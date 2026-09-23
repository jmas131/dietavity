'use strict';

const { isIsoTimestamp, isPlainObject, validateDictionary } = require('./policy-validator');

class PolicyResolverError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = 'PolicyResolverError';
    this.code = code;
    this.cause = cause;
  }
}

const REQUESTED_ACTIONS = new Set(['provide_checkout_destination', 'provide_holding_page_destination', 'schedule_reminder', 'create_checkout']);
const CONTEXT_KEYS = new Set(['offer_version', 'channel', 'campaign', 'commercial_state', 'reminder']);
const COMMERCIAL_KEYS = new Set(['current_purchase_request', 'safety_gate']);
const REMINDER_KEYS = new Set(['requested', 'scheduled_for', 'existing_schedule']);

function hasOnly(object, allowed) { return Object.keys(object).every(key => allowed.has(key)); }
function assertBoolean(value) { return typeof value === 'boolean'; }

function assertRequest(request) {
  if (!isPlainObject(request) || !hasOnly(request, new Set(['obligation', 'context', 'requested_action_type']))) throw new PolicyResolverError('POLICY_REQUEST_INVALID');
  const { obligation, context } = request;
  if (!isPlainObject(obligation) || !hasOnly(obligation, new Set(['id', 'category', 'subtype', 'ambiguous'])) || typeof obligation.id !== 'string' || !obligation.id || typeof obligation.category !== 'string' || !obligation.category || typeof obligation.subtype !== 'string' || !obligation.subtype || !assertBoolean(obligation.ambiguous)) throw new PolicyResolverError('POLICY_REQUEST_INVALID');
  if (!isPlainObject(context) || !hasOnly(context, CONTEXT_KEYS)) throw new PolicyResolverError('POLICY_REQUEST_INVALID');
  if (context.offer_version !== undefined && (typeof context.offer_version !== 'string' || !context.offer_version)) throw new PolicyResolverError('POLICY_REQUEST_INVALID');
  if (context.channel !== undefined && context.channel !== 'whatsapp') throw new PolicyResolverError('POLICY_REQUEST_INVALID');
  if (context.campaign !== undefined && !['standard', 'glp1_validation'].includes(context.campaign)) throw new PolicyResolverError('POLICY_REQUEST_INVALID');
  if (context.commercial_state !== undefined) {
    if (!isPlainObject(context.commercial_state) || !hasOnly(context.commercial_state, COMMERCIAL_KEYS) || !assertBoolean(context.commercial_state.current_purchase_request) || !['clear', 'blocked', 'indeterminate'].includes(context.commercial_state.safety_gate)) throw new PolicyResolverError('POLICY_REQUEST_INVALID');
  }
  if (context.reminder !== undefined) {
    if (!isPlainObject(context.reminder) || !hasOnly(context.reminder, REMINDER_KEYS) || !assertBoolean(context.reminder.requested) || (context.reminder.scheduled_for !== undefined && context.reminder.scheduled_for !== null && !isIsoTimestamp(context.reminder.scheduled_for)) || (context.reminder.existing_schedule !== undefined && !assertBoolean(context.reminder.existing_schedule))) throw new PolicyResolverError('POLICY_REQUEST_INVALID');
  }
  if (request.requested_action_type !== undefined && !REQUESTED_ACTIONS.has(request.requested_action_type)) throw new PolicyResolverError('POLICY_REQUEST_INVALID');
  return structuredClone(request);
}

function source(policy) { return { type: 'deterministic_policy', id: policy.id, version: String(policy.version) }; }
function policyDecision(policy, outcome, reasonCode) { return { outcome, policy_id: policy.id, policy_version: policy.version, reason_code: reasonCode, required_handling: structuredClone(policy.required_handling || []), prohibited_handling: structuredClone(policy.prohibited_handling || []) }; }
function noApplicable(obligation) { return { obligation_id: obligation.id, resolution_status: 'no_applicable_policy', authority: 'bounded_unknown', source: null, policy_decision: null, reason_code: 'NO_APPLICABLE_POLICY', llm_reasoning_permitted: false, action_authorization: null }; }
function needsClarification(obligation, code) { return { obligation_id: obligation.id, resolution_status: 'clarification_required', authority: 'clarification_required', source: null, policy_decision: null, reason_code: code, llm_reasoning_permitted: false, action_authorization: null }; }

function contextRequirementPresent(context, requirement) {
  const parts = requirement.split('.'); let value = context;
  for (const part of parts) { if (!isPlainObject(value) || !(part in value)) return false; value = value[part]; }
  return value === true || (typeof value === 'string' && value.length > 0);
}

// An explicit reminder obligation is sufficient to request clarification. The
// optional reminder context refines it only when a time was successfully
// structured; absent context, an absent key, and null all mean no time exists.
function reminderScheduledForIsMissing(context) {
  return context.reminder === undefined || context.reminder.scheduled_for === undefined || context.reminder.scheduled_for === null;
}

function matches(policy, request) {
  const { obligation, context } = request;
  if (policy.category !== obligation.category || !policy.subtypes.includes(obligation.subtype)) return false;
  if (policy.campaign !== undefined && policy.campaign !== (context.campaign || 'standard')) return false;
  if (policy.when?.reminder_scheduled_for === 'missing' && !reminderScheduledForIsMissing(context)) return false;
  if (policy.when?.safety_gate !== undefined && context.commercial_state?.safety_gate !== policy.when.safety_gate) return false;
  if (policy.required_context && !policy.required_context.every(requirement => contextRequirementPresent(context, requirement))) return false;
  return true;
}

function resolved(policy, request) {
  const base = { obligation_id: request.obligation.id, resolution_status: policy.outcome === 'authorized' ? 'resolved' : policy.outcome, authority: policy.category === 'commercial_purchase_intent' && policy.outcome === 'authorized' ? 'commercial_authorization' : policy.outcome === 'prohibited' ? 'prohibited' : 'deterministic_policy', source: source(policy), policy_decision: policyDecision(policy, policy.outcome, policy.reason_code), reason_code: policy.reason_code, required_handling: structuredClone(policy.required_handling || []), prohibited_handling: structuredClone(policy.prohibited_handling || []), llm_reasoning_permitted: false, action_authorization: null };
  if (policy.outcome !== 'authorized') return base;
  if (request.requested_action_type && request.requested_action_type !== policy.action_type) {
    const reason_code = request.requested_action_type === 'create_checkout' ? 'ACTION_EXECUTION_NOT_AUTHORIZED' : 'ACTION_NOT_AUTHORIZED_FOR_CONTEXT';
    return { ...base, resolution_status: 'prohibited', authority: 'prohibited', reason_code, policy_decision: policyDecision(policy, 'prohibited', reason_code) };
  }
  const parameters = { offer_version: request.context.offer_version || null };
  // `scheduled_for` was already structurally validated above. Copy the exact
  // authoritative value; no policy or downstream action may derive it again.
  if (policy.action_type === 'schedule_reminder') parameters.scheduled_for = request.context.reminder.scheduled_for;
  return { ...base, action_authorization: { action_type: policy.action_type, authorization_source: 'deterministic_policy', authorizing_rule: policy.id + '.v' + policy.version, parameters, preconditions: ['structured_non_ambiguous_obligation', 'matching_authoritative_context'], constraints: { side_effect_execution: 'not_performed', offer_version: request.context.offer_version || null }, idempotency: { required: true, key_scope: 'inbound_message' }, status: 'authorized' } };
}

function resolvePolicyFromPolicies(policies, request) {
  const normalized = assertRequest(request);
  if (!Array.isArray(policies)) throw new PolicyResolverError('POLICY_STORE_UNAVAILABLE');
  try { validateDictionary({ policy_dictionary_version: 'runtime', policies }); } catch (error) { throw new PolicyResolverError('POLICY_STORE_MALFORMED', error); }
  if (normalized.obligation.ambiguous) return needsClarification(normalized.obligation, 'OBLIGATION_AMBIGUOUS');
  let candidates;
  try { candidates = policies.filter(policy => matches(policy, normalized)); } catch (error) { throw new PolicyResolverError('POLICY_STORE_MALFORMED', error); }
  if (!candidates.length) return noApplicable(normalized.obligation);
  if (candidates.length !== 1) throw new PolicyResolverError('POLICY_AMBIGUOUS');
  return resolved(candidates[0], normalized);
}

function createPolicyResolver({ policies }) {
  try { validateDictionary({ policy_dictionary_version: 'runtime', policies }); } catch (error) { throw new PolicyResolverError('POLICY_STORE_MALFORMED', error); }
  const snapshot = structuredClone(policies);
  return Object.freeze({
    resolvePolicy(request) { return resolvePolicyFromPolicies(snapshot, request); },
    resolvePolicies(requests) {
      if (!Array.isArray(requests)) throw new PolicyResolverError('POLICY_REQUEST_INVALID');
      return requests.map(request => resolvePolicyFromPolicies(snapshot, request));
    },
  });
}

module.exports = { PolicyResolverError, createPolicyResolver, resolvePolicyFromPolicies };
