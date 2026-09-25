'use strict';

const { assertConversationContext } = require('./conversation-context-validator');
const { projectCommercialSemantics } = require('./commercial-semantics');
const { actionValid, assertObligation, launchActionValid } = require('./resolution-orchestrator-validator');
const { ACTION_TYPES } = require('./resolved-obligation-validator');
const { ResponsePlanError, assertGate, assertResolved, assertResponsePlan } = require('./response-plan-validator');
const { gateMatchesTerminalResult } = require('./semantic-guidance-safety-validator');

const INPUT_KEYS = new Set(['context', 'obligations', 'resolvedObligations', 'semanticGuidanceGates', 'authorizedActions']);
const only = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.has(key));
const clone = value => structuredClone(value);
const actionKey = value => JSON.stringify(value);

function input(raw) {
  if (!only(raw, INPUT_KEYS) || !Array.isArray(raw.obligations) || !Array.isArray(raw.resolvedObligations) || !Array.isArray(raw.semanticGuidanceGates) || !Array.isArray(raw.authorizedActions)) throw new ResponsePlanError('RESPONSE_PLAN_INPUT_INVALID');
  let context;
  try { context = assertConversationContext(raw.context); } catch (error) { throw new ResponsePlanError('RESPONSE_PLAN_CONTEXT_INVALID', error); }
  let obligations;
  try { obligations = raw.obligations.map(obligation => assertObligation(obligation, context)); } catch (error) { throw new ResponsePlanError('RESPONSE_PLAN_OBLIGATION_INVALID', error); }
  const ids = obligations.map(value => value.id);
  if (new Set(ids).size !== ids.length) throw new ResponsePlanError('RESPONSE_PLAN_OBLIGATION_IDS_DUPLICATE');
  let resolved; let gates;
  try { resolved = raw.resolvedObligations.map(assertResolved); } catch (error) { throw new ResponsePlanError('RESPONSE_PLAN_RESOLUTION_INVALID', error); }
  if (resolved.some(value => value.authority === 'conversational_generation')) throw new ResponsePlanError('RESPONSE_PLAN_CONVERSATIONAL_GENERATION_UNSUPPORTED');
  try { gates = raw.semanticGuidanceGates.map(assertGate); } catch (error) { throw new ResponsePlanError('RESPONSE_PLAN_GATE_INVALID', error); }
  if (new Set(resolved.map(value => value.obligation_id)).size !== resolved.length) throw new ResponsePlanError('RESPONSE_PLAN_RESOLUTION_IDS_DUPLICATE');
  const byResolution = new Map(resolved.map(value => [value.obligation_id, value]));
  if (resolved.length !== obligations.length || ids.some(id => !byResolution.has(id)) || resolved.some(value => !ids.includes(value.obligation_id))) throw new ResponsePlanError('RESPONSE_PLAN_RESOLUTION_ALIGNMENT_INVALID');
  if (new Set(gates.map(value => value.obligation_id)).size !== gates.length) throw new ResponsePlanError('RESPONSE_PLAN_GATE_IDS_DUPLICATE');
  const guidanceIds = resolved.filter(value => ['reviewed_knowledge', 'generated_guidance'].includes(value.authority)).map(value => value.obligation_id);
  const byGate = new Map(gates.map(value => [value.obligation_id, value]));
  if (gates.length !== guidanceIds.length || guidanceIds.some(id => !byGate.has(id)) || gates.some(value => !guidanceIds.includes(value.obligation_id))) throw new ResponsePlanError('RESPONSE_PLAN_GATE_ALIGNMENT_INVALID');
  if (!raw.authorizedActions.every(launchActionValid) || new Set(raw.authorizedActions.map(action => action.action_id)).size !== raw.authorizedActions.length) throw new ResponsePlanError('RESPONSE_PLAN_ACTION_INVALID');
  const expectedActions = obligations.map(value => byResolution.get(value.id)).filter(value => value.action_authorization !== undefined).map(value => value.action_authorization);
  // Ticket 59 defines no independent action identifier. Ticket 62 emits this
  // ordered exact projection, so equality plus order is the only non-heuristic
  // alignment available and preserves duplicate authorized actions if any.
  if (expectedActions.length !== raw.authorizedActions.length || expectedActions.some((value, index) => actionKey(value) !== actionKey(raw.authorizedActions[index]))) throw new ResponsePlanError('RESPONSE_PLAN_ACTION_ALIGNMENT_INVALID');
  return { context, obligations, byResolution, byGate, actions: raw.authorizedActions.map(clone) };
}

function coverage(resolution) {
  if (resolution.authority === 'canonical_fact') return 'express_fact';
  if (resolution.authority === 'bounded_unknown') return 'express_uncertainty';
  if (resolution.authority === 'clarification_required') return 'request_clarification';
  if (resolution.authority === 'resolver_failure') return 'resolution_unavailable';
  if (resolution.resolution_status === 'deferred') return ({ reviewed_knowledge_or_reasoning: 'deferred_practical_guidance', conversational_generation: 'conversational_handling', support_resolution: 'support_unresolved', response_composition: 'social_acknowledgement' })[resolution.next_stage];
  if (resolution.authority === 'commercial_authorization') return 'commercial_handling';
  if (resolution.authority === 'reviewed_knowledge' || resolution.authority === 'generated_guidance') return null;
  return 'express_policy';
}

function buildResponsePlan(raw) {
  const value = input(raw);
  const plan = { contract_version: '2.0', context_id: value.context.context_id, locale: value.context.locale, obligation_ids: value.obligations.map(item => item.id), required_coverage: [], canonical_facts: [], policy_outcomes: [], permitted_guidance: [], conversational_generation: [], commercial_semantics: [], bounded_uncertainties: [], clarification_requirements: [], deferred_obligations: [], authorized_actions: value.actions, prohibited_claims: [], prohibited_actions: [...ACTION_TYPES].filter(type => !value.actions.some(action => action.action_type === type)), question_budget: 0, completion_requirement: 'cover_all_required_items' };
  const artifactsById = new Map(value.context.conversation_artifacts.map(artifact => [artifact.artifact_id, artifact]));
  for (const obligation of value.obligations) {
    const result = value.byResolution.get(obligation.id);
    let handling = coverage(result);
    if (result.authority === 'reviewed_knowledge' || result.authority === 'generated_guidance') {
      const gate = value.byGate.get(obligation.id);
      if (!gateMatchesTerminalResult(gate, result)) throw new ResponsePlanError('RESPONSE_PLAN_GATE_TERMINAL_BINDING_INVALID');
      if (gate.gate_status === 'cleared') {
        handling = 'express_guidance';
        plan.permitted_guidance.push({ obligation_id: obligation.id, authority: result.authority, source: clone(result.source), guidance_payload: clone(result.guidance_payload), ...(result.retrieved_knowledge_references ? { retrieved_knowledge_references: clone(result.retrieved_knowledge_references) } : {}), semantic_gate: { gate_id: gate.gate_id, gate_version: gate.gate_version, gate_status: 'cleared' } });
      } else if (gate.gate_status === 'blocked') handling = 'withhold_safety';
      else { handling = 'withhold_indeterminate'; plan.bounded_uncertainties.push({ obligation_id: obligation.id, reason: 'guidance_gate_indeterminate', prohibited_claims: clone(result.prohibited_claims) }); }
    }
    plan.required_coverage.push({ obligation_id: obligation.id, handling });
    if (handling === 'commercial_handling') {
      try { plan.commercial_semantics.push(projectCommercialSemantics(result)); } catch (error) { throw new ResponsePlanError('RESPONSE_PLAN_COMMERCIAL_SEMANTICS_INVALID', error); }
    }
    if (handling === 'conversational_handling') {
      const task = obligation.conversational_task;
      if (!task) throw new ResponsePlanError('RESPONSE_PLAN_CONVERSATIONAL_TASK_INVALID');
      const artifacts = task.artifact_ids.map(id => artifactsById.get(id));
      if (artifacts.some(artifact => !artifact)) throw new ResponsePlanError('RESPONSE_PLAN_CONVERSATIONAL_ARTIFACT_INVALID');
      plan.conversational_generation.push({ obligation_id: obligation.id, operation: task.operation, current_turn_inputs: clone(task.current_turn_inputs), current_turn_constraints: clone(task.current_turn_constraints), artifacts: artifacts.map(artifact => ({ artifact_id: artifact.artifact_id, text: artifact.text })) });
    }
    if (result.authority === 'canonical_fact') plan.canonical_facts.push({ obligation_id: obligation.id, source: clone(result.source), factual_payload: clone(result.factual_payload), allowed_claims: clone(result.allowed_claims), prohibited_claims: clone(result.prohibited_claims) });
    if (['deterministic_policy', 'commercial_authorization', 'prohibited'].includes(result.authority)) plan.policy_outcomes.push({ obligation_id: obligation.id, authority: result.authority, source: clone(result.source), policy_decision: clone(result.policy_decision), allowed_claims: clone(result.allowed_claims), prohibited_claims: clone(result.prohibited_claims) });
    if (result.authority === 'bounded_unknown') plan.bounded_uncertainties.push({ obligation_id: obligation.id, reason: obligation.category === 'practical_guidance' ? 'practical_guidance_unknown' : 'canonical_fact_unknown', ...(result.source === null ? {} : { source: clone(result.source) }), prohibited_claims: clone(result.prohibited_claims) });
    if (result.authority === 'clarification_required') { plan.clarification_requirements.push({ obligation_id: obligation.id, ...(obligation.subject ? { subject: obligation.subject } : {}), ...(obligation.attributes ? { attributes: clone(obligation.attributes) } : {}) }); plan.question_budget = 1; }
    if (result.authority === 'resolver_failure') plan.bounded_uncertainties.push({ obligation_id: obligation.id, reason: 'resolver_failure', prohibited_claims: clone(result.prohibited_claims) });
    if (result.resolution_status === 'deferred') { plan.deferred_obligations.push({ obligation_id: obligation.id, next_stage: result.next_stage }); if (result.next_stage === 'support_resolution') plan.bounded_uncertainties.push({ obligation_id: obligation.id, reason: 'support_unresolved', prohibited_claims: [] }); }
    for (const claim of result.prohibited_claims) plan.prohibited_claims.push({ obligation_id: obligation.id, claim });
  }
  return assertResponsePlan(plan);
}

module.exports = { ResponsePlanError, buildResponsePlan };
