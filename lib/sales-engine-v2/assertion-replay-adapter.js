'use strict';

class AssertionReplayAdapterError extends Error {
  constructor(code) { super(code); this.name = 'AssertionReplayAdapterError'; this.code = code; }
}

const opaque = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);

function request({ issuer, clientId, jti, exp }) {
  if (!opaque(issuer) || !opaque(clientId) || !opaque(jti) || !Number.isInteger(exp) || exp * 1000 <= Date.now()) {
    throw new AssertionReplayAdapterError('ASSERTION_REPLAY_INPUT_INVALID');
  }
  return Object.freeze({ contract_version: 'ticket-75g3a-v1', issuer, client_id: clientId, jti, expires_at: new Date(exp * 1000).toISOString() });
}

function createSupabaseAssertionReplayAdapter({ supabase } = {}) {
  if (!supabase || typeof supabase.rpc !== 'function') throw new AssertionReplayAdapterError('ASSERTION_REPLAY_ADAPTER_INVALID');
  return Object.freeze({
    kind: 'durable_assertion_replay',
    async consume(input) {
      const payload = request(input);
      try {
        const result = await supabase.rpc('consume_sales_engine_v2_assertion_replay', { p: payload });
        if (!result || result.error || !Array.isArray(result.data) || !['consumed', 'replayed'].includes(result.data[0]?.state)) {
          throw new AssertionReplayAdapterError('ASSERTION_REPLAY_UNAVAILABLE');
        }
        return result.data[0].state === 'consumed';
      } catch (error) {
        if (error instanceof AssertionReplayAdapterError) throw error;
        throw new AssertionReplayAdapterError('ASSERTION_REPLAY_UNAVAILABLE');
      }
    }
  });
}

module.exports = { AssertionReplayAdapterError, createSupabaseAssertionReplayAdapter };
