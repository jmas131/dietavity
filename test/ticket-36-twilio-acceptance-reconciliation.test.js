'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const delivery = require('../lib/twilio-delivery');
const ordering = require('../lib/session-ordering');

const root = path.resolve(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(
  root, 'n8n', 'Dietavity Sales Engine (Ticket 10).json'
), 'utf8'));
const errorWorkflow = JSON.parse(fs.readFileSync(path.join(
  root, 'n8n', 'Global Error Handler.json'
), 'utf8'));
const generator = fs.readFileSync(path.join(root, 'scripts', 'refactor-ticket-10-workflow.js'), 'utf8');
const preflight = fs.readFileSync(path.join(root, 'database', 'preflight-ticket-36.sql'), 'utf8');
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const sid = `SM${'a'.repeat(32)}`;

function outputs(name, index = 0) {
  return (workflow.connections[name]?.main?.[index] || []).map((edge) => edge.node);
}

test('n8n 2.36.8 normal Twilio responses establish API acceptance, not delivery', () => {
  assert.equal(delivery.classifyTwilioResult({ sid, status: 'queued' }), 'accepted');
  assert.equal(delivery.classifyTwilioResult({ sid, status: 'accepted' }), 'accepted');
  assert.equal(delivery.classifyTwilioResult({ sid, status: 'sending' }), 'accepted');
  assert.equal(delivery.classifyTwilioResult({ sid, status: 'sent' }), 'accepted');
  assert.equal(delivery.classifyTwilioResult({ sid, status: 'delivered' }), 'accepted');
  assert.equal(delivery.classifyTwilioResult({ sid }), 'accepted');
  assert.equal(delivery.classifyTwilioResult({ sid, status: 'mystery' }), 'accepted');
});

test('explicit failures outrank SID presence and ambiguous errors stay unknown', () => {
  assert.equal(delivery.classifyTwilioResult({ sid, status: 'failed' }), 'failed');
  assert.equal(delivery.classifyTwilioResult({ sid, status: 'undelivered' }), 'failed');
  assert.equal(delivery.classifyTwilioResult({ statusCode: 400, error: 'bad request' }), 'failed');
  assert.equal(delivery.classifyTwilioResult({ statusCode: 503, error: 'timeout' }), 'unknown');
  assert.equal(delivery.classifyTwilioResult({ error: 'socket hang up' }), 'unknown');
});

test('continued n8n error strings and supported response variants remain observable', () => {
  assert.deepEqual(delivery.normalizeTwilioResponse({ error: 'socket hang up' }), {
    provider_message_sid: '', provider_status: '', status_code: '', error_code: '',
    error_message: 'socket hang up',
  });
  assert.equal(delivery.normalizeTwilioResponse({ data: { message_sid: sid } }).provider_message_sid, sid);
  const expression = nodes.get('Update Paid Assistant Reply Delivery')
    .parameters.options.queryReplacement;
  assert.match(expression, /typeof \$json\.error === 'string'/);
  assert.match(expression, /\$json\.data\.sid/);
});

test('every generated delivery update uses the Ticket 36 classification contract', () => {
  const updates = workflow.nodes.filter((node) => /^Update .* Delivery$/.test(node.name));
  assert.ok(updates.length >= 10);
  for (const update of updates) {
    assert.equal(update.parameters.query, delivery.DELIVERY_UPDATE_SQL, update.name);
    assert.match(update.parameters.query, /IN \('canceled', 'failed', 'undelivered'\)/, update.name);
    assert.match(update.parameters.query, /provider_acceptance_evidence/, update.name);
  }
  assert.match(generator, /twilio-delivery/);
});

test('paid reply follows reserve, send, reconcile, assert, state, completion', () => {
  assert.deepEqual(outputs('Reserve Paid Assistant Reply'), ['Loop Paid WhatsApp Parts']);
  assert.deepEqual(outputs('Loop Paid WhatsApp Parts', 1), ['Send All Intents Message']);
  assert.deepEqual(outputs('Send All Intents Message'), ['Update Paid Assistant Reply Delivery']);
  assert.deepEqual(outputs('Update Paid Assistant Reply Delivery'), ['Assert Paid Assistant Reply Accepted']);
  assert.deepEqual(outputs('Assert Paid Assistant Reply Accepted'), ['Loop Paid WhatsApp Parts']);
  assert.deepEqual(outputs('Loop Paid WhatsApp Parts'), ['Update Last Assistant Message']);
  assert.deepEqual(outputs('Update Last Assistant Message'), ['Mark Session Inbound Complete']);
});

test('ambiguous or failed outbound cannot complete or duplicate-send', () => {
  assert.ok(ordering.COMPLETE_INBOUND_SQL.includes(require('../lib/logical-reply').fullyAcceptedSql('message.id')));
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /'reconciliation'::text AS claim_state/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL,
    /delivery_status IN \('accepted', 'scheduled', 'sent', 'delivered'\)/);
  const reserve = nodes.get('Reserve Paid Assistant Reply').parameters.query;
  assert.match(reserve, /ON CONFLICT \(idempotency_key\)[\s\S]*DO NOTHING/);
  assert.match(nodes.get('Send All Intents Message').parameters.message, /\$json\.body/);
  assert.equal(nodes.get('Send All Intents Message').retryOnFail, false);
});

test('the Global Error Handler leaves unresolved replies incomplete and actionable', () => {
  const sql = errorWorkflow.nodes.find((node) => node.name === 'Insert Error Log (Error Handler)')
    .parameters.query;
  assert.match(sql,
    /processing_completed_at = CASE[\s\S]*delivery_status IN \('accepted', 'scheduled', 'sent', 'delivered'\)/);
  assert.match(sql, /processing_outcome = CASE[\s\S]*THEN 'reconciliation'/);
  assert.match(sql, /INSERT INTO public\.logs/);
});

test('Ticket 28A recovery and Ticket 17 ownership remain on the same paid path', () => {
  assert.deepEqual(outputs('Receive Verified WhatsApp Sessions'), ['Claim Next Session Inbound']);
  const reserve = nodes.get('Reserve Paid Assistant Reply');
  assert.match(reserve.parameters.query, /processing_owner = input\.payload->>'processing_owner'/);
  assert.match(reserve.parameters.options.queryReplacement,
    /idempotency_key: 'reply:' \+ \$\('Claim Next Session Inbound'\)\.item\.json\.provider_message_sid \+ ':paid'/);
});

test('incident evidence query is exact, minimized, and read-only', () => {
  assert.match(preflight, /reply:SMf79859ae7c0c371d57060f58334c6bce:paid/);
  for (const field of [
    'id', 'direction', 'delivery_status', 'provider_message_sid',
    'idempotency_key', 'in_reply_to_id', 'processing_completed_at', 'metadata',
  ]) assert.match(preflight, new RegExp(`\\b${field}\\b`));
  assert.doesNotMatch(preflight, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(preflight, /\bbody\b/i);
});
