'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFactResolver } = require('../lib/sales-engine-v2/fact-resolver');
const { createPolicyResolver } = require('../lib/sales-engine-v2/policy-resolver');
const { ResolutionOrchestratorError, resolveObligations } = require('../lib/sales-engine-v2/resolution-orchestrator');
const { assertOutputs, resolvedValid } = require('../lib/sales-engine-v2/resolution-orchestrator-validator');
const { RESOLVED_OBLIGATION_KEYS } = require('../lib/sales-engine-v2/resolved-obligation-validator');
const { deriveCommercialAuthorizationSubject } = require('../lib/sales-engine-v2/commercial-authorization-subject');

const root = path.join(__dirname, '..');
const facts = JSON.parse(fs.readFileSync(path.join(root, 'config/sales-engine-v2/product-facts.json'), 'utf8')).facts;
const membershipDefinitions = JSON.parse(fs.readFileSync(path.join(root, 'config/sales-engine-v2/fact-membership.json'), 'utf8'));
const policies = JSON.parse(fs.readFileSync(path.join(root, 'config/sales-engine-v2/policies.json'), 'utf8')).policies;
const contract = JSON.parse(fs.readFileSync(path.join(root, 'docs/contracts/sales-engine-v2-contract.schema.json'), 'utf8'));
const asOf = '2026-09-22T00:00:01.000Z';
const resolvers = () => ({ factResolver: createFactResolver({ facts, membershipDefinitions }), policyResolver: createPolicyResolver({ policies }) });

function context(campaign = 'standard', history = []) {
  return { contract_version: '2.0', context_id: 'c-1', locale: 'es-MX', current_message: { role: 'customer', text: 'mensaje actual', occurred_at: asOf, source_id: 'm-current', canonical_message_id: '11111111-1111-4111-8111-000000000062' }, history, history_metadata: { ordering: 'occurred_at', history_truncated: false, retained_prior_turns: history.length, retained_prior_characters: 0 }, conversation_artifacts: [], conversation_artifacts_metadata: { ordering: 'occurred_at', artifacts_truncated: false, retained_artifacts: 0, retained_artifact_characters: 0 }, session_state: { session_id: 's-1' }, offer_context: { offer_version: '28d-149-v1' }, customer_state: {}, commercial_state: { checkout_sent: false, valid_purchase_confirmation: false }, metadata: { channel: 'whatsapp', campaign }, authoritative_context: {}, informational_context: { knowledge: [] } };
}
function obligation(id, category, subject, attributes = undefined, ambiguous = false) { return { id, category, ...(subject ? { subject } : {}), current_turn_evidence: 'mensaje actual', confidence: 'high', ambiguous, ...(attributes ? { attributes } : {}), ...(category === 'commercial_purchase_intent' ? deriveCommercialAuthorizationSubject({ campaign: 'standard', offerVersion: '28d-149-v1' }) : {}), ...(category === 'practical_guidance' ? { practical_task: { task_kind: 'knowledge_question', bounded_inputs: [] } } : {}) }; }
function resolve(obligations, extra = {}) { return resolveObligations({ context: context(), obligations, asOf, ...resolvers(), ...extra }); }

test('Ticket 62 routes canonical facts, payment membership, and unmapped capability independently', () => {
  const result = resolve([
    obligation('o-price', 'product_fact', 'price'),
    obligation('o-oxxo', 'product_fact', 'payment_method', { customer_candidate: 'OXXO' }),
    obligation('o-video', 'provider_service_fact', 'video_calls'),
  ]);
  assert.deepEqual(result.resolved_obligations.map(value => value.obligation_id), ['o-price', 'o-oxxo', 'o-video']);
  assert.deepEqual(result.resolved_obligations[0].factual_payload, { amount: 149, currency: 'MXN' });
  assert.deepEqual(result.resolved_obligations[1].factual_payload, { operation: 'contains', candidate: 'oxxo', value: true });
  assert.equal(result.resolved_obligations[2].authority, 'bounded_unknown');
  assert.equal(result.resolved_obligations[2].source, null);
});

test('Ticket 62 keeps deferred, clarification, and policy-backed outcomes distinct', () => {
  const result = resolve([
    obligation('o-practical', 'practical_guidance', 'meal_preparation'),
    obligation('o-task', 'conversational_task', 'draft'),
    obligation('o-support', 'support_account', 'login'),
    obligation('o-social', 'social_acknowledgement'),
    obligation('o-clarify', 'clarification'),
    obligation('o-medication', 'medication_management', 'dose_change'),
  ]);
  assert.deepEqual(result.resolved_obligations.slice(0, 4).map(value => value.next_stage), ['reviewed_knowledge_or_reasoning', 'conversational_generation', 'support_resolution', 'response_composition']);
  assert.equal(result.resolved_obligations[4].authority, 'clarification_required');
  assert.equal(result.resolved_obligations[5].resolution_status, 'prohibited');
  assert.deepEqual(result.authorized_actions, []);
});

test('Ticket 61C.1 preserves globally allocated practical bounded-input IDs through orchestration', () => {
  const practical = id => ({ id, category: 'practical_guidance', subject: 'organizar', current_turn_evidence: 'mensaje actual', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'organization', bounded_inputs: [{ id: id === 'o-practical-1' ? 'bi-1' : 'bi-2', input_type: 'user_preference', value: 'mensaje', origin: 'current_turn' }] } });
  const result = resolve([practical('o-practical-1'), practical('o-practical-2')]);
  assert.deepEqual(result.resolved_obligations.map(item => item.next_stage), ['reviewed_knowledge_or_reasoning', 'reviewed_knowledge_or_reasoning']);
  assert.throws(() => resolve([practical('o-practical-1'), { ...practical('o-practical-2'), practical_task: { task_kind: 'organization', bounded_inputs: [{ id: 'bi-1', input_type: 'user_preference', value: 'mensaje', origin: 'current_turn' }] } }]), error => error.code === 'ORCHESTRATION_OBLIGATION_INVALID');
});

test('Ticket 62 resolves safety before commercial policy without changing returned order', () => {
  const result = resolve([
    obligation('o-buy', 'commercial_purchase_intent', 'explicit_current_request'),
    obligation('o-dose', 'medication_management', 'dose_change'),
  ]);
  assert.deepEqual(result.resolved_obligations.map(value => value.obligation_id), ['o-buy', 'o-dose']);
  assert.equal(result.resolved_obligations[0].policy_decision.reason_code, 'COMMERCIAL_SAFETY_GATE_BLOCKED');
  assert.equal(result.resolved_obligations[1].policy_decision.reason_code, 'MEDICATION_MANAGEMENT_REQUIRES_CLINICIAN');
  assert.deepEqual(result.authorized_actions, []);
});

test('Ticket 62 produces commercial standard and GLP-1 actions only with a clear current gate', () => {
  const purchase = [obligation('o-buy', 'commercial_purchase_intent', 'explicit_current_request')];
  const glp1Subject = deriveCommercialAuthorizationSubject({ campaign: 'glp1_validation', offerVersion: '28d-149-v1' });
  const standard = resolve(purchase);
  const glp1 = resolveObligations({ context: context('glp1_validation'), obligations: [{ ...purchase[0], ...glp1Subject }], asOf, ...resolvers() });
  assert.equal(standard.authorized_actions[0].action_type, 'provide_checkout_destination');
  assert.equal(glp1.authorized_actions[0].action_type, 'provide_holding_page_destination');
  assert.notEqual(purchase[0].authorization_subject_id, glp1Subject.authorization_subject_id);
  assert.match(standard.authorized_actions[0].action_id, /^act-[0-9a-f]{64}$/);
  assert.equal(standard.authorized_actions[0].action_identity_version, 'action-identity-v1');
  assert.match(standard.authorized_actions[0].idempotency.execution_key, /^aek-[0-9a-f]{64}$/);
  assert.equal(standard.authorized_actions[0].idempotency.execution_key_version, 'action-execution-idempotency-v1');
  assert.equal(standard.resolved_obligations[0].source.type, 'deterministic_policy');
});

test('Ticket 59B action identity is stable across retry and interpretation-local obligation changes', () => {
  const first = resolve([obligation('o-1', 'commercial_purchase_intent', 'explicit_current_request')]);
  const retried = resolve([{ ...obligation('o-99', 'commercial_purchase_intent', 'explicit_current_request'), current_turn_evidence: 'otra redacción', confidence: 'low' }]);
  assert.equal(first.authorized_actions[0].action_id, retried.authorized_actions[0].action_id);
  assert.equal(first.authorized_actions[0].idempotency.execution_key, retried.authorized_actions[0].idempotency.execution_key);
  const otherInbound = resolveObligations({ context: { ...context(), current_message: { ...context().current_message, canonical_message_id: '11111111-1111-4111-8111-000000000063' } }, obligations: [obligation('o-1', 'commercial_purchase_intent', 'explicit_current_request')], asOf, ...resolvers() });
  assert.notEqual(first.authorized_actions[0].action_id, otherInbound.authorized_actions[0].action_id);
});

test('Ticket 59B rejects duplicate action identities in an orchestration projection', () => {
  const result = resolve([obligation('o-1', 'commercial_purchase_intent', 'explicit_current_request')]);
  const duplicatedResolution = { ...structuredClone(result.resolved_obligations[0]), obligation_id: 'o-2' };
  assert.throws(() => assertOutputs([{ id: 'o-1' }, { id: 'o-2' }], [result.resolved_obligations[0], duplicatedResolution], [result.authorized_actions[0], structuredClone(result.authorized_actions[0])]), error => error.code === 'ORCHESTRATION_ACTION_INVALID');
});

test('Ticket 60B-R fails closed for missing, malformed, or context-mismatched commercial subjects', () => {
  const purchase = obligation('o-buy', 'commercial_purchase_intent', 'explicit_current_request');
  assert.throws(() => resolve([{ ...purchase, authorization_subject_id: 'cas-short' }]), error => error.code === 'ORCHESTRATION_COMMERCIAL_SUBJECT_INVALID');
  assert.throws(() => resolve([{ ...purchase, authorization_subject_version: 'commercial-authorization-subject-v2' }]), error => error.code === 'ORCHESTRATION_COMMERCIAL_SUBJECT_INVALID');
  assert.throws(() => resolveObligations({ context: context('glp1_validation'), obligations: [purchase], asOf, ...resolvers() }), error => error.code === 'ORCHESTRATION_COMMERCIAL_SUBJECT_INVALID');
  assert.throws(() => resolve([{ ...obligation('o-fact', 'product_fact', 'price'), authorization_subject_id: purchase.authorization_subject_id, authorization_subject_version: purchase.authorization_subject_version }]), error => error.code === 'ORCHESTRATION_OBLIGATION_INVALID');
  assert.throws(() => resolve([purchase, { ...purchase, id: 'o-buy-duplicate', current_turn_evidence: 'otra evidencia' }]), error => error.code === 'ORCHESTRATION_COMMERCIAL_SUBJECT_DUPLICATE');
});

test('Ticket 60B-R keeps legacy reminder context dormant and never authorizes scheduling', () => {
  const reminder = [obligation('o-reminder', 'reminder_request', 'explicit')];
  const scheduledFor = '2026-09-23T18:00:00.123+05:30';
  const incomplete = resolve(reminder);
  const complete = resolve(reminder, { reminderContexts: { 'o-reminder': { scheduled_for: scheduledFor, existing_schedule: false } } });
  assert.equal(incomplete.resolved_obligations[0].resolution_status, 'resolved');
  assert.equal(complete.resolved_obligations[0].resolution_status, 'resolved');
  assert.equal(complete.resolved_obligations[0].action_authorization, undefined);
  assert.deepEqual(complete.authorized_actions, []);
  assert.equal(complete.resolved_obligations[0].policy_decision.reason_code, 'REMINDER_SCHEDULING_OUTSIDE_V2_LAUNCH');
});

test('Ticket 62 isolates availability failures and passes indeterminate safety to commercial policy', () => {
  const normalPolicy = resolvers().policyResolver;
  const unavailableSafetyPolicy = { resolvePolicy(request) { if (request.obligation.category === 'medication_management') { const error = new Error('unavailable'); error.code = 'POLICY_STORE_UNAVAILABLE'; throw error; } return normalPolicy.resolvePolicy(request); } };
  const result = resolveObligations({ context: context(), obligations: [obligation('o-buy', 'commercial_purchase_intent', 'explicit_current_request'), obligation('o-dose', 'medication_management', 'dose_change')], factResolver: resolvers().factResolver, policyResolver: unavailableSafetyPolicy, asOf });
  assert.equal(result.resolved_obligations[0].policy_decision.reason_code, 'COMMERCIAL_SAFETY_GATE_INDETERMINATE');
  assert.equal(result.resolved_obligations[1].resolution_status, 'failed');
  const factFailure = resolveObligations({ context: context(), obligations: [obligation('o-price', 'product_fact', 'price'), obligation('o-social', 'social_acknowledgement')], factResolver: { resolveFact() { const error = new Error('unavailable'); error.code = 'FACT_STORE_UNAVAILABLE'; throw error; } }, policyResolver: resolvers().policyResolver, asOf });
  assert.deepEqual(factFailure.resolved_obligations.map(value => value.resolution_status), ['failed', 'deferred']);
});

test('Ticket 62 rejects structural input and malformed authority results whole-call', () => {
  assert.throws(() => resolve([obligation('o-1', 'product_fact', 'price'), obligation('o-1', 'product_fact', 'duration')]), error => error instanceof ResolutionOrchestratorError && error.code === 'ORCHESTRATION_OBLIGATION_IDS_DUPLICATE');
  assert.throws(() => resolveObligations({ context: context(), obligations: [obligation('o-price', 'product_fact', 'price')], factResolver: { resolveFact() { return { status: 'resolved', authority: 'canonical_fact', source: null, factual_payload: 1 }; } }, policyResolver: resolvers().policyResolver, asOf }), error => error instanceof ResolutionOrchestratorError && error.code === 'ORCHESTRATION_OUTPUT_INVALID');
});

test('Ticket 62 is deterministic and does not use history as fact, purchase, or safety authority', () => {
  const staleHistory = [{ role: 'assistant', text: 'Cuesta $1', occurred_at: '2026-09-22T00:00:00.000Z', source_id: 'm-old', final_visible: true }];
  const input = { context: context('standard', staleHistory), obligations: [obligation('o-price', 'product_fact', 'price'), obligation('o-social', 'social_acknowledgement')], asOf, ...resolvers() };
  assert.deepEqual(resolveObligations(input), resolveObligations(input));
  assert.deepEqual(resolveObligations(input).resolved_obligations[0].factual_payload, { amount: 149, currency: 'MXN' });
  assert.deepEqual(resolveObligations(input).authorized_actions, []);
});

test('Ticket 62 accepts no ResolvedObligation property outside the normative schema', () => {
  const schemaProperties = Object.keys(contract.$defs.resolvedObligation.properties).sort();
  const validatorProperties = [...RESOLVED_OBLIGATION_KEYS].sort();
  assert.deepEqual(validatorProperties, schemaProperties);
  const resolved = resolve([obligation('o-price', 'product_fact', 'price')]).resolved_obligations[0];
  assert.equal(resolvedValid(resolved), true);
  assert.equal(resolvedValid({ ...resolved, reason_code: 'NOT_NORMATIVE' }), false);
  assert.equal(Object.hasOwn(resolved, 'reason_code'), false);
});

test('Ticket 62 projects false membership, reviewed unknown, and canonical not-applicable without local reason metadata', () => {
  const ordinary = resolve([
    obligation('o-paypal', 'product_fact', 'payment_method', { customer_candidate: 'paypal' }),
    obligation('o-refund', 'product_fact', 'refund_policy'),
  ]).resolved_obligations;
  assert.equal(ordinary[0].factual_payload.value, false);
  assert.equal(ordinary[1].authority, 'bounded_unknown');
  assert.deepEqual(ordinary[1].source, { type: 'canonical_fact', id: 'offer.public_refund_policy', version: '1' });
  const notApplicableFacts = facts.map(fact => fact.fact_key === 'offer.price' ? { ...fact, state: 'not_applicable', value: null } : fact);
  const result = resolveObligations({ context: context(), obligations: [obligation('o-price', 'product_fact', 'price')], factResolver: createFactResolver({ facts: notApplicableFacts, membershipDefinitions }), policyResolver: resolvers().policyResolver, asOf });
  assert.equal(result.resolved_obligations[0].authority, 'canonical_fact');
  assert.equal(result.resolved_obligations[0].factual_payload, null);
  assert.equal(Object.hasOwn(result.resolved_obligations[0], 'reason_code'), false);
});

test('Ticket 62 canonical four-obligation case preserves independent truth, safety, and order', () => {
  const result = resolve([
    obligation('o-buy', 'commercial_purchase_intent', 'explicit_current_request'),
    obligation('o-oxxo', 'product_fact', 'payment_method', { customer_candidate: 'OXXO' }),
    obligation('o-start', 'product_fact', 'start_date'),
    obligation('o-dose', 'medication_management', 'dose_change'),
  ]);
  assert.deepEqual(result.resolved_obligations.map(value => value.obligation_id), ['o-buy', 'o-oxxo', 'o-start', 'o-dose']);
  assert.equal(result.resolved_obligations[0].policy_decision.reason_code, 'COMMERCIAL_SAFETY_GATE_BLOCKED');
  assert.deepEqual(result.resolved_obligations[1].factual_payload, { operation: 'contains', candidate: 'oxxo', value: true });
  assert.deepEqual(result.resolved_obligations[2].factual_payload, { minimum_days: 0, maximum_days: 30 });
  assert.equal(result.resolved_obligations[3].resolution_status, 'prohibited');
  assert.deepEqual(result.authorized_actions, []);
});

test('Ticket 62 keeps known facts, unknown capability, practical guidance, and medication independent', () => {
  const result = resolve([
    obligation('o-price', 'product_fact', 'price'),
    obligation('o-video', 'provider_service_fact', 'video_calls'),
    obligation('o-practical', 'practical_guidance', 'meal_preparation'),
    obligation('o-dose', 'medication_management', 'dose_change'),
  ]).resolved_obligations;
  assert.deepEqual(result.map(value => value.resolution_status), ['resolved', 'unknown', 'deferred', 'prohibited']);
  assert.equal(result[1].source, null);
  assert.equal(result[2].next_stage, 'reviewed_knowledge_or_reasoning');
});

test('Ticket 62 preserves Ticket 56 and Ticket 55 category boundaries without rereading content', () => {
  const practicalCapability = resolve([
    obligation('o-practical', 'practical_guidance', 'meal_preparation'),
    obligation('o-capability', 'provider_service_fact', 'automatic_meal_prep_adaptation'),
  ]).resolved_obligations;
  assert.deepEqual(practicalCapability.map(value => value.resolution_status), ['deferred', 'unknown']);
  const taskAndDirectMedication = resolve([
    obligation('o-task', 'conversational_task', 'draft', { task_operation: 'draft' }),
    obligation('o-dose', 'medication_management', 'dose_change', { medication_decision: 'dose_change' }),
  ]).resolved_obligations;
  assert.equal(taskAndDirectMedication[0].next_stage, 'conversational_generation');
  assert.equal(taskAndDirectMedication[1].resolution_status, 'prohibited');
});

test('Ticket 62 does not turn historical purchase or medication text into current authorization or safety', () => {
  const history = [{ role: 'customer', text: 'Quiero comprar y debo bajar mi dosis', occurred_at: '2026-09-22T00:00:00.000Z', source_id: 'm-old' }];
  const social = resolveObligations({ context: context('standard', history), obligations: [obligation('o-social', 'social_acknowledgement')], asOf, ...resolvers() });
  assert.deepEqual(social.authorized_actions, []);
  const currentPurchase = resolveObligations({ context: context('standard', history), obligations: [obligation('o-buy', 'commercial_purchase_intent', 'explicit_current_request')], asOf, ...resolvers() });
  assert.equal(currentPurchase.authorized_actions[0].action_type, 'provide_checkout_destination');
});

test('Ticket 62 rejects malformed Policy Resolver output whole-call', () => {
  assert.throws(() => resolveObligations({ context: context(), obligations: [obligation('o-buy', 'commercial_purchase_intent', 'explicit_current_request')], factResolver: resolvers().factResolver, policyResolver: { resolvePolicy() { return { resolution_status: 'resolved', authority: 'commercial_authorization', source: null, action_authorization: null }; } }, asOf }), error => error instanceof ResolutionOrchestratorError && error.code === 'ORCHESTRATION_OUTPUT_INVALID');
});

test('Ticket 60B-R keeps reminder intent independent without adding a launch action', () => {
  const result = resolve([
    obligation('o-buy', 'commercial_purchase_intent', 'explicit_current_request'),
    obligation('o-reminder', 'reminder_request', 'explicit'),
  ], { reminderContexts: { 'o-reminder': { scheduled_for: '2026-09-23T18:00:00.000Z', existing_schedule: false } } });
  assert.deepEqual(result.authorized_actions.map(value => value.action_type), ['provide_checkout_destination']);
  assert.deepEqual(result.resolved_obligations[0].action_authorization, result.authorized_actions[0]);
  assert.equal(result.resolved_obligations[1].action_authorization, undefined);
});
