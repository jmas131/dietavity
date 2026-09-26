'use strict';

const { formatWhatsAppMessage } = require('../whatsapp-message');
const { buildApprovedReplyReservationInput } = require('./approved-reply-reservation-input');

class ApprovedDeliveryReservationError extends Error {
  constructor(code, cause) { super(code); this.name = 'ApprovedDeliveryReservationError'; this.code = code; this.cause = cause; }
}

function prepareApprovedPhysicalParts(approvedResponseText) {
  let formatted;
  try { formatted = formatWhatsAppMessage(approvedResponseText); } catch (cause) { throw new ApprovedDeliveryReservationError('reservation_preparation_failed', cause); }
  if (!formatted || !Array.isArray(formatted.parts) || formatted.parts.length < 1 || formatted.parts.length > 999) throw new ApprovedDeliveryReservationError('reservation_preparation_failed');
  return Object.freeze(formatted.parts.map((body, index) => Object.freeze({ part_index: index + 1, part_count: formatted.parts.length, body })));
}

function handoff(result) {
  if (!result || !['reserved_new', 'reserved_existing'].includes(result.state) || typeof result.physical_logical_reply_key !== 'string' || !Array.isArray(result.messages)) throw new ApprovedDeliveryReservationError('reservation_result_invalid');
  const messages = result.messages.map(row => {
    const index = row?.metadata?.part_index;
    const count = row?.metadata?.part_count;
    if (!row || typeof row.id !== 'string' || typeof row.body !== 'string' || typeof row.idempotency_key !== 'string' || !Number.isInteger(index) || !Number.isInteger(count)) throw new ApprovedDeliveryReservationError('reservation_result_invalid');
    return Object.freeze({ id: row.id, body: row.body, idempotency_key: row.idempotency_key, part_index: index, part_count: count });
  }).sort((a, b) => a.part_index - b.part_index);
  if (!messages.length || messages.some((row, index) => row.part_index !== index + 1 || row.part_count !== messages.length)) throw new ApprovedDeliveryReservationError('reservation_result_invalid');
  return Object.freeze({ state: result.state, physical_logical_reply_key: result.physical_logical_reply_key, messages: Object.freeze(messages) });
}

function createApprovedDeliveryReservation({ reservationAdapter } = {}) {
  if (!reservationAdapter || typeof reservationAdapter.reserve !== 'function') throw new ApprovedDeliveryReservationError('reservation_not_configured');
  const prepared = new Map();
  return Object.freeze({
    async reserve({ turnResult, manifest, session_id, processing_owner, invocationIdentity }) {
      if (typeof invocationIdentity !== 'string' || !invocationIdentity) throw new ApprovedDeliveryReservationError('reservation_preparation_failed');
      let input = prepared.get(invocationIdentity);
      if (!input) {
        const parts = prepareApprovedPhysicalParts(turnResult?.customer_response?.text);
        try { input = buildApprovedReplyReservationInput({ turnResult, manifest, session_id, processing_owner, parts }); }
        catch (cause) { throw new ApprovedDeliveryReservationError('reservation_preparation_failed', cause); }
        prepared.set(invocationIdentity, input);
      }
      try { return Object.freeze({ input, reservation: handoff(await reservationAdapter.reserve(input)) }); }
      catch (cause) { throw new ApprovedDeliveryReservationError('reservation_unavailable', cause); }
    }
  });
}

module.exports = { ApprovedDeliveryReservationError, createApprovedDeliveryReservation, prepareApprovedPhysicalParts };
