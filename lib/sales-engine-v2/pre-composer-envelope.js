'use strict';

const { assertResponsePlan } = require('./response-plan-validator');
const { assertActionResult, customerDestinationValid } = require('./action-result-validator');

const ENVELOPE_VERSION = 'ticket-65d-v1';
const ACTION_ID = /^act-[0-9a-f]{64}$/;
const only = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.has(key));
const SEMANTICS_KEYS = new Set(['contract_version', 'context_id', 'locale', 'obligation_ids', 'required_coverage', 'canonical_facts', 'policy_outcomes', 'permitted_guidance', 'conversational_generation', 'commercial_semantics', 'bounded_uncertainties', 'clarification_requirements', 'deferred_obligations', 'prohibited_claims', 'prohibited_actions', 'question_budget', 'completion_requirement']);

function expressiveSemantics(plan) {
  return {
    contract_version: plan.contract_version,
    context_id: plan.context_id,
    locale: plan.locale,
    obligation_ids: plan.obligation_ids,
    required_coverage: plan.required_coverage,
    canonical_facts: plan.canonical_facts.map(({ obligation_id, factual_payload, allowed_claims, prohibited_claims }) => ({ obligation_id, factual_payload, allowed_claims, prohibited_claims })),
    policy_outcomes: plan.policy_outcomes.map(({ obligation_id, authority, allowed_claims, prohibited_claims }) => ({ obligation_id, authority, allowed_claims, prohibited_claims })),
    permitted_guidance: plan.permitted_guidance,
    conversational_generation: plan.conversational_generation,
    commercial_semantics: plan.commercial_semantics,
    bounded_uncertainties: plan.bounded_uncertainties,
    clarification_requirements: plan.clarification_requirements,
    deferred_obligations: plan.deferred_obligations,
    prohibited_claims: plan.prohibited_claims,
    prohibited_actions: plan.prohibited_actions,
    question_budget: plan.question_budget,
    completion_requirement: plan.completion_requirement
  };
}

function preComposerEnvelopeValid(value) {
  if (!only(value, new Set(['pre_composer_envelope_version', 'response_semantics', 'customer_action_results', 'action_execution_states'])) || value.pre_composer_envelope_version !== ENVELOPE_VERSION || !only(value.response_semantics, SEMANTICS_KEYS) || [...SEMANTICS_KEYS].some(key => !Object.hasOwn(value.response_semantics, key))) return false;
  const semantics = value.response_semantics;
  if (semantics.contract_version !== '2.0' || typeof semantics.context_id !== 'string' || !semantics.context_id || semantics.locale !== 'es-MX' || !Array.isArray(semantics.obligation_ids) || new Set(semantics.obligation_ids).size !== semantics.obligation_ids.length) return false;
  if (!Array.isArray(value.customer_action_results) || !Array.isArray(value.action_execution_states)) return false;
  const actions = value.action_execution_states;
  const actionById = new Map(actions.map(action => [action.action_id, action]));
  if (value.customer_action_results.some(item => !only(item, new Set(['action_id', 'action_type', 'destination'])) || !ACTION_ID.test(item.action_id) || !actionById.has(item.action_id) || item.action_type !== actionById.get(item.action_id).action_type || !customerDestinationValid(item.action_type, item.destination))) return false;
  if (new Set(value.customer_action_results.map(item => item.action_id)).size !== value.customer_action_results.length) return false;
  if (value.action_execution_states.some(item => !only(item, new Set(['action_id', 'action_type', 'execution_status'])) || !ACTION_ID.test(item.action_id) || !['provide_checkout_destination', 'provide_holding_page_destination'].includes(item.action_type) || !['succeeded', 'failed_retryable', 'failed_terminal', 'in_progress', 'not_executed'].includes(item.execution_status)) || new Set(value.action_execution_states.map(item => item.action_id)).size !== value.action_execution_states.length) return false;
  const succeeded = new Set(value.action_execution_states.filter(item => item.execution_status === 'succeeded').map(item => item.action_id));
  return value.customer_action_results.length === succeeded.size && value.customer_action_results.every(item => succeeded.has(item.action_id));
}

function assertPreComposerEnvelope(value) {
  if (!preComposerEnvelopeValid(value)) { const error = new Error('PRE_COMPOSER_ENVELOPE_INVALID'); error.code = 'PRE_COMPOSER_ENVELOPE_INVALID'; throw error; }
  return structuredClone(value);
}

function buildPreComposerEnvelope({ responsePlan, actionResults = [], executionStates = [] }) {
  const plan = assertResponsePlan(responsePlan);
  if (!Array.isArray(actionResults) || !Array.isArray(executionStates)) { const error = new Error('PRE_COMPOSER_ACTION_RESULTS_INVALID'); error.code = 'PRE_COMPOSER_ACTION_RESULTS_INVALID'; throw error; }
  const actionById = new Map(plan.authorized_actions.map(action => [action.action_id, action]));
  const results = actionResults.map(assertActionResult);
  if (new Set(results.map(result => result.action_id)).size !== results.length || results.some(result => !actionById.has(result.action_id) || actionById.get(result.action_id).action_type !== result.action_type || actionById.get(result.action_id).idempotency.execution_key !== result.execution_key)) {
    const error = new Error('PRE_COMPOSER_ACTION_RESULT_ALIGNMENT_INVALID'); error.code = 'PRE_COMPOSER_ACTION_RESULT_ALIGNMENT_INVALID'; throw error;
  }
  if (new Set(executionStates.map(state => state?.action_id)).size !== executionStates.length || executionStates.some(state => !only(state, new Set(['action_id', 'action_type', 'execution_status'])) || state.execution_status !== 'in_progress' || !actionById.has(state.action_id) || actionById.get(state.action_id).action_type !== state.action_type || results.some(result => result.action_id === state.action_id))) {
    const error = new Error('PRE_COMPOSER_EXECUTION_STATE_ALIGNMENT_INVALID'); error.code = 'PRE_COMPOSER_EXECUTION_STATE_ALIGNMENT_INVALID'; throw error;
  }
  const resultById = new Map(results.map(result => [result.action_id, result]));
  const stateById = new Map(executionStates.map(state => [state.action_id, state]));
  const action_execution_states = plan.authorized_actions.map(action => {
    const result = resultById.get(action.action_id);
    return { action_id: action.action_id, action_type: action.action_type, execution_status: result ? result.execution_status : stateById.has(action.action_id) ? 'in_progress' : 'not_executed' };
  });
  const customer_action_results = plan.authorized_actions.flatMap(action => {
    const result = resultById.get(action.action_id);
    return result?.execution_status === 'succeeded' ? [{ action_id: action.action_id, action_type: action.action_type, destination: result.payload.destination }] : [];
  });
  return assertPreComposerEnvelope({ pre_composer_envelope_version: ENVELOPE_VERSION, response_semantics: expressiveSemantics(plan), customer_action_results, action_execution_states });
}

module.exports = { ENVELOPE_VERSION, assertPreComposerEnvelope, buildPreComposerEnvelope, expressiveSemantics, preComposerEnvelopeValid };
