'use strict';

const { LAUNCH_ACTION_TYPES, launchActionIdentityValid } = require('./authorized-action-identity');

// Shared executable mirror of the normative schema. Stage validators layer
// narrower producer/consumer rules on top of this contract.
const RESOLVED_OBLIGATION_KEYS = new Set(['obligation_id', 'resolution_status', 'authority', 'source', 'factual_payload', 'policy_decision', 'allowed_claims', 'prohibited_claims', 'retrieved_knowledge_references', 'guidance_payload', 'llm_reasoning_permitted', 'customer_uncertainty_required', 'action_authorization', 'next_stage']);
const ACTION_TYPES = new Set(['create_checkout', 'provide_checkout_destination', 'provide_holding_page_destination', 'schedule_reminder', 'persist_commercial_transition', 'update_conversation_state']);
const AUTHORITIES = new Set(['canonical_fact', 'deterministic_policy', 'commercial_authorization', 'reviewed_knowledge', 'generated_guidance', 'conversational_generation', 'bounded_unknown', 'clarification_required', 'prohibited', 'resolver_failure', null]);
const STATUSES = new Set(['resolved', 'unknown', 'clarification_required', 'prohibited', 'failed', 'deferred']);
const STAGES = new Set(['reviewed_knowledge_or_reasoning', 'conversational_generation', 'support_resolution', 'response_composition']);
const BOUNDED_INPUT_TYPES = new Set(['meal_name', 'ingredient', 'preparation_step', 'meal_component', 'schedule_constraint', 'time_constraint', 'user_preference']);

function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function only(value, keys) { return Object.keys(value).every(key => keys.has(key)); }
function sourceValid(source, type) {
  if (!plainObject(source) || !only(source, new Set(['type', 'id', 'version', 'model_run_id', 'generation_stage'])) || source.type !== type || typeof source.id !== 'string' || !source.id || typeof source.version !== 'string' || !source.version) return false;
  if (type === 'generated_guidance') return typeof source.model_run_id === 'string' && !!source.model_run_id && source.generation_stage === 'bounded_reasoning';
  if (type === 'conversational_generation') return typeof source.model_run_id === 'string' && !!source.model_run_id && source.generation_stage === 'composer';
  return !('model_run_id' in source) && !('generation_stage' in source);
}
function actionValid(action) {
  if (!plainObject(action) || !only(action, new Set(['action_identity_version', 'action_id', 'action_type', 'authorization_source', 'authorizing_rule', 'parameters', 'preconditions', 'constraints', 'idempotency', 'status', 'expires_at'])) || !ACTION_TYPES.has(action.action_type) || action.authorization_source !== 'deterministic_policy' || typeof action.authorizing_rule !== 'string' || !action.authorizing_rule || !plainObject(action.parameters) || !Array.isArray(action.preconditions) || !action.preconditions.every(value => typeof value === 'string') || !plainObject(action.constraints) || !plainObject(action.idempotency) || action.idempotency.required !== true || !['inbound_message', 'session', 'action'].includes(action.idempotency.key_scope) || action.status !== 'authorized') return false;
  const hasIdentity = 'action_identity_version' in action || 'action_id' in action || 'execution_key_version' in action.idempotency || 'execution_key' in action.idempotency;
  if (!LAUNCH_ACTION_TYPES.has(action.action_type)) return !hasIdentity && only(action.idempotency, new Set(['required', 'key_scope']));
  return hasIdentity ? launchActionIdentityValid(action) && only(action.idempotency, new Set(['required', 'key_scope', 'execution_key_version', 'execution_key'])) : only(action.idempotency, new Set(['required', 'key_scope']));
}
function guidancePayloadValid(payload, references) {
  if (!plainObject(payload) || !only(payload, new Set(['units', 'semantic_safety_validation_required'])) || payload.semantic_safety_validation_required !== true || !Array.isArray(payload.units) || !payload.units.length) return false;
  const referenceIds = new Set((references || []).map(reference => reference.id));
  return payload.units.every(unit => {
    if (!plainObject(unit) || !only(unit, new Set(['unit_type', 'content', 'reviewed_knowledge_reference_ids', 'bounded_input_ids'])) || !['reviewed_information', 'practical_instruction', 'transformation', 'organization'].includes(unit.unit_type) || typeof unit.content !== 'string' || !unit.content) return false;
    const knowledge = ['reviewed_information', 'practical_instruction'].includes(unit.unit_type);
    if (knowledge) return Array.isArray(unit.reviewed_knowledge_reference_ids) && unit.reviewed_knowledge_reference_ids.length > 0 && new Set(unit.reviewed_knowledge_reference_ids).size === unit.reviewed_knowledge_reference_ids.length && unit.reviewed_knowledge_reference_ids.every(id => typeof id === 'string' && referenceIds.has(id)) && !('bounded_input_ids' in unit);
    return Array.isArray(unit.bounded_input_ids) && unit.bounded_input_ids.length > 0 && new Set(unit.bounded_input_ids).size === unit.bounded_input_ids.length && unit.bounded_input_ids.every(id => typeof id === 'string' && /^bi-[1-9][0-9]*$/.test(id)) && !('reviewed_knowledge_reference_ids' in unit);
  });
}
function normativeResolvedValid(value) {
  if (!plainObject(value) || !only(value, RESOLVED_OBLIGATION_KEYS) || !/^o-[A-Za-z0-9._-]+$/.test(value.obligation_id) || !STATUSES.has(value.resolution_status) || !AUTHORITIES.has(value.authority) || !('source' in value) || !Array.isArray(value.allowed_claims) || !Array.isArray(value.prohibited_claims) || !value.allowed_claims.every(item => typeof item === 'string') || !value.prohibited_claims.every(item => typeof item === 'string') || (value.policy_decision !== undefined && !plainObject(value.policy_decision)) || (value.retrieved_knowledge_references !== undefined && (!Array.isArray(value.retrieved_knowledge_references) || !value.retrieved_knowledge_references.every(reference => sourceValid(reference, 'reviewed_knowledge')))) || typeof value.customer_uncertainty_required !== 'boolean' || typeof value.llm_reasoning_permitted !== 'boolean') return false;
  if (value.resolution_status === 'deferred') return value.authority === null && value.source === null && STAGES.has(value.next_stage) && value.allowed_claims.length === 0 && value.prohibited_claims.length === 0 && value.customer_uncertainty_required === false && value.llm_reasoning_permitted === false && !['factual_payload', 'policy_decision', 'action_authorization', 'retrieved_knowledge_references', 'guidance_payload'].some(key => key in value);
  if (value.authority === null || 'next_stage' in value || value.llm_reasoning_permitted !== false && value.authority !== 'generated_guidance') return false;
  if (value.action_authorization !== undefined && !actionValid(value.action_authorization)) return false;
  if (value.authority === 'canonical_fact') return sourceValid(value.source, 'canonical_fact') && !('guidance_payload' in value);
  if (value.authority === 'bounded_unknown') return value.customer_uncertainty_required && (value.source === null || sourceValid(value.source, 'canonical_fact')) && !('guidance_payload' in value);
  if (value.authority === 'clarification_required' || value.authority === 'resolver_failure') return value.source === null && !('guidance_payload' in value);
  if (value.authority === 'reviewed_knowledge') return value.resolution_status === 'resolved' && sourceValid(value.source, 'reviewed_knowledge') && Array.isArray(value.retrieved_knowledge_references) && value.retrieved_knowledge_references.length > 0 && value.llm_reasoning_permitted === false && guidancePayloadValid(value.guidance_payload, value.retrieved_knowledge_references) && value.guidance_payload.units.every(unit => ['reviewed_information', 'practical_instruction'].includes(unit.unit_type));
  if (value.authority === 'generated_guidance') return value.resolution_status === 'resolved' && sourceValid(value.source, 'generated_guidance') && value.llm_reasoning_permitted === true && guidancePayloadValid(value.guidance_payload, value.retrieved_knowledge_references) && (!value.retrieved_knowledge_references || (Array.isArray(value.retrieved_knowledge_references) && value.retrieved_knowledge_references.every(reference => sourceValid(reference, 'reviewed_knowledge'))));
  const type = value.authority === 'conversational_generation' ? 'conversational_generation' : 'deterministic_policy';
  return sourceValid(value.source, type) && !('guidance_payload' in value);
}

const TASK_GUIDANCE_UNITS = Object.freeze({
  knowledge_question: new Set(['reviewed_information', 'practical_instruction']),
  transformation: new Set(['transformation']),
  organization: new Set(['organization']),
});

function practicalGuidanceTerminalValid(obligation, result) {
  if (!plainObject(obligation) || obligation.category !== 'practical_guidance' || !plainObject(obligation.practical_task) || !TASK_GUIDANCE_UNITS[obligation.practical_task.task_kind] || !Array.isArray(obligation.practical_task.bounded_inputs) || !normativeResolvedValid(result) || result.obligation_id !== obligation.id) return false;
  const inputs = obligation.practical_task.bounded_inputs;
  const inputIds = new Set(inputs.map(input => input?.id));
  if (inputIds.size !== inputs.length || inputs.some(input => !plainObject(input) || typeof input.id !== 'string' || !/^bi-[1-9][0-9]*$/.test(input.id) || !BOUNDED_INPUT_TYPES.has(input.input_type) || typeof input.value !== 'string' || !input.value || input.origin !== 'current_turn')) return false;
  if (!result.guidance_payload) return true;
  const permitted = TASK_GUIDANCE_UNITS[obligation.practical_task.task_kind];
  return result.guidance_payload.units.every(unit => permitted.has(unit.unit_type) && (!unit.bounded_input_ids || unit.bounded_input_ids.every(id => inputIds.has(id))));
}

module.exports = { ACTION_TYPES, RESOLVED_OBLIGATION_KEYS, TASK_GUIDANCE_UNITS, actionValid, normativeResolvedValid, plainObject, practicalGuidanceTerminalValid, sourceValid };
