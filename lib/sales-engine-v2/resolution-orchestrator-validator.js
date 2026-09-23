'use strict';

const { assertConversationContext } = require('./conversation-context-validator');
const { ATTRIBUTE_KEYS, CATEGORIES, CONFIDENCES } = require('./interpreter-validator');

class ResolutionOrchestratorError extends Error {
  constructor(code, cause) { super(code); this.name = 'ResolutionOrchestratorError'; this.code = code; this.cause = cause; }
}

const ACTION_TYPES = new Set(['create_checkout', 'provide_checkout_destination', 'provide_holding_page_destination', 'schedule_reminder', 'persist_commercial_transition', 'update_conversation_state']);
const STATUSES = new Set(['resolved', 'unknown', 'clarification_required', 'prohibited', 'failed', 'deferred']);
const AUTHORITIES = new Set(['canonical_fact', 'deterministic_policy', 'commercial_authorization', 'bounded_unknown', 'clarification_required', 'prohibited', 'resolver_failure', null]);
const DEFERRED_STAGES = new Set(['reviewed_knowledge_or_reasoning', 'conversational_generation', 'support_resolution', 'response_composition']);
const RESOLVED_OBLIGATION_KEYS = new Set(['obligation_id', 'resolution_status', 'authority', 'source', 'factual_payload', 'policy_decision', 'allowed_claims', 'prohibited_claims', 'retrieved_knowledge_references', 'llm_reasoning_permitted', 'customer_uncertainty_required', 'action_authorization', 'next_stage']);

function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function only(object, keys) { return Object.keys(object).every(key => keys.has(key)); }
function sourceMatches(source, type) { return plainObject(source) && only(source, new Set(['type', 'id', 'version'])) && source.type === type && typeof source.id === 'string' && !!source.id && typeof source.version === 'string' && !!source.version; }

function assertObligation(obligation) {
  const keys = new Set(['id', 'category', 'subject', 'current_turn_evidence', 'confidence', 'ambiguous', 'attributes']);
  if (!plainObject(obligation) || !only(obligation, keys) || typeof obligation.id !== 'string' || !/^o-[A-Za-z0-9._-]+$/.test(obligation.id) || !CATEGORIES.has(obligation.category) || typeof obligation.current_turn_evidence !== 'string' || !obligation.current_turn_evidence || !CONFIDENCES.has(obligation.confidence) || typeof obligation.ambiguous !== 'boolean') throw new ResolutionOrchestratorError('ORCHESTRATION_OBLIGATION_INVALID');
  if (obligation.subject !== undefined && (typeof obligation.subject !== 'string' || !obligation.subject)) throw new ResolutionOrchestratorError('ORCHESTRATION_OBLIGATION_INVALID');
  if (obligation.attributes !== undefined && (!plainObject(obligation.attributes) || !only(obligation.attributes, ATTRIBUTE_KEYS) || Object.values(obligation.attributes).some(value => typeof value !== 'string' || !value))) throw new ResolutionOrchestratorError('ORCHESTRATION_OBLIGATION_INVALID');
  return structuredClone(obligation);
}

function assertInputs(input) {
  if (!plainObject(input) || !only(input, new Set(['context', 'obligations', 'factResolver', 'policyResolver', 'asOf', 'reminderContexts']))) throw new ResolutionOrchestratorError('ORCHESTRATION_INPUT_INVALID');
  let context;
  try { context = assertConversationContext(input.context); } catch (error) { throw new ResolutionOrchestratorError('ORCHESTRATION_CONTEXT_INVALID', error); }
  if (!Array.isArray(input.obligations)) throw new ResolutionOrchestratorError('ORCHESTRATION_OBLIGATIONS_INVALID');
  const obligations = input.obligations.map(assertObligation);
  if (new Set(obligations.map(value => value.id)).size !== obligations.length) throw new ResolutionOrchestratorError('ORCHESTRATION_OBLIGATION_IDS_DUPLICATE');
  if (typeof input.asOf !== 'string' || Number.isNaN(Date.parse(input.asOf))) throw new ResolutionOrchestratorError('ORCHESTRATION_AS_OF_INVALID');
  if (!input.factResolver || typeof input.factResolver.resolveFact !== 'function' || !input.policyResolver || typeof input.policyResolver.resolvePolicy !== 'function') throw new ResolutionOrchestratorError('ORCHESTRATION_RESOLVER_INTERFACE_INVALID');
  if (input.reminderContexts !== undefined && (!plainObject(input.reminderContexts) || Object.values(input.reminderContexts).some(value => !plainObject(value)))) throw new ResolutionOrchestratorError('ORCHESTRATION_REMINDER_CONTEXT_INVALID');
  return { context, obligations, factResolver: input.factResolver, policyResolver: input.policyResolver, asOf: input.asOf, reminderContexts: input.reminderContexts || {} };
}

function actionValid(action) {
  return plainObject(action) && only(action, new Set(['action_type', 'authorization_source', 'authorizing_rule', 'parameters', 'preconditions', 'constraints', 'idempotency', 'status', 'expires_at'])) && ACTION_TYPES.has(action.action_type) && action.authorization_source === 'deterministic_policy' && typeof action.authorizing_rule === 'string' && !!action.authorizing_rule && plainObject(action.parameters) && Array.isArray(action.preconditions) && action.preconditions.every(value => typeof value === 'string') && plainObject(action.constraints) && plainObject(action.idempotency) && action.idempotency.required === true && ['inbound_message', 'session', 'action'].includes(action.idempotency.key_scope) && action.status === 'authorized' && (action.expires_at === undefined || (typeof action.expires_at === 'string' && !Number.isNaN(Date.parse(action.expires_at))));
}

function resolvedValid(value) {
  if (!plainObject(value) || !only(value, RESOLVED_OBLIGATION_KEYS) || !/^o-[A-Za-z0-9._-]+$/.test(value.obligation_id) || !STATUSES.has(value.resolution_status) || !AUTHORITIES.has(value.authority) || !('source' in value) || !Array.isArray(value.allowed_claims) || !Array.isArray(value.prohibited_claims) || !value.allowed_claims.every(item => typeof item === 'string') || !value.prohibited_claims.every(item => typeof item === 'string') || typeof value.customer_uncertainty_required !== 'boolean' || typeof value.llm_reasoning_permitted !== 'boolean') return false;
  if (value.resolution_status === 'deferred') return value.authority === null && value.source === null && DEFERRED_STAGES.has(value.next_stage) && value.allowed_claims.length === 0 && value.prohibited_claims.length === 0 && value.customer_uncertainty_required === false && value.llm_reasoning_permitted === false && !['factual_payload', 'policy_decision', 'action_authorization', 'retrieved_knowledge_references'].some(key => key in value);
  if (value.authority === null || 'next_stage' in value || value.llm_reasoning_permitted !== false) return false;
  if (value.authority === 'canonical_fact') return sourceMatches(value.source, 'canonical_fact');
  if (value.authority === 'bounded_unknown') return value.customer_uncertainty_required === true && (value.source === null || sourceMatches(value.source, 'canonical_fact'));
  if (value.authority === 'clarification_required' || value.authority === 'resolver_failure') return value.source === null;
  if (!sourceMatches(value.source, 'deterministic_policy')) return false;
  return value.action_authorization === undefined || actionValid(value.action_authorization);
}

function assertOutputs(obligations, resolved, actions) {
  if (!Array.isArray(resolved) || resolved.length !== obligations.length || !resolved.every(resolvedValid) || resolved.some((value, index) => value.obligation_id !== obligations[index].id)) throw new ResolutionOrchestratorError('ORCHESTRATION_OUTPUT_INVALID');
  if (!Array.isArray(actions) || !actions.every(actionValid)) throw new ResolutionOrchestratorError('ORCHESTRATION_ACTION_INVALID');
  const expected = resolved.filter(value => value.action_authorization && value.action_authorization.status === 'authorized').map(value => value.action_authorization);
  if (JSON.stringify(expected) !== JSON.stringify(actions)) throw new ResolutionOrchestratorError('ORCHESTRATION_ACTION_TRACEABILITY_INVALID');
}

module.exports = { RESOLVED_OBLIGATION_KEYS, ResolutionOrchestratorError, actionValid, assertInputs, assertOutputs, plainObject, resolvedValid };
