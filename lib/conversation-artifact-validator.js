'use strict';

// Typed artifact metadata identifies bounded conversational material only. It
// is deliberately not a provenance source and never certifies its message text.
const ARTIFACT_TYPES = new Set(['draft', 'summary']);
const GENERATION_OPERATIONS = new Set(['draft', 'transform', 'summarize']);
const ARTIFACT_KEYS = new Set(['contract_version', 'artifact_id', 'artifact_type', 'generation_operation', 'generation_task_id', 'logical_reply_key', 'anchor_message_id']);
const LINEAGE_KEYS = new Set(['artifact_id', 'source_artifact_id', 'position']);
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => plainObject(value) && Object.keys(value).every(key => keys.has(key));
const artifactId = value => typeof value === 'string' && /^ca-[A-Za-z0-9._-]+$/.test(value);
const messageId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const taskId = value => typeof value === 'string' && /^cgt-[A-Za-z0-9._-]+$/.test(value);

function conversationArtifactValid(value) {
  return only(value, ARTIFACT_KEYS)
    && value.contract_version === '1.0'
    && artifactId(value.artifact_id)
    && ARTIFACT_TYPES.has(value.artifact_type)
    && GENERATION_OPERATIONS.has(value.generation_operation)
    && taskId(value.generation_task_id)
    && typeof value.logical_reply_key === 'string' && value.logical_reply_key.length > 0
    && messageId(value.anchor_message_id)
    && !(value.generation_operation === 'summarize' && value.artifact_type !== 'summary')
    && !(value.generation_operation !== 'summarize' && value.artifact_type !== 'draft');
}

function conversationArtifactRecordValid(value) {
  return only(value, new Set(['artifact', 'lineage'])) && conversationArtifactValid(value.artifact) && artifactSetValid(value.artifact, value.lineage);
}

function artifactLineageValid(value, artifact) {
  return conversationArtifactValid(artifact) && only(value, LINEAGE_KEYS)
    && value.artifact_id === artifact.artifact_id
    && artifactId(value.source_artifact_id)
    && value.source_artifact_id !== artifact.artifact_id
    && Number.isInteger(value.position) && value.position > 0;
}

function artifactSetValid(artifact, lineage) {
  if (!conversationArtifactValid(artifact) || !Array.isArray(lineage) || !lineage.every(item => artifactLineageValid(item, artifact))) return false;
  const sources = lineage.map(item => item.source_artifact_id);
  if (new Set(sources).size !== sources.length || new Set(lineage.map(item => item.position)).size !== lineage.length) return false;
  if (lineage.some((item, index) => item.position !== index + 1)) return false;
  if (artifact.generation_operation === 'draft') return lineage.length === 0;
  return lineage.length > 0;
}

module.exports = { ARTIFACT_TYPES, GENERATION_OPERATIONS, artifactLineageValid, artifactSetValid, conversationArtifactRecordValid, conversationArtifactValid };
