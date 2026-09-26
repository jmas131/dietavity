'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { createHardenedModelTransport, createStageAdapters } = require('../lib/sales-engine-v2/hardened-model-runtime');
test('T75C.1 transport forwards only stage request, retries bounded transient failures, and redacts errors', async () => {
  const calls = []; let attempt = 0;
  const transport = createHardenedModelTransport({ models: { interpreter: 'configured-model' }, maxAttempts: 2, client: { async complete(request) { calls.push(request); attempt += 1; if (attempt === 1) { const error = new Error('customer content must not leak'); error.status = 429; throw error; } return { output: { obligations: [] } }; } } });
  const output = await transport.run({ stage: 'interpreter', request: { prompt_version: 'v1', system_prompt: 'server-owned', input: { current_turn: 'bounded' } } });
  assert.deepEqual(output, { obligations: [] }); assert.equal(calls.length, 2); assert.equal(calls[0].model, 'configured-model'); assert.equal('client' in calls[0], false);
  const failing = createHardenedModelTransport({ models: { interpreter: 'm' }, client: { async complete() { throw new Error('sensitive provider body'); } } });
  await assert.rejects(() => failing.run({ stage: 'interpreter', request: { input: {} } }), error => error.code === 'MODEL_RUNTIME_UNAVAILABLE' && !/sensitive provider body/.test(error.message));
});
test('T75C.1 transport honors abort and stage adapters expose only domain callback surfaces', async () => {
  const controller = new AbortController(); controller.abort(); let called = false;
  const transport = createHardenedModelTransport({ models: { composer: 'm' }, client: { async complete() { called = true; return { output: {} }; } } });
  await assert.rejects(() => transport.run({ stage: 'composer', request: { input: {} }, signal: controller.signal }), error => error.code === 'MODEL_RUNTIME_DEADLINE_EXCEEDED'); assert.equal(called, false);
  const adapters = createStageAdapters({ transport });
  assert.deepEqual(Object.keys(adapters).sort(), ['artifactReproductionAssessor', 'boundedReasoningAdapter', 'composerAdapter', 'finalResponseAssessor', 'interpreterAdapter', 'semanticGuidanceAssessor']);
});
