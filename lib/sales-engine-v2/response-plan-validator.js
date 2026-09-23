'use strict';

const { ACTION_TYPES, normativeResolvedValid, plainObject } = require('./resolved-obligation-validator');
const { actionValid } = require('./resolution-orchestrator-validator');
const { semanticGuidanceGateValid } = require('./semantic-guidance-safety-validator');

class ResponsePlanError extends Error {
  constructor(code, cause) { super(code); this.name = 'ResponsePlanError'; this.code = code; this.cause = cause; }
}

const PLAN_KEYS = new Set(['contract_version', 'context_id', 'locale', 'obligation_ids', 'required_coverage', 'canonical_facts', 'policy_outcomes', 'permitted_guidance', 'bounded_uncertainties', 'clarification_requirements', 'deferred_obligations', 'authorized_actions', 'prohibited_claims', 'prohibited_actions', 'question_budget', 'completion_requirement']);
const HANDLINGS = new Set(['express_fact', 'express_policy', 'express_guidance', 'express_uncertainty', 'request_clarification', 'withhold_safety', 'withhold_indeterminate', 'commercial_handling', 'conversational_handling', 'support_unresolved', 'social_acknowledgement', 'deferred_practical_guidance', 'resolution_unavailable']);
const UNCERTAINTY_REASONS = new Set(['canonical_fact_unknown', 'guidance_gate_indeterminate', 'support_unresolved', 'resolver_failure']);
const STAGES = new Set(['reviewed_knowledge_or_reasoning', 'conversational_generation', 'support_resolution', 'response_composition']);
const own = (value, key) => Object.hasOwn(value, key);
const only = (value, keys) => plainObject(value) && Object.keys(value).every(key => keys.has(key));
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
const ids = value => Array.isArray(value) && value.every(item => typeof item === 'string' && /^o-[A-Za-z0-9._-]+$/.test(item)) && new Set(value).size === value.length;
function source(value, type) {
  if (!plainObject(value) || value.type !== type || typeof value.id !== 'string' || !value.id || typeof value.version !== 'string' || !value.version) return false;
  if (type === 'generated_guidance') return Object.keys(value).every(k => ['type', 'id', 'version', 'model_run_id', 'generation_stage'].includes(k)) && typeof value.model_run_id === 'string' && !!value.model_run_id && value.generation_stage === 'bounded_reasoning';
  return Object.keys(value).every(k => ['type', 'id', 'version'].includes(k));
}
function guidancePayload(value, references = []) {
  if (!plainObject(value) || !Object.keys(value).every(k => ['units', 'semantic_safety_validation_required'].includes(k)) || value.semantic_safety_validation_required !== true || !Array.isArray(value.units) || !value.units.length) return false;
  const referenceIds = new Set(references.map(item => item.id));
  return value.units.every(unit => {
    if (!only(unit, new Set(['unit_type', 'content', 'reviewed_knowledge_reference_ids', 'bounded_input_ids'])) || !['reviewed_information', 'practical_instruction', 'transformation', 'organization'].includes(unit.unit_type) || typeof unit.content !== 'string' || !unit.content) return false;
    const reviewed = ['reviewed_information', 'practical_instruction'].includes(unit.unit_type);
    if (reviewed) return Array.isArray(unit.reviewed_knowledge_reference_ids) && unit.reviewed_knowledge_reference_ids.length > 0 && new Set(unit.reviewed_knowledge_reference_ids).size === unit.reviewed_knowledge_reference_ids.length && unit.reviewed_knowledge_reference_ids.every(id => typeof id === 'string' && referenceIds.has(id)) && !own(unit, 'bounded_input_ids');
    return Array.isArray(unit.bounded_input_ids) && unit.bounded_input_ids.length > 0 && new Set(unit.bounded_input_ids).size === unit.bounded_input_ids.length && unit.bounded_input_ids.every(id => typeof id === 'string' && /^bi-[1-9][0-9]*$/.test(id)) && !own(unit, 'reviewed_knowledge_reference_ids');
  });
}
function uniqueByObligation(entries) { const values = entries.map(value => value.obligation_id); return ids(values) && new Set(values).size === values.length; }

function responsePlanValid(plan) {
  if (!only(plan, PLAN_KEYS) || [...PLAN_KEYS].some(key => !own(plan, key)) || plan.contract_version !== '2.0' || typeof plan.context_id !== 'string' || !plan.context_id || plan.locale !== 'es-MX' || !ids(plan.obligation_ids) || !Array.isArray(plan.required_coverage) || !Array.isArray(plan.canonical_facts) || !Array.isArray(plan.policy_outcomes) || !Array.isArray(plan.permitted_guidance) || !Array.isArray(plan.bounded_uncertainties) || !Array.isArray(plan.clarification_requirements) || !Array.isArray(plan.deferred_obligations) || !Array.isArray(plan.authorized_actions) || !Array.isArray(plan.prohibited_claims) || !Array.isArray(plan.prohibited_actions) || ![0, 1].includes(plan.question_budget) || plan.completion_requirement !== 'cover_all_required_items') return false;
  const obligationSet = new Set(plan.obligation_ids);
  if (plan.required_coverage.length !== plan.obligation_ids.length || !uniqueByObligation(plan.required_coverage) || plan.required_coverage.some(value => !only(value, new Set(['obligation_id', 'handling'])) || !obligationSet.has(value.obligation_id) || !HANDLINGS.has(value.handling))) return false;
  if (!uniqueByObligation(plan.canonical_facts) || plan.canonical_facts.some(value => !only(value, new Set(['obligation_id', 'source', 'factual_payload', 'allowed_claims', 'prohibited_claims'])) || !obligationSet.has(value.obligation_id) || !source(value.source, 'canonical_fact') || !own(value, 'factual_payload') || !strings(value.allowed_claims) || !strings(value.prohibited_claims))) return false;
  if (!uniqueByObligation(plan.policy_outcomes) || plan.policy_outcomes.some(value => !only(value, new Set(['obligation_id', 'authority', 'source', 'policy_decision', 'allowed_claims', 'prohibited_claims'])) || !obligationSet.has(value.obligation_id) || !['deterministic_policy', 'commercial_authorization', 'prohibited'].includes(value.authority) || !source(value.source, 'deterministic_policy') || !plainObject(value.policy_decision) || !strings(value.allowed_claims) || !strings(value.prohibited_claims))) return false;
  if (!uniqueByObligation(plan.permitted_guidance) || plan.permitted_guidance.some(value => !only(value, new Set(['obligation_id', 'authority', 'source', 'guidance_payload', 'retrieved_knowledge_references', 'semantic_gate'])) || !obligationSet.has(value.obligation_id) || !['reviewed_knowledge', 'generated_guidance'].includes(value.authority) || !source(value.source, value.authority) || (own(value, 'retrieved_knowledge_references') && (!Array.isArray(value.retrieved_knowledge_references) || !value.retrieved_knowledge_references.every(item => source(item, 'reviewed_knowledge')))) || !guidancePayload(value.guidance_payload, value.retrieved_knowledge_references || []) || !only(value.semantic_gate, new Set(['gate_id', 'gate_version', 'gate_status'])) || value.semantic_gate.gate_id !== 'semantic-guidance-safety-gate' || value.semantic_gate.gate_version !== 'ticket-64-v1' || value.semantic_gate.gate_status !== 'cleared')) return false;
  if (!uniqueByObligation(plan.bounded_uncertainties) || plan.bounded_uncertainties.some(value => !only(value, new Set(['obligation_id', 'reason', 'source', 'prohibited_claims'])) || !obligationSet.has(value.obligation_id) || !UNCERTAINTY_REASONS.has(value.reason) || !strings(value.prohibited_claims) || (value.reason === 'canonical_fact_unknown' ? own(value, 'source') && value.source !== null && !source(value.source, 'canonical_fact') : own(value, 'source')))) return false;
  if (!uniqueByObligation(plan.clarification_requirements) || plan.clarification_requirements.some(value => !only(value, new Set(['obligation_id', 'subject', 'attributes'])) || !obligationSet.has(value.obligation_id) || (own(value, 'subject') && (typeof value.subject !== 'string' || !value.subject)) || (own(value, 'attributes') && !plainObject(value.attributes)))) return false;
  if (!uniqueByObligation(plan.deferred_obligations) || plan.deferred_obligations.some(value => !only(value, new Set(['obligation_id', 'next_stage'])) || !obligationSet.has(value.obligation_id) || !STAGES.has(value.next_stage))) return false;
  const authorizedTypes = new Set(plan.authorized_actions.map(value => value.action_type));
  if (!plan.authorized_actions.every(actionValid) || !plan.prohibited_actions.every(value => ACTION_TYPES.has(value)) || new Set(plan.prohibited_actions).size !== plan.prohibited_actions.length || plan.prohibited_actions.length + authorizedTypes.size !== ACTION_TYPES.size || plan.prohibited_actions.some(value => authorizedTypes.has(value)) || plan.prohibited_claims.some(value => !only(value, new Set(['obligation_id', 'claim'])) || !obligationSet.has(value.obligation_id) || typeof value.claim !== 'string' || !value.claim)) return false;
  return true;
}

function assertResponsePlan(plan) { if (!responsePlanValid(plan)) throw new ResponsePlanError('RESPONSE_PLAN_INVALID'); return structuredClone(plan); }
function assertGate(value) { if (!semanticGuidanceGateValid(value)) throw new ResponsePlanError('RESPONSE_PLAN_GATE_INVALID'); return structuredClone(value); }
function assertResolved(value) { if (!normativeResolvedValid(value)) throw new ResponsePlanError('RESPONSE_PLAN_RESOLUTION_INVALID'); return structuredClone(value); }

module.exports = { HANDLINGS, PLAN_KEYS, ResponsePlanError, UNCERTAINTY_REASONS, assertGate, assertResolved, assertResponsePlan, responsePlanValid };
