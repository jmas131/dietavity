'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SNAPSHOT } = require('../lib/conversation-engine-v4/product-authority');
const { MEDICAL_POLICY } = require('../lib/conversation-engine-v4/medical-policy');
const { buildRequest, validateRequest, validateModelOutput, ConversationV4ContractError } = require('../lib/conversation-engine-v4/contracts');
const { createConversationEngineV4 } = require('../lib/conversation-engine-v4/service');
const { createPrimaryConversationLlmClient, ConversationV4LlmError } = require('../lib/conversation-engine-v4/llm-client');
const { PRIMARY_CONVERSATION_SYSTEM_PROMPT } = require('../lib/conversation-engine-v4/prompt');
const { FIXTURES } = require('../test-support/conversation-engine-v4-qualification-fixtures');

function input(overrides = {}) { return { request_id: 'v4-test', session_id: 'session-v4-test', claimed_inbound_message_id: '00000000-0000-4000-8000-000000000001', processing_order: 1, current_message: 'Tengo pollo y calabacitas, ¿cómo los preparo?', canonical_history: [{ role: 'assistant', text: '¿Qué alimentos tienes disponibles ahora?' }], durable_memory: { allergies: ['cacahuate'], dietary_restrictions: ['sin cerdo'], preferences: ['prefiere comida suave'] }, ...overrides }; }

test('V4 request injects authority, medical policy, canonical history, and only approved durable memory', () => {
  const request = buildRequest(input());
  assert.equal(request.commercial_context.version, SNAPSHOT.version);
  assert.equal(request.medical_policy.version, MEDICAL_POLICY.version);
  assert.deepEqual(request.durable_memory, { allergies: ['cacahuate'], dietary_restrictions: ['sin cerdo'], preferences: ['prefiere comida suave'] });
  assert.equal(Object.hasOwn(request, 'inventory'), false);
  assert.equal(Object.hasOwn(request, 'obligations'), false);
  assert.deepEqual(validateRequest(request), request);
  assert.equal(buildRequest(input({ current_message: 'Tengo pollo\ny calabacitas', canonical_history: [{ role: 'customer', text: 'Hola\nquiero cocinar' }] })).current_message, 'Tengo pollo\ny calabacitas');
  assert.throws(() => buildRequest({ ...input(), inventory: ['pollo'] }), error => error instanceof ConversationV4ContractError && error.code === 'V4_REQUEST_INVALID');
});

test('V4 output validation is structural only and permits arbitrary natural food wording', () => {
  const valid = validateModelOutput({ response: 'Con esos huauzontlez puedes hacer tortitas sencillas; si tienes huevo, úsalos para ligarlas.', memory_updates: [{ kind: 'preference', action: 'add', value: 'le gustan los huauzontles' }] });
  assert.equal(valid.response.includes('huauzontlez'), true);
  assert.throws(() => validateModelOutput({ response: 'Hola', memory_updates: [], intent: 'food_decision' }), /V4_MODEL_OUTPUT_INVALID/u);
  assert.throws(() => validateModelOutput({ response: '', memory_updates: [] }), /V4_MODEL_OUTPUT_INVALID/u);
  assert.throws(() => validateModelOutput({ response: 'Hola', memory_updates: [{ kind: 'inventory', action: 'add', value: 'pollo' }] }), /V4_MODEL_OUTPUT_INVALID/u);
});

test('V4 invokes exactly one primary model with authority and safety context, then returns proposed memory only', async () => {
  let received;
  const engine = createConversationEngineV4({ llmClient: { configuration: { model: 'gpt-6.1-sol' }, async generate(request) { received = request; return { response: 'Haz pollo con calabacitas en sartén y un poco de sal.', memory_updates: [] }; } } });
  const response = await engine.resolve(input());
  assert.equal(response.generation_status, 'generated');
  assert.equal(response.model, 'gpt-6.1-sol');
  assert.equal(response.response, 'Haz pollo con calabacitas en sartén y un poco de sal.');
  assert.deepEqual(response.memory_updates, []);
  assert.equal(received.current_message, input().current_message);
  assert.equal(received.commercial_context.version, SNAPSHOT.version);
  assert.equal(received.medical_policy.version, MEDICAL_POLICY.version);
});

test('V4 primary client uses one strict structured OpenAI call and exposes controlled failures', async () => {
  const calls = [];
  const client = createPrimaryConversationLlmClient({ apiKey: 'test-key', http: { async post(_url, body, options) { calls.push({ body, options }); return { data: { choices: [{ message: { content: JSON.stringify({ response: 'Prueba unas quesadillas de flor de calabaza.', memory_updates: [] }) } }] } }; } } });
  const output = await client.generate(buildRequest(input()));
  assert.equal(output.response, 'Prueba unas quesadillas de flor de calabaza.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, 'gpt-6.1-sol');
  assert.equal(calls[0].body.response_format.json_schema.strict, true);
  assert.deepEqual(calls[0].body.response_format.json_schema.schema.required, ['response', 'memory_updates']);
  assert.match(calls[0].body.messages[0].content, /medical_policy/u);
  await assert.rejects(() => createPrimaryConversationLlmClient({ apiKey: '', http: {} }).generate({}), error => error instanceof ConversationV4LlmError && error.code === 'llm_unavailable');
});

test('V4 prompt states culinary freedom, commercial grounding, medical separability, and durable-memory limits', () => {
  assert.match(PRIMARY_CONVERSATION_SYSTEM_PROMPT, /not a culinary capability whitelist/u);
  assert.match(PRIMARY_CONVERSATION_SYSTEM_PROMPT, /separable food question/u);
  assert.match(PRIMARY_CONVERSATION_SYSTEM_PROMPT, /allergies and dietary restrictions.*hard constraints/isu);
  assert.match(PRIMARY_CONVERSATION_SYSTEM_PROMPT, /temporary inventory.*durable memory/isu);
  assert.match(PRIMARY_CONVERSATION_SYSTEM_PROMPT, /allergen itself.*"cacahuate"/isu);
  assert.match(PRIMARY_CONVERSATION_SYSTEM_PROMPT, /restricted food or category itself.*"cerdo"/isu);
  assert.match(PRIMARY_CONVERSATION_SYSTEM_PROMPT, /copy its stored value exactly/iu);
  assert.match(PRIMARY_CONVERSATION_SYSTEM_PROMPT, /does not confirm.*do not turn missing information into a claim that the opposite is true/isu);
  assert.doesNotMatch(PRIMARY_CONVERSATION_SYSTEM_PROMPT, /five-item|inventory parser|obligation taxonomy|food scanner/iu);
});

test('V4 has no dependency on legacy semantic routing or Candidate V2/V3 modules', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const root = path.join(__dirname, '..', 'lib', 'conversation-engine-v4');
  const source = fs.readdirSync(root).filter(name => name.endsWith('.js')).map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
  assert.doesNotMatch(source, /direct-rag|contextualIngredientReply|boundedActiveInventoryList|splitLiteralFoods|recommendation-candidate-v3|recommendation-v2|obligation|buyer_signal|FACTS\.unsupported|food-span|appetite extractor/iu);
});

test('V4 qualification fixtures cover all three incidents and required edge classes without golden response strings', () => {
  const ids = new Set(FIXTURES.map(item => item.id));
  for (const id of ['long_inventory', 'early_satiety', 'preparation_capability', 'cooking_barrier', 'delayed_inventory', 'appetite_craving', 'uncertain_inventory', 'preparation', 'restaurant', 'delivery', 'regional_misspelling', 'topic_change', 'allergy_add', 'allergy_remove', 'preference_add', 'preference_remove', 'medical_mixed', 'invented_commercial', 'trial']) assert.equal(ids.has(id), true, id);
  assert.ok(FIXTURES.every(item => Array.isArray(item.criteria) && item.criteria.length > 0 && !Object.hasOwn(item, 'expected_response')));
});
