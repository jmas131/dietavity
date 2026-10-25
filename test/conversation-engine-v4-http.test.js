'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationEngineV4Handler } = require('../lib/conversation-engine-v4/internal-route');
const { ConversationV4LlmError } = require('../lib/conversation-engine-v4/llm-client');

const secret = 'v'.repeat(32);
const body = {
  request_id: 'v4-http-request',
  session_id: 'v4-http-session',
  claimed_inbound_message_id: '00000000-0000-4000-8000-000000000001',
  processing_order: 1,
  current_message: 'Tengo pollo',
  canonical_history: [],
  durable_memory: { allergies: [], dietary_restrictions: [], preferences: [] },
};

async function post(engine, payload = body, suppliedSecret = secret) {
  const handler = createConversationEngineV4Handler({ engine, secretProvider: () => secret });
  const response = { statusCode: null, value: null, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return this; } };
  await handler({ body: payload, get: name => name === 'x-dietavity-conversation-engine-secret' ? suppliedSecret : undefined }, response);
  return { status: response.statusCode, value: response.value };
}

test('V4 internal endpoint authenticates and returns only the V4 envelope', async () => {
  const engine = { async resolve(value) { return { contract_version: 'conversation-engine-v4-response-v1', engine_version: 'conversation-engine-v4-primary-v1', request_id: value.request_id, model: 'gpt-6.1-sol', generation_status: 'generated', response: 'Haz pollo con calabacitas.', memory_updates: [], memory_update_count: 0 }; } };
  const result = await post(engine);
  assert.equal(result.status, 200);
  assert.equal(result.value.response, 'Haz pollo con calabacitas.');
  assert.equal((await post(engine, body, null)).status, 401);
});

test('V4 only exposes transient upstream availability to Ticket 85', async () => {
  for (const category of ['timeout', 'http_429', 'http_5xx', 'network', 'unavailable']) {
    const result = await post({ async resolve() { throw new ConversationV4LlmError('transient', { upstream_category: category }); } });
    assert.equal(result.status, 503, category);
    assert.deepEqual(result.value, { contract_version: 'conversation-engine-v4-response-v1', engine_version: 'conversation-engine-v4-primary-v1', request_id: body.request_id, generation_status: 'infrastructure_failure', failure_category: 'engine_unavailable' });
  }
  const malformed = await post({ async resolve() { throw new ConversationV4LlmError('llm_malformed_output', { upstream_category: 'malformed_output' }); } });
  assert.equal(malformed.status, 500);
  assert.deepEqual(malformed.value, { error: 'internal_error' });
});
