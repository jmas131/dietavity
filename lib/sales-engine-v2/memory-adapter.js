'use strict';

const { ConversationContextError, isIsoTimestamp, isPlainObject, assertConversationContext } = require('./conversation-context-validator');

const DEFAULT_OPTIONS = Object.freeze({ maxPriorTurns: 20, maxPriorCharacters: 12000 });
const ROLE_MAP = new Map([['human', 'customer'], ['customer', 'customer'], ['user', 'customer'], ['ai', 'assistant'], ['assistant', 'assistant']]);

function fail(code, cause) { throw new ConversationContextError(code, cause); }
function hasOnly(value, keys) { return Object.keys(value).every(key => keys.has(key)); }
function text(value, code) { if (typeof value !== 'string' || !value.length) fail(code); return value; }
function timestamp(value, code) { if (!isIsoTimestamp(value)) fail(code); return value; }
function identifier(value, code) { if (typeof value !== 'string' || !value) fail(code); return value; }

function normalizeRole(role) {
  if (typeof role !== 'string' || !ROLE_MAP.has(role)) fail('MEMORY_ROLE_UNSUPPORTED');
  return ROLE_MAP.get(role);
}

function normalizeCanonicalEntry(entry) {
  if (!isPlainObject(entry) || !hasOnly(entry, new Set(['source_id', 'role', 'text', 'occurred_at', 'final_visible']))) fail('MEMORY_HISTORY_INVALID');
  const result = { source_id: identifier(entry.source_id, 'MEMORY_SOURCE_ID_INVALID'), role: normalizeRole(entry.role), text: text(entry.text, 'MEMORY_TEXT_INVALID'), occurred_at: timestamp(entry.occurred_at, 'MEMORY_TIMESTAMP_INVALID') };
  if (entry.final_visible !== undefined) {
    if (typeof entry.final_visible !== 'boolean') fail('MEMORY_HISTORY_INVALID');
    result.final_visible = entry.final_visible;
  }
  return result;
}

// This is the only production-shape adapter. It understands the legacy
// persisted chat-memory payload, but exposes none of its implementation fields.
function normalizeOnboardingChatMemoryRow(row) {
  if (!isPlainObject(row) || !hasOnly(row, new Set(['id', 'session_id', 'created_at', 'updated_at', 'message']))) fail('MEMORY_HISTORY_INVALID');
  const message = row.message;
  if (!isPlainObject(message) || !hasOnly(message, new Set(['type', 'content', 'data', 'additional_kwargs']))) fail('MEMORY_HISTORY_INVALID');
  if (message.data !== undefined && (!isPlainObject(message.data) || !hasOnly(message.data, new Set(['content'])))) fail('MEMORY_HISTORY_INVALID');
  const content = message.content === undefined ? message.data?.content : message.content;
  if (message.content !== undefined && message.data?.content !== undefined && message.content !== message.data.content) fail('MEMORY_HISTORY_INVALID');
  return normalizeCanonicalEntry({ source_id: identifier(row.id, 'MEMORY_SOURCE_ID_INVALID'), role: message.type, text: text(content, 'MEMORY_TEXT_INVALID'), occurred_at: timestamp(row.created_at, 'MEMORY_TIMESTAMP_INVALID') });
}

function normalizeMemoryEntry(entry) {
  if (!isPlainObject(entry)) fail('MEMORY_HISTORY_INVALID');
  if ('message' in entry) return normalizeOnboardingChatMemoryRow(entry);
  return normalizeCanonicalEntry(entry);
}

function normalizeCurrentTurn(turn) {
  if (!isPlainObject(turn) || !hasOnly(turn, new Set(['id', 'text', 'received_at', 'occurred_at']))) fail('CURRENT_TURN_INVALID');
  if (turn.received_at !== undefined && turn.occurred_at !== undefined && turn.received_at !== turn.occurred_at) fail('CURRENT_TURN_INVALID');
  return { source_id: identifier(turn.id, 'CURRENT_TURN_INVALID'), role: 'customer', text: text(turn.text, 'CURRENT_TURN_INVALID'), occurred_at: timestamp(turn.received_at === undefined ? turn.occurred_at : turn.received_at, 'CURRENT_TURN_INVALID') };
}

function normalizeRuntimeMetadata(metadata) {
  if (!isPlainObject(metadata) || !hasOnly(metadata, new Set(['conversation_id', 'session_id', 'channel', 'locale', 'offer_version', 'campaign', 'commercial_state']))) fail('RUNTIME_METADATA_INVALID');
  const conversation_id = identifier(metadata.conversation_id, 'RUNTIME_METADATA_INVALID');
  const session_id = identifier(metadata.session_id, 'RUNTIME_METADATA_INVALID');
  if (metadata.channel !== 'whatsapp' || (metadata.locale !== undefined && metadata.locale !== 'es-MX')) fail('RUNTIME_METADATA_INVALID');
  if (metadata.offer_version !== undefined) identifier(metadata.offer_version, 'RUNTIME_METADATA_INVALID');
  if (metadata.campaign !== undefined && !['standard', 'glp1_validation'].includes(metadata.campaign)) fail('RUNTIME_METADATA_INVALID');
  const commercial = metadata.commercial_state === undefined ? {} : metadata.commercial_state;
  if (!isPlainObject(commercial) || !hasOnly(commercial, new Set(['checkout_sent', 'valid_purchase_confirmation'])) || Object.values(commercial).some(value => typeof value !== 'boolean')) fail('RUNTIME_METADATA_INVALID');
  return { conversation_id, session_id, channel: metadata.channel, locale: metadata.locale || 'es-MX', offer_version: metadata.offer_version, campaign: metadata.campaign, commercial_state: structuredClone(commercial) };
}

function normalizeOptions(options) {
  if (options === undefined) return { ...DEFAULT_OPTIONS };
  if (!isPlainObject(options) || !hasOnly(options, new Set(['maxPriorTurns', 'maxPriorCharacters']))) fail('MEMORY_ADAPTER_CONFIGURATION_INVALID');
  const result = { ...DEFAULT_OPTIONS, ...options };
  if (!Number.isInteger(result.maxPriorTurns) || result.maxPriorTurns < 0 || !Number.isInteger(result.maxPriorCharacters) || result.maxPriorCharacters < 0) fail('MEMORY_ADAPTER_CONFIGURATION_INVALID');
  return result;
}

function boundedHistory(history, options) {
  const selected = [];
  let characters = 0;
  for (let index = history.length - 1; index >= 0 && selected.length < options.maxPriorTurns; index -= 1) {
    const item = history[index];
    if (characters + item.text.length > options.maxPriorCharacters) break;
    selected.push(item); characters += item.text.length;
  }
  selected.reverse();
  return { history: selected, history_truncated: selected.length !== history.length, retained_prior_characters: characters };
}

function createConversationContext({ currentTurn, memory = [], runtimeMetadata, options } = {}) {
  const current = normalizeCurrentTurn(currentTurn);
  if (!Array.isArray(memory)) fail('MEMORY_HISTORY_INVALID');
  const normalized = memory.map(normalizeMemoryEntry);
  const ids = new Set();
  for (const entry of normalized) {
    if (ids.has(entry.source_id)) fail(entry.source_id === current.source_id ? 'CURRENT_TURN_DUPLICATED' : 'MEMORY_DUPLICATE_ID');
    ids.add(entry.source_id);
  }
  const currentEntries = normalized.filter(entry => entry.source_id === current.source_id);
  if (currentEntries.length > 1) fail('CURRENT_TURN_DUPLICATED');
  const history = normalized.filter(entry => entry.source_id !== current.source_id).sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  for (let index = 1; index < history.length; index += 1) if (Date.parse(history[index - 1].occurred_at) === Date.parse(history[index].occurred_at)) fail('MEMORY_ORDER_AMBIGUOUS');
  const runtime = normalizeRuntimeMetadata(runtimeMetadata);
  const config = normalizeOptions(options);
  const bounded = boundedHistory(history, config);
  return assertConversationContext({
    contract_version: '2.0', context_id: runtime.conversation_id + ':' + current.source_id, locale: runtime.locale,
    current_message: current,
    history: bounded.history,
    history_metadata: { ordering: 'occurred_at', history_truncated: bounded.history_truncated, retained_prior_turns: bounded.history.length, retained_prior_characters: bounded.retained_prior_characters },
    session_state: { session_id: runtime.session_id }, offer_context: runtime.offer_version === undefined ? {} : { offer_version: runtime.offer_version }, customer_state: {}, commercial_state: runtime.commercial_state,
    metadata: runtime.campaign === undefined ? { channel: runtime.channel } : { channel: runtime.channel, campaign: runtime.campaign }, authoritative_context: {}, informational_context: { knowledge: [] },
  });
}

module.exports = { DEFAULT_OPTIONS, ROLE_MAP, createConversationContext, normalizeCurrentTurn, normalizeMemoryEntry, normalizeOnboardingChatMemoryRow };
