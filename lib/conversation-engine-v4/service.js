'use strict';

const { buildRequest, validateModelOutput, buildResponse } = require('./contracts');
const { createPrimaryConversationLlmClient } = require('./llm-client');

function createConversationEngineV4({ llmClient = createPrimaryConversationLlmClient() } = {}) {
  if (!llmClient || typeof llmClient.generate !== 'function' || !llmClient.configuration?.model) throw new TypeError('V4_LLM_CLIENT_INVALID');
  return Object.freeze({
    async resolve(input) {
      const request = buildRequest(input);
      const output = validateModelOutput(await llmClient.generate(request));
      return buildResponse({ request, model: llmClient.configuration.model, output });
    },
  });
}

module.exports = Object.freeze({ createConversationEngineV4 });
