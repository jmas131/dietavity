'use strict';

const CHANNELS = new Set(['whatsapp']);
const CAMPAIGNS = new Set(['standard', 'glp1_validation']);
const ROLES = new Set(['customer', 'assistant']);
const CONTEXT_KEYS = new Set(['contract_version', 'context_id', 'locale', 'current_message', 'history', 'history_metadata', 'session_state', 'offer_context', 'customer_state', 'commercial_state', 'metadata', 'authoritative_context', 'informational_context']);
const HISTORY_KEYS = new Set(['role', 'text', 'occurred_at', 'source_id', 'final_visible']);

class ConversationContextError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = 'ConversationContextError';
    this.code = code;
    this.cause = cause;
  }
}

function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function hasOnly(value, keys) { return Object.keys(value).every(key => keys.has(key)); }
function isIsoTimestamp(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && !Number.isNaN(Date.parse(value)); }

function validateMessage(message, current) {
  if (!isPlainObject(message) || !hasOnly(message, HISTORY_KEYS)) return 'CONVERSATION_MESSAGE_FIELDS_INVALID';
  if (!ROLES.has(message.role) || (current && message.role !== 'customer')) return 'CONVERSATION_ROLE_INVALID';
  if (typeof message.text !== 'string' || !message.text.length) return 'CONVERSATION_TEXT_INVALID';
  if (!isIsoTimestamp(message.occurred_at)) return 'CONVERSATION_TIMESTAMP_INVALID';
  if (typeof message.source_id !== 'string' || !message.source_id) return 'CONVERSATION_SOURCE_ID_INVALID';
  if (message.final_visible !== undefined && typeof message.final_visible !== 'boolean') return 'CONVERSATION_FINAL_VISIBLE_INVALID';
  return null;
}

function validateConversationContext(context) {
  if (!isPlainObject(context) || !hasOnly(context, CONTEXT_KEYS)) return 'CONVERSATION_CONTEXT_INVALID';
  for (const key of CONTEXT_KEYS) if (!(key in context)) return 'CONVERSATION_CONTEXT_REQUIRED_FIELD_MISSING';
  if (context.contract_version !== '2.0' || typeof context.context_id !== 'string' || !context.context_id || context.locale !== 'es-MX') return 'CONVERSATION_CONTEXT_INVALID';
  let error = validateMessage(context.current_message, true);
  if (error) return error;
  if (!Array.isArray(context.history)) return 'MEMORY_HISTORY_INVALID';
  const ids = new Set([context.current_message.source_id]);
  let previous = null;
  for (const message of context.history) {
    error = validateMessage(message, false);
    if (error) return error;
    if (ids.has(message.source_id)) return message.source_id === context.current_message.source_id ? 'CURRENT_TURN_DUPLICATED' : 'MEMORY_DUPLICATE_ID';
    ids.add(message.source_id);
    const order = [Date.parse(message.occurred_at), message.source_id];
    if (previous && order[0] <= previous[0]) return order[0] === previous[0] ? 'MEMORY_ORDER_AMBIGUOUS' : 'MEMORY_ORDER_INVALID';
    previous = order;
  }
  const hm = context.history_metadata;
  if (!isPlainObject(hm) || !hasOnly(hm, new Set(['ordering', 'history_truncated', 'retained_prior_turns', 'retained_prior_characters'])) || hm.ordering !== 'occurred_at' || typeof hm.history_truncated !== 'boolean' || !Number.isInteger(hm.retained_prior_turns) || hm.retained_prior_turns !== context.history.length || !Number.isInteger(hm.retained_prior_characters) || hm.retained_prior_characters < 0) return 'MEMORY_METADATA_INVALID';
  if (!isPlainObject(context.session_state) || !hasOnly(context.session_state, new Set(['session_id'])) || typeof context.session_state.session_id !== 'string' || !context.session_state.session_id) return 'RUNTIME_METADATA_INVALID';
  if (!isPlainObject(context.offer_context) || !hasOnly(context.offer_context, new Set(['offer_version'])) || (context.offer_context.offer_version !== undefined && (typeof context.offer_context.offer_version !== 'string' || !context.offer_context.offer_version))) return 'RUNTIME_METADATA_INVALID';
  if (!isPlainObject(context.customer_state) || Object.keys(context.customer_state).length) return 'RUNTIME_METADATA_INVALID';
  if (!isPlainObject(context.commercial_state) || !hasOnly(context.commercial_state, new Set(['checkout_sent', 'valid_purchase_confirmation'])) || Object.values(context.commercial_state).some(value => typeof value !== 'boolean')) return 'RUNTIME_METADATA_INVALID';
  if (!isPlainObject(context.metadata) || !hasOnly(context.metadata, new Set(['channel', 'campaign'])) || !CHANNELS.has(context.metadata.channel) || (context.metadata.campaign !== undefined && !CAMPAIGNS.has(context.metadata.campaign))) return 'RUNTIME_METADATA_INVALID';
  if (!isPlainObject(context.authoritative_context) || Object.keys(context.authoritative_context).length || !isPlainObject(context.informational_context) || !hasOnly(context.informational_context, new Set(['knowledge'])) || !Array.isArray(context.informational_context.knowledge) || context.informational_context.knowledge.length) return 'CONVERSATION_CONTEXT_INVALID';
  return null;
}

function assertConversationContext(context) {
  const error = validateConversationContext(context);
  if (error) throw new ConversationContextError(error);
  return structuredClone(context);
}

module.exports = { CAMPAIGNS, CHANNELS, CONTEXT_KEYS, ConversationContextError, ROLES, assertConversationContext, isIsoTimestamp, isPlainObject, validateConversationContext };
