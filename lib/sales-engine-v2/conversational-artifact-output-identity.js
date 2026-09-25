'use strict';

// Ticket 65B.1 establishes a prospective persistence identity only. It never
// contains generated text and does not authorize persistence or delivery.
const crypto = require('node:crypto');
const { assertConversationContext } = require('./conversation-context-validator');
const { assertResponsePlan } = require('./response-plan-validator');

const CONTRACT_VERSION = 'ticket-65b1-v1';
const GENERATION_TASK_DOMAIN = 'conversational-artifact-generation-task-v1';
const ARTIFACT_DOMAIN = 'conversational-artifact-output-v1';
const BINDING_DOMAIN = 'conversational-artifact-output-binding-v1';
const PRODUCING_OPERATIONS = new Set(['draft', 'transform', 'summarize']);
const OUTPUT_KEYS = new Set(['contract_version', 'artifact_id', 'generation_task_id', 'artifact_type', 'generation_operation', 'ordered_lineage_artifact_ids', 'identity_binding']);
const only = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.has(key));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const artifactId = value => typeof value === 'string' && /^ca-[0-9a-f]{64}$/.test(value);
const lineageArtifactId = value => typeof value === 'string' && /^ca-[A-Za-z0-9._-]+$/.test(value);
const taskId = value => typeof value === 'string' && /^cgt-[0-9a-f]{64}$/.test(value);
const binding = value => typeof value === 'string' && /^caob-[0-9a-f]{64}$/.test(value);
const typeFor = operation => operation === 'summarize' ? 'summary' : 'draft';

class ConversationalArtifactOutputIdentityError extends Error {
  constructor(code, cause) { super(code); this.name = 'ConversationalArtifactOutputIdentityError'; this.code = code; this.cause = cause; }
}

function generationSpecification(task) {
  return {
    obligation_id: task.obligation_id,
    generation_operation: task.operation,
    current_turn_inputs: task.current_turn_inputs.map(item => [item.input_type, item.value, item.origin]),
    current_turn_constraints: task.current_turn_constraints.map(item => [item.value, item.origin]),
    ordered_lineage_artifact_ids: task.artifacts.map(item => item.artifact_id),
  };
}

function identityBasis(context, task) {
  return [CONTRACT_VERSION, context.context_id, context.current_message.canonical_message_id.toLowerCase(), generationSpecification(task)];
}

function taskValid(task) {
  return only(task, new Set(['obligation_id', 'operation', 'current_turn_inputs', 'current_turn_constraints', 'artifacts']))
    && typeof task.obligation_id === 'string' && /^o-[A-Za-z0-9._-]+$/.test(task.obligation_id)
    && ['draft', 'transform', 'summarize', 'show'].includes(task.operation)
    && Array.isArray(task.current_turn_inputs) && task.current_turn_inputs.every(item => only(item, new Set(['input_type', 'value', 'origin'])) && item.input_type === 'draft_specification' && typeof item.value === 'string' && !!item.value && item.origin === 'current_turn')
    && Array.isArray(task.current_turn_constraints) && task.current_turn_constraints.every(item => only(item, new Set(['value', 'origin'])) && typeof item.value === 'string' && !!item.value && item.origin === 'current_turn')
    && Array.isArray(task.artifacts) && task.artifacts.every(item => only(item, new Set(['artifact_id', 'text'])) && typeof item.artifact_id === 'string' && /^ca-[A-Za-z0-9._-]+$/.test(item.artifact_id) && typeof item.text === 'string' && !!item.text)
    && new Set(task.artifacts.map(item => item.artifact_id)).size === task.artifacts.length
    && (task.operation === 'draft' ? task.artifacts.length === 0 && task.current_turn_inputs.length > 0 : task.operation === 'summarize' ? task.artifacts.length > 0 : task.artifacts.length === 1);
}

function deriveConversationalArtifactOutputIntent({ context, conversationalGeneration }) {
  let canonicalContext;
  try { canonicalContext = assertConversationContext(context); } catch (error) { throw new ConversationalArtifactOutputIdentityError('ARTIFACT_OUTPUT_IDENTITY_INPUT_INVALID', error); }
  if (!taskValid(conversationalGeneration)) throw new ConversationalArtifactOutputIdentityError('ARTIFACT_OUTPUT_IDENTITY_INPUT_INVALID');
  const task = structuredClone(conversationalGeneration);
  if (!PRODUCING_OPERATIONS.has(task.operation)) return null;
  const basis = identityBasis(canonicalContext, task);
  const generation_task_id = `cgt-${digest([GENERATION_TASK_DOMAIN, basis])}`;
  const artifact_id = `ca-${digest([ARTIFACT_DOMAIN, generation_task_id])}`;
  const ordered_lineage_artifact_ids = task.artifacts.map(item => item.artifact_id);
  const value = {
    contract_version: CONTRACT_VERSION,
    artifact_id,
    generation_task_id,
    artifact_type: typeFor(task.operation),
    generation_operation: task.operation,
    ordered_lineage_artifact_ids,
    identity_binding: `caob-${digest([BINDING_DOMAIN, basis, generation_task_id, artifact_id])}`,
  };
  return assertConversationalArtifactOutputIntent(value);
}

function conversationalArtifactOutputIntentValid(value, { context, conversationalGeneration } = {}) {
  if (!only(value, OUTPUT_KEYS) || [...OUTPUT_KEYS].some(key => !Object.hasOwn(value, key)) || value.contract_version !== CONTRACT_VERSION || !artifactId(value.artifact_id) || !taskId(value.generation_task_id) || !['draft', 'summary'].includes(value.artifact_type) || !PRODUCING_OPERATIONS.has(value.generation_operation) || !Array.isArray(value.ordered_lineage_artifact_ids) || !value.ordered_lineage_artifact_ids.every(lineageArtifactId) || new Set(value.ordered_lineage_artifact_ids).size !== value.ordered_lineage_artifact_ids.length || value.ordered_lineage_artifact_ids.includes(value.artifact_id) || !binding(value.identity_binding) || value.artifact_type !== typeFor(value.generation_operation) || (value.generation_operation === 'draft' ? value.ordered_lineage_artifact_ids.length !== 0 : value.ordered_lineage_artifact_ids.length === 0)) return false;
  if (!context || !conversationalGeneration) return true;
  try { return JSON.stringify(value) === JSON.stringify(deriveConversationalArtifactOutputIntent({ context, conversationalGeneration })); } catch { return false; }
}

function assertConversationalArtifactOutputIntent(value, context) {
  if (!conversationalArtifactOutputIntentValid(value, context)) throw new ConversationalArtifactOutputIdentityError('ARTIFACT_OUTPUT_IDENTITY_INVALID');
  return deepFreeze(structuredClone(value));
}

function deriveArtifactOutputIntents({ context, responsePlan }) {
  let plan; let canonicalContext;
  try { canonicalContext = assertConversationContext(context); plan = assertResponsePlan(responsePlan); } catch (error) { throw new ConversationalArtifactOutputIdentityError('ARTIFACT_OUTPUT_IDENTITIES_INPUT_INVALID', error); }
  if (plan.context_id !== canonicalContext.context_id) throw new ConversationalArtifactOutputIdentityError('ARTIFACT_OUTPUT_IDENTITIES_CONTEXT_INVALID');
  return deepFreeze(plan.conversational_generation.map(task => deriveConversationalArtifactOutputIntent({ context: canonicalContext, conversationalGeneration: task })).filter(Boolean));
}

function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; }

module.exports = { ARTIFACT_DOMAIN, BINDING_DOMAIN, CONTRACT_VERSION, ConversationalArtifactOutputIdentityError, GENERATION_TASK_DOMAIN, PRODUCING_OPERATIONS, assertConversationalArtifactOutputIntent, conversationalArtifactOutputIntentValid, deriveArtifactOutputIntents, deriveConversationalArtifactOutputIntent, generationSpecification, identityBasis, taskValid };
