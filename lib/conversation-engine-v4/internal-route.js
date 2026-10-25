'use strict';

const { secretMatches } = require('../conversation-engine/internal-route');
const { ConversationV4ContractError, RESPONSE_CONTRACT_VERSION, ENGINE_VERSION } = require('./contracts');
const { ConversationV4LlmError } = require('./llm-client');

const TRANSIENT_UPSTREAM_CATEGORIES = new Set(['timeout', 'http_429', 'http_5xx', 'network', 'unavailable']);

function requestId(value) {
  return typeof value?.request_id === 'string' ? value.request_id : null;
}

function availabilityFailure(value) {
  return Object.freeze({
    contract_version: RESPONSE_CONTRACT_VERSION,
    engine_version: ENGINE_VERSION,
    request_id: requestId(value),
    generation_status: 'infrastructure_failure',
    failure_category: 'engine_unavailable',
  });
}

function createConversationEngineV4Handler({ engine, secretProvider = () => process.env.DIETAVITY_CONVERSATION_ENGINE_SECRET } = {}) {
  if (!engine || typeof engine.resolve !== 'function') throw new TypeError('V4_CONVERSATION_ENGINE_REQUIRED');
  return async (req, res) => {
    const secret = secretProvider();
    if (!secretMatches(req.get('x-dietavity-conversation-engine-secret'), secret)) return res.status(401).json({ error: 'unauthorized' });
    try {
      return res.status(200).json(await engine.resolve(req.body));
    } catch (error) {
      if (error instanceof ConversationV4ContractError) return res.status(400).json({ error: 'invalid_request' });
      if (error instanceof ConversationV4LlmError && TRANSIENT_UPSTREAM_CATEGORIES.has(error.upstream_category)) {
        return res.status(503).json(availabilityFailure(req.body));
      }
      return res.status(500).json({ error: 'internal_error' });
    }
  };
}

module.exports = Object.freeze({
  TRANSIENT_UPSTREAM_CATEGORIES,
  availabilityFailure,
  createConversationEngineV4Handler,
});
