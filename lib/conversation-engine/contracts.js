'use strict';

const REQUEST_CONTRACT_VERSION = 'conversation-engine-request-v1';
const RESPONSE_CONTRACT_VERSION = 'conversation-engine-response-v1';
const ENGINE_VERSION = 'direct-rag-v3-v1_3';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_HISTORY_ENTRIES = 12;
const MAX_CURRENT_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_TEXT_LENGTH = 1000;

class ConversationRequestError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ConversationRequestError';
    this.code = code;
  }
}

class ConversationResponseError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ConversationResponseError';
    this.code = code;
  }
}

function ownOnly(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const names = Object.getOwnPropertyNames(value);
    if (Object.getOwnPropertySymbols(value).length || names.some(name => !keys.has(name))) return false;
    return names.every(name => {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      return Boolean(descriptor) && descriptor.enumerable === true
        && Object.prototype.hasOwnProperty.call(descriptor, 'value');
    });
  } catch (_) {
    return false;
  }
}

function required(value, keys) {
  return keys.every(key => Object.hasOwn(value, key));
}

function fail(code) { throw new ConversationRequestError(code); }

function validateHistory(history, processingOrder) {
  if (!Array.isArray(history) || history.length > MAX_HISTORY_ENTRIES) fail('HISTORY_INVALID');
  let priorOrder = 0;
  let priorRole = null;
  return history.map(entry => {
    if (!ownOnly(entry, new Set(['role', 'text', 'source_processing_order']))
      || !required(entry, ['role', 'text', 'source_processing_order'])
      || !['customer', 'assistant'].includes(entry.role)
      || typeof entry.text !== 'string'
      || entry.text.length > MAX_HISTORY_TEXT_LENGTH
      || !Number.isSafeInteger(entry.source_processing_order)
      || entry.source_processing_order < 1
      || entry.source_processing_order >= processingOrder) fail('HISTORY_INVALID');
    if (entry.source_processing_order < priorOrder
      || (entry.source_processing_order === priorOrder && priorRole === 'assistant' && entry.role === 'customer')) fail('HISTORY_ORDER_INVALID');
    priorOrder = entry.source_processing_order;
    priorRole = entry.role;
    return Object.freeze({ role: entry.role, text: entry.text, source_processing_order: entry.source_processing_order });
  });
}

function validateRequest(value) {
  const keys = new Set(['contract_version', 'request_id', 'session_id', 'inbound_message_id', 'processing_order', 'current_message', 'canonical_history']);
  if (!ownOnly(value, keys) || !required(value, [...keys])) fail('REQUEST_INVALID');
  if (value.contract_version !== REQUEST_CONTRACT_VERSION
    || typeof value.request_id !== 'string' || !UUID.test(value.request_id)
    || typeof value.inbound_message_id !== 'string' || !UUID.test(value.inbound_message_id)
    || typeof value.session_id !== 'string' || !value.session_id.trim() || value.session_id.length > 200
    || !Number.isSafeInteger(value.processing_order) || value.processing_order < 1
    || typeof value.current_message !== 'string' || !value.current_message.trim() || value.current_message.length > MAX_CURRENT_MESSAGE_LENGTH) fail('REQUEST_INVALID');
  return Object.freeze({
    contract_version: value.contract_version,
    request_id: value.request_id,
    session_id: value.session_id,
    inbound_message_id: value.inbound_message_id,
    processing_order: value.processing_order,
    current_message: value.current_message,
    canonical_history: Object.freeze(validateHistory(value.canonical_history, value.processing_order)),
  });
}

function infrastructureFailure(requestId = null) {
  return Object.freeze({
    contract_version: RESPONSE_CONTRACT_VERSION,
    engine_version: ENGINE_VERSION,
    request_id: typeof requestId === 'string' && UUID.test(requestId) ? requestId : null,
    resolution: Object.freeze({ status: 'infrastructure_failure', type: 'engine_unavailable', delivery_permitted: false }),
    assistant_response: null,
    persistence: null,
    diagnostics: Object.freeze({ recommendation: null, llm: Object.freeze({ obligations: 'unavailable', composition: 'unavailable' }) }),
  });
}

function validateResponse(value) {
  const keys = new Set(['contract_version', 'engine_version', 'request_id', 'resolution', 'assistant_response', 'persistence', 'diagnostics']);
  const resolutionKeys = new Set(['status', 'type', 'delivery_permitted']);
  const persistenceKeys = new Set(['pending_action', 'strategy', 'buyer_signal', 'topic', 'conversation_stage', 'goal', 'next_last_question_type', 'events']);
  const diagnosticKeys = new Set(['recommendation', 'llm']);
  const recommendationKeys = new Set(['source', 'status', 'failure_code']);
  const llmKeys = new Set(['obligations', 'composition']);
  const invalid = code => { throw new ConversationResponseError(code); };
  if (!ownOnly(value, keys) || !required(value, [...keys]) || value.contract_version !== RESPONSE_CONTRACT_VERSION || value.engine_version !== ENGINE_VERSION || typeof value.request_id !== 'string' || !UUID.test(value.request_id) || typeof value.assistant_response !== 'string' || value.assistant_response.length > 4000) invalid('RESPONSE_INVALID');
  if (!ownOnly(value.resolution, resolutionKeys) || !required(value.resolution, [...resolutionKeys]) || !['resolved', 'safe_fallback'].includes(value.resolution.status) || value.resolution.type !== 'direct_rag_response' || value.resolution.delivery_permitted !== true) invalid('RESPONSE_INVALID');
  if (!ownOnly(value.persistence, persistenceKeys) || !required(value.persistence, [...persistenceKeys]) || value.persistence.pending_action !== 'respond' || !Array.isArray(value.persistence.events) || value.persistence.events.length) invalid('RESPONSE_INVALID');
  if (!ownOnly(value.diagnostics, diagnosticKeys) || !required(value.diagnostics, [...diagnosticKeys]) || !ownOnly(value.diagnostics.recommendation, recommendationKeys) || !required(value.diagnostics.recommendation, [...recommendationKeys]) || !ownOnly(value.diagnostics.llm, llmKeys) || !required(value.diagnostics.llm, [...llmKeys])) invalid('RESPONSE_INVALID');
  return Object.freeze(value);
}

module.exports = Object.freeze({
  REQUEST_CONTRACT_VERSION,
  RESPONSE_CONTRACT_VERSION,
  ENGINE_VERSION,
  MAX_HISTORY_ENTRIES,
  MAX_CURRENT_MESSAGE_LENGTH,
  MAX_HISTORY_TEXT_LENGTH,
  ConversationRequestError,
  ConversationResponseError,
  validateRequest,
  validateResponse,
  infrastructureFailure,
});
