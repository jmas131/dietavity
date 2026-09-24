'use strict';

class ActionReservationStoreError extends Error { constructor(code, cause) { super(code); this.code = code; this.cause = cause; } }

function createPostgresActionReservationStore({ rpc, workerId }) {
  if (typeof rpc !== 'function' || typeof workerId !== 'string' || !workerId || workerId.length > 128) throw new ActionReservationStoreError('ACTION_RESERVATION_STORE_INPUT_INVALID');
  const invoke = async (name, payload) => {
    const result = await rpc(name, payload);
    if (!result || result.error) throw new ActionReservationStoreError('ACTION_RESERVATION_STORE_RPC_FAILED', result?.error);
    return result.data;
  };
  return Object.freeze({
    async reserve({ action_id, execution_key, action_type }) {
      const data = await invoke('reserve_authorized_action_execution', { action_id, execution_key, action_type, worker_id: workerId });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new ActionReservationStoreError('ACTION_RESERVATION_STORE_RESULT_INVALID');
      return row;
    },
    async succeed({ action_id, execution_key, result }) {
      await invoke('complete_authorized_action_execution', { action_id, execution_key, worker_id: workerId, result });
    },
    async fail({ action_id, execution_key, execution_status }) {
      await invoke('fail_authorized_action_execution', { action_id, execution_key, worker_id: workerId, execution_status });
    }
  });
}

module.exports = { ActionReservationStoreError, createPostgresActionReservationStore };
