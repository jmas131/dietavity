'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationEngineHandler } = require('../lib/conversation-engine/internal-route');
const { ConversationLlmError } = require('../lib/conversation-engine/llm-client');
const { createConversationEngine } = require('../lib/conversation-engine/service');

const secret = 'a'.repeat(32);
const body = { contract_version: 'conversation-engine-request-v1', request_id: '00000000-0000-4000-8000-000000000001', session_id: 'whatsapp:+5215550000000', inbound_message_id: '00000000-0000-4000-8000-000000000002', processing_order: 1, current_message: 'Gracias', canonical_history: [] };

async function post(engine, payload = body, suppliedSecret = secret) {
  // The sandbox forbids opening a loopback socket. Handler-level contract
  // coverage is sufficient for Phase A; Phase B requires a real loopback
  // HTTP smoke test on the deployment host before Ticket 10 is routed here.
  const handler = createConversationEngineHandler({ engine, secretProvider: () => secret });
  const response = { statusCode: null, value: null, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return this; } };
  await handler({ body: payload, get: header => header === 'x-dietavity-conversation-engine-secret' ? suppliedSecret : undefined }, response);
  return { status: response.statusCode, value: response.value };
}

test('internal endpoint authenticates and returns only the bounded transport contract', async () => {
  const engine = { async resolve(value) { return { contract_version: 'conversation-engine-response-v1', engine_version: 'direct-rag-v3-v1_3', request_id: value.request_id, resolution: { status: 'resolved', type: 'direct_rag_response', delivery_permitted: true }, assistant_response: '¡Con gusto! 😊', persistence: { pending_action: 'respond', strategy: 'direct_rag_v3_response', buyer_signal: 'obligation_resolution', topic: 'acknowledgement', conversation_stage: null, goal: null, next_last_question_type: null, events: [] }, diagnostics: { recommendation: { source: null, status: null, failure_code: null }, llm: { obligations: 'valid', composition: 'valid' } } }; } };
  const valid = await post(engine);
  assert.equal(valid.status, 200); assert.equal(valid.value.assistant_response, '¡Con gusto! 😊');
  assert.equal((await post(engine, body, null)).status, 401);
  assert.equal((await post(engine, body, 'wrong'.repeat(8))).status, 401);
});

test('internal endpoint rejects malformed or injected requests before engine execution', async () => {
  let interpreted = false;
  const engine = createConversationEngine({ llmClient: { async interpret() { interpreted = true; return {}; }, async compose() { return {}; } } });
  assert.equal((await post(engine, { ...body, semantic_context: { forged: true } })).status, 400);
  assert.equal((await post(engine, { ...body, canonical_history: Array.from({ length: 13 }, () => ({ role: 'customer', text: 'x', source_processing_order: 1 })) })).status, 400);
  assert.equal((await post(engine, { ...body, canonical_history: [{ role: 'customer', text: 'x'.repeat(1001), source_processing_order: 1 }] })).status, 400);
  assert.equal(interpreted, false);
});

test('internal endpoint maps LLM timeout and unexpected errors to non-deliverable infrastructure failures without leakage', async () => {
  const unavailable = await post({ async resolve() { throw new ConversationLlmError('llm_timeout'); } });
  assert.equal(unavailable.status, 503); assert.equal(unavailable.value.resolution.delivery_permitted, false);
  assert.equal(unavailable.value.assistant_response, null); assert.doesNotMatch(JSON.stringify(unavailable.value), /llm_timeout|stack|exception/iu);
  const unexpected = await post({ async resolve() { throw new Error('sensitive internal failure'); } });
  assert.equal(unexpected.status, 500); assert.equal(unexpected.value.resolution.delivery_permitted, false);
  assert.doesNotMatch(JSON.stringify(unexpected.value), /sensitive|internal failure/iu);
});
