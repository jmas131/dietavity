'use strict';

// T75D.1 deliberately exposes one narrow Node-owned persistence operation.
// n8n receives only the returned, already-reserved physical message rows.
const { assertApprovedReplyReservationInput } = require('./approved-reply-reservation-input');

class ApprovedReplyReservationAdapterError extends Error {
  constructor(code) { super(code); this.name = 'ApprovedReplyReservationAdapterError'; this.code = code; }
}

function checkAbort(signal) {
  if (signal?.aborted) throw new ApprovedReplyReservationAdapterError('V2_REPLY_RESERVATION_ABORTED');
}

function validResult(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && ['reserved_new', 'reserved_existing'].includes(value.state)
    && typeof value.physical_logical_reply_key === 'string'
    && Array.isArray(value.messages) && value.messages.length > 0;
}

function createSupabaseApprovedReplyReservationAdapter({ supabase, signal } = {}) {
  if (!supabase || typeof supabase.rpc !== 'function') throw new ApprovedReplyReservationAdapterError('V2_REPLY_RESERVATION_ADAPTER_INVALID');
  return Object.freeze({
    async reserve(input) {
      const request = assertApprovedReplyReservationInput(input);
      checkAbort(signal);
      try {
        let query = supabase.rpc('reserve_v2_approved_logical_reply', { p: request });
        if (signal && query && typeof query.abortSignal === 'function') query = query.abortSignal(signal);
        const response = await query;
        checkAbort(signal);
        if (!response || response.error || !validResult(response.data)) throw new ApprovedReplyReservationAdapterError('V2_REPLY_RESERVATION_UNAVAILABLE');
        return Object.freeze(structuredClone(response.data));
      } catch (error) {
        if (error instanceof ApprovedReplyReservationAdapterError) throw error;
        throw new ApprovedReplyReservationAdapterError('V2_REPLY_RESERVATION_UNAVAILABLE');
      }
    }
  });
}

module.exports = { ApprovedReplyReservationAdapterError, createSupabaseApprovedReplyReservationAdapter, validResult };
