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
const supersessionMigration = fs.readFileSync(path.join(
  root, 'database', 'migrations', '20261018_ticket_82e_turn_supersession.sql'
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

function claimedUpdateOuterAliases(sql) {
  const claimed = sql.match(/\), claimed AS \(\n([\s\S]*?)\n\), claimed_anchor AS \(/)?.[1];
  assert.ok(claimed, 'claim SQL must contain its claimed UPDATE CTE');
  const from = claimed.match(/\n  FROM ([\s\S]*?)\n  WHERE /)?.[1];
  const where = claimed.match(/\n  WHERE ([\s\S]*?)\n    AND NOT EXISTS /)?.[1];
  assert.ok(from && where, 'claimed UPDATE must retain explicit FROM and outer WHERE clauses');
  const declared = new Set(['message']);
  for (const match of from.matchAll(/(?:^|\s(?:CROSS JOIN|JOIN))\s*([a-z_][a-z_0-9]*)/gi)) {
    declared.add(match[1]);
  }
  return { declared, referenced: [...where.matchAll(/\b([a-z_][a-z_0-9]*)\./gi)].map((match) => match[1]) };
}

class ReferenceQueue {
  constructor() {
    this.nextOrder = 1;
    this.bySid = new Map();
    this.outboundKeys = new Set();
  }

  reserve(session, sid, body, receivedAt = 0) {
    if (this.bySid.has(sid)) return null;
    const row = {
      id: `in-${sid}`,
      session,
      sid,
      body,
      receivedAt,
      order: this.nextOrder++,
      anchorId: null,
      owner: null,
      leaseUntil: 0,
      completed: false,
      outcome: null,
      outboundStatus: null,
    };
    this.bySid.set(sid, row);
    return row;
  }

  membersFor(head) {
    const ordered = [...this.bySid.values()]
      .filter((row) => row.session === head.session && !row.completed)
      .sort((a, b) => a.order - b.order);
    const completedBoundary = [...this.bySid.values()]
      .filter((row) => row.session === head.session && row.completed && row.order > head.order)
      .sort((a, b) => a.order - b.order)[0];
    const members = [];
    for (const row of ordered) {
      if (row.order < head.order || (completedBoundary && row.order >= completedBoundary.order)) continue;
      const prior = members.at(-1);
      if (prior && row.receivedAt > prior.receivedAt + ordering.TURN_QUIET_SECONDS * 1000) break;
      members.push(row);
    }
    return members;
  }

  finishGroup(anchor, outcome) {
    for (const row of [...this.bySid.values()]) {
      if (!row.completed && (row.anchorId || row.id) === anchor.id) {
        row.completed = true;
        row.outcome = outcome;
        row.owner = null;
        row.leaseUntil = 0;
      }
    }
  }

  supersedeIfMovedOn(head, now) {
    const members = this.membersFor(head);
    const next = [...this.bySid.values()]
      .filter((row) => row.session === head.session && !row.completed && !members.includes(row))
      .sort((a, b) => a.order - b.order)[0];
    if (!next || head.outboundStatus
      || members.some((row) => row.owner && row.leaseUntil > now)) return false;
    for (const row of members) {
      row.completed = true;
      row.outcome = 'superseded';
      row.owner = null;
      row.leaseUntil = 0;
      row.anchorId = head.id;
      row.supersededBy = next.id;
    }
    return true;
  }

  claim(session, owner, now = Date.now()) {
    const head = [...this.bySid.values()]
      .filter((row) => row.session === session && !row.completed)
      .sort((a, b) => a.order - b.order)[0];
    if (!head) return { state: 'empty' };
    if (this.supersedeIfMovedOn(head, now)) return this.claim(session, owner, now);
    if (head.owner && head.leaseUntil > now && head.owner !== owner) {
      return { state: 'busy', row: head };
    }
    if (head.owner && head.leaseUntil <= now
      && ['accepted', 'scheduled', 'sent', 'delivered'].includes(head.outboundStatus)) {
      this.finishGroup(head, 'reconciliation');
      return this.claim(session, owner, now);
    }
    if (head.outboundStatus) return { state: 'reconciliation', row: head };
    const members = this.membersFor(head);
    const newestReceivedAt = Math.max(...members.map(row => row.receivedAt));
    if (newestReceivedAt > now - ordering.TURN_QUIET_SECONDS * 1000) {
      return { state: 'deferred', row: head, quietUntil: newestReceivedAt + ordering.TURN_QUIET_SECONDS * 1000 };
    }
    if (members.some(row => row.owner && row.leaseUntil > now && row.owner !== owner)) {
      return { state: 'busy', row: head };
    }
    for (const row of members) {
      row.owner = owner;
      row.leaseUntil = now + ordering.SESSION_LEASE_MINUTES * 60_000;
      row.anchorId = head.id;
    }
    return { state: 'acquired', row: head, anchor: head, members,
      combinedBody: members.map(row => row.body).join('\n') };
  }

  reserveOutbound(turn, owner, suffix) {
    const anchor = turn.anchor || turn.row || turn;
    const members = turn.members || this.membersFor(anchor);
    if (members.some(row => row.owner !== owner || row.completed)) return false;
    const key = `reply:${anchor.sid}:${suffix}`;
    if (this.outboundKeys.has(key)) return false;
    this.outboundKeys.add(key);
    anchor.outboundStatus = 'pending';
    return true;
  }

  release(turn, owner) {
    for (const row of turn.members) {
      assert.equal(row.owner, owner);
      row.owner = null;
      row.leaseUntil = 0;
    }
  }

  complete(turn, owner) {
    const anchor = turn.anchor || turn.row || turn;
    assert.equal(anchor.outboundStatus, 'accepted');
    for (const row of turn.members || this.membersFor(anchor)) {
      assert.equal(row.owner, owner);
      row.completed = true;
      row.outcome = 'completed';
      row.owner = null;
      row.leaseUntil = 0;
    }
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

test('human-paced fragments reset the sliding quiet deadline and claim one anchored turn', () => {
  const queue = new ReferenceQueue();
  queue.reserve('session-a', 'A', 'Papa', 1000);
  queue.reserve('session-a', 'B', 'Zanahoria', 5000);
  queue.reserve('session-a', 'C', 'Ejotes', 9000);
  queue.reserve('session-a', 'D', 'Pepino', 14000);
  queue.reserve('session-a', 'E', 'Carne de res', 18000);
  const deferred = queue.claim('session-a', 'worker', 27000);
  assert.equal(deferred.state, 'deferred');
  assert.equal(deferred.quietUntil, 28000);
  const claim = queue.claim('session-a', 'worker', 28000);
  assert.equal(claim.state, 'acquired');
  assert.equal(claim.anchor.sid, 'A');
  assert.equal(claim.combinedBody, 'Papa\nZanahoria\nEjotes\nPepino\nCarne de res');
  assert.deepEqual(claim.members.map(row => row.sid), ['A', 'B', 'C', 'D', 'E']);
  assert.ok(claim.members.every(row => row.owner === 'worker' && row.anchorId === claim.anchor.id));
  assert.equal(queue.claim('session-a', 'other', 28001).state, 'busy');
});

test('a completed prior turn is a hard boundary before a new rapid B/C group', () => {
  const queue = new ReferenceQueue();
  queue.reserve('session-a', 'A', 'A', 0);
  const first = queue.claim('session-a', 'worker-a', 10000);
  assert.equal(first.state, 'acquired');
  assert.equal(queue.reserveOutbound(first, 'worker-a', 'sales'), true);
  first.anchor.outboundStatus = 'accepted';
  queue.complete(first, 'worker-a');
  queue.reserve('session-a', 'B', 'B', 20000);
  queue.reserve('session-a', 'C', 'C', 24000);
  assert.equal(queue.claim('session-a', 'worker-b', 33000).state, 'deferred');
  const second = queue.claim('session-a', 'worker-b', 34000);
  assert.equal(second.state, 'acquired');
  assert.equal(second.anchor.sid, 'B');
  assert.equal(second.combinedBody, 'B\nC');
  assert.deepEqual(second.members.map(row => row.sid), ['B', 'C']);
});

test('a normal single message waits for the ten-second quiet deadline', () => {
  const queue = new ReferenceQueue();
  queue.reserve('session-a', 'A', 'Tengo pollo, tortillas y aguacate', 1000);
  const deferred = queue.claim('session-a', 'worker', 10999);
  assert.equal(deferred.state, 'deferred');
  assert.equal(deferred.quietUntil, 11000);
  assert.equal(queue.claim('session-a', 'worker', 11000).state, 'acquired');
});

test('an old pre-outbound burst is superseded when a later independent turn exists', () => {
  const queue = new ReferenceQueue();
  queue.reserve('session-a', 'A', 'Jitomate', 0);
  queue.reserve('session-a', 'B', 'Frijoles', 1000);
  const later = queue.reserve('session-a', 'C', '¡Hola! Quiero saber más.', 60000);

  const laterTurn = queue.claim('session-a', 'next-worker', 70000);
  assert.equal(laterTurn.state, 'acquired');
  assert.equal(laterTurn.combinedBody, '¡Hola! Quiero saber más.');
  assert.deepEqual(laterTurn.members.map(row => row.sid), ['C']);
  assert.equal(later.owner, 'next-worker');
  for (const row of [queue.bySid.get('A'), queue.bySid.get('B')]) {
    assert.equal(row.completed, true);
    assert.equal(row.outcome, 'superseded');
    assert.equal(row.supersededBy, later.id);
  }
  assert.equal(queue.claim('session-a', 'later-worker', 70001).state, 'busy');
});

test('an old unfinished burst without a newer temporal turn remains recoverable', () => {
  const queue = new ReferenceQueue();
  queue.reserve('session-a', 'A', 'Jitomate', 0);
  queue.reserve('session-a', 'B', 'Frijoles', 1000);
  const recovery = queue.claim('session-a', 'recovery-worker', 11000);
  assert.equal(recovery.state, 'acquired');
  assert.equal(recovery.combinedBody, 'Jitomate\nFrijoles');
  assert.ok(recovery.members.every((row) => !row.completed));
});

test('multiple stale temporal groups are all superseded before the newest turn is claimed', () => {
  const queue = new ReferenceQueue();
  queue.reserve('session-a', 'A', 'old-a', 0);
  queue.reserve('session-a', 'B', 'old-b', 11000);
  queue.reserve('session-a', 'C', 'current', 22000);
  const claim = queue.claim('session-a', 'worker', 32000);
  assert.equal(claim.state, 'acquired');
  assert.equal(claim.combinedBody, 'current');
  assert.equal(queue.bySid.get('A').outcome, 'superseded');
  assert.equal(queue.bySid.get('B').outcome, 'superseded');
  assert.equal(queue.bySid.get('C').outcome, null);
});

test('a reserved old burst is not superseded and remains on reconciliation', () => {
  const queue = new ReferenceQueue();
  queue.reserve('session-a', 'A', 'old', 0);
  const old = queue.claim('session-a', 'worker', 10000);
  assert.equal(queue.reserveOutbound(old, 'worker', 'sales'), true);
  queue.release(old, 'worker');
  queue.reserve('session-a', 'B', 'new', 60000);
  const result = queue.claim('session-a', 'next-worker', 70000);
  assert.equal(result.state, 'reconciliation');
  assert.equal(queue.bySid.get('A').completed, false);
  assert.equal(queue.bySid.get('A').outcome, null);
});

test('pre-reservation failure releases and retries the whole coalesced group', () => {
  const queue = new ReferenceQueue();
  for (const sid of ['A', 'B', 'C']) queue.reserve('session-a', sid, sid, 0);
  const initial = queue.claim('session-a', 'failed-ce', 10000);
  assert.equal(initial.state, 'acquired');
  queue.release(initial, 'failed-ce');
  assert.ok(initial.members.every(row => row.owner === null && !row.completed));
  const retry = queue.claim('session-a', 'retry-worker', 10001);
  assert.equal(retry.state, 'acquired');
  assert.equal(retry.anchor.sid, 'A');
  assert.equal(retry.combinedBody, 'A\nB\nC');
  assert.deepEqual(retry.members.map(row => row.sid), ['A', 'B', 'C']);
});

test('accepted anchor reply completes or reconciles every absorbed member', () => {
  const queue = new ReferenceQueue();
  for (const sid of ['A', 'B', 'C']) queue.reserve('session-a', sid, sid, 0);
  const turn = queue.claim('session-a', 'worker', 10000);
  assert.equal(queue.reserveOutbound(turn, 'worker', 'sales'), true);
  turn.anchor.outboundStatus = 'accepted';
  queue.complete(turn, 'worker');
  assert.ok(turn.members.every(row => row.completed && row.outcome === 'completed'));
  assert.equal(queue.claim('session-a', 'next', 6000).state, 'empty');

  const recovery = new ReferenceQueue();
  for (const sid of ['A', 'B', 'C']) recovery.reserve('session-a', sid, sid, 0);
  const claimed = recovery.claim('session-a', 'dead-worker', 10000);
  assert.equal(recovery.reserveOutbound(claimed, 'dead-worker', 'sales'), true);
  claimed.anchor.outboundStatus = 'accepted';
  for (const row of claimed.members) row.leaseUntil = 1;
  assert.equal(recovery.claim('session-a', 'recovery-worker', 10001).state, 'empty');
  assert.ok(claimed.members.every(row => row.completed && row.outcome === 'reconciliation'));
  assert.equal(recovery.outboundKeys.size, 1);
});

test('coalesced turns never combine members from different sessions', () => {
  const queue = new ReferenceQueue();
  queue.reserve('session-a', 'A1', 'A1', 0);
  queue.reserve('session-a', 'A2', 'A2', 0);
  queue.reserve('session-b', 'B1', 'B1', 0);
  queue.reserve('session-b', 'B2', 'B2', 0);
  const a = queue.claim('session-a', 'worker-a', 10000);
  const b = queue.claim('session-b', 'worker-b', 10000);
  assert.equal(a.combinedBody, 'A1\nA2');
  assert.equal(b.combinedBody, 'B1\nB2');
  assert.ok(a.members.every(row => row.session === 'session-a'));
  assert.ok(b.members.every(row => row.session === 'session-b'));
});

test('quiet-gated claim exposes a single explicit ten-second turn boundary', () => {
  assert.equal(ordering.TURN_QUIET_SECONDS, 10);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /'deferred'::text AS claim_state/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /newest_received_at > NOW\(\) - INTERVAL '10 seconds'/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /STRING_AGG\(COALESCE\(body, ''\), E'\\n'/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /\(ARRAY_AGG\(id ORDER BY processing_order, id\)\)\[1\] AS anchor_id/);
  assert.doesNotMatch(ordering.CLAIM_NEXT_INBOUND_SQL, /\b(?:MIN|MAX)\s*\(\s*(?:members\.)?id\s*\)/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /turn_anchor_id/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /completed_boundary/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /members_with_gap/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /burst_boundary/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /LAG\(timestamp\) OVER \(ORDER BY processing_order, id\)/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /timestamp > prior_received_at \+ INTERVAL '10 seconds'/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /processing_outcome = 'superseded'/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /turn_superseded_by_anchor_id/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /newer_independent_turn/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /initial_group_summary/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /superseded_groups/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /outbound\.in_reply_to_id = superseded_groups\.anchor_id/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /message\.id NOT IN \(SELECT id FROM superseded\)/);
  assert.match(ordering.COMPLETE_INBOUND_SQL, /COALESCE\(message\.metadata->>'turn_anchor_id', message\.id::text\) = anchor\.id::text/);
});

test('claimed UPDATE outer WHERE references only aliases available in its FROM clause', () => {
  const { declared, referenced } = claimedUpdateOuterAliases(ordering.CLAIM_NEXT_INBOUND_SQL);
  assert.ok(declared.has('turn_members'));
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /WHERE message\.id = turn_members\.id/);
  for (const alias of referenced) {
    assert.ok(declared.has(alias), `claimed UPDATE outer WHERE references unavailable alias: ${alias}`);
  }
  assert.equal(nodes.get('Claim Next Session Inbound').parameters.query, ordering.CLAIM_NEXT_INBOUND_SQL);
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
  assert.equal(queue.claim('session-a', 'dead-worker', 10000).state, 'acquired');
  assert.equal(queue.claim('session-a', 'recovery', a.leaseUntil + 1).row.sid, 'A');

  queue.reserveOutbound(a, 'recovery', 'sales');
  a.leaseUntil = 100;
  queue.reserve('session-a', 'B', 'second');
  const unresolved = queue.claim('session-a', 'next-worker', 101);
  assert.equal(unresolved.state, 'reconciliation');
  assert.equal(a.completed, false);
  a.outboundStatus = 'accepted';
  const recovered = queue.claim('session-a', 'next-worker', 5000);
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

test('workflow terminates busy claims and waits only for database-computed quiet boundaries after reservation', () => {
  assert.deepEqual(outputs('Incoming Message'), ['Canonicalize Inbound WhatsApp']);
  assert.deepEqual(outputs('Canonicalize Inbound WhatsApp'), ['Reserve Canonical Inbound Message']);
  assert.deepEqual(outputs('Reserve Canonical Inbound Message'), ['Claim Next Session Inbound']);
  assert.deepEqual(outputs('Route Session Claim State', 0), ['Get V4 Conversation Context']);
  assert.deepEqual(outputs('Route Session Claim State', 1), ['Wait For Turn Quiet Period']);
  assert.deepEqual(outputs('Wait For Turn Quiet Period'), ['Claim Next Session Inbound']);
  assert.deepEqual(outputs('Route Session Claim State', 2), ['End — Turn Already Owned']);
  assert.deepEqual(outputs('End — Turn Already Owned'), []);
  assert.deepEqual(nodes.get('Wait For Turn Quiet Period').parameters, {
    resume: 'specificTime', dateTime: '={{ $json.quiet_until }}',
  });
  // Captured from the isolated n8n 2.43.5 deferred claim execution. The
  // Postgres node supplies a string, not a Date, so calling toISOString()
  // would resolve the Wait expression to undefined.
  const quietUntil = '2026-10-18T16:55:57.340Z';
  assert.match(quietUntil, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(new Date(quietUntil).toISOString(), quietUntil);
  assert.equal(nodes.get('Wait Before Session Claim Retry'), undefined);
  assert.deepEqual(nodes.get('End — Turn Already Owned').parameters, { jsCode: 'return $input.all();' });
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

test('canonical history omits terminal superseded customer turns', () => {
  const historySql = nodes.get('Get Direct RAG Conversation History').parameters.query;
  assert.match(historySql, /message\.processing_outcome IS DISTINCT FROM 'superseded'/);
  assert.match(historySql, /replied_inbound\.processing_outcome IS DISTINCT FROM 'superseded'/);
  assert.match(historySql, /anchor\.processing_outcome IS DISTINCT FROM 'superseded'/);
  assert.match(historySql, /member\.processing_outcome IS DISTINCT FROM 'superseded'/);
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
  // The Checkout implementation remains intact, but the active Direct RAG GLP-1
  // pilot deliberately has no route that can authorize it from a claimed inbound.
  assert.equal(reachable('Claim Next Session Inbound', 'Persist Checkout Authorization v3'), false);
  assert.equal(reachable('Route Authorized Sales Action', 'Persist Checkout Authorization v3'), true);
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
  assert.ok(ordering.COMPLETE_INBOUND_SQL.includes(require('../lib/logical-reply').fullyAcceptedSql('anchor.id')));
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
  assert.match(supersessionMigration, /'superseded'/);
  assert.match(schema, /'superseded'::text/);
  assert.match(generator, /processing_outcome IS DISTINCT FROM 'superseded'/);
  assert.match(schema, /messages_inbound_processing_order_seq/);
  assert.match(schema, /messages_session_processing_queue_idx/);
  assert.match(generator, /require\('\.\.\/lib\/session-ordering'\)/);
  assert.match(generator, /workflow\.active = false/);
  assert.ok(nodes.has('Claim Next Session Inbound'));
  assert.ok(nodes.has('Mark Session Inbound Complete'));
});
