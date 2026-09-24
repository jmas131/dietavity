'use strict';

const { DEFERRED_STAGES, FACT_CATEGORIES, FACT_SUBJECTS, POLICY_CATEGORIES } = require('../../config/sales-engine-v2/resolution-routing');
const { ResolutionOrchestratorError, assertInputs, assertOutputs } = require('./resolution-orchestrator-validator');
const { deriveAuthorizedActionIdentity, LAUNCH_ACTION_TYPES } = require('./authorized-action-identity');

function localFailure(obligation) {
  return base(obligation, { resolution_status: 'failed', authority: 'resolver_failure', source: null });
}

function base(obligation, fields) {
  return {
    obligation_id: obligation.id,
    allowed_claims: [],
    prohibited_claims: [],
    customer_uncertainty_required: false,
    llm_reasoning_permitted: false,
    ...fields,
  };
}

function deferred(obligation) {
  return base(obligation, { resolution_status: 'deferred', authority: null, source: null, next_stage: DEFERRED_STAGES[obligation.category] });
}

function unsupportedFact(obligation) {
  return base(obligation, { resolution_status: 'unknown', authority: 'bounded_unknown', source: null, customer_uncertainty_required: true });
}

function isUnavailable(error, prefix) {
  return !!error && typeof error.code === 'string' && error.code === `${prefix}_STORE_UNAVAILABLE`;
}

function factRequest(obligation, context, asOf) {
  const definition = FACT_SUBJECTS[obligation.subject];
  if (!definition) return null;
  const request = { factKey: definition.factKey, offerVersion: definition.offerScoped ? context.offer_context.offer_version || null : null, scope: {}, asOf };
  if (definition.membership) {
    const candidate = obligation.attributes?.customer_candidate;
    if (typeof candidate !== 'string' || !candidate.trim()) return null;
    request.query = { operation: definition.membership, candidate };
  }
  return request;
}

function projectFact(obligation, result) {
  if (!result || typeof result !== 'object' || !['resolved', 'unknown', 'not_applicable'].includes(result.status) || !['canonical_fact', 'bounded_unknown'].includes(result.authority) || !('source' in result)) throw new ResolutionOrchestratorError('ORCHESTRATION_FACT_RESULT_INVALID');
  if (result.status === 'unknown') return base(obligation, { resolution_status: 'unknown', authority: 'bounded_unknown', source: result.source, customer_uncertainty_required: true, factual_payload: null });
  if (result.status === 'not_applicable') return base(obligation, { resolution_status: 'resolved', authority: 'canonical_fact', source: result.source, factual_payload: null });
  return base(obligation, { resolution_status: 'resolved', authority: 'canonical_fact', source: result.source, factual_payload: structuredClone(result.factual_payload) });
}

function policyContext(context, obligation, safetyGate) {
  const value = { offer_version: context.offer_context.offer_version, channel: context.metadata.channel };
  if (context.metadata.campaign !== undefined) value.campaign = context.metadata.campaign;
  if (obligation.category === 'commercial_purchase_intent') value.commercial_state = { current_purchase_request: true, safety_gate: safetyGate };
  if (obligation.category === 'reminder_request') value.reminder = { requested: true };
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function policyRequest(obligation, context, safetyGate) {
  return {
    obligation: { id: obligation.id, category: obligation.category, subtype: obligation.subject || 'unspecified', ambiguous: obligation.ambiguous, ...(obligation.category === 'commercial_purchase_intent' ? { authorization_subject_id: obligation.authorization_subject_id, authorization_subject_version: obligation.authorization_subject_version } : {}) },
    context: policyContext(context, obligation, safetyGate),
  };
}

function projectAuthorizedAction(obligation, context, result) {
  const action = result.action_authorization;
  if (action === null) return null;
  if (obligation.category !== 'commercial_purchase_intent' || !LAUNCH_ACTION_TYPES.has(action.action_type) || result.source?.type !== 'deterministic_policy') throw new ResolutionOrchestratorError('ORCHESTRATION_POLICY_RESULT_INVALID');
  let identity;
  try {
    identity = deriveAuthorizedActionIdentity({
      canonicalMessageId: context.current_message.canonical_message_id,
      authorizationSubject: obligation,
      actionType: action.action_type,
      policy: result.source,
    });
  } catch (error) { throw new ResolutionOrchestratorError('ORCHESTRATION_ACTION_IDENTITY_INVALID', error); }
  return {
    ...structuredClone(action),
    action_identity_version: identity.action_identity_version,
    action_id: identity.action_id,
    idempotency: { ...structuredClone(action.idempotency), execution_key_version: identity.execution_key_version, execution_key: identity.execution_key },
  };
}

function projectPolicy(obligation, context, result) {
  if (!result || typeof result !== 'object' || typeof result.resolution_status !== 'string' || !('source' in result) || !('authority' in result) || !('action_authorization' in result)) throw new ResolutionOrchestratorError('ORCHESTRATION_POLICY_RESULT_INVALID');
  const common = { source: result.source, ...(result.policy_decision === null || result.policy_decision === undefined ? {} : { policy_decision: structuredClone(result.policy_decision) }) };
  if (result.resolution_status === 'no_applicable_policy') return base(obligation, { ...common, resolution_status: 'unknown', authority: 'bounded_unknown', source: null, customer_uncertainty_required: true });
  if (result.resolution_status === 'clarification_required') return base(obligation, { ...common, resolution_status: 'clarification_required', authority: result.authority });
  if (result.resolution_status === 'prohibited') return base(obligation, { ...common, resolution_status: 'prohibited', authority: 'prohibited', prohibited_claims: structuredClone(result.prohibited_handling || []) });
  if (result.resolution_status === 'resolved') {
    const action = projectAuthorizedAction(obligation, context, result);
    return base(obligation, { ...common, resolution_status: 'resolved', authority: result.authority, ...(action === null ? {} : { action_authorization: action }), allowed_claims: structuredClone(result.required_handling || []), prohibited_claims: structuredClone(result.prohibited_handling || []) });
  }
  // Ticket 59's `unsupported` has policy provenance but no matching normative
  // status. Preserve its exact policy decision rather than relabeling it as
  // an unknown or resolver failure.
  if (result.resolution_status === 'unsupported') return base(obligation, { ...common, resolution_status: 'resolved', authority: 'deterministic_policy', allowed_claims: structuredClone(result.required_handling || []), prohibited_claims: structuredClone(result.prohibited_handling || []) });
  throw new ResolutionOrchestratorError('ORCHESTRATION_POLICY_RESULT_INVALID');
}

function resolvePolicy(obligation, input, safetyGate) {
  try { return projectPolicy(obligation, input.context, input.policyResolver.resolvePolicy(policyRequest(obligation, input.context, safetyGate))); }
  catch (error) {
    if (isUnavailable(error, 'POLICY')) return localFailure(obligation);
    throw error;
  }
}

function resolveFact(obligation, input) {
  const request = factRequest(obligation, input.context, input.asOf);
  if (!request) return unsupportedFact(obligation);
  try { return projectFact(obligation, input.factResolver.resolveFact(request)); }
  catch (error) {
    if (isUnavailable(error, 'FACT')) return localFailure(obligation);
    throw error;
  }
}

function deriveSafetyGate(safetyResults) {
  if (!safetyResults.length) return 'clear';
  if (safetyResults.some(result => result.resolution_status === 'failed' || result.resolution_status === 'unknown' || result.resolution_status === 'clarification_required')) return 'indeterminate';
  if (safetyResults.some(result => result.resolution_status === 'prohibited')) return 'blocked';
  return 'clear';
}

function resolveObligations(rawInput) {
  const input = assertInputs(rawInput);
  const safetyById = new Map();
  for (const obligation of input.obligations) {
    if (obligation.category === 'medication_management' || obligation.category === 'safety_sensitive_nutrition') safetyById.set(obligation.id, resolvePolicy(obligation, input, 'clear'));
  }
  const safetyGate = deriveSafetyGate([...safetyById.values()]);
  const resolved = input.obligations.map(obligation => {
    if (safetyById.has(obligation.id)) return safetyById.get(obligation.id);
    if (FACT_CATEGORIES.has(obligation.category)) return resolveFact(obligation, input);
    if (POLICY_CATEGORIES.has(obligation.category)) return resolvePolicy(obligation, input, safetyGate);
    if (obligation.category === 'clarification') return base(obligation, { resolution_status: 'clarification_required', authority: 'clarification_required', source: null });
    if (DEFERRED_STAGES[obligation.category]) return deferred(obligation);
    throw new ResolutionOrchestratorError('ORCHESTRATION_CATEGORY_UNROUTED');
  });
  const actions = resolved.filter(value => value.action_authorization?.status === 'authorized').map(value => structuredClone(value.action_authorization));
  assertOutputs(input.obligations, resolved, actions);
  return { resolved_obligations: resolved, authorized_actions: actions };
}

module.exports = { ResolutionOrchestratorError, deriveSafetyGate, resolveObligations };
