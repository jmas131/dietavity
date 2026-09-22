'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationContextError, validateConversationContext } = require('../lib/sales-engine-v2/conversation-context-validator');
const { createConversationContext, normalizeOnboardingChatMemoryRow } = require('../lib/sales-engine-v2/memory-adapter');

const currentTurn = { id: 'inbound-3', text: '¿Cuánto cuesta?', received_at: '2026-09-22T12:00:00.000Z' };
const runtimeMetadata = { conversation_id: 'conversation-1', session_id: 'session-opaque-1', channel: 'whatsapp', offer_version: '28d-149-v1', campaign: 'standard', commercial_state: { checkout_sent: false } };
const entry = (source_id, role, text, occurred_at) => ({ source_id, role, text, occurred_at });
const productionRow = (id, type, content, created_at) => ({ id, session_id: 'session-opaque-1', created_at, updated_at: created_at, message: { type, content, additional_kwargs: { ignored: 'never visible' } } });
const errorCode = (fn, code) => assert.throws(fn, error => error instanceof ConversationContextError && error.code === code);

test('Ticket 60 creates an empty, structurally separate canonical ConversationContext', () => {
  const context = createConversationContext({ currentTurn, runtimeMetadata });
  assert.equal(context.context_id, 'conversation-1:inbound-3');
  assert.deepEqual(context.current_message, { source_id: 'inbound-3', role: 'customer', text: '¿Cuánto cuesta?', occurred_at: '2026-09-22T12:00:00.000Z' });
  assert.deepEqual(context.history, []);
  assert.deepEqual(context.history_metadata, { ordering: 'occurred_at', history_truncated: false, retained_prior_turns: 0, retained_prior_characters: 0 });
  assert.equal(validateConversationContext(context), null);
});

test('Ticket 60 normalizes production rows and harness-shaped entries through the same history contract', () => {
  const production = [
    productionRow('row-2', 'ai', 'Respuesta final', '2026-09-22T11:01:00.000Z'),
    productionRow('row-1', 'human', 'Hola  con espacios', '2026-09-22T11:00:00.000Z'),
  ];
  const harness = [
    entry('row-2', 'assistant', 'Respuesta final', '2026-09-22T11:01:00.000Z'),
    entry('row-1', 'user', 'Hola  con espacios', '2026-09-22T11:00:00.000Z'),
  ];
  const a = createConversationContext({ currentTurn, memory: production, runtimeMetadata });
  const b = createConversationContext({ currentTurn, memory: harness, runtimeMetadata });
  assert.deepEqual(a.history, b.history);
  assert.deepEqual(a.history, [
    { source_id: 'row-1', role: 'customer', text: 'Hola  con espacios', occurred_at: '2026-09-22T11:00:00.000Z' },
    { source_id: 'row-2', role: 'assistant', text: 'Respuesta final', occurred_at: '2026-09-22T11:01:00.000Z' },
  ]);
  assert.equal(JSON.stringify(a).includes('ignored'), false);
  assert.deepEqual(normalizeOnboardingChatMemoryRow({ ...production[0], message: { type: 'ai', data: { content: 'Respuesta final' } } }), a.history[1]);
});

test('Ticket 60 orders distinct timestamps and bounds the newest prior window', () => {
  const memory = [entry('b', 'assistant', 'BBBB', '2026-09-22T11:00:01.000Z'), entry('a', 'human', 'AAA', '2026-09-22T11:00:00.000Z'), entry('c', 'assistant', 'CC', '2026-09-22T11:01:00.000Z')];
  const full = createConversationContext({ currentTurn, memory, runtimeMetadata });
  assert.deepEqual(full.history.map(item => item.source_id), ['a', 'b', 'c']);
  const bounded = createConversationContext({ currentTurn, memory, runtimeMetadata, options: { maxPriorTurns: 2, maxPriorCharacters: 6 } });
  assert.deepEqual(bounded.history.map(item => item.source_id), ['b', 'c']);
  assert.equal(bounded.history_metadata.history_truncated, true);
  assert.equal(bounded.history_metadata.retained_prior_characters, 6);
  assert.equal(bounded.current_message.text, currentTurn.text);
});

test('Ticket 60 fails closed when equal timestamps have no authoritative durable order', () => {
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, memory: [
    entry('7f6ff0ea-5d90-4edc-9708-0f5b5a95a1c2', 'human', 'Primero desconocido', '2026-09-22T11:00:00.000Z'),
    entry('0a5bf7a1-0e3d-4b62-8f61-1b302fabcf6e', 'assistant', 'Después desconocido', '2026-09-22T11:00:00.000Z'),
  ] }), 'MEMORY_ORDER_AMBIGUOUS');
});

test('Ticket 60 deduplicates only the exact current source identity and fails closed for duplicates', () => {
  const snapshot = [entry('inbound-3', 'human', '¿Cuánto cuesta?', '2026-09-22T12:00:00.000Z'), entry('prior-1', 'ai', 'Hola', '2026-09-22T11:59:00.000Z')];
  const context = createConversationContext({ currentTurn, memory: snapshot, runtimeMetadata });
  assert.deepEqual(context.history.map(item => item.source_id), ['prior-1']);
  errorCode(() => createConversationContext({ currentTurn, memory: [...snapshot, entry('inbound-3', 'human', '¿Cuánto cuesta?', '2026-09-22T12:00:00.000Z')], runtimeMetadata }), 'CURRENT_TURN_DUPLICATED');
  errorCode(() => createConversationContext({ currentTurn, memory: [entry('same', 'human', 'a', '2026-09-22T11:00:00.000Z'), entry('same', 'assistant', 'b', '2026-09-22T11:01:00.000Z')], runtimeMetadata }), 'MEMORY_DUPLICATE_ID');
});

test('Ticket 60 keeps stale claims as text and supplies no fact, policy, intent, or generated-response authority', () => {
  const context = createConversationContext({ currentTurn, runtimeMetadata, memory: [
    entry('old-customer', 'human', 'Quiero comprar', '2026-09-22T11:00:00.000Z'),
    entry('old-assistant', 'ai', 'El programa cuesta $99 y cambia tu dosis.', '2026-09-22T11:01:00.000Z'),
  ] });
  assert.match(context.history[0].text, /Quiero comprar/);
  assert.match(context.history[1].text, /\$99/);
  assert.deepEqual(context.commercial_state, { checkout_sent: false });
  assert.deepEqual(context.authoritative_context, {});
  assert.deepEqual(context.informational_context, { knowledge: [] });
  assert.equal('price' in context, false);
  assert.equal('current_purchase_request' in context.commercial_state, false);
  assert.equal('safety_clear' in context.commercial_state, false);
});

test('Ticket 60 rejects malformed input, unknown roles, invalid trusted metadata, and invalid bounds without side effects', () => {
  errorCode(() => createConversationContext({ currentTurn: { ...currentTurn, text: '' }, runtimeMetadata }), 'CURRENT_TURN_INVALID');
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, memory: [entry('x', 'system', 'hidden', '2026-09-22T11:00:00.000Z')] }), 'MEMORY_ROLE_UNSUPPORTED');
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata: { ...runtimeMetadata, campaign: 'from_customer_text' } }), 'RUNTIME_METADATA_INVALID');
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata: { ...runtimeMetadata, untrusted: true } }), 'RUNTIME_METADATA_INVALID');
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, options: { maxPriorTurns: -1 } }), 'MEMORY_ADAPTER_CONFIGURATION_INVALID');
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, memory: [entry('x', 'human', 'x', 'not-a-time')] }), 'MEMORY_TIMESTAMP_INVALID');
});

test('Ticket 60 has no policy, fact, LLM, database, or provider dependency', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sales-engine-v2', 'memory-adapter.js'), 'utf8');
  assert.doesNotMatch(source, /policy-resolver|fact-resolver|openai|fetch\(|supabase|postgres|twilio|stripe|node:(?:fs|net|http|https)/i);
});
