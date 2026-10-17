'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationLlmError, createOpenAiConversationLlmClient } = require('../lib/conversation-engine/llm-client');

async function failure(client) {
  try {
    await client.interpret({});
  } catch (error) {
    assert.ok(error instanceof ConversationLlmError);
    return error;
  }
  assert.fail('expected ConversationLlmError');
}

test('Conversation Engine LLM client retains only bounded failure classifications and metadata', async () => {
  const missingKey = await failure(createOpenAiConversationLlmClient({ apiKey: '' }));
  assert.deepEqual({ code: missingKey.code, upstream_status: missingKey.upstream_status, upstream_category: missingKey.upstream_category }, { code: 'llm_unavailable', upstream_status: null, upstream_category: 'unavailable' });

  const timeout = await failure(createOpenAiConversationLlmClient({ apiKey: 'test-key', http: { async post() { const error = new Error('request timeout'); error.code = 'ECONNABORTED'; throw error; } } }));
  assert.deepEqual({ code: timeout.code, upstream_status: timeout.upstream_status, upstream_category: timeout.upstream_category }, { code: 'llm_timeout', upstream_status: null, upstream_category: 'timeout' });

  const malformed = await failure(createOpenAiConversationLlmClient({ apiKey: 'test-key', http: { async post() { return { data: { choices: [{ message: { content: 'not json' } }] } }; } } }));
  assert.deepEqual({ code: malformed.code, upstream_status: malformed.upstream_status, upstream_category: malformed.upstream_category }, { code: 'llm_malformed_output', upstream_status: null, upstream_category: 'malformed_output' });

  for (const [status, category] of [[429, 'http_429'], [503, 'http_5xx'], [401, 'http_4xx']]) {
    const transport = await failure(createOpenAiConversationLlmClient({ apiKey: 'test-key', http: { async post() { throw { response: { status }, message: 'upstream failure', headers: { authorization: 'do-not-retain' } }; } } }));
    assert.deepEqual({ code: transport.code, upstream_status: transport.upstream_status, upstream_category: transport.upstream_category }, { code: 'llm_transport_failure', upstream_status: status, upstream_category: category });
    assert.doesNotMatch(JSON.stringify(transport), /upstream failure|authorization|do-not-retain/u);
  }
});

test('Conversation Engine LLM client rejects invalid upstream statuses without retaining raw error material', async () => {
  const transport = await failure(createOpenAiConversationLlmClient({ apiKey: 'test-key', http: { async post() { throw { response: { status: 999 }, message: 'sensitive transport detail', config: { headers: { Authorization: 'secret' } } }; } } }));
  assert.deepEqual({ code: transport.code, upstream_status: transport.upstream_status, upstream_category: transport.upstream_category }, { code: 'llm_transport_failure', upstream_status: null, upstream_category: 'network' });
  assert.doesNotMatch(JSON.stringify(transport), /sensitive|secret|config|headers/u);
});

test('candidate generation is an isolated strict structured-output call using the same bounded transport contract', async () => {
  const calls = [];
  const diagnostics = [];
  const client = createOpenAiConversationLlmClient({ apiKey: 'test-key', http: { async post(_url, body) {
    calls.push(body);
    return { data: { choices: [{ message: { content: '{"candidates":[{"required_refs":["food-1"],"pantry_ids":[],"actions":[{"kind":"cook","refs":["food-1"]}],"portion":"normal"}]}' } }] } };
  } }, candidateDiagnosticLogger: event => diagnostics.push(event) });
  const constrained = {
    contract_version: 'recommendation-candidate-v1',
    availability: { scope: 'constrained', references: [{ id: 'food-1' }, { id: 'group-1' }] },
  };
  assert.deepEqual(await client.generateRecommendationCandidates(constrained), { candidates: [{ required_refs: ['food-1'], pantry_ids: [], actions: [{ kind: 'cook', refs: ['food-1'] }], portion: 'normal' }] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].messages[0].content, /zero to two practical, simple meal candidates appropriate for users in Mexico/u);
  assert.equal(calls[0].messages[1].content, JSON.stringify(constrained));
  const schema = calls[0].response_format;
  assert.equal(schema.type, 'json_schema');
  assert.equal(schema.json_schema.strict, true);
  assert.equal(schema.json_schema.schema.additionalProperties, false);
  assert.equal(schema.json_schema.schema.properties.candidates.maxItems, 2);
  const candidate = schema.json_schema.schema.properties.candidates.items;
  assert.deepEqual(candidate.required, ['required_refs', 'pantry_ids', 'actions', 'portion']);
  assert.equal(candidate.additionalProperties, false);
  assert.deepEqual(candidate.properties.required_refs.items.enum, ['food-1', 'group-1']);
  assert.deepEqual(candidate.properties.pantry_ids.items.enum, ['water', 'salt', 'cooking_oil']);
  assert.deepEqual(candidate.properties.portion.enum, ['small', 'normal']);
  const action = candidate.properties.actions.items;
  assert.equal(action.additionalProperties, false);
  assert.deepEqual(action.properties.kind.enum, ['cook', 'saute', 'mix', 'heat', 'serve', 'combine']);
  assert.deepEqual(action.properties.refs.items.enum, ['food-1', 'group-1', 'water', 'salt', 'cooking_oil']);
  assert.deepEqual(diagnostics, [
    { event: 'recommendation_candidate_raw_output', message_content: '{"candidates":[{"required_refs":["food-1"],"pantry_ids":[],"actions":[{"kind":"cook","refs":["food-1"]}],"portion":"normal"}]}' },
    {
      event: 'recommendation_candidate_parsed_actions',
      actions: [{
        candidate_index: 0,
        action_index: 0,
        is_object: true,
        prototype_is_object_prototype: true,
        prototype_is_null: false,
        own_enumerable_keys: ['kind', 'refs'],
        symbol_count: 0,
        property_descriptors: [
          { key: 'kind', kind: 'data', enumerable: true, configurable: true, writable: true, has_getter: false, has_setter: false },
          { key: 'refs', kind: 'data', enumerable: true, configurable: true, writable: true, has_getter: false, has_setter: false },
        ],
      }],
    },
  ]);
});

test('only candidate generation receives its strict schema, including broad candidate structure', async () => {
  const calls = [];
  const diagnostics = [];
  const client = createOpenAiConversationLlmClient({ apiKey: 'test-key', http: { async post(_url, body) {
    calls.push(body);
    return { data: { choices: [{ message: { content: '{"candidates":[]}' } }] } };
  } }, candidateDiagnosticLogger: event => diagnostics.push(event) });
  await client.interpret({ contract_version: 'conversation-engine-request-v1' });
  await client.compose({ contract_version: 'composition-envelope-v1' });
  await client.generateRecommendationCandidates({ contract_version: 'recommendation-candidate-v1', availability: { scope: 'broad', references: [] } });
  assert.equal(calls[0].response_format, undefined);
  assert.equal(calls[1].response_format, undefined);
  const candidate = calls[2].response_format.json_schema.schema.properties.candidates.items;
  assert.deepEqual(candidate.required, ['selected_foods', 'pantry_ids', 'actions', 'portion']);
  assert.equal(candidate.additionalProperties, false);
  assert.deepEqual(candidate.properties.selected_foods.items.required, ['id', 'label']);
  assert.equal(candidate.properties.selected_foods.items.additionalProperties, false);
  assert.deepEqual(candidate.properties.selected_foods.items.properties.id.enum, ['selected-1', 'selected-2', 'selected-3', 'selected-4']);
  assert.equal(diagnostics.length, 2);
});
