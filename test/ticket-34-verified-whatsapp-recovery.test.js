'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(
  root, 'n8n', 'Dietavity Sales Engine (Ticket 10).json'
), 'utf8'));
const errorWorkflow = JSON.parse(fs.readFileSync(path.join(
  root, 'n8n', 'Global Error Handler.json'
), 'utf8'));
const linkingMigration = fs.readFileSync(path.join(
  root, 'database', 'migrations',
  '20260827_ticket_28a_pending_whatsapp_linking.sql'
), 'utf8');
const schema = fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8');
const poller = JSON.parse(fs.readFileSync(path.join(root, 'n8n', 'Dietavity WhatsApp Recovery Poller.json'), 'utf8'));
const pollerNodes = new Map(poller.nodes.map(node => [node.name, node]));
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));

function outputs(name, index = 0) {
  return (workflow.connections[name]?.main?.[index] || []).map((edge) => edge.node);
}

function isRecoveryEligible(message, now) {
  return message.direction === 'inbound'
    && message.processing_order !== null
    && message.processing_order !== undefined
    && message.processing_completed_at === null
    && !(message.processing_owner
      && message.processing_lease_until
      && message.processing_lease_until > now);
}

test('WhatsApp recovery is a one-minute scheduled ledger wake-up', () => {
  const trigger = pollerNodes.get('Resume Verified WhatsApp Requests');
  const finder = pollerNodes.get('Find Verified WhatsApp Sessions');

  assert.equal(trigger.type, 'n8n-nodes-base.scheduleTrigger');
  assert.deepEqual(trigger.parameters.rule.interval, [{
    field: 'minutes',
    minutesInterval: 1,
  }]);
  assert.deepEqual(poller.connections[trigger.name].main[0].map(edge => edge.node), [finder.name]);
  assert.deepEqual(poller.connections[finder.name].main[0].map(edge => edge.node), ['Execute Dietavity Sales Engine']);
  assert.deepEqual(outputs('Receive Verified WhatsApp Sessions'), ['Claim Next Session Inbound']);
  assert.equal(finder.type, 'n8n-nodes-base.postgres');
  assert.equal(finder.parameters.operation, 'executeQuery');
});

test('the read-only wake-up lookup selects only unfinished work without a live lease', () => {
  const sql = pollerNodes.get('Find Verified WhatsApp Sessions').parameters.query;

  assert.match(sql, /^SELECT DISTINCT message\.session_id/m);
  assert.match(sql, /FROM public\.messages AS message/);
  assert.doesNotMatch(sql, /JOIN public\.users AS app_user/);
  assert.match(sql, /message\.direction = 'inbound'/);
  assert.match(sql, /message\.processing_order IS NOT NULL/);
  assert.match(sql, /message\.processing_completed_at IS NULL/);
  assert.match(sql, /message\.processing_owner IS NULL/);
  assert.match(sql, /message\.processing_lease_until IS NULL/);
  assert.match(sql, /message\.processing_lease_until <= NOW\(\)/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CALL)\b/i);

  const now = Date.now();
  assert.equal(isRecoveryEligible({ direction: 'inbound', processing_order: 1, processing_completed_at: null, processing_owner: null, processing_lease_until: null }, now), true, 'ordinary unclaimed inbound wakes');
  assert.equal(isRecoveryEligible({ direction: 'inbound', processing_order: 1, processing_completed_at: null, processing_owner: 'failed-execution', processing_lease_until: now - 1 }, now), true, 'expired lease wakes');
  assert.equal(isRecoveryEligible({ direction: 'inbound', processing_order: 1, processing_completed_at: null, processing_owner: 'active-execution', processing_lease_until: now + 1 }, now), false, 'live lease does not wake');
  assert.equal(isRecoveryEligible({ direction: 'inbound', processing_order: 1, processing_completed_at: now, processing_owner: null, processing_lease_until: null }, now), false, 'completed inbound does not wake');

  // Link verification was formerly the only poller predicate. It remains a
  // canonical inbound and is therefore still woken when its lease is absent.
  assert.equal(isRecoveryEligible({ direction: 'inbound', processing_order: 1, processing_completed_at: null, processing_owner: null, processing_lease_until: null, metadata: { identity_verification_purpose: 'link_whatsapp', identity_verification_state: 'verified' } }, now), true, 'verified link_whatsapp remains eligible');

  const verifiedBranch = linkingMigration.match(
    /ELSIF target_request\.purpose = 'link_whatsapp'[\s\S]*?END IF;/
  )?.[0] || '';
  assert.match(verifiedBranch, /processing_owner = NULL/);
  assert.match(verifiedBranch, /processing_lease_until = NULL/);
  assert.match(verifiedBranch, /processing_completed_at = NULL/);
  assert.match(verifiedBranch, /identity_verification_state', 'verified'/);
  assert.doesNotMatch(verifiedBranch, /identity_verification_state', 'pending'/);
});

test('poller delegates durable-outbound reconciliation, concurrent ownership, and V4 routing to the canonical Sales Engine', () => {
  const claim = nodes.get('Claim Next Session Inbound');
  const v4Context = nodes.get('Get V4 Conversation Context');

  assert.deepEqual(outputs('Receive Verified WhatsApp Sessions'), [claim.name]);
  assert.match(claim.parameters.query, /pg_advisory_xact_lock/);
  assert.match(claim.parameters.query, /processing_lease_until <= NOW\(\)/);
  assert.match(claim.parameters.query, /outbound\.in_reply_to_id = candidate\.id/);
  assert.match(claim.parameters.query, /'reconciliation'::text AS claim_state/);
  assert.match(claim.parameters.query, /NOT EXISTS \(\s*SELECT 1\s*FROM public\.messages AS outbound[\s\S]*outbound\.in_reply_to_id = turn\.anchor_id/);
  assert.deepEqual(outputs('Route Session Claim State'), [v4Context.name]);
  assert.deepEqual(outputs(v4Context.name), ['Build V4 Conversation Engine Request']);
  assert.doesNotMatch(JSON.stringify(poller), /Reserve V4 Reply With Memory|Respond to V4 Chat|twilio/i);
});

test('recovery deliberately relies on the next bounded scheduled execution', () => {
  const finder = pollerNodes.get('Find Verified WhatsApp Sessions');

  assert.notEqual(finder.retryOnFail, true);
  assert.equal(finder.maxTries, undefined);
  assert.equal(finder.waitBetweenTries, undefined);
  assert.deepEqual(finder.parameters.options, {});
  assert.equal(workflow.active, false);
});

test('Ticket 17 ordering and outbound reservation prevent duplicate paid replies', () => {
  const claim = nodes.get('Claim Next Session Inbound');
  const reserve = nodes.get('Reserve Paid Assistant Reply');

  assert.match(claim.parameters.query, /pg_advisory_xact_lock/);
  assert.match(claim.parameters.query, /ORDER BY message\.processing_order, message\.id/);
  assert.match(claim.parameters.query, /processing_owner = input\.payload->>'processing_owner'/);
  assert.match(reserve.parameters.query, /EXISTS \(SELECT 1 FROM renewed_claim\)/);
  assert.match(reserve.parameters.query,
    /ON CONFLICT \(idempotency_key\)[\s\S]*DO NOTHING/);
  assert.match(reserve.parameters.options.queryReplacement,
    /'reply:' \+ \$\('Claim Next Session Inbound'\)\.item\.json\.provider_message_sid \+ ':paid'/);
  assert.match(schema, /CREATE UNIQUE INDEX messages_idempotency_key_uidx/);
  assert.match(schema, /CREATE INDEX messages_session_processing_queue_idx/);
});

test('failed scheduled lookups route to the existing durable error and email paths', () => {
  assert.equal(poller.settings.errorWorkflow, errorWorkflow.id);

  const errorOutputs = errorWorkflow.connections['Build Log JSON'].main[0]
    .map((edge) => edge.node);
  assert.ok(errorOutputs.includes('Insert Error Log (Error Handler)'));
  assert.ok(errorOutputs.includes('Build Email Error Content'));

  const insert = errorWorkflow.nodes.find(
    (node) => node.name === 'Insert Error Log (Error Handler)'
  );
  assert.match(insert.parameters.query, /INSERT INTO public\.logs/);
  assert.match(insert.parameters.query, /'global_workflow_error'/);
  assert.deepEqual(
    errorWorkflow.connections['Build Email Error Content'].main[0]
      .map((edge) => edge.node),
    ['Send Error Notification']
  );
});

test('existing indexes support session claiming without a speculative metadata index', () => {
  assert.match(schema, /ADD CONSTRAINT users_whatsapp_id_key1 UNIQUE \(whatsapp_id\)/);
  assert.match(schema, /CREATE INDEX messages_session_processing_queue_idx/);
  assert.doesNotMatch(schema,
    /CREATE (?:UNIQUE )?INDEX[^;]*(?:identity_verification_purpose|identity_verification_state)/i);
});
