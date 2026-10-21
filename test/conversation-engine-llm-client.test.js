'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationLlmError, createOpenAiConversationLlmClient } = require('../lib/conversation-engine/llm-client');

async function failure(client) { await assert.rejects(() => client.interpret({}), error => error instanceof ConversationLlmError); try { await client.interpret({}); } catch (error) { return error; } }

test('Conversation Engine LLM client retains only bounded failure classifications and metadata', async () => {
  const missingKey = await failure(createOpenAiConversationLlmClient({ apiKey: '' }));
  assert.deepEqual({ code: missingKey.code, upstream_status: missingKey.upstream_status, upstream_category: missingKey.upstream_category }, { code: 'llm_unavailable', upstream_status: null, upstream_category: 'unavailable' });
  const timeout = await failure(createOpenAiConversationLlmClient({ apiKey: 'test-key', http: { async post() { const error = new Error('timeout'); error.code = 'ECONNABORTED'; throw error; } } }));
  assert.equal(timeout.code, 'llm_timeout');
});

test('V3 generation preserves bounded upstream failures without raw response material', async () => {
  const client = createOpenAiConversationLlmClient({ apiKey: 'test-key', http: { async post() { throw { response: { status: 503 }, message: 'private candidate body' }; } } });
  await assert.rejects(() => client.generateRecommendationCandidate({ food_facts: [{ id: 'food-1' }] }), error => error instanceof ConversationLlmError && error.code === 'llm_transport_failure' && error.upstream_status === 503 && !/private/u.test(JSON.stringify(error)));
});

test('V3 generation is one strict structured-output call with open culinary labels and trusted IDs', async () => {
  const calls = [];
  const client = createOpenAiConversationLlmClient({ apiKey: 'test-key', http: { async post(_url, body) {
    calls.push(body);
    return { data: { choices: [{ message: { content: JSON.stringify({ candidate_type: 'meal_proposal', dish: { label: 'tacos de huauzontles', confirmed_anchor_ids: ['food-1'] }, proposed_items: [], customer_response: 'Puedes hacer tacos de huauzontles.' }) } }] } };
  } } });
  const payload = { contract_version: 'recommendation-candidate-v3', food_facts: [{ id: 'food-1', label: 'huauzontles', status: 'confirmed_available', provenance: 'current_turn' }] };
  assert.equal((await client.generateRecommendationCandidate(payload)).dish.label, 'tacos de huauzontles');
  const schema = calls[0].response_format.json_schema.schema;
  assert.equal(calls.length, 1);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['candidate_type', 'dish', 'proposed_items', 'customer_response']);
  assert.equal(Object.hasOwn(schema.properties, 'operations'), false);
  assert.deepEqual(schema.properties.dish.properties.confirmed_anchor_ids.items.enum, ['food-1']);
  assert.match(calls[0].messages[0].content, /proposed_items/u);
});

test('Candidate V3 has isolated Sol configuration while interpreter and composition retain shared defaults', async () => {
  const calls = [];
  const client = createOpenAiConversationLlmClient({ apiKey: 'test-key', http: { async post(_url, body, options) {
    calls.push({ body, timeout: options.timeout });
    return { data: { choices: [{ message: { content: '{}' } }] } };
  } } });
  await client.interpret({});
  await client.generateRecommendationCandidate({ food_facts: [] });
  await client.compose({});
  assert.deepEqual(client.configuration, {
    model: 'gpt-5-mini', reasoningEffort: 'low', timeoutMs: 6000,
    candidate: { model: 'gpt-6.1-sol', reasoningEffort: 'low', timeoutMs: 15000 },
  });
  assert.deepEqual(calls.map(call => ({ model: call.body.model, reasoning: call.body.reasoning_effort, timeout: call.timeout })), [
    { model: 'gpt-5-mini', reasoning: 'low', timeout: 6000 },
    { model: 'gpt-6.1-sol', reasoning: 'low', timeout: 15000 },
    { model: 'gpt-5-mini', reasoning: 'low', timeout: 6000 },
  ]);
});

test('Candidate-only environment configuration is bounded and does not alter shared calls', async () => {
  const prior = {
    model: process.env.CONVERSATION_CANDIDATE_V3_MODEL,
    reasoning: process.env.CONVERSATION_CANDIDATE_V3_REASONING_EFFORT,
    timeout: process.env.CONVERSATION_CANDIDATE_V3_TIMEOUT_MS,
  };
  const restore = () => {
    for (const [name, value] of Object.entries({ CONVERSATION_CANDIDATE_V3_MODEL: prior.model, CONVERSATION_CANDIDATE_V3_REASONING_EFFORT: prior.reasoning, CONVERSATION_CANDIDATE_V3_TIMEOUT_MS: prior.timeout })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  };
  try {
    process.env.CONVERSATION_CANDIDATE_V3_MODEL = 'gpt-6.1-sol';
    process.env.CONVERSATION_CANDIDATE_V3_REASONING_EFFORT = 'low';
    process.env.CONVERSATION_CANDIDATE_V3_TIMEOUT_MS = '12000';
    const calls = [];
    const client = createOpenAiConversationLlmClient({ apiKey: 'test-key', http: { async post(_url, body, options) {
      calls.push({ body, timeout: options.timeout });
      return { data: { choices: [{ message: { content: '{}' } }] } };
    } } });
    await client.interpret({}); await client.generateRecommendationCandidate({ food_facts: [] }); await client.compose({});
    assert.deepEqual(calls.map(call => [call.body.model, call.timeout]), [['gpt-5-mini', 6000], ['gpt-6.1-sol', 12000], ['gpt-5-mini', 6000]]);
    process.env.CONVERSATION_CANDIDATE_V3_TIMEOUT_MS = 'not-a-number';
    assert.throws(() => createOpenAiConversationLlmClient({ apiKey: 'test-key' }), /CONVERSATION_CANDIDATE_V3_TIMEOUT_INVALID/u);
    process.env.CONVERSATION_CANDIDATE_V3_TIMEOUT_MS = '12000';
    process.env.CONVERSATION_CANDIDATE_V3_REASONING_EFFORT = 'high';
    assert.throws(() => createOpenAiConversationLlmClient({ apiKey: 'test-key' }), /CONVERSATION_CANDIDATE_V3_REASONING_EFFORT_INVALID/u);
    process.env.CONVERSATION_CANDIDATE_V3_REASONING_EFFORT = 'low';
    process.env.CONVERSATION_CANDIDATE_V3_MODEL = 'bad model';
    assert.throws(() => createOpenAiConversationLlmClient({ apiKey: 'test-key' }), /CONVERSATION_CANDIDATE_V3_MODEL_INVALID/u);
  } finally { restore(); }
});
