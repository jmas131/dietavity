'use strict';

const { SNAPSHOT } = require('./product-authority');
const { MEDICAL_POLICY } = require('./medical-policy');

const REQUEST_CONTRACT_VERSION = 'conversation-engine-v4-request-v1';
const RESPONSE_CONTRACT_VERSION = 'conversation-engine-v4-response-v1';
const ENGINE_VERSION = 'conversation-engine-v4-primary-v1';
const MEMORY_KINDS = Object.freeze(['allergy', 'dietary_restriction', 'preference']);
const MEMORY_ACTIONS = Object.freeze(['add', 'remove']);
const MAX_HISTORY_ITEMS = 30;
const MAX_HISTORY_TEXT = 3000;
const MAX_CURRENT_MESSAGE = 6000;
const MAX_RESPONSE = 4000;
const MAX_MEMORY_UPDATES = 12;
const MAX_MEMORY_VALUE = 160;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

class ConversationV4ContractError extends Error {
  constructor(code) { super(code); this.name = 'ConversationV4ContractError'; this.code = code; }
}

function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function plain(value) { return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0; }
function closed(value, keys) {
  if (!plain(value)) return false;
  const names = Object.getOwnPropertyNames(value);
  return names.length === keys.length && names.every(key => keys.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.enumerable && own(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
function cleanText(value, max, { singleLine = false } = {}) {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || (singleLine && /[\r\n\t]/u.test(value))) return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}
function stringArray(value, maxItems, maxItemLength) {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const values = value.map(item => cleanText(item, maxItemLength, { singleLine: true }));
  return values.every(Boolean) ? Object.freeze(values) : null;
}
function history(value) {
  if (!Array.isArray(value) || value.length > MAX_HISTORY_ITEMS) return null;
  const entries = value.map(item => {
    if (!closed(item, ['role', 'text']) || !['customer', 'assistant'].includes(item.role)) return null;
    const text = cleanText(item.text, MAX_HISTORY_TEXT);
    return text ? Object.freeze({ role: item.role, text }) : null;
  });
  return entries.every(Boolean) ? Object.freeze(entries) : null;
}
function memory(value) {
  if (!closed(value, ['allergies', 'dietary_restrictions', 'preferences'])) return null;
  const allergies = stringArray(value.allergies, 30, MAX_MEMORY_VALUE);
  const dietary_restrictions = stringArray(value.dietary_restrictions, 30, MAX_MEMORY_VALUE);
  const preferences = stringArray(value.preferences, 30, MAX_MEMORY_VALUE);
  return allergies && dietary_restrictions && preferences
    ? Object.freeze({ allergies, dietary_restrictions, preferences })
    : null;
}
function sameJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function buildRequest(input) {
  if (!closed(input, ['request_id', 'session_id', 'claimed_inbound_message_id', 'processing_order', 'current_message', 'canonical_history', 'durable_memory'])) throw new ConversationV4ContractError('V4_REQUEST_INVALID');
  const request_id = cleanText(input.request_id, 160, { singleLine: true });
  const session_id = cleanText(input.session_id, 320, { singleLine: true });
  const claimed_inbound_message_id = cleanText(input.claimed_inbound_message_id, 36, { singleLine: true });
  const current_message = cleanText(input.current_message, MAX_CURRENT_MESSAGE);
  const canonical_history = history(input.canonical_history);
  const durable_memory = memory(input.durable_memory);
  if (!request_id || !session_id || !UUID.test(claimed_inbound_message_id) || !current_message || !canonical_history || !durable_memory || !Number.isSafeInteger(input.processing_order) || input.processing_order < 0) throw new ConversationV4ContractError('V4_REQUEST_INVALID');
  return Object.freeze({
    contract_version: REQUEST_CONTRACT_VERSION,
    request_id,
    session_id,
    claimed_inbound_message_id,
    processing_order: input.processing_order,
    current_message,
    canonical_history,
    commercial_context: SNAPSHOT,
    medical_policy: MEDICAL_POLICY,
    durable_memory,
  });
}

function validateRequest(value) {
  if (!closed(value, ['contract_version', 'request_id', 'session_id', 'claimed_inbound_message_id', 'processing_order', 'current_message', 'canonical_history', 'commercial_context', 'medical_policy', 'durable_memory']) || value.contract_version !== REQUEST_CONTRACT_VERSION) throw new ConversationV4ContractError('V4_REQUEST_INVALID');
  const rebuilt = buildRequest({
    request_id: value.request_id,
    session_id: value.session_id,
    claimed_inbound_message_id: value.claimed_inbound_message_id,
    processing_order: value.processing_order,
    current_message: value.current_message,
    canonical_history: value.canonical_history,
    durable_memory: value.durable_memory,
  });
  if (!sameJson(value.commercial_context, SNAPSHOT) || !sameJson(value.medical_policy, MEDICAL_POLICY)) throw new ConversationV4ContractError('V4_REQUEST_AUTHORITY_INVALID');
  return rebuilt;
}

function validateModelOutput(value) {
  if (!closed(value, ['response', 'memory_updates']) || !Array.isArray(value.memory_updates) || value.memory_updates.length > MAX_MEMORY_UPDATES) throw new ConversationV4ContractError('V4_MODEL_OUTPUT_INVALID');
  const response = cleanText(value.response, MAX_RESPONSE);
  const memory_updates = value.memory_updates.map(update => {
    if (!closed(update, ['kind', 'action', 'value']) || !MEMORY_KINDS.includes(update.kind) || !MEMORY_ACTIONS.includes(update.action)) return null;
    const text = cleanText(update.value, MAX_MEMORY_VALUE, { singleLine: true });
    return text ? Object.freeze({ kind: update.kind, action: update.action, value: text }) : null;
  });
  if (!response || !memory_updates.every(Boolean)) throw new ConversationV4ContractError('V4_MODEL_OUTPUT_INVALID');
  return Object.freeze({ response, memory_updates: Object.freeze(memory_updates) });
}

function buildResponse({ request, model, output }) {
  const validRequest = validateRequest(request);
  const validOutput = validateModelOutput(output);
  const safeModel = cleanText(model, 120, { singleLine: true });
  if (!safeModel) throw new ConversationV4ContractError('V4_RESPONSE_INVALID');
  return Object.freeze({
    contract_version: RESPONSE_CONTRACT_VERSION,
    engine_version: ENGINE_VERSION,
    request_id: validRequest.request_id,
    model: safeModel,
    generation_status: 'generated',
    response: validOutput.response,
    memory_updates: validOutput.memory_updates,
    memory_update_count: validOutput.memory_updates.length,
  });
}

module.exports = Object.freeze({ REQUEST_CONTRACT_VERSION, RESPONSE_CONTRACT_VERSION, ENGINE_VERSION, MEMORY_KINDS, MEMORY_ACTIONS, ConversationV4ContractError, buildRequest, validateRequest, validateModelOutput, buildResponse });
