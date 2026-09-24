'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveAuthorizedActionIdentity } = require('../lib/sales-engine-v2/authorized-action-identity');
const { deriveCommercialAuthorizationSubject } = require('../lib/sales-engine-v2/commercial-authorization-subject');
const { ACTION_RESULT_VERSION, actionResultValid, assertActionResult, resultFor } = require('../lib/sales-engine-v2/action-result-validator');
const { executeAuthorizedAction } = require('../lib/sales-engine-v2/action-executor');
const { assertPreComposerEnvelope, buildPreComposerEnvelope, preComposerEnvelopeValid } = require('../lib/sales-engine-v2/pre-composer-envelope');
const { buildResponsePlan } = require('../lib/sales-engine-v2/response-plan-builder');

function action(type = 'provide_checkout_destination') {
  const subject = deriveCommercialAuthorizationSubject({ campaign: type === 'provide_holding_page_destination' ? 'glp1_validation' : 'standard', offerVersion: '28d-149-v1' });
  const identity = deriveAuthorizedActionIdentity({ canonicalMessageId: '11111111-1111-4111-8111-000000000065', authorizationSubject: subject, actionType: type, policy: { id: type === 'provide_holding_page_destination' ? 'commercial.checkout.glp1_canary' : 'commercial.checkout.standard', version: '1' } });
  return { action_identity_version: identity.action_identity_version, action_id: identity.action_id, action_type: type, authorization_source: 'deterministic_policy', authorizing_rule: type === 'provide_holding_page_destination' ? 'commercial.checkout.glp1_canary' : 'commercial.checkout.standard', parameters: {}, preconditions: [], constraints: {}, idempotency: { required: true, key_scope: 'inbound_message', execution_key_version: identity.execution_key_version, execution_key: identity.execution_key }, status: 'authorized' };
}

function planWithAction(authorizedAction) {
  const context = { contract_version: '2.0', context_id: 'c-65d', locale: 'es-MX', current_message: { role: 'customer', text: 'quiero comprar', occurred_at: '2026-09-24T18:00:00.000Z', source_id: 'provider-sid', canonical_message_id: '11111111-1111-4111-8111-000000000065' }, history: [], history_metadata: { ordering: 'occurred_at', history_truncated: false, retained_prior_turns: 0, retained_prior_characters: 0 }, conversation_artifacts: [], conversation_artifacts_metadata: { ordering: 'occurred_at', artifacts_truncated: false, retained_artifacts: 0, retained_artifact_characters: 0 }, session_state: { session_id: 's-65d' }, offer_context: { offer_version: '28d-149-v1' }, customer_state: {}, commercial_state: { checkout_sent: false, valid_purchase_confirmation: false }, metadata: { channel: 'whatsapp', campaign: authorizedAction.action_type === 'provide_holding_page_destination' ? 'glp1_validation' : 'standard' }, authoritative_context: {}, informational_context: { knowledge: [] } };
  const subject = deriveCommercialAuthorizationSubject({ campaign: context.metadata.campaign, offerVersion: context.offer_context.offer_version });
  const obligation = { id: 'o-buy', category: 'commercial_purchase_intent', current_turn_evidence: 'quiero comprar', confidence: 'high', ambiguous: false, ...subject };
  const resolved = { obligation_id: 'o-buy', resolution_status: 'resolved', authority: 'commercial_authorization', source: { type: 'deterministic_policy', id: authorizedAction.authorizing_rule, version: '1' }, policy_decision: { outcome: 'authorized', reason_code: 'CHECKOUT_AUTHORIZED' }, allowed_claims: [], prohibited_claims: [], customer_uncertainty_required: false, llm_reasoning_permitted: false, action_authorization: authorizedAction };
  return buildResponsePlan({ context, obligations: [obligation], resolvedObligations: [resolved], semanticGuidanceGates: [], authorizedActions: [authorizedAction] });
}

test('Ticket 65D accepts only bounded typed ActionResults', () => {
  const checkout = action();
  const result = resultFor({ action: checkout, execution_status: 'succeeded', payload: { destination: { kind: 'checkout', url: 'https://checkout.stripe.com/c/pay_test' } } });
  assert.equal(result.action_result_version, ACTION_RESULT_VERSION);
  assert.equal(actionResultValid(result), true);
  assert.equal(actionResultValid({ ...result, payload: { destination: { kind: 'checkout', url: 'https://evil.example/path' } } }), false);
  assert.equal(actionResultValid({ ...result, execution_status: 'failed_retryable', payload: { destination: result.payload.destination } }), false);
  assert.throws(() => assertActionResult({ ...result, action_id: 'act-short' }), /ACTION_RESULT_INVALID/);
});

test('Ticket 65D executor reserves before calling injected providers and never exposes errors', async () => {
  const checkout = action(); const calls = [];
  const store = {
    async reserve(input) { calls.push(['reserve', input]); return { state: 'acquired', action_id: input.action_id, execution_key: input.execution_key }; },
    async succeed(input) { calls.push(['succeed', input]); },
    async fail(input) { calls.push(['fail', input]); }
  };
  const result = await executeAuthorizedAction({ authorizedAction: checkout, reservationStore: store, providers: { async createCheckoutDestination(input) { calls.push(['provider', input]); return { kind: 'checkout', url: 'https://checkout.stripe.com/c/pay_test' }; } } });
  assert.equal(result.execution_status, 'succeeded');
  assert.deepEqual(calls.map(call => call[0]), ['reserve', 'provider', 'succeed']);
  const failed = await executeAuthorizedAction({ authorizedAction: checkout, reservationStore: { ...store, async reserve(input) { return { state: 'retry_acquired', action_id: input.action_id, execution_key: input.execution_key }; } }, providers: { async createCheckoutDestination() { throw new Error('provider secret'); } } });
  assert.deepEqual(failed.payload, null); assert.equal(failed.execution_status, 'failed_retryable');
  assert.equal(JSON.stringify(failed).includes('provider secret'), false);
});

test('Ticket 65D resolves the authorized holding-page destination from bounded canonical configuration', async () => {
  const holding = action('provide_holding_page_destination');
  const result = await executeAuthorizedAction({ authorizedAction: holding, reservationStore: { async reserve(input) { return { state: 'acquired', action_id: input.action_id, execution_key: input.execution_key }; }, async succeed() {}, async fail() {} }, providers: {} });
  assert.deepEqual(result.payload, { destination: { kind: 'holding_page', url: 'https://dietavity.com/programa-glp1' } });
});

test('Ticket 65D represents a currently owned reservation without calling it an execution failure', async () => {
  const checkout = action(); let providerCalled = false;
  const state = await executeAuthorizedAction({ authorizedAction: checkout, reservationStore: { async reserve(input) { return { state: 'in_progress', action_id: input.action_id, execution_key: input.execution_key }; }, async succeed() {}, async fail() {} }, providers: { async createCheckoutDestination() { providerCalled = true; } } });
  assert.deepEqual(state, { action_execution_state: 'in_progress', action_id: checkout.action_id, action_type: checkout.action_type });
  assert.equal(providerCalled, false);
  const envelope = buildPreComposerEnvelope({ responsePlan: planWithAction(checkout), executionStates: [{ action_id: state.action_id, action_type: state.action_type, execution_status: state.action_execution_state }] });
  assert.deepEqual(envelope.action_execution_states, [{ action_id: checkout.action_id, action_type: checkout.action_type, execution_status: 'in_progress' }]);
  assert.deepEqual(envelope.customer_action_results, []);
});

test('Ticket 65D reuses a completed bounded result and keeps action internals out of the pre-Composer envelope', async () => {
  const checkout = action();
  const completed = resultFor({ action: checkout, execution_status: 'succeeded', payload: { destination: { kind: 'checkout', url: 'https://checkout.stripe.com/c/pay_test' } } });
  const result = await executeAuthorizedAction({ authorizedAction: checkout, reservationStore: { async reserve(input) { return { state: 'already_succeeded', action_id: input.action_id, execution_key: input.execution_key, result: completed }; }, async succeed() { throw new Error('must not execute'); }, async fail() { throw new Error('must not execute'); } }, providers: {} });
  assert.deepEqual(result, completed);
  const envelope = buildPreComposerEnvelope({ responsePlan: planWithAction(checkout), actionResults: [completed] });
  assert.deepEqual(envelope.customer_action_results, [{ action_id: checkout.action_id, action_type: checkout.action_type, destination: completed.payload.destination }]);
  assert.equal(Object.hasOwn(envelope.response_semantics, 'authorized_actions'), false);
  assert.equal(JSON.stringify(envelope).includes(checkout.idempotency.execution_key), false);
  assert.equal(JSON.stringify(envelope.response_semantics).includes('CHECKOUT_AUTHORIZED'), false);
  const mismatchedStore = {
    async reserve(input) {
      return { state: 'already_succeeded', action_id: input.action_id, execution_key: input.execution_key, result: { ...completed, action_type: 'provide_holding_page_destination', payload: { destination: { kind: 'holding_page', url: 'https://dietavity.com/programa-glp1' } } } };
    },
    async succeed() {}, async fail() {}
  };
  await assert.rejects(() => executeAuthorizedAction({ authorizedAction: checkout, reservationStore: mismatchedStore, providers: {} }), /ACTION_RESERVATION_RESULT_INVALID/);
});

test('Ticket 65D fail-closes ActionResult/plan alignment and preserves missing execution as bounded state', () => {
  const checkout = action(); const plan = planWithAction(checkout);
  const envelope = buildPreComposerEnvelope({ responsePlan: plan });
  assert.deepEqual(envelope.action_execution_states, [{ action_id: checkout.action_id, action_type: checkout.action_type, execution_status: 'not_executed' }]);
  const foreign = action('provide_holding_page_destination');
  const foreignResult = resultFor({ action: foreign, execution_status: 'succeeded', payload: { destination: { kind: 'holding_page', url: 'https://dietavity.com/programa-glp1' } } });
  assert.throws(() => buildPreComposerEnvelope({ responsePlan: plan, actionResults: [foreignResult] }), /PRE_COMPOSER_ACTION_RESULT_ALIGNMENT_INVALID/);
});

test('Ticket 65D standalone envelope validation is the destination trust boundary and never throws on malformed shapes', () => {
  const checkout = action();
  const completed = resultFor({ action: checkout, execution_status: 'succeeded', payload: { destination: { kind: 'checkout', url: 'https://checkout.stripe.com/c/pay_test' } } });
  const base = buildPreComposerEnvelope({ responsePlan: planWithAction(checkout), actionResults: [completed] });
  const forged = destination => ({ ...base, customer_action_results: [{ ...base.customer_action_results[0], destination }] });
  assert.equal(preComposerEnvelopeValid(forged({ kind: 'checkout', url: 'https://example.test/not-stripe' })), false);
  assert.equal(preComposerEnvelopeValid(forged({ kind: 'holding_page', url: 'https://dietavity.com/programa-glp1' })), false);
  const holding = action('provide_holding_page_destination');
  const holdingResult = resultFor({ action: holding, execution_status: 'succeeded', payload: { destination: { kind: 'holding_page', url: 'https://dietavity.com/programa-glp1' } } });
  const holdingEnvelope = buildPreComposerEnvelope({ responsePlan: planWithAction(holding), actionResults: [holdingResult] });
  assert.equal(preComposerEnvelopeValid({ ...holdingEnvelope, customer_action_results: [{ ...holdingEnvelope.customer_action_results[0], destination: { kind: 'checkout', url: 'https://checkout.stripe.com/c/pay_test' } }] }), false);
  assert.equal(preComposerEnvelopeValid({ ...holdingEnvelope, customer_action_results: [{ ...holdingEnvelope.customer_action_results[0], destination: { kind: 'holding_page', url: 'https://dietavity.com/altered' } }] }), false);
  assert.equal(preComposerEnvelopeValid({ ...base, action_execution_states: null }), false);
  assert.equal(preComposerEnvelopeValid({ ...base, customer_action_results: null }), false);
  assert.throws(() => assertPreComposerEnvelope({ ...base, action_execution_states: null }), /PRE_COMPOSER_ENVELOPE_INVALID/);
});
