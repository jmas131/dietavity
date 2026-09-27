'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ordering = require('../lib/session-ordering');

const root = path.resolve(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(
  root, 'n8n', 'Dietavity Sales Engine (Ticket 10).json'
), 'utf8'));
const errorWorkflow = JSON.parse(fs.readFileSync(path.join(
  root, 'n8n', 'Global Error Handler.json'
), 'utf8'));
const migration = fs.readFileSync(path.join(
  root, 'database', 'migrations', '20260818_ticket_17_session_inbound_ordering.sql'
), 'utf8');
const schema = fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8');
const generator = fs.readFileSync(path.join(root, 'scripts', 'refactor-ticket-10-workflow.js'), 'utf8');
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));

function outputs(name, index = 0) {
  return (workflow.connections[name]?.main?.[index] || []).map((edge) => edge.node);
}

function reachable(start, target) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    if (current === target) return true;
    for (const groups of Object.values(workflow.connections[current] || {})) {
      for (const group of groups || []) {
        for (const edge of group || []) {
          if (!seen.has(edge.node)) {
            seen.add(edge.node);
            queue.push(edge.node);
          }
        }
      }
    }
  }
  return false;
}

class ReferenceQueue {
  constructor() {
    this.nextOrder = 1;
    this.bySid = new Map();
    this.outboundKeys = new Set();
  }

  reserve(session, sid, body) {
    if (this.bySid.has(sid)) return null;
    const row = {
      id: `in-${sid}`,
      session,
      sid,
      body,
      order: this.nextOrder++,
      owner: null,
      leaseUntil: 0,
      completed: false,
      outcome: null,
      outboundStatus: null,
    };
    this.bySid.set(sid, row);
    return row;
  }

  claim(session, owner, now = Date.now()) {
    const head = [...this.bySid.values()]
      .filter((row) => row.session === session && !row.completed)
      .sort((a, b) => a.order - b.order)[0];
    if (!head) return { state: 'empty' };
    if (head.owner && head.leaseUntil > now && head.owner !== owner) {
      return { state: 'busy', row: head };
    }
    if (head.owner && head.leaseUntil <= now
      && ['accepted', 'scheduled', 'sent', 'delivered'].includes(head.outboundStatus)) {
      head.completed = true;
      head.outcome = 'reconciliation';
      head.owner = null;
      return this.claim(session, owner, now);
    }
    if (head.outboundStatus) return { state: 'reconciliation', row: head };
    head.owner = owner;
    head.leaseUntil = now + ordering.SESSION_LEASE_MINUTES * 60_000;
    return { state: 'acquired', row: head };
  }

  reserveOutbound(row, owner, suffix) {
    if (row.owner !== owner || row.completed) return false;
    const key = `reply:${row.sid}:${suffix}`;
    if (this.outboundKeys.has(key)) return false;
    this.outboundKeys.add(key);
    row.outboundStatus = 'pending';
    return true;
  }

  complete(row, owner) {
    assert.equal(row.owner, owner);
    row.completed = true;
    row.outcome = 'completed';
    row.owner = null;
  }
}

class PerSessionRunner {
  constructor() {
    this.tails = new Map();
  }

  run(session, work) {
    const prior = this.tails.get(session) || Promise.resolve();
    const current = prior.then(work, work);
    this.tails.set(session, current.catch(() => {}));
    return current;
  }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('production fixture remains A then B even when A generation is slower', async () => {
  const runner = new PerSessionRunner();
  const visible = [];
  const a = runner.run('+5215550000001', async () => {
    await delay(35);
    visible.push('illustrative example');
  });
  await delay(2);
  const b = runner.run('+5215550000001', async () => {
    await delay(1);
    visible.push('price response');
  });
  await Promise.all([a, b]);
  assert.deepEqual(visible, ['illustrative example', 'price response']);
});

test('distinct SIDs survive and duplicate delivery still deduplicates independently', () => {
  const queue = new ReferenceQueue();
  assert.ok(queue.reserve('session-a', 'SID_A', 'Sip'));
  assert.ok(queue.reserve('session-a', 'SID_B', '¿Cuánto cuesta?'));
  assert.equal(queue.reserve('session-a', 'SID_A', 'Sip'), null);
  assert.equal(queue.bySid.size, 2);

  const reserveSql = nodes.get('Reserve Canonical Inbound Message').parameters.query;
  assert.match(reserveSql, /ON CONFLICT \(idempotency_key\)[\s\S]*DO NOTHING/);
  assert.match(reserveSql, /nextval\('public\.messages_inbound_processing_order_seq'\)/);
});

test('three-message bursts claim in reservation order without loss or duplicates', () => {
  const queue = new ReferenceQueue();
  for (const sid of ['A', 'B', 'C']) queue.reserve('session-a', sid, sid);
  const observed = [];
  for (let index = 0; index < 3; index += 1) {
    const claim = queue.claim('session-a', `worker-${index}`);
    assert.equal(claim.state, 'acquired');
    assert.equal(queue.reserveOutbound(claim.row, `worker-${index}`, 'sales'), true);
    observed.push(claim.row.sid);
    queue.complete(claim.row, `worker-${index}`);
  }
  assert.deepEqual(observed, ['A', 'B', 'C']);
  assert.equal(queue.claim('session-a', 'last').state, 'empty');
  assert.equal(queue.outboundKeys.size, 3);
});

test('different sessions do not share a lock or execution tail', async () => {
  const runner = new PerSessionRunner();
  const visible = [];
  const slow = runner.run('session-a', async () => {
    await delay(35);
    visible.push('A');
  });
  const fast = runner.run('session-b', async () => {
    await delay(1);
    visible.push('B');
  });
  await Promise.all([slow, fast]);
  assert.deepEqual(visible, ['B', 'A']);

  const claimSql = nodes.get('Claim Next Session Inbound').parameters.query;
  assert.match(claimSql, /hashtextextended\(input\.payload->>'session_id'/);
  assert.doesNotMatch(JSON.stringify(workflow.settings), /concurrency/i);
});

test('lease recovery preserves ambiguous work until acceptance is reconciled', () => {
  const queue = new ReferenceQueue();
  const a = queue.reserve('session-a', 'A', 'first');
  assert.equal(queue.claim('session-a', 'dead-worker', 100).state, 'acquired');
  assert.equal(queue.claim('session-a', 'recovery', a.leaseUntil + 1).row.sid, 'A');

  queue.reserveOutbound(a, 'recovery', 'sales');
  a.leaseUntil = 100;
  queue.reserve('session-a', 'B', 'second');
  const unresolved = queue.claim('session-a', 'next-worker', 101);
  assert.equal(unresolved.state, 'reconciliation');
  assert.equal(a.completed, false);
  a.outboundStatus = 'accepted';
  const recovered = queue.claim('session-a', 'next-worker', 102);
  assert.equal(a.outcome, 'reconciliation');
  assert.equal(recovered.row.sid, 'B');

  const claimSql = nodes.get('Claim Next Session Inbound').parameters.query;
  assert.match(claimSql, /processing_lease_until <= NOW\(\)/);
  assert.match(claimSql, /processing_outcome = 'reconciliation'/);
  assert.match(claimSql, /checkout_authorization_type = NULL/);
  const errorSql = errorWorkflow.nodes.find((node) => node.name === 'Insert Error Log (Error Handler)').parameters.query;
  assert.match(errorSql, /claim_released_by_error_handler_at/);
  assert.match(errorSql, /processing_outcome = CASE/);
});

test('workflow waits only on a busy same-session claim after Twilio reservation', () => {
  assert.deepEqual(outputs('Incoming Message'), ['Canonicalize Inbound WhatsApp']);
  assert.deepEqual(outputs('Canonicalize Inbound WhatsApp'), ['Reserve Canonical Inbound Message']);
  assert.deepEqual(outputs('Reserve Canonical Inbound Message'), ['Claim Next Session Inbound']);
  assert.deepEqual(outputs('Route Session Claim State', 0), ['Route Sales Engine V2 Claim']);
  assert.deepEqual(outputs('Route Sales Engine V2 Claim'), ['Route Sales Engine V2 Mode', 'Build V2 Route Diagnostic']);
  assert.deepEqual(outputs('Route Sales Engine V2 Mode', 0), ['Get User from Supabase']);
  assert.deepEqual(outputs('Route Session Claim State', 1), ['Wait Before Session Claim Retry']);
  assert.deepEqual(outputs('Wait Before Session Claim Retry'), ['Claim Next Session Inbound']);
  assert.equal(nodes.get('Wait Before Session Claim Retry').parameters.amount, ordering.CLAIM_RETRY_SECONDS);
  assert.equal(nodes.get('Incoming Message').type, 'n8n-nodes-base.twilioTrigger');
  for (const node of workflow.nodes) {
    if (node.name === 'Canonicalize Inbound WhatsApp') continue;
    assert.doesNotMatch(
      JSON.stringify(node.parameters),
      /\$\('Incoming Message'\)/,
      `${node.name} must consume the claimed canonical inbound, not this execution's raw trigger`,
    );
  }
});

test('only the current lease owner may reserve any inbound customer response', () => {
  const reservationNames = [
    'Reserve Paid Assistant Reply', 'Reserve Sales Reply', 'Reserve Checkout Reply',
    'Reserve Media Clarification', 'Reserve Legacy Cancellation Success',
    'Reserve Legacy Cancellation Failure', 'Reserve Reminder Confirmation',
    'Reserve Scheduled Reminder',
  ];
  for (const name of reservationNames) {
    const node = nodes.get(name);
    assert.match(node.parameters.query, /inbound\.processing_owner = input\.payload->>'processing_owner'/, name);
    assert.match(node.parameters.query, /EXISTS \(SELECT 1 FROM renewed_claim\)/, name);
    assert.match(node.parameters.options.queryReplacement, /processing_owner: \$execution\.id/, name);
    assert.match(node.parameters.query, /ON CONFLICT \(idempotency_key\)[\s\S]*DO NOTHING/, name);
  }
});

test('Checkout and purchase-confirmation state are ordered and remain fail-closed', () => {
  assert.equal(reachable('Claim Next Session Inbound', 'Persist Checkout Authorization v3'), true);
  assert.equal(reachable('Mark Checkout Sent v3', 'Mark Session Inbound Complete'), true);
  assert.equal(reachable('Persist Sales Response State and Events', 'Mark Session Inbound Complete'), true);
  assert.match(nodes.get('Persist Checkout Authorization v3').parameters.query, /checkout_authorized.*IS TRUE/);
  assert.match(nodes.get('Persist Checkout Authorization v3').parameters.query, /purchase_confirmation/);
  assert.match(nodes.get('Reserve Checkout Reply').parameters.options.queryReplacement, /reply:.*:checkout/);
  assert.match(nodes.get('Claim Next Session Inbound').parameters.query, /last_question_type = NULL/);
});

test('a later yes cannot consume an assistant question that has not reached the safe boundary', () => {
  const completionPredecessors = [];
  for (const [source, groups] of Object.entries(workflow.connections)) {
    for (const group of groups.main || []) {
      if ((group || []).some((edge) => edge.node === 'Mark Session Inbound Complete')) {
        completionPredecessors.push(source);
      }
    }
  }
  assert.ok(completionPredecessors.includes('Persist Sales Response State and Events'));
  assert.ok(!completionPredecessors.includes('Reserve Sales Reply'));
  assert.ok(!completionPredecessors.includes('Respond to Chat'));
  assert.ok(ordering.COMPLETE_INBOUND_SQL.includes(require('../lib/logical-reply').fullyAcceptedSql('message.id')));
});

test('reminder scheduling and confirmation finish before the session advances', () => {
  assert.deepEqual(outputs('Assert Scheduled Reminder Accepted'), ['Validate Scheduled Reminder']);
  assert.equal(reachable('Assert Scheduled Reminder Accepted', 'Persist Requested Reminder'), true);
  assert.equal(reachable('Persist Requested Reminder', 'Assert Reminder Confirmation Accepted'), true);
  assert.deepEqual(outputs('Assert Reminder Confirmation Accepted'), ['Mark Session Inbound Complete']);
  assert.match(nodes.get('Persist Requested Reminder').parameters.query, /ON CONFLICT \(event_key\)/);
});

test('canonical outbound linkage follows the claimed inbound, not trigger completion order', () => {
  for (const name of ['Reserve Sales Reply', 'Reserve Checkout Reply', 'Reserve Paid Assistant Reply']) {
    const replacement = nodes.get(name).parameters.options.queryReplacement;
    assert.match(replacement, /in_reply_to_id: \$\('Claim Next Session Inbound'\)\.item\.json\.id/, name);
    assert.doesNotMatch(replacement, /Reserve Canonical Inbound Message/, name);
  }
  assert.match(nodes.get('Claim Next Session Inbound').parameters.query, /ORDER BY message\.processing_order, message\.id/);
});

test('paid-user and legacy cancellation paths use the same session claim', () => {
  assert.equal(reachable('Get User from Supabase', 'Reserve Paid Assistant Reply'), true);
  assert.equal(reachable('Get User from Supabase', 'Reserve Legacy Cancellation Success'), true);
  assert.equal(reachable('Get User from Supabase', 'Reserve Legacy Cancellation Failure'), true);
  assert.deepEqual(outputs('Update Last Assistant Message'), ['Mark Session Inbound Complete']);
  assert.deepEqual(outputs('Assert Legacy Cancellation Success Accepted'), ['Mark Session Inbound Complete']);
  assert.deepEqual(outputs('Assert Legacy Cancellation Failure Accepted'), ['Mark Session Inbound Complete']);
});

test('migration, schema snapshot, generator, and generated artifact stay synchronized', () => {
  for (const column of [
    'processing_order bigint', 'processing_owner text',
    'processing_lease_until timestamptz', 'processing_completed_at timestamptz',
    'processing_outcome text',
  ]) assert.match(migration, new RegExp(column));
  assert.match(migration, /messages_session_processing_queue_idx/);
  assert.match(migration, /historical_completed/);
  assert.match(schema, /messages_inbound_processing_order_seq/);
  assert.match(schema, /messages_session_processing_queue_idx/);
  assert.match(generator, /require\('\.\.\/lib\/session-ordering'\)/);
  assert.match(generator, /workflow\.active = false/);
  assert.ok(nodes.has('Claim Next Session Inbound'));
  assert.ok(nodes.has('Mark Session Inbound Complete'));
});
