'use strict';

const { customerDestinationValid } = require('./action-result-validator');

const COMMERCIAL_EXECUTION_EXPRESSION_VERSION = 'ticket-65c1-v1';
const ACTION_ID = /^act-[0-9a-f]{64}$/;
const INTENT_ACTION_TYPES = Object.freeze({ checkout_offer: 'provide_checkout_destination', holding_page_offer: 'provide_holding_page_destination' });
const EXECUTION_STATUSES = new Set(['succeeded', 'not_executed', 'in_progress', 'failed_retryable', 'failed_terminal']);
const only = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.has(key));

const expressionMeaning = Object.freeze({
  succeeded: Object.freeze({ commercial_next_step_status: 'available', destination_may_be_expressed: true, allowed_claims: Object.freeze(['commercial_next_step_available', 'exact_validated_destination']), prohibited_claims: Object.freeze(['delivery_claim', 'customer_received_or_opened_destination', 'unvalidated_destination']) }),
  not_executed: Object.freeze({ commercial_next_step_status: 'unavailable_now', destination_may_be_expressed: false, allowed_claims: Object.freeze(['commercial_next_step_unavailable_now']), prohibited_claims: Object.freeze(['execution_attempt_or_failure_claim', 'provider_failure_explanation', 'retry_instruction_or_timing', 'future_destination_or_delivery', 'product_or_capability_unavailability']) }),
  in_progress: Object.freeze({ commercial_next_step_status: 'unavailable_now', destination_may_be_expressed: false, allowed_claims: Object.freeze(['commercial_next_step_unavailable_now']), prohibited_claims: Object.freeze(['execution_success_or_failure_claim', 'provider_failure_explanation', 'retry_instruction_or_timing', 'future_destination_or_delivery', 'product_or_capability_unavailability']) }),
  failed_retryable: Object.freeze({ commercial_next_step_status: 'unavailable_now', destination_may_be_expressed: false, allowed_claims: Object.freeze(['commercial_next_step_unavailable_now']), prohibited_claims: Object.freeze(['provider_failure_explanation', 'retry_instruction_or_timing', 'future_destination_or_delivery', 'product_or_capability_unavailability']) }),
  failed_terminal: Object.freeze({ commercial_next_step_status: 'unavailable_now', destination_may_be_expressed: false, allowed_claims: Object.freeze(['commercial_next_step_unavailable_now']), prohibited_claims: Object.freeze(['provider_failure_explanation', 'permanent_unavailability_claim', 'future_destination_or_delivery', 'product_or_capability_unavailability', 'alternate_purchase_route']) }),
});

function commercialSemanticsValid(value) {
  return only(value, new Set(['obligation_id', 'semantics_version', 'commercial_intent', 'destination'])) && typeof value.obligation_id === 'string' && /^o-[A-Za-z0-9._-]+$/.test(value.obligation_id) && value.semantics_version === 'ticket-65c-v1' && Object.hasOwn(INTENT_ACTION_TYPES, value.commercial_intent) && only(value.destination, new Set(['status'])) && value.destination.status === 'authorized_to_provide';
}

function executionStateValid(value, intent) {
  return only(value, new Set(['action_id', 'action_type', 'execution_status'])) && typeof value.action_id === 'string' && ACTION_ID.test(value.action_id) && value.action_type === INTENT_ACTION_TYPES[intent] && EXECUTION_STATUSES.has(value.execution_status);
}

function customerActionResultValid(value, state) {
  return only(value, new Set(['action_id', 'action_type', 'destination'])) && value.action_id === state.action_id && value.action_type === state.action_type && customerDestinationValid(value.action_type, value.destination);
}

function expressionFor({ commercialSemantics, actionExecutionState, customerActionResult = null }) {
  if (!commercialSemanticsValid(commercialSemantics) || !executionStateValid(actionExecutionState, commercialSemantics?.commercial_intent)) {
    const error = new Error('COMMERCIAL_EXECUTION_EXPRESSION_INPUT_INVALID'); error.code = 'COMMERCIAL_EXECUTION_EXPRESSION_INPUT_INVALID'; throw error;
  }
  const status = actionExecutionState.execution_status;
  if ((status === 'succeeded' && !customerActionResultValid(customerActionResult, actionExecutionState)) || (status !== 'succeeded' && customerActionResult !== null)) {
    const error = new Error('COMMERCIAL_EXECUTION_EXPRESSION_DESTINATION_ALIGNMENT_INVALID'); error.code = 'COMMERCIAL_EXECUTION_EXPRESSION_DESTINATION_ALIGNMENT_INVALID'; throw error;
  }
  const meaning = expressionMeaning[status];
  return Object.freeze({ obligation_id: commercialSemantics.obligation_id, semantics_version: COMMERCIAL_EXECUTION_EXPRESSION_VERSION, commercial_intent: commercialSemantics.commercial_intent, action_id: actionExecutionState.action_id, execution_status: status, commercial_next_step_status: meaning.commercial_next_step_status, destination_may_be_expressed: meaning.destination_may_be_expressed, allowed_claims: [...meaning.allowed_claims], prohibited_claims: [...meaning.prohibited_claims] });
}

function commercialExecutionExpressionValid(value, { customerActionResults = [] } = {}) {
  if (!only(value, new Set(['obligation_id', 'semantics_version', 'commercial_intent', 'action_id', 'execution_status', 'commercial_next_step_status', 'destination_may_be_expressed', 'allowed_claims', 'prohibited_claims'])) || typeof value.obligation_id !== 'string' || !/^o-[A-Za-z0-9._-]+$/.test(value.obligation_id) || value.semantics_version !== COMMERCIAL_EXECUTION_EXPRESSION_VERSION || !Object.hasOwn(INTENT_ACTION_TYPES, value.commercial_intent) || typeof value.action_id !== 'string' || !ACTION_ID.test(value.action_id) || !EXECUTION_STATUSES.has(value.execution_status) || !Array.isArray(value.allowed_claims) || !Array.isArray(value.prohibited_claims)) return false;
  const meaning = expressionMeaning[value.execution_status];
  if (value.commercial_next_step_status !== meaning.commercial_next_step_status || value.destination_may_be_expressed !== meaning.destination_may_be_expressed || JSON.stringify(value.allowed_claims) !== JSON.stringify(meaning.allowed_claims) || JSON.stringify(value.prohibited_claims) !== JSON.stringify(meaning.prohibited_claims)) return false;
  if (!Array.isArray(customerActionResults)) return false;
  const matching = customerActionResults.filter(result => result?.action_id === value.action_id);
  return value.execution_status === 'succeeded'
    ? matching.length === 1 && customerActionResultValid(matching[0], { action_id: value.action_id, action_type: INTENT_ACTION_TYPES[value.commercial_intent] })
    : matching.length === 0;
}

function assertCommercialExecutionExpression(value, context) {
  if (!commercialExecutionExpressionValid(value, context)) { const error = new Error('COMMERCIAL_EXECUTION_EXPRESSION_INVALID'); error.code = 'COMMERCIAL_EXECUTION_EXPRESSION_INVALID'; throw error; }
  return structuredClone(value);
}

module.exports = { COMMERCIAL_EXECUTION_EXPRESSION_VERSION, EXECUTION_STATUSES, assertCommercialExecutionExpression, commercialExecutionExpressionValid, expressionFor };
