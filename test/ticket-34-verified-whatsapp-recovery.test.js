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

test('verified WhatsApp recovery is a one-minute scheduled ledger lookup', () => {
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

test('lookup failure cannot mutate or complete the pending canonical inbound', () => {
  const sql = pollerNodes.get('Find Verified WhatsApp Sessions').parameters.query;

  assert.match(sql, /^SELECT DISTINCT message\.session_id/m);
  assert.match(sql, /FROM public\.messages AS message/);
  assert.match(sql, /JOIN public\.users AS app_user ON app_user\.whatsapp_id = message\.session_id/);
  assert.match(sql, /message\.processing_completed_at IS NULL/);
  assert.match(sql, /identity_verification_purpose' = 'link_whatsapp'/);
  assert.match(sql, /identity_verification_state' = 'verified'/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CALL)\b/i);

  const verifiedBranch = linkingMigration.match(
    /ELSIF target_request\.purpose = 'link_whatsapp'[\s\S]*?END IF;/
  )?.[0] || '';
  assert.match(verifiedBranch, /processing_owner = NULL/);
  assert.match(verifiedBranch, /processing_lease_until = NULL/);
  assert.match(verifiedBranch, /processing_completed_at = NULL/);
  assert.match(verifiedBranch, /identity_verification_state', 'verified'/);
  assert.doesNotMatch(verifiedBranch, /identity_verification_state', 'pending'/);
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
