'use strict';

const { LAUNCH_ACTION_TYPES } = require('./authorized-action-identity');
const actionDestinations = require('../../config/sales-engine-v2/action-destinations.json');

const ACTION_RESULT_VERSION = 'ticket-65d-v1';
const EXECUTION_STATUSES = new Set(['succeeded', 'failed_retryable', 'failed_terminal']);
const ACTION_ID = /^act-[0-9a-f]{64}$/;
const EXECUTION_KEY = /^aek-[0-9a-f]{64}$/;
const URL = /^https:\/\/[^\s]+$/;
const only = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.has(key));

function customerDestinationValid(actionType, destination) {
  if (!LAUNCH_ACTION_TYPES.has(actionType) || !only(destination, new Set(['kind', 'url'])) || typeof destination.url !== 'string' || !URL.test(destination.url)) return false;
  return actionType === 'provide_checkout_destination'
    ? destination.kind === 'checkout' && /^https:\/\/checkout\.stripe\.com\//.test(destination.url)
    : destination.kind === actionDestinations.holding_page.kind && destination.url === actionDestinations.holding_page.url;
}

function actionResultValid(value) {
  if (!only(value, new Set(['action_result_version', 'action_id', 'execution_key', 'action_type', 'execution_status', 'provenance', 'payload'])) || value.action_result_version !== ACTION_RESULT_VERSION || typeof value.action_id !== 'string' || !ACTION_ID.test(value.action_id) || typeof value.execution_key !== 'string' || !EXECUTION_KEY.test(value.execution_key) || !LAUNCH_ACTION_TYPES.has(value.action_type) || !EXECUTION_STATUSES.has(value.execution_status) || !only(value.provenance, new Set(['type', 'version'])) || value.provenance.type !== 'authorized_action_execution' || value.provenance.version !== ACTION_RESULT_VERSION) return false;
  if (value.execution_status !== 'succeeded') return value.payload === null;
  return only(value.payload, new Set(['destination'])) && customerDestinationValid(value.action_type, value.payload.destination);
}

function assertActionResult(value) { if (!actionResultValid(value)) { const error = new Error('ACTION_RESULT_INVALID'); error.code = 'ACTION_RESULT_INVALID'; throw error; } return structuredClone(value); }
function resultFor({ action, execution_status, payload = null }) { return assertActionResult({ action_result_version: ACTION_RESULT_VERSION, action_id: action.action_id, execution_key: action.idempotency.execution_key, action_type: action.action_type, execution_status, provenance: { type: 'authorized_action_execution', version: ACTION_RESULT_VERSION }, payload }); }

module.exports = { ACTION_RESULT_VERSION, EXECUTION_STATUSES, actionResultValid, assertActionResult, customerDestinationValid, resultFor };
