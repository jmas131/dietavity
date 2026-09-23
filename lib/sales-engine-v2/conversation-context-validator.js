'use strict';

const CHANNELS = new Set(['whatsapp']);
const CAMPAIGNS = new Set(['standard', 'glp1_validation']);
const ROLES = new Set(['customer', 'assistant']);
const CONTEXT_KEYS = new Set(['contract_version', 'context_id', 'locale', 'current_message', 'history', 'history_metadata', 'conversation_artifacts', 'conversation_artifacts_metadata', 'session_state', 'offer_context', 'customer_state', 'commercial_state', 'metadata', 'authoritative_context', 'informational_context']);
const HISTORY_KEYS = new Set(['role', 'text', 'occurred_at', 'source_id', 'final_visible']);
const ARTIFACT_KEYS = new Set(['artifact_id', 'artifact_type', 'generation_operation', 'generation_task_id', 'logical_reply_key', 'anchor_message_id', 'text', 'lineage_artifact_ids', 'occurred_at']);

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

function validateArtifact(artifact) {
  if (!isPlainObject(artifact) || !hasOnly(artifact, ARTIFACT_KEYS)) return 'CONVERSATION_ARTIFACT_FIELDS_INVALID';
  if (typeof artifact.artifact_id !== 'string' || !/^ca-[A-Za-z0-9._-]+$/.test(artifact.artifact_id)
    || !['draft', 'summary'].includes(artifact.artifact_type)
    || !['draft', 'transform', 'summarize'].includes(artifact.generation_operation)
    || typeof artifact.generation_task_id !== 'string' || !/^cgt-[A-Za-z0-9._-]+$/.test(artifact.generation_task_id)
    || typeof artifact.logical_reply_key !== 'string' || !artifact.logical_reply_key
    || typeof artifact.anchor_message_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artifact.anchor_message_id)
    || typeof artifact.text !== 'string' || !artifact.text
    || !Array.isArray(artifact.lineage_artifact_ids) || !artifact.lineage_artifact_ids.every(id => typeof id === 'string' && /^ca-[A-Za-z0-9._-]+$/.test(id))
    || new Set(artifact.lineage_artifact_ids).size !== artifact.lineage_artifact_ids.length
    || !isIsoTimestamp(artifact.occurred_at)) return 'CONVERSATION_ARTIFACT_INVALID';
  if (artifact.lineage_artifact_ids.includes(artifact.artifact_id)) return 'CONVERSATION_ARTIFACT_LINEAGE_INVALID';
  if ((artifact.generation_operation === 'summarize') !== (artifact.artifact_type === 'summary')) return 'CONVERSATION_ARTIFACT_INVALID';
  if ((artifact.generation_operation === 'draft') !== (artifact.lineage_artifact_ids.length === 0)) return 'CONVERSATION_ARTIFACT_LINEAGE_INVALID';
  if (artifact.generation_operation !== 'draft' && artifact.lineage_artifact_ids.length === 0) return 'CONVERSATION_ARTIFACT_LINEAGE_INVALID';
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
  if (!Array.isArray(context.conversation_artifacts)) return 'CONVERSATION_ARTIFACTS_INVALID';
  const artifactIds = new Set(); previous = null;
  for (const artifact of context.conversation_artifacts) {
    error = validateArtifact(artifact);
    if (error) return error;
    if (artifactIds.has(artifact.artifact_id)) return 'CONVERSATION_ARTIFACT_DUPLICATE_ID';
    artifactIds.add(artifact.artifact_id);
    const order = Date.parse(artifact.occurred_at);
    if (previous !== null && order <= previous) return order === previous ? 'CONVERSATION_ARTIFACT_ORDER_AMBIGUOUS' : 'CONVERSATION_ARTIFACT_ORDER_INVALID';
    previous = order;
  }
  for (const artifact of context.conversation_artifacts) if (artifact.lineage_artifact_ids.some(id => !artifactIds.has(id))) return 'CONVERSATION_ARTIFACT_LINEAGE_INCOMPLETE';
  const am = context.conversation_artifacts_metadata;
  if (!isPlainObject(am) || !hasOnly(am, new Set(['ordering', 'artifacts_truncated', 'retained_artifacts', 'retained_artifact_characters'])) || am.ordering !== 'occurred_at' || typeof am.artifacts_truncated !== 'boolean' || !Number.isInteger(am.retained_artifacts) || am.retained_artifacts !== context.conversation_artifacts.length || !Number.isInteger(am.retained_artifact_characters) || am.retained_artifact_characters !== context.conversation_artifacts.reduce((total, artifact) => total + artifact.text.length, 0)) return 'CONVERSATION_ARTIFACT_METADATA_INVALID';
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
