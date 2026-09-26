'use strict';

// Ticket 75D.0B prepares a closed, non-persistent request after Ticket68A has
// established eligibility. It deliberately carries the exact approved source
// separately from physical transport parts; neither is reconstructed from the
// other.
const { assertPostGateDeliveryManifest } = require('./post-gate-delivery-manifest');
const { approvedResponseDigest, reservationBinding } = require('./approved-reply-reservation-binding');

const CONTRACT_VERSION = 'ticket-75d1-v1';
const REQUEST_KEYS = new Set(['contract_version', 'canonical_inbound_message_id', 'session_id', 'processing_owner', 'logical_reply_key', 'eligible_response_binding', 'approved_response_text', 'approved_response_digest', 'parts', 'artifact_projection', 'reservation_binding']);
class ApprovedReplyReservationInputError extends Error { constructor(code) { super(code); this.name = 'ApprovedReplyReservationInputError'; this.code = code; } }
function fail(code) { throw new ApprovedReplyReservationInputError(code); }
function nonempty(value, code) { if (typeof value !== 'string' || value.length === 0) fail(code); return value; }
function clone(value) { return structuredClone(value); }
function exactArtifact(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function buildApprovedReplyReservationInput({ turnResult, manifest, session_id, processing_owner, parts } = {}) {
  let approvedManifest;
  try { approvedManifest = assertPostGateDeliveryManifest(manifest, { turnResult }); } catch { fail('APPROVED_REPLY_RESERVATION_INELIGIBLE'); }
  const approved_response_text = nonempty(turnResult?.customer_response?.text, 'APPROVED_REPLY_RESERVATION_TEXT_INVALID');
  nonempty(session_id, 'APPROVED_REPLY_RESERVATION_SESSION_INVALID');
  nonempty(processing_owner, 'APPROVED_REPLY_RESERVATION_OWNER_INVALID');
  const artifact_projection = clone(approvedManifest.artifact_projection);
  const base = {
    canonical_inbound_message_id: approvedManifest.canonical_inbound_message_id,
    session_id,
    logical_reply_key: approvedManifest.logical_reply_key,
    eligible_response_binding: approvedManifest.eligible_response_binding,
    approved_response_digest: approvedResponseDigest(approved_response_text),
    parts: clone(parts),
    artifact_projection,
  };
  const result = {
    contract_version: CONTRACT_VERSION,
    canonical_inbound_message_id: base.canonical_inbound_message_id,
    session_id,
    processing_owner,
    logical_reply_key: base.logical_reply_key,
    eligible_response_binding: base.eligible_response_binding,
    approved_response_text,
    approved_response_digest: base.approved_response_digest,
    parts: base.parts,
    artifact_projection,
    reservation_binding: reservationBinding(base),
  };
  return deepFreeze(result);
}

function approvedReplyReservationInputValid(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== REQUEST_KEYS.size || Object.keys(value).some(key => !REQUEST_KEYS.has(key))) return false;
  if (value.contract_version !== CONTRACT_VERSION || typeof value.approved_response_text !== 'string' || value.approved_response_text.length === 0) return false;
  try {
    const binding = reservationBinding(value);
    return value.approved_response_digest === approvedResponseDigest(value.approved_response_text) && binding === value.reservation_binding;
  } catch { return false; }
}
function assertApprovedReplyReservationInput(value) { if (!approvedReplyReservationInputValid(value)) fail('APPROVED_REPLY_RESERVATION_INPUT_INVALID'); return deepFreeze(clone(value)); }
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; }

module.exports = { ApprovedReplyReservationInputError, CONTRACT_VERSION, REQUEST_KEYS, approvedReplyReservationInputValid, assertApprovedReplyReservationInput, buildApprovedReplyReservationInput, exactArtifact };
