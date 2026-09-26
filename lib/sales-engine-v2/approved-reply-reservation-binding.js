'use strict';

// Ticket 75D.0A: this is a persistence-consistency binding, not a semantic
// approval capability.  Ticket 68A remains the owner of semantic approval.
const crypto = require('node:crypto');

const CONTRACT_VERSION = 'ticket-75d0a-reservation-binding-v1';
const DOMAIN = 'ticket-75d0a-approved-reply-reservation-v1';
const PREFIX = 'rrb';

class ApprovedReplyReservationBindingError extends Error {
  constructor(code) { super(code); this.name = 'ApprovedReplyReservationBindingError'; this.code = code; }
}

function fail(code) { throw new ApprovedReplyReservationBindingError(code); }
function string(value, code) { if (typeof value !== 'string' || value.length === 0) fail(code); return value; }
function uuid(value, code) {
  value = string(value, code).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) fail(code);
  return value;
}
function digest(value, code) { value = string(value, code); if (!/^[0-9a-f]{64}$/.test(value)) fail(code); return value; }
function binding(value, prefix, code) { value = string(value, code); if (!new RegExp(`^${prefix}-[0-9a-f]{64}$`).test(value)) fail(code); return value; }

// An explicit UTF-8 byte-length grammar avoids JSON object ordering and
// PostgreSQL jsonb whitespace/escaping differences.  Scalars are s<bytes>:<UTF8>
// or z for null; lists are a<count>[<encoded members>].
function scalar(value) {
  if (value === null) return 'z';
  if (typeof value !== 'string') fail('RESERVATION_BINDING_SCALAR_INVALID');
  return `s${Buffer.byteLength(value, 'utf8')}:${value}`;
}
function list(values) {
  if (!Array.isArray(values)) fail('RESERVATION_BINDING_LIST_INVALID');
  return `a${values.length}[${values.join('')}]`;
}
function integer(value, code) { if (!Number.isInteger(value) || value < 1 || value > 999) fail(code); return value; }
function encodedPart(part, expectedCount) {
  if (!part || typeof part !== 'object' || Array.isArray(part)) fail('RESERVATION_BINDING_PART_INVALID');
  const index = integer(part.part_index, 'RESERVATION_BINDING_PART_INDEX_INVALID');
  const count = integer(part.part_count, 'RESERVATION_BINDING_PART_COUNT_INVALID');
  if (count !== expectedCount || index > count || typeof part.body !== 'string' || part.body.length === 0) fail('RESERVATION_BINDING_PART_INVALID');
  return list([scalar(String(index)), scalar(String(count)), scalar(part.body)]);
}
function encodedArtifact(artifact) {
  if (artifact === null || artifact === undefined) return scalar(null);
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) fail('RESERVATION_BINDING_ARTIFACT_INVALID');
  const ids = artifact.ordered_lineage_artifact_ids;
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) fail('RESERVATION_BINDING_ARTIFACT_INVALID');
  return list([
    scalar(string(artifact.artifact_id, 'RESERVATION_BINDING_ARTIFACT_INVALID')),
    scalar(string(artifact.artifact_type, 'RESERVATION_BINDING_ARTIFACT_INVALID')),
    scalar(string(artifact.generation_operation, 'RESERVATION_BINDING_ARTIFACT_INVALID')),
    scalar(string(artifact.generation_task_id, 'RESERVATION_BINDING_ARTIFACT_INVALID')),
    list(ids.map(id => scalar(string(id, 'RESERVATION_BINDING_ARTIFACT_INVALID')))),
  ]);
}

function canonicalReservationBindingPreimage({ canonical_inbound_message_id, session_id, logical_reply_key, eligible_response_binding, approved_response_digest, parts, artifact_projection = null } = {}) {
  const inbound = uuid(canonical_inbound_message_id, 'RESERVATION_BINDING_INBOUND_INVALID');
  const session = string(session_id, 'RESERVATION_BINDING_SESSION_INVALID');
  const logical = binding(logical_reply_key, 'lrk', 'RESERVATION_BINDING_LOGICAL_REPLY_INVALID');
  const eligible = binding(eligible_response_binding, 'pgrsp', 'RESERVATION_BINDING_ELIGIBLE_RESPONSE_INVALID');
  const response = digest(approved_response_digest, 'RESERVATION_BINDING_RESPONSE_DIGEST_INVALID');
  if (!Array.isArray(parts) || parts.length === 0 || parts.length > 999) fail('RESERVATION_BINDING_PARTS_INVALID');
  const count = parts.length;
  const ordered = [...parts].sort((a, b) => a.part_index - b.part_index);
  if (ordered.some((part, index) => part.part_index !== index + 1)) fail('RESERVATION_BINDING_PARTS_INVALID');
  return list([
    scalar(DOMAIN), scalar(CONTRACT_VERSION), scalar(inbound), scalar(session), scalar(logical), scalar(eligible), scalar(response),
    list(ordered.map(part => encodedPart(part, count))), encodedArtifact(artifact_projection),
  ]);
}

function approvedResponseDigest(text) {
  return crypto.createHash('sha256').update(string(text, 'RESERVATION_BINDING_RESPONSE_TEXT_INVALID'), 'utf8').digest('hex');
}
function reservationBinding(input) {
  return `${PREFIX}-${crypto.createHash('sha256').update(canonicalReservationBindingPreimage(input), 'utf8').digest('hex')}`;
}

module.exports = { ApprovedReplyReservationBindingError, CONTRACT_VERSION, DOMAIN, PREFIX, approvedResponseDigest, canonicalReservationBindingPreimage, reservationBinding };
