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

test('candidate generation is an isolated JSON call using the same bounded transport contract', async () => {
  const calls = [];
  const client = createOpenAiConversationLlmClient({ apiKey: 'test-key', http: { async post(_url, body) {
    calls.push(body);
    return { data: { choices: [{ message: { content: '{"candidates":[]}' } }] } };
  } } });
  assert.deepEqual(await client.generateRecommendationCandidates({ contract_version: 'recommendation-candidate-v1' }), { candidates: [] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].messages[0].content, /zero to two practical, simple meal candidates appropriate for users in Mexico/u);
  assert.equal(calls[0].messages[1].content, '{"contract_version":"recommendation-candidate-v1"}');
});
