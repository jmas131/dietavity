'use strict';

const { launchActionValid } = require('./resolution-orchestrator-validator');
const { assertActionResult, resultFor } = require('./action-result-validator');
const actionDestinations = require('../../config/sales-engine-v2/action-destinations.json');

class ActionExecutorError extends Error { constructor(code, cause) { super(code); this.code = code; this.cause = cause; } }

function assertReservation(value, action) {
  if (!value || typeof value !== 'object' || !['acquired', 'retry_acquired', 'already_succeeded', 'in_progress', 'terminal_failure'].includes(value.state) || value.action_id !== action.action_id || value.execution_key !== action.idempotency.execution_key) throw new ActionExecutorError('ACTION_RESERVATION_INVALID');
  return value;
}

async function executeAuthorizedAction({ authorizedAction, reservationStore, providers }) {
  if (!launchActionValid(authorizedAction) || !reservationStore || typeof reservationStore.reserve !== 'function' || typeof reservationStore.succeed !== 'function' || typeof reservationStore.fail !== 'function' || !providers || typeof providers !== 'object') throw new ActionExecutorError('ACTION_EXECUTOR_INPUT_INVALID');
  const action = structuredClone(authorizedAction);
  const reservation = assertReservation(await reservationStore.reserve({ action_id: action.action_id, execution_key: action.idempotency.execution_key, action_type: action.action_type }), action);
  if (reservation.state === 'already_succeeded') {
    const prior = assertActionResult(reservation.result);
    if (prior.action_id !== action.action_id || prior.execution_key !== action.idempotency.execution_key || prior.action_type !== action.action_type) throw new ActionExecutorError('ACTION_RESERVATION_RESULT_INVALID');
    return prior;
  }
  if (reservation.state === 'in_progress') return Object.freeze({ action_execution_state: 'in_progress', action_id: action.action_id, action_type: action.action_type });
  if (reservation.state === 'terminal_failure') return resultFor({ action, execution_status: 'failed_terminal' });
  try {
    const destination = action.action_type === 'provide_checkout_destination'
      ? await providers.createCheckoutDestination({ execution_key: action.idempotency.execution_key })
      : structuredClone(actionDestinations.holding_page);
    const result = resultFor({ action, execution_status: 'succeeded', payload: { destination } });
    await reservationStore.succeed({ action_id: action.action_id, execution_key: action.idempotency.execution_key, result });
    return result;
  } catch (error) {
    const execution_status = error?.terminal === true ? 'failed_terminal' : 'failed_retryable';
    const result = resultFor({ action, execution_status });
    await reservationStore.fail({ action_id: action.action_id, execution_key: action.idempotency.execution_key, execution_status });
    return result;
  }
}

module.exports = { ActionExecutorError, executeAuthorizedAction };
