'use strict';

const { ConversationContextError, isIsoTimestamp, isPlainObject, assertConversationContext } = require('./conversation-context-validator');
const { artifactSetValid, conversationArtifactRecordValid } = require('../conversation-artifact-validator');

const DEFAULT_OPTIONS = Object.freeze({ maxPriorTurns: 20, maxPriorCharacters: 12000, maxConversationArtifacts: 10, maxConversationArtifactCharacters: 12000 });
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
  if (!isPlainObject(options) || !hasOnly(options, new Set(['maxPriorTurns', 'maxPriorCharacters', 'maxConversationArtifacts', 'maxConversationArtifactCharacters']))) fail('MEMORY_ADAPTER_CONFIGURATION_INVALID');
  const result = { ...DEFAULT_OPTIONS, ...options };
  if (!Number.isInteger(result.maxPriorTurns) || result.maxPriorTurns < 0 || !Number.isInteger(result.maxPriorCharacters) || result.maxPriorCharacters < 0 || !Number.isInteger(result.maxConversationArtifacts) || result.maxConversationArtifacts < 0 || !Number.isInteger(result.maxConversationArtifactCharacters) || result.maxConversationArtifactCharacters < 0) fail('MEMORY_ADAPTER_CONFIGURATION_INVALID');
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

function normalizeArtifactMessage(message) {
  if (!isPlainObject(message) || !hasOnly(message, new Set(['id', 'direction', 'body', 'timestamp', 'idempotency_key', 'metadata']))) fail('CONVERSATION_ARTIFACT_CONTENT_INVALID');
  if (typeof message.id !== 'string' || !message.id || message.direction !== 'outbound' || typeof message.body !== 'string' || !message.body || !isIsoTimestamp(message.timestamp) || typeof message.idempotency_key !== 'string' || !message.idempotency_key || !isPlainObject(message.metadata)) fail('CONVERSATION_ARTIFACT_CONTENT_INVALID');
  return structuredClone(message);
}

function reconstructArtifact(record) {
  if (!isPlainObject(record) || !hasOnly(record, new Set(['artifact', 'lineage', 'messages'])) || !conversationArtifactRecordValid({ artifact: record.artifact, lineage: record.lineage }) || !Array.isArray(record.messages) || !record.messages.length) fail('CONVERSATION_ARTIFACT_INVALID');
  const artifact = record.artifact;
  const messages = record.messages.map(normalizeArtifactMessage);
  if (new Set(messages.map(message => message.id)).size !== messages.length) fail('CONVERSATION_ARTIFACT_CONTENT_AMBIGUOUS');
  const parts = messages.map(message => ({ message, logical_reply_key: message.metadata.logical_reply_key, part_index: message.metadata.part_index, part_count: message.metadata.part_count }));
  if (parts.some(part => part.logical_reply_key !== artifact.logical_reply_key || !Number.isInteger(part.part_index) || !Number.isInteger(part.part_count) || part.part_count < 1 || part.part_count > 999 || part.part_index < 1 || part.part_index > part.part_count)) fail('CONVERSATION_ARTIFACT_CONTENT_AMBIGUOUS');
  const count = parts[0].part_count;
  if (parts.length !== count || parts.some(part => part.part_count !== count) || new Set(parts.map(part => part.part_index)).size !== count) fail('CONVERSATION_ARTIFACT_CONTENT_AMBIGUOUS');
  parts.sort((a, b) => a.part_index - b.part_index);
  if (parts.some((part, index) => part.part_index !== index + 1)) fail('CONVERSATION_ARTIFACT_CONTENT_AMBIGUOUS');
  const anchor = parts[0].message;
  if (anchor.id !== artifact.anchor_message_id || anchor.idempotency_key !== artifact.logical_reply_key) fail('CONVERSATION_ARTIFACT_ANCHOR_INVALID');
  if (parts.some(part => part.message.idempotency_key !== (part.part_index === 1 ? artifact.logical_reply_key : `${artifact.logical_reply_key}:part:${String(part.part_index).padStart(3, '0')}`))) fail('CONVERSATION_ARTIFACT_CONTENT_AMBIGUOUS');
  return { artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type, generation_operation: artifact.generation_operation, generation_task_id: artifact.generation_task_id, logical_reply_key: artifact.logical_reply_key, anchor_message_id: artifact.anchor_message_id, text: parts.map(part => part.message.body).join('\n'), lineage_artifact_ids: record.lineage.map(item => item.source_artifact_id), occurred_at: anchor.timestamp };
}

function boundedArtifacts(artifacts, options) {
  const byId = new Map(artifacts.map(artifact => [artifact.artifact_id, artifact]));
  const selected = new Set();
  let characters = 0;

  function closure(id, collected = new Set()) {
    if (collected.has(id)) return collected;
    collected.add(id);
    for (const sourceId of byId.get(id).lineage_artifact_ids) closure(sourceId, collected);
    return collected;
  }

  // Newest candidates get first claim on the bounded projection, but only as
  // their complete explicit dependency closure. Skipped candidates never make
  // a dependent appear with dangling lineage; an older independent candidate
  // may still fit after a newer closure does not.
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const candidate = artifacts[index];
    const missing = [...closure(candidate.artifact_id)].filter(id => !selected.has(id));
    const additionalCharacters = missing.reduce((total, id) => total + byId.get(id).text.length, 0);
    if (selected.size + missing.length > options.maxConversationArtifacts || characters + additionalCharacters > options.maxConversationArtifactCharacters) continue;
    for (const id of missing) selected.add(id);
    characters += additionalCharacters;
  }
  const retained = artifacts.filter(artifact => selected.has(artifact.artifact_id));
  return { artifacts: retained, artifacts_truncated: retained.length !== artifacts.length, retained_artifact_characters: characters };
}

function projectConversationArtifacts(records, options) {
  if (!Array.isArray(records)) fail('CONVERSATION_ARTIFACTS_INVALID');
  const artifacts = records.map(reconstructArtifact);
  const ids = new Set();
  for (const artifact of artifacts) {
    if (ids.has(artifact.artifact_id)) fail('CONVERSATION_ARTIFACT_DUPLICATE_ID');
    ids.add(artifact.artifact_id);
  }
  for (const record of records) if (!artifactSetValid(record.artifact, record.lineage) || record.lineage.some(item => !ids.has(item.source_artifact_id))) fail('CONVERSATION_ARTIFACT_LINEAGE_INVALID');
  const sourcesById = new Map(records.map(record => [record.artifact.artifact_id, record.lineage.map(item => item.source_artifact_id)]));
  const visiting = new Set(); const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail('CONVERSATION_ARTIFACT_LINEAGE_INVALID');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const source of sourcesById.get(id)) visit(source);
    visiting.delete(id); visited.add(id);
  }
  for (const id of ids) visit(id);
  artifacts.sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  for (let index = 1; index < artifacts.length; index += 1) if (Date.parse(artifacts[index - 1].occurred_at) === Date.parse(artifacts[index].occurred_at)) fail('CONVERSATION_ARTIFACT_ORDER_AMBIGUOUS');
  return boundedArtifacts(artifacts, options);
}

function createConversationContext({ currentTurn, memory = [], conversationArtifacts = [], runtimeMetadata, options } = {}) {
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
  const projectedArtifacts = projectConversationArtifacts(conversationArtifacts, config);
  return assertConversationContext({
    contract_version: '2.0', context_id: runtime.conversation_id + ':' + current.source_id, locale: runtime.locale,
    current_message: current,
    history: bounded.history,
    history_metadata: { ordering: 'occurred_at', history_truncated: bounded.history_truncated, retained_prior_turns: bounded.history.length, retained_prior_characters: bounded.retained_prior_characters },
    conversation_artifacts: projectedArtifacts.artifacts,
    conversation_artifacts_metadata: { ordering: 'occurred_at', artifacts_truncated: projectedArtifacts.artifacts_truncated, retained_artifacts: projectedArtifacts.artifacts.length, retained_artifact_characters: projectedArtifacts.retained_artifact_characters },
    session_state: { session_id: runtime.session_id }, offer_context: runtime.offer_version === undefined ? {} : { offer_version: runtime.offer_version }, customer_state: {}, commercial_state: runtime.commercial_state,
    metadata: runtime.campaign === undefined ? { channel: runtime.channel } : { channel: runtime.channel, campaign: runtime.campaign }, authoritative_context: {}, informational_context: { knowledge: [] },
  });
}

module.exports = { DEFAULT_OPTIONS, ROLE_MAP, createConversationContext, normalizeCurrentTurn, normalizeMemoryEntry, normalizeOnboardingChatMemoryRow, projectConversationArtifacts };
