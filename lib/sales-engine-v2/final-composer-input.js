'use strict';

// Ticket 65E turns the independently validated planning and execution-stage
// contracts into the only semantic envelope a Composer may consume.
const { assertResponsePlan } = require('./response-plan-validator');
const { artifactReproductionGateValid, gateMatches } = require('./artifact-reproduction-safety-validator');
const { buildPreComposerEnvelope } = require('./pre-composer-envelope');
const { commercialExecutionExpressionValid, expressionFor } = require('./commercial-execution-expression');
const { customerDestinationValid } = require('./action-result-validator');

const FINAL_COMPOSER_INPUT_VERSION = 'ticket-65e-v1';
const POLICY_EXPRESSION_VERSION = 'ticket-65e-policy-v1';
const ACTION_TYPE_BY_INTENT = Object.freeze({ checkout_offer: 'provide_checkout_destination', holding_page_offer: 'provide_holding_page_destination' });
const only = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.has(key));
const clone = value => structuredClone(value);
const obligationId = value => typeof value === 'string' && /^o-[A-Za-z0-9._-]+$/.test(value);
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
const sourceValid = value => only(value, new Set(['type', 'id', 'version', 'model_run_id', 'generation_stage'])) && typeof value.type === 'string' && typeof value.id === 'string' && !!value.id && typeof value.version === 'string' && !!value.version && (value.type === 'generated_guidance' ? typeof value.model_run_id === 'string' && !!value.model_run_id && value.generation_stage === 'bounded_reasoning' : !Object.hasOwn(value, 'model_run_id') && !Object.hasOwn(value, 'generation_stage'));
const conversationalInputValid = value => only(value, new Set(['input_type', 'value', 'origin'])) && value.input_type === 'draft_specification' && typeof value.value === 'string' && !!value.value && value.origin === 'current_turn';
const conversationalConstraintValid = value => only(value, new Set(['value', 'origin'])) && typeof value.value === 'string' && !!value.value && value.origin === 'current_turn';
const artifactValid = value => only(value, new Set(['artifact_id', 'text'])) && typeof value.artifact_id === 'string' && /^ca-[A-Za-z0-9._-]+$/.test(value.artifact_id) && typeof value.text === 'string' && !!value.text;

class FinalComposerInputError extends Error {
  constructor(code, cause) { super(code); this.name = 'FinalComposerInputError'; this.code = code; this.cause = cause; }
}

// This is deliberately a closed mapping, not an interpretation of policy
// reason strings. The tuple is the Ticket 59 policy identity and outcome.
const POLICY_EXPRESSIONS = Object.freeze({
  'safety.medication_management|1|prohibited|MEDICATION_MANAGEMENT_REQUIRES_CLINICIAN': Object.freeze({ directive: 'refer_to_clinician_or_prescriber', allowed_claims: Object.freeze(['refer_to_clinician']), prohibited_claims: Object.freeze(['medication_management_advice']) }),
  'reminder.explicit_launch_unavailable|1|unsupported|REMINDER_SCHEDULING_OUTSIDE_V2_LAUNCH': Object.freeze({ directive: 'reminder_scheduling_unavailable', allowed_claims: Object.freeze(['reminder_scheduling_unavailable']), prohibited_claims: Object.freeze(['reminder_scheduling_claim']) }),
  'reminder.unsupported|1|unsupported|REMINDER_UNSUPPORTED': Object.freeze({ directive: 'reminder_request_unsupported', allowed_claims: Object.freeze([]), prohibited_claims: Object.freeze([]) }),
  'commercial.checkout.safety_blocked|1|prohibited|COMMERCIAL_SAFETY_GATE_BLOCKED': Object.freeze({ directive: 'commercial_next_step_not_available', allowed_claims: Object.freeze([]), prohibited_claims: Object.freeze([]) }),
  'commercial.checkout.safety_indeterminate|1|prohibited|COMMERCIAL_SAFETY_GATE_INDETERMINATE': Object.freeze({ directive: 'commercial_next_step_not_available', allowed_claims: Object.freeze([]), prohibited_claims: Object.freeze([]) }),
});

const POLICY_EXPRESSION_BY_DIRECTIVE = Object.freeze(Object.fromEntries(Object.values(POLICY_EXPRESSIONS).map(value => [value.directive, value])));

function policyExpression(value) {
  const key = `${value?.source?.id}|${value?.source?.version}|${value?.policy_decision?.outcome}|${value?.policy_decision?.reason_code}`;
  const mapped = POLICY_EXPRESSIONS[key];
  if (!mapped) throw new FinalComposerInputError('FINAL_COMPOSER_POLICY_EXPRESSION_UNAVAILABLE');
  return { semantics_version: POLICY_EXPRESSION_VERSION, directive: mapped.directive, allowed_claims: [...mapped.allowed_claims], prohibited_claims: [...mapped.prohibited_claims] };
}

function policyExpressionValid(value) {
  const expected = POLICY_EXPRESSION_BY_DIRECTIVE[value?.directive];
  return only(value, new Set(['semantics_version', 'directive', 'allowed_claims', 'prohibited_claims']))
    && value.semantics_version === POLICY_EXPRESSION_VERSION
    && !!expected
    && JSON.stringify(value.allowed_claims) === JSON.stringify(expected.allowed_claims)
    && JSON.stringify(value.prohibited_claims) === JSON.stringify(expected.prohibited_claims);
}

function conversationalOutcome(task, gatesByObligation) {
  if (task.operation === 'draft') {
    if (gatesByObligation.has(task.obligation_id)) throw new FinalComposerInputError('FINAL_COMPOSER_DRAFT_GATE_FORBIDDEN');
    return { type: 'conversational_generation', operation: 'draft', safety_outcome: 'generation_allowed', current_turn_inputs: clone(task.current_turn_inputs), current_turn_constraints: clone(task.current_turn_constraints), artifacts: [] };
  }
  const gate = gatesByObligation.get(task.obligation_id);
  if (!gate || !gateMatches(task, gate)) throw new FinalComposerInputError('FINAL_COMPOSER_ARTIFACT_GATE_ALIGNMENT_INVALID');
  const safety_outcome = ({ cleared: 'reproduction_allowed', blocked: 'reproduction_blocked', indeterminate: 'reproduction_indeterminate' })[gate.gate_status];
  return { type: 'conversational_generation', operation: task.operation, safety_outcome, current_turn_inputs: clone(task.current_turn_inputs), current_turn_constraints: clone(task.current_turn_constraints), artifacts: gate.gate_status === 'cleared' ? clone(task.artifacts) : [] };
}

function commercialOutcome(semantics, envelope) {
  const actionType = ACTION_TYPE_BY_INTENT[semantics.commercial_intent];
  const states = envelope.action_execution_states.filter(value => value.action_type === actionType);
  if (states.length !== 1) throw new FinalComposerInputError('FINAL_COMPOSER_COMMERCIAL_ACTION_ALIGNMENT_INVALID');
  const state = states[0];
  const result = envelope.customer_action_results.find(value => value.action_id === state.action_id) || null;
  let expression;
  try { expression = expressionFor({ commercialSemantics: semantics, actionExecutionState: state, customerActionResult: result }); } catch (error) { throw new FinalComposerInputError('FINAL_COMPOSER_COMMERCIAL_EXPRESSION_INVALID', error); }
  const customer_action_result = expression.destination_may_be_expressed ? clone(result.destination) : null;
  return { type: 'commercial_execution', expression, ...(customer_action_result ? { customer_action_result } : {}) };
}

function outcomeFor(plan, coverage, byId, gates, envelope) {
  const id = coverage.obligation_id;
  if (coverage.handling === 'express_fact') {
    const value = byId.canonicalFacts.get(id); if (!value) throw new FinalComposerInputError('FINAL_COMPOSER_FACT_ALIGNMENT_INVALID');
    return { obligation_id: id, handling: coverage.handling, type: 'canonical_fact', factual_payload: clone(value.factual_payload), source: clone(value.source), allowed_claims: clone(value.allowed_claims), prohibited_claims: clone(value.prohibited_claims) };
  }
  if (coverage.handling === 'express_guidance') {
    const value = byId.guidance.get(id); if (!value) throw new FinalComposerInputError('FINAL_COMPOSER_GUIDANCE_ALIGNMENT_INVALID');
    return { obligation_id: id, handling: coverage.handling, type: 'permitted_guidance', guidance_payload: clone(value.guidance_payload), source: clone(value.source) };
  }
  if (coverage.handling === 'conversational_handling') {
    const task = byId.conversations.get(id); if (!task) throw new FinalComposerInputError('FINAL_COMPOSER_CONVERSATION_ALIGNMENT_INVALID');
    return { obligation_id: id, handling: coverage.handling, ...conversationalOutcome(task, gates) };
  }
  if (coverage.handling === 'commercial_handling') {
    const semantics = byId.commercial.get(id); if (!semantics) throw new FinalComposerInputError('FINAL_COMPOSER_COMMERCIAL_ALIGNMENT_INVALID');
    return { obligation_id: id, handling: coverage.handling, ...commercialOutcome(semantics, envelope) };
  }
  if (coverage.handling === 'express_policy') {
    const value = byId.policies.get(id); if (!value) throw new FinalComposerInputError('FINAL_COMPOSER_POLICY_ALIGNMENT_INVALID');
    return { obligation_id: id, handling: coverage.handling, type: 'policy_expression', policy_expression: policyExpression(value) };
  }
  if (['express_uncertainty', 'withhold_indeterminate', 'resolution_unavailable'].includes(coverage.handling)) {
    const value = byId.uncertainties.get(id); if (!value) throw new FinalComposerInputError('FINAL_COMPOSER_UNCERTAINTY_ALIGNMENT_INVALID');
    return { obligation_id: id, handling: coverage.handling, type: 'bounded_uncertainty', reason: value.reason, prohibited_claims: clone(value.prohibited_claims) };
  }
  if (coverage.handling === 'request_clarification') {
    const value = byId.clarifications.get(id); if (!value) throw new FinalComposerInputError('FINAL_COMPOSER_CLARIFICATION_ALIGNMENT_INVALID');
    return { obligation_id: id, handling: coverage.handling, type: 'clarification', requirement: clone(value) };
  }
  if (coverage.handling === 'withhold_safety') return { obligation_id: id, handling: coverage.handling, type: 'guidance_withheld_safety' };
  if (coverage.handling === 'support_unresolved') return { obligation_id: id, handling: coverage.handling, type: 'support_unresolved', customer_expression: 'support_request_unresolved' };
  if (coverage.handling === 'social_acknowledgement') return { obligation_id: id, handling: coverage.handling, type: 'social_acknowledgement', customer_expression: 'acknowledge' };
  throw new FinalComposerInputError('FINAL_COMPOSER_HANDLING_UNSUPPORTED');
}

function finalComposerInputValid(value) {
  const keys = new Set(['composer_input_version', 'contract_version', 'context_id', 'locale', 'obligation_ids', 'obligation_outcomes', 'prohibited_claims', 'prohibited_actions', 'question_budget', 'completion_requirement']);
  if (!only(value, keys) || value.composer_input_version !== FINAL_COMPOSER_INPUT_VERSION || value.contract_version !== '2.0' || typeof value.context_id !== 'string' || !value.context_id || value.locale !== 'es-MX' || !Array.isArray(value.obligation_ids) || !value.obligation_ids.every(obligationId) || new Set(value.obligation_ids).size !== value.obligation_ids.length || !Array.isArray(value.obligation_outcomes) || value.obligation_outcomes.length !== value.obligation_ids.length || !Array.isArray(value.prohibited_claims) || !Array.isArray(value.prohibited_actions) || ![0, 1].includes(value.question_budget) || value.completion_requirement !== 'cover_all_required_items') return false;
  return value.obligation_outcomes.every((outcome, index) => {
    if (!outcome || outcome.obligation_id !== value.obligation_ids[index]) return false;
    if (outcome.type === 'canonical_fact') return only(outcome, new Set(['obligation_id', 'handling', 'type', 'factual_payload', 'source', 'allowed_claims', 'prohibited_claims'])) && outcome.handling === 'express_fact' && Object.hasOwn(outcome, 'factual_payload') && sourceValid(outcome.source) && outcome.source.type === 'canonical_fact' && strings(outcome.allowed_claims) && strings(outcome.prohibited_claims);
    if (outcome.type === 'permitted_guidance') return only(outcome, new Set(['obligation_id', 'handling', 'type', 'guidance_payload', 'source'])) && outcome.handling === 'express_guidance' && outcome.guidance_payload !== undefined && sourceValid(outcome.source);
    if (outcome.type === 'conversational_generation') return only(outcome, new Set(['obligation_id', 'handling', 'type', 'operation', 'safety_outcome', 'current_turn_inputs', 'current_turn_constraints', 'artifacts'])) && outcome.handling === 'conversational_handling' && ['draft', 'show', 'transform', 'summarize'].includes(outcome.operation) && ['generation_allowed', 'reproduction_allowed', 'reproduction_blocked', 'reproduction_indeterminate'].includes(outcome.safety_outcome) && Array.isArray(outcome.current_turn_inputs) && outcome.current_turn_inputs.every(conversationalInputValid) && Array.isArray(outcome.current_turn_constraints) && outcome.current_turn_constraints.every(conversationalConstraintValid) && Array.isArray(outcome.artifacts) && outcome.artifacts.every(artifactValid) && new Set(outcome.artifacts.map(value => value.artifact_id)).size === outcome.artifacts.length && (outcome.operation === 'draft' ? outcome.safety_outcome === 'generation_allowed' && outcome.artifacts.length === 0 && outcome.current_turn_inputs.length > 0 : outcome.safety_outcome !== 'generation_allowed' && (['show', 'transform'].includes(outcome.operation) ? outcome.artifacts.length <= 1 : true) && (outcome.safety_outcome === 'reproduction_allowed' ? outcome.artifacts.length > 0 : outcome.artifacts.length === 0));
    if (outcome.type === 'commercial_execution') { if (!only(outcome, new Set(['obligation_id', 'handling', 'type', 'expression', 'customer_action_result'])) || outcome.handling !== 'commercial_handling') return false; const results = outcome.customer_action_result ? [{ action_id: outcome.expression?.action_id, action_type: ACTION_TYPE_BY_INTENT[outcome.expression?.commercial_intent], destination: outcome.customer_action_result }] : []; return commercialExecutionExpressionValid(outcome.expression, { customerActionResults: results }) && (!outcome.customer_action_result || customerDestinationValid(ACTION_TYPE_BY_INTENT[outcome.expression.commercial_intent], outcome.customer_action_result)); }
    if (outcome.type === 'policy_expression') return only(outcome, new Set(['obligation_id', 'handling', 'type', 'policy_expression'])) && outcome.handling === 'express_policy' && policyExpressionValid(outcome.policy_expression);
    if (outcome.type === 'bounded_uncertainty') return only(outcome, new Set(['obligation_id', 'handling', 'type', 'reason', 'prohibited_claims'])) && ['express_uncertainty', 'withhold_indeterminate', 'resolution_unavailable'].includes(outcome.handling) && ['canonical_fact_unknown', 'practical_guidance_unknown', 'guidance_gate_indeterminate', 'support_unresolved', 'resolver_failure'].includes(outcome.reason) && strings(outcome.prohibited_claims);
    if (outcome.type === 'clarification') return only(outcome, new Set(['obligation_id', 'handling', 'type', 'requirement'])) && outcome.handling === 'request_clarification' && only(outcome.requirement, new Set(['obligation_id', 'subject', 'attributes'])) && outcome.requirement.obligation_id === outcome.obligation_id && (!Object.hasOwn(outcome.requirement, 'subject') || typeof outcome.requirement.subject === 'string') && (!Object.hasOwn(outcome.requirement, 'attributes') || only(outcome.requirement.attributes, new Set(Object.keys(outcome.requirement.attributes))));
    if (outcome.type === 'guidance_withheld_safety') return only(outcome, new Set(['obligation_id', 'handling', 'type'])) && outcome.handling === 'withhold_safety';
    if (outcome.type === 'support_unresolved') return only(outcome, new Set(['obligation_id', 'handling', 'type', 'customer_expression'])) && outcome.handling === 'support_unresolved' && outcome.customer_expression === 'support_request_unresolved';
    return only(outcome, new Set(['obligation_id', 'handling', 'type', 'customer_expression'])) && outcome.type === 'social_acknowledgement' && outcome.handling === 'social_acknowledgement' && outcome.customer_expression === 'acknowledge';
  });
}

function assertFinalComposerInput(value) { if (!finalComposerInputValid(value)) throw new FinalComposerInputError('FINAL_COMPOSER_INPUT_INVALID'); return clone(value); }

function buildFinalComposerInput({ responsePlan, artifactReproductionGates = [], actionResults = [], executionStates = [] }) {
  const plan = assertResponsePlan(responsePlan);
  if (!Array.isArray(artifactReproductionGates)) throw new FinalComposerInputError('FINAL_COMPOSER_ARTIFACT_GATES_INVALID');
  if (!artifactReproductionGates.every(artifactReproductionGateValid) || new Set(artifactReproductionGates.map(gate => gate.obligation_id)).size !== artifactReproductionGates.length) throw new FinalComposerInputError('FINAL_COMPOSER_ARTIFACT_GATES_INVALID');
  const envelope = buildPreComposerEnvelope({ responsePlan: plan, actionResults, executionStates });
  const gates = new Map(artifactReproductionGates.map(gate => [gate.obligation_id, gate]));
  const reproduction = plan.conversational_generation.filter(task => task.operation !== 'draft');
  if (gates.size !== reproduction.length || reproduction.some(task => !gates.has(task.obligation_id)) || [...gates.keys()].some(id => !reproduction.some(task => task.obligation_id === id))) throw new FinalComposerInputError('FINAL_COMPOSER_ARTIFACT_GATE_ALIGNMENT_INVALID');
  const byId = {
    canonicalFacts: new Map(plan.canonical_facts.map(value => [value.obligation_id, value])), policies: new Map(plan.policy_outcomes.map(value => [value.obligation_id, value])), guidance: new Map(plan.permitted_guidance.map(value => [value.obligation_id, value])), conversations: new Map(plan.conversational_generation.map(value => [value.obligation_id, value])), commercial: new Map(plan.commercial_semantics.map(value => [value.obligation_id, value])), uncertainties: new Map(plan.bounded_uncertainties.map(value => [value.obligation_id, value])), clarifications: new Map(plan.clarification_requirements.map(value => [value.obligation_id, value])),
  };
  const value = { composer_input_version: FINAL_COMPOSER_INPUT_VERSION, contract_version: plan.contract_version, context_id: plan.context_id, locale: plan.locale, obligation_ids: clone(plan.obligation_ids), obligation_outcomes: plan.required_coverage.map(coverage => outcomeFor(plan, coverage, byId, gates, envelope)), prohibited_claims: clone(plan.prohibited_claims), prohibited_actions: clone(plan.prohibited_actions), question_budget: plan.question_budget, completion_requirement: plan.completion_requirement };
  return assertFinalComposerInput(value);
}

module.exports = { FINAL_COMPOSER_INPUT_VERSION, POLICY_EXPRESSION_VERSION, FinalComposerInputError, assertFinalComposerInput, buildFinalComposerInput, finalComposerInputValid, policyExpression, policyExpressionValid };
