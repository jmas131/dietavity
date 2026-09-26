'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveAuthorizedActionIdentity } = require('../lib/sales-engine-v2/authorized-action-identity');
const { deriveCommercialAuthorizationSubject } = require('../lib/sales-engine-v2/commercial-authorization-subject');
const { executeAuthorizedAction } = require('../lib/sales-engine-v2/action-executor');
const { createActionProviders, createCheckoutProvider, createHoldingPageProvider, createShadowActionExecutor, createSupabaseActionReservationStore } = require('../lib/sales-engine-v2/action-runtime-adapters');

function action(type = 'provide_checkout_destination') {
  const subject = deriveCommercialAuthorizationSubject({ campaign: type === 'provide_holding_page_destination' ? 'glp1_validation' : 'standard', offerVersion: '28d-149-v1' });
  const identity = deriveAuthorizedActionIdentity({ canonicalMessageId: '11111111-1111-4111-8111-000000000075', authorizationSubject: subject, actionType: type, policy: { id: type === 'provide_holding_page_destination' ? 'commercial.checkout.glp1_canary' : 'commercial.checkout.standard', version: '1' } });
  return { action_identity_version: identity.action_identity_version, action_id: identity.action_id, action_type: type, authorization_source: 'deterministic_policy', authorizing_rule: type === 'provide_holding_page_destination' ? 'commercial.checkout.glp1_canary.v1' : 'commercial.checkout.standard.v1', parameters: {}, preconditions: [], constraints: {}, idempotency: { required: true, key_scope: 'inbound_message', execution_key_version: identity.execution_key_version, execution_key: identity.execution_key }, status: 'authorized' };
}

function store(calls, state = 'acquired', completed) {
  return {
    async reserve(input) { calls.push(['reserve', input]); return { state, action_id: input.action_id, execution_key: input.execution_key, ...(completed ? { result: completed } : {}) }; },
    async succeed(input) { calls.push(['succeed', input]); },
    async fail(input) { calls.push(['fail', input]); }
  };
}

const destination = { kind: 'holding_page', url: 'https://dietavity.com/programa-glp1' };
const mappings = { 'commercial.checkout.standard.v1': { action_type: 'provide_checkout_destination', price_id: 'price_test_only' } };

test('T75C.2 Supabase store exposes only the three Ticket65D RPCs with exact p payloads', async () => {
  const calls = [];
  const supabase = { rpc(name, payload) { calls.push([name, payload]); return { abortSignal() { return Promise.resolve({ data: [{ state: 'acquired', action_id: 'act-a', execution_key: 'aek-a' }], error: null }); } }; } };
  const actionStore = createSupabaseActionReservationStore({ supabase, workerId: 'worker-75c2', signal: new AbortController().signal });
  await actionStore.reserve({ action_id: 'act-a', execution_key: 'aek-a', action_type: 'provide_checkout_destination' });
  await actionStore.succeed({ action_id: 'act-a', execution_key: 'aek-a', result: { execution_status: 'succeeded' } });
  await actionStore.fail({ action_id: 'act-a', execution_key: 'aek-a', execution_status: 'failed_retryable' });
  assert.deepEqual(calls.map(item => item[0]), ['reserve_authorized_action_execution', 'complete_authorized_action_execution', 'fail_authorized_action_execution']);
  assert.deepEqual(calls[0][1], { p: { action_id: 'act-a', execution_key: 'aek-a', action_type: 'provide_checkout_destination', worker_id: 'worker-75c2' } });
  assert.equal(Object.hasOwn(actionStore, 'rpc'), false);
});

test('T75C.2 normalizes database failures and honors abort without exposing a client error', async () => {
  const unavailable = createSupabaseActionReservationStore({ supabase: { rpc() { return Promise.resolve({ error: { message: 'credential detail' } }); } }, workerId: 'worker-75c2' });
  await assert.rejects(() => unavailable.reserve({ action_id: 'act-a', execution_key: 'aek-a', action_type: 'provide_checkout_destination' }), error => error.code === 'ACTION_RESERVATION_STORE_UNAVAILABLE' && !String(error).includes('credential detail'));
  const controller = new AbortController(); controller.abort(); let called = false;
  const aborted = createSupabaseActionReservationStore({ supabase: { rpc() { called = true; } }, workerId: 'worker-75c2', signal: controller.signal });
  await assert.rejects(() => aborted.reserve({ action_id: 'act-a', execution_key: 'aek-a', action_type: 'provide_checkout_destination' }), /ACTION_RUNTIME_DEADLINE_EXCEEDED/);
  assert.equal(called, false);
});

test('T75C.2 checkout reserves first and passes its execution key as the sole provider idempotency identity', async () => {
  const authorizedAction = action(); const calls = [];
  const client = { async createCheckoutSession(input) { calls.push(['stripe', input]); return { url: 'https://checkout.stripe.com/c/t75c2' }; } };
  const providers = createActionProviders({ checkoutProvider: createCheckoutProvider({ stripeClient: client, commercialMappings: mappings }), holdingPageProvider: createHoldingPageProvider({ destination }) });
  const result = await executeAuthorizedAction({ authorizedAction, reservationStore: store(calls), providers });
  assert.equal(result.execution_status, 'succeeded');
  assert.deepEqual(calls.map(item => item[0]), ['reserve', 'stripe', 'succeed']);
  assert.deepEqual(calls[1][1], { price_id: 'price_test_only', idempotency_key: authorizedAction.idempotency.execution_key, signal: undefined });
  assert.equal(JSON.stringify(result).includes('price_test_only'), false);
});

test('T75C.2 unknown commercial mappings fail before Stripe and do not default an offer', async () => {
  const authorizedAction = action(); const calls = [];
  const providers = createActionProviders({ checkoutProvider: createCheckoutProvider({ stripeClient: { async createCheckoutSession() { calls.push(['stripe']); } }, commercialMappings: {} }), holdingPageProvider: createHoldingPageProvider({ destination }) });
  const result = await executeAuthorizedAction({ authorizedAction, reservationStore: store(calls), providers });
  assert.equal(result.execution_status, 'failed_terminal');
  assert.deepEqual(calls.map(item => item[0]), ['reserve', 'fail']);
});

test('T75C.2 classifies invalid, rejected, and unavailable checkout results without leaking provider details', async () => {
  const authorizedAction = action();
  for (const scenario of [
    { response: { url: 'https://invalid.test/checkout' }, status: 'failed_terminal' },
    { error: Object.assign(new Error('card or secret'), { status: 400 }), status: 'failed_terminal' },
    { error: Object.assign(new Error('provider body'), { status: 429 }), status: 'failed_retryable' },
    { error: Object.assign(new Error('provider body'), { status: 503 }), status: 'failed_retryable' }
  ]) {
    const calls = [];
    const providers = createActionProviders({ checkoutProvider: createCheckoutProvider({ stripeClient: { async createCheckoutSession() { if (scenario.error) throw scenario.error; return scenario.response; } }, commercialMappings: mappings }), holdingPageProvider: createHoldingPageProvider({ destination }) });
    const result = await executeAuthorizedAction({ authorizedAction, reservationStore: store(calls), providers });
    assert.equal(result.execution_status, scenario.status);
    assert.equal(JSON.stringify(result).includes('provider body'), false);
    assert.deepEqual(calls.map(item => item[0]), ['reserve', 'fail']);
  }
});

test('T75C.2 leaves ambiguous checkout and completion-persistence outcomes in progress without a second provider call', async () => {
  const authorizedAction = action(); const calls = [];
  const ambiguousProviders = createActionProviders({ checkoutProvider: createCheckoutProvider({ stripeClient: { async createCheckoutSession() { calls.push(['stripe']); const error = new Error('timeout detail'); error.code = 'ETIMEDOUT'; throw error; } }, commercialMappings: mappings }), holdingPageProvider: createHoldingPageProvider({ destination }) });
  const ambiguous = await executeAuthorizedAction({ authorizedAction, reservationStore: store(calls), providers: ambiguousProviders });
  assert.deepEqual(ambiguous, { action_execution_state: 'in_progress', action_id: authorizedAction.action_id, action_type: authorizedAction.action_type });
  assert.deepEqual(calls.map(item => item[0]), ['reserve', 'stripe']);
  const completionCalls = [];
  const successProviders = createActionProviders({ checkoutProvider: createCheckoutProvider({ stripeClient: { async createCheckoutSession() { completionCalls.push(['stripe']); return { url: 'https://checkout.stripe.com/c/t75c2' }; } }, commercialMappings: mappings }), holdingPageProvider: createHoldingPageProvider({ destination }) });
  const completionStore = { ...store(completionCalls), async succeed() { completionCalls.push(['succeed']); throw new Error('db detail'); } };
  const completion = await executeAuthorizedAction({ authorizedAction, reservationStore: completionStore, providers: successProviders });
  assert.equal(completion.action_execution_state, 'in_progress');
  assert.deepEqual(completionCalls.map(item => item[0]), ['reserve', 'stripe', 'succeed']);
});

test('T75C.2 validates holding configuration, does no network work, and persists only after reservation', async () => {
  const authorizedAction = action('provide_holding_page_destination'); const calls = [];
  const providers = createActionProviders({ checkoutProvider: createCheckoutProvider({ stripeClient: { async createCheckoutSession() { throw new Error('must not run'); } }, commercialMappings: mappings }), holdingPageProvider: createHoldingPageProvider({ destination }) });
  const result = await executeAuthorizedAction({ authorizedAction, reservationStore: store(calls), providers });
  assert.equal(result.execution_status, 'succeeded');
  assert.deepEqual(result.payload.destination, destination);
  assert.deepEqual(calls.map(item => item[0]), ['reserve', 'succeed']);
  assert.throws(() => createHoldingPageProvider({ destination: { kind: 'holding_page', url: 'https://invalid.test' } }), /HOLDING_PAGE_DESTINATION_INVALID/);
});

test('T75C.2 reuses durable success and shadow action execution does not touch DB, Stripe, or destinations', async () => {
  const authorizedAction = action(); const calls = [];
  const completed = { action_result_version: 'ticket-65d-v1', action_id: authorizedAction.action_id, execution_key: authorizedAction.idempotency.execution_key, action_type: authorizedAction.action_type, execution_status: 'succeeded', provenance: { type: 'authorized_action_execution', version: 'ticket-65d-v1' }, payload: { destination: { kind: 'checkout', url: 'https://checkout.stripe.com/c/prior' } } };
  const result = await executeAuthorizedAction({ authorizedAction, reservationStore: store(calls, 'already_succeeded', completed), providers: {} });
  assert.deepEqual(result, completed); assert.deepEqual(calls.map(item => item[0]), ['reserve']);
  const shadow = createShadowActionExecutor();
  assert.deepEqual(await shadow({ authorizedAction }), { action_execution_state: 'not_executed', action_id: authorizedAction.action_id, action_type: authorizedAction.action_type });
});
