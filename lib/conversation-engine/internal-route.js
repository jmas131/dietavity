'use strict';

const crypto = require('node:crypto');
const { ConversationRequestError, ConversationResponseError, validateResponse, infrastructureFailure } = require('./contracts');
const { ConversationLlmError } = require('./llm-client');

function secretMatches(value, expected) {
  if (typeof value !== 'string' || typeof expected !== 'string' || expected.length < 32 || value.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

function requestId(value) {
  return typeof value?.request_id === 'string' ? value.request_id : null;
}

function createConversationEngineHandler({ engine, secretProvider = () => process.env.DIETAVITY_CONVERSATION_ENGINE_SECRET } = {}) {
  if (!engine || typeof engine.resolve !== 'function') throw new TypeError('CONVERSATION_ENGINE_REQUIRED');
  return async (req, res) => {
    const secret = secretProvider();
    if (!secretMatches(req.get('x-dietavity-conversation-engine-secret'), secret)) return res.status(401).json({ error: 'unauthorized' });
    try {
      return res.status(200).json(validateResponse(await engine.resolve(req.body)));
    } catch (error) {
      if (error instanceof ConversationRequestError) return res.status(400).json({ error: 'invalid_request' });
      if (error instanceof ConversationResponseError) return res.status(500).json(infrastructureFailure(requestId(req.body)));
      if (error instanceof ConversationLlmError) return res.status(503).json(infrastructureFailure(requestId(req.body)));
      return res.status(500).json(infrastructureFailure(requestId(req.body)));
    }
  };
}

module.exports = Object.freeze({ createConversationEngineHandler, secretMatches });
