'use strict';

class ModelRuntimeError extends Error { constructor(code) { super(code); this.code = code; } }
const STAGES = new Set(['interpreter', 'bounded_reasoning', 'semantic_guidance_assessor', 'artifact_reproduction_assessor', 'composer', 'final_response_assessor']);
const retryable = error => error?.status === 429 || error?.status >= 500 || error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT';
function aborted(signal) { if (signal?.aborted) throw new ModelRuntimeError('MODEL_RUNTIME_DEADLINE_EXCEEDED'); }
function createHardenedModelTransport({ client, models, maxAttempts = 2 } = {}) {
  if (!client || typeof client.complete !== 'function' || !models || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new ModelRuntimeError('MODEL_RUNTIME_CONFIGURATION_INVALID');
  return Object.freeze({ async run({ stage, request, signal }) {
    if (!STAGES.has(stage) || !request || typeof request !== 'object' || typeof models[stage] !== 'string' || !models[stage]) throw new ModelRuntimeError('MODEL_RUNTIME_REQUEST_INVALID');
    let last;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      aborted(signal);
      try {
        const response = await client.complete({ model: models[stage], stage, instruction_version: request.prompt_version || request.composer_input_version || 'server-owned-v1', system_prompt: request.system_prompt, input: request.input, signal, attempt });
        aborted(signal);
        if (!response || typeof response !== 'object' || !Object.hasOwn(response, 'output')) throw new ModelRuntimeError('MODEL_RUNTIME_MALFORMED_RESPONSE');
        return structuredClone(response.output);
      } catch (error) {
        if (error instanceof ModelRuntimeError) throw error;
        if (signal?.aborted) throw new ModelRuntimeError('MODEL_RUNTIME_DEADLINE_EXCEEDED');
        last = error;
        if (!retryable(error) || attempt === maxAttempts) throw new ModelRuntimeError('MODEL_RUNTIME_UNAVAILABLE');
      }
    }
    throw new ModelRuntimeError('MODEL_RUNTIME_UNAVAILABLE', last);
  }});
}
function createStageAdapters({ transport, signal } = {}) {
  if (!transport || typeof transport.run !== 'function') throw new ModelRuntimeError('MODEL_RUNTIME_CONFIGURATION_INVALID');
  const stage = name => request => transport.run({ stage: name, request, signal });
  return Object.freeze({ interpreterAdapter: stage('interpreter'), boundedReasoningAdapter: stage('bounded_reasoning'), semanticGuidanceAssessor: stage('semantic_guidance_assessor'), artifactReproductionAssessor: stage('artifact_reproduction_assessor'), composerAdapter: stage('composer'), finalResponseAssessor: stage('final_response_assessor') });
}
module.exports = { ModelRuntimeError, STAGES, createHardenedModelTransport, createStageAdapters };
