'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const message = require('../lib/whatsapp-message');
const delivery = require('../lib/twilio-delivery');
const ordering = require('../lib/session-ordering');

const root = path.resolve(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(
  root, 'n8n', 'Dietavity Sales Engine (Ticket 10).json'
), 'utf8'));
const errorWorkflow = JSON.parse(fs.readFileSync(path.join(
  root, 'n8n', 'Global Error Handler.json'
), 'utf8'));
const recipe = fs.readFileSync(path.join(
  root, 'test-support', 'fixtures', 'ticket-37-long-recipe.txt'
), 'utf8').trim();
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const sid = `SM${'b'.repeat(32)}`;

function outputs(name, index = 0) {
  return (workflow.connections[name]?.main?.[index] || []).map((edge) => edge.node);
}

test('below-limit and near-threshold responses are sent unchanged', () => {
  for (const body of ['Respuesta breve.', 'x'.repeat(message.SAFE_CHARACTER_LIMIT)]) {
    const result = message.formatWhatsAppMessage(body);
    assert.deepEqual(result.parts, [body]);
    assert.equal(result.was_compacted, false);
    assert.equal(result.was_split, false);
    assert.equal(result.original_character_count, body.length);
    assert.equal(result.final_character_count, body.length);
  }
});

test('excess whitespace is compacted safely before splitting', () => {
  const body = (`Ingredientes:   pollo     arroz\n\n\n\nPreparación:   mezcla y cocina.   `)
    .repeat(24);
  assert.ok(body.length > message.SAFE_CHARACTER_LIMIT);
  const result = message.formatWhatsAppMessage(body);
  assert.equal(result.was_compacted, true);
  assert.equal(result.was_split, false);
  assert.equal(result.part_count, 1);
  assert.ok(result.parts[0].length <= message.SAFE_CHARACTER_LIMIT);
  assert.doesNotMatch(result.parts[0], / {2,}|\n{3,}/);
});

test('production-sized recipe is split without blind truncation', () => {
  assert.ok(recipe.length > 1600);
  const result = message.formatWhatsAppMessage(recipe);
  assert.equal(result.was_split, true);
  assert.ok(result.part_count > 1);
  assert.ok(result.parts.every((part) => part.length <= message.SAFE_CHARACTER_LIMIT));
  const joined = result.parts.map((part) => part.replace(/^Parte \d+\/\d+\n/, '')).join(' ');
  for (const required of [
    'Ingredientes para 2 porciones',
    '300 g de pechuga de pollo',
    'Preparación:',
    'Calienta una cucharadita de aceite',
    'Termina cada porción con aguacate',
    'Conserva el pollo refrigerado',
  ]) assert.match(joined, new RegExp(required));
  assert.equal(joined.includes(recipe.slice(-80)), true);
});

test('logical-boundary splitting and ordering are deterministic', () => {
  const body = Array.from({ length: 45 }, (_, index) => (
    `Paso ${index + 1}: prepara el ingrediente con calma y consérvalo para el siguiente paso.`
  )).join('\n');
  const first = message.formatWhatsAppMessage(body, 240);
  const second = message.formatWhatsAppMessage(body, 240);
  assert.deepEqual(first, second);
  assert.ok(first.parts.length > 1);
  first.parts.forEach((part, index) => {
    assert.match(part, new RegExp(`^Parte ${index + 1}/${first.part_count}\\n`));
    assert.ok(part.length <= 240);
  });
});

test('paid final body is prepared before an atomic canonical multipart reservation', () => {
  assert.deepEqual(outputs('Parse Assistant Response'), ['Prepare Paid WhatsApp Message Parts']);
  assert.deepEqual(outputs('Build Deterministic Customer Response'), ['Prepare Paid WhatsApp Message Parts']);
  assert.deepEqual(outputs('Prepare Paid WhatsApp Message Parts'), ['Reserve Paid Assistant Reply']);
  assert.deepEqual(outputs('Reserve Paid Assistant Reply'), ['Loop Paid WhatsApp Parts']);
  assert.deepEqual(outputs('Loop Paid WhatsApp Parts', 1), ['Send All Intents Message']);
  assert.match(nodes.get('Send All Intents Message').parameters.message, /\$json\.body/);

  const reserve = nodes.get('Reserve Paid Assistant Reply');
  assert.equal(reserve.parameters.query, ordering.RESERVE_MULTIPART_OUTBOUND_SQL);
  assert.match(reserve.parameters.query, /jsonb_array_elements_text/);
  assert.match(reserve.parameters.query, /ORDER BY parts\.part_index/);
  assert.match(reserve.parameters.query, /WHEN parts\.part_index = 1[\s\S]*base_idempotency_key/);
  assert.match(reserve.parameters.query, /':part:' \|\| LPAD\(parts\.part_index::text, 3, '0'\)/);
  assert.match(reserve.parameters.query, /ON CONFLICT \(idempotency_key\)[\s\S]*DO NOTHING/);
});

test('multipart metadata is content-free and sufficient for observability', () => {
  const replacement = nodes.get('Reserve Paid Assistant Reply')
    .parameters.options.queryReplacement;
  const preparation = nodes.get('Prepare Paid WhatsApp Message Parts').parameters.jsCode;
  for (const field of [
    'original_character_count', 'final_character_count', 'was_compacted',
    'was_split', 'part_count',
  ]) assert.match(preparation, new RegExp(field));
  assert.match(ordering.RESERVE_MULTIPART_OUTBOUND_SQL, /'part_index'/);
  assert.match(ordering.RESERVE_MULTIPART_OUTBOUND_SQL, /'logical_reply_key'/);
  assert.doesNotMatch(replacement, /metadata:[^\n]*(?:assistant_response|logical_body)/);
});

test('accepted parts are not resent and inbound completes only after every part resolves', () => {
  assert.match(ordering.RESERVE_MULTIPART_OUTBOUND_SQL,
    /ON CONFLICT \(idempotency_key\)[\s\S]*DO NOTHING/);
  assert.ok(ordering.COMPLETE_INBOUND_SQL.includes(require('../lib/logical-reply').fullyAcceptedSql('message.id')));
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /'reconciliation'::text AS claim_state/);
  const assertion = nodes.get('Assert Paid Assistant Reply Accepted').parameters.jsCode;
  assert.match(assertion, /\$input\.all\(\)/);
  assert.match(assertion, /rows\.find/);
});

test('Twilio 21617 and generic 4xx are deterministic while unknown semantics remain', () => {
  assert.equal(delivery.classifyTwilioResult({ error: 'Twilio error 21617: body too long' }), 'failed');
  assert.equal(delivery.normalizeTwilioResponse({ error: '21617 body too long' }).error_code, '21617');
  assert.equal(delivery.classifyTwilioResult({ statusCode: 422, error: 'invalid request' }), 'failed');
  assert.equal(delivery.classifyTwilioResult({ statusCode: 503, error: 'timeout' }), 'unknown');
  assert.equal(delivery.classifyTwilioResult({ error: 'socket hang up' }), 'unknown');
  assert.equal(delivery.classifyTwilioResult({ sid, status: 'queued' }), 'accepted');
});

test('paid recipe prompt is concise but requires semantic completeness', () => {
  const prompt = nodes.get('Dietavity Nutrition Model').parameters.responses.values[0].content;
  assert.match(prompt, /natural para WhatsApp/);
  assert.match(prompt, /nombre, lista de ingredientes y pasos breves de preparación/);
  assert.match(prompt, /No omitas ingredientes ni pasos esenciales/);
});

test('Ticket 17 FIFO, Ticket 28A resume, and Global Error Handler remain intact', () => {
  assert.match(nodes.get('Claim Next Session Inbound').parameters.query,
    /ORDER BY message\.processing_order, message\.id/);
  assert.deepEqual(outputs('Receive Verified WhatsApp Sessions'), ['Claim Next Session Inbound']);
  const errorSql = errorWorkflow.nodes.find(
    (node) => node.name === 'Insert Error Log (Error Handler)'
  ).parameters.query;
  assert.match(errorSql, /INSERT INTO public\.logs/);
  assert.match(errorSql, /processing_outcome = CASE[\s\S]*THEN 'reconciliation'/);
});
