'use strict';

const { ActionReservationStoreError, createPostgresActionReservationStore } = require('./action-reservation-store');
const { customerDestinationValid } = require('./action-result-validator');
const { launchActionValid } = require('./resolution-orchestrator-validator');

class ActionRuntimeError extends Error {
  constructor(code) { super(code); this.name = 'ActionRuntimeError'; this.code = code; }
}

class CheckoutProviderError extends ActionRuntimeError {
  constructor(code, { terminal = false, ambiguous = false } = {}) {
    super(code); this.terminal = terminal; this.ambiguous = ambiguous;
  }
}

function checkAbort(signal) {
  if (signal?.aborted) throw new ActionRuntimeError('ACTION_RUNTIME_DEADLINE_EXCEEDED');
}

function createSupabaseActionReservationStore({ supabase, workerId, signal }) {
  if (!supabase || typeof supabase.rpc !== 'function') throw new ActionReservationStoreError('ACTION_RESERVATION_STORE_INPUT_INVALID');
  return createPostgresActionReservationStore({
    workerId,
    rpc: async (name, payload) => {
      checkAbort(signal);
      let request;
      try {
        request = supabase.rpc(name, { p: payload });
        if (signal && request && typeof request.abortSignal === 'function') request = request.abortSignal(signal);
        const result = await request;
        checkAbort(signal);
        if (!result || result.error) throw new ActionRuntimeError('ACTION_RESERVATION_STORE_UNAVAILABLE');
        return result;
      } catch (error) {
        if (error instanceof ActionRuntimeError) throw error;
        throw new ActionRuntimeError('ACTION_RESERVATION_STORE_UNAVAILABLE');
      }
    }
  });
}

function mappingFor(action, mappings) {
  if (!launchActionValid(action) || action.action_type !== 'provide_checkout_destination' || !mappings || typeof mappings !== 'object') throw new CheckoutProviderError('CHECKOUT_MAPPING_UNAVAILABLE', { terminal: true });
  const mapping = mappings[action.authorizing_rule];
  if (!mapping || typeof mapping !== 'object' || mapping.action_type !== action.action_type || typeof mapping.price_id !== 'string' || !mapping.price_id) throw new CheckoutProviderError('CHECKOUT_MAPPING_UNAVAILABLE', { terminal: true });
  return mapping;
}

function classifyStripeFailure(error) {
  if (error?.ambiguous === true || error?.code === 'ETIMEDOUT' || error?.code === 'ECONNABORTED' || error?.code === 'ECONNRESET') return new CheckoutProviderError('CHECKOUT_PROVIDER_AMBIGUOUS', { ambiguous: true });
  if (error?.status === 400 || error?.status === 401 || error?.status === 403 || error?.status === 404 || error?.status === 422 || error?.code === 'STRIPE_CONFIGURATION_INVALID') return new CheckoutProviderError('CHECKOUT_PROVIDER_REJECTED', { terminal: true });
  if (error?.status === 429) return new CheckoutProviderError('CHECKOUT_PROVIDER_RATE_LIMITED');
  if (typeof error?.status === 'number' && error.status >= 500) return new CheckoutProviderError('CHECKOUT_PROVIDER_UNAVAILABLE');
  return new CheckoutProviderError('CHECKOUT_PROVIDER_UNAVAILABLE');
}

function createCheckoutProvider({ stripeClient, commercialMappings, signal }) {
  if (!stripeClient || typeof stripeClient.createCheckoutSession !== 'function') throw new ActionRuntimeError('CHECKOUT_PROVIDER_INPUT_INVALID');
  return Object.freeze({
    async createCheckoutDestination({ action, execution_key }) {
      const mapping = mappingFor(action, commercialMappings);
      checkAbort(signal);
      let response;
      try {
        response = await stripeClient.createCheckoutSession({ price_id: mapping.price_id, idempotency_key: execution_key, signal });
        checkAbort(signal);
      } catch (error) {
        if (error instanceof ActionRuntimeError) throw error;
        throw classifyStripeFailure(error);
      }
      const destination = response && typeof response === 'object' ? { kind: 'checkout', url: response.url } : null;
      if (!customerDestinationValid(action.action_type, destination)) throw new CheckoutProviderError('CHECKOUT_PROVIDER_RESPONSE_INVALID', { terminal: true });
      return Object.freeze(destination);
    }
  });
}

function createHoldingPageProvider({ destination, signal }) {
  if (!customerDestinationValid('provide_holding_page_destination', destination)) throw new ActionRuntimeError('HOLDING_PAGE_DESTINATION_INVALID');
  const bounded = Object.freeze(structuredClone(destination));
  return Object.freeze({
    async createHoldingPageDestination({ action }) {
      if (!launchActionValid(action) || action.action_type !== 'provide_holding_page_destination') throw new ActionRuntimeError('HOLDING_PAGE_ACTION_INVALID');
      checkAbort(signal);
      checkAbort(signal);
      return structuredClone(bounded);
    }
  });
}

function createActionProviders({ checkoutProvider, holdingPageProvider }) {
  if (!checkoutProvider || typeof checkoutProvider.createCheckoutDestination !== 'function' || !holdingPageProvider || typeof holdingPageProvider.createHoldingPageDestination !== 'function') throw new ActionRuntimeError('ACTION_PROVIDERS_INPUT_INVALID');
  return Object.freeze({
    createCheckoutDestination: input => checkoutProvider.createCheckoutDestination(input),
    createHoldingPageDestination: input => holdingPageProvider.createHoldingPageDestination(input)
  });
}

function createShadowActionExecutor() {
  return Object.freeze(async ({ authorizedAction }) => {
    if (!launchActionValid(authorizedAction)) throw new ActionRuntimeError('SHADOW_ACTION_INPUT_INVALID');
    return Object.freeze({ action_execution_state: 'not_executed', action_id: authorizedAction.action_id, action_type: authorizedAction.action_type });
  });
}

module.exports = { ActionRuntimeError, CheckoutProviderError, classifyStripeFailure, createActionProviders, createCheckoutProvider, createHoldingPageProvider, createShadowActionExecutor, createSupabaseActionReservationStore };
