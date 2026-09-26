'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ApprovedReplyReservationBindingError, CONTRACT_VERSION, DOMAIN, approvedResponseDigest, canonicalReservationBindingPreimage, reservationBinding } = require('../lib/sales-engine-v2/approved-reply-reservation-binding');

function fixture(overrides = {}) {
  const text = overrides.text || 'Hola, José.\n¿Continuamos?';
  return {
    canonical_inbound_message_id: '11111111-1111-4111-8111-000000007501', session_id: 'session-75d0a',
    logical_reply_key: `lrk-${'a'.repeat(64)}`, eligible_response_binding: `pgrsp-${'b'.repeat(64)}`,
    approved_response_digest: approvedResponseDigest(text),
    parts: [{ part_index: 1, part_count: 2, body: 'Hola, José.\n' }, { part_index: 2, part_count: 2, body: '¿Continuamos?' }],
    artifact_projection: null, ...overrides,
  };
}
function changed(input, change) { const copy = structuredClone(input); change(copy); return copy; }

test('Ticket 75D.0A binding is deterministic, UTF-8 stable, and independent of object key order', () => {
  const first = fixture(); const reordered = { parts: first.parts, approved_response_digest: first.approved_response_digest, session_id: first.session_id, logical_reply_key: first.logical_reply_key, canonical_inbound_message_id: first.canonical_inbound_message_id, artifact_projection: first.artifact_projection, eligible_response_binding: first.eligible_response_binding };
  assert.equal(reservationBinding(first), reservationBinding(reordered));
  assert.match(reservationBinding(first), /^rrb-[0-9a-f]{64}$/);
  assert.match(canonicalReservationBindingPreimage(first), /^a9\[/);
  assert.equal(CONTRACT_VERSION, 'ticket-75d0a-reservation-binding-v1'); assert.equal(DOMAIN, 'ticket-75d0a-approved-reply-reservation-v1');
});

test('Ticket 75D.0A binding changes for each physical or approved-reply identity field', () => {
  const base = fixture(); const original = reservationBinding(base);
  const variants = [
    changed(base, v => { v.canonical_inbound_message_id = '11111111-1111-4111-8111-000000007502'; }),
    changed(base, v => { v.approved_response_digest = approvedResponseDigest('Otra respuesta'); }),
    changed(base, v => { v.parts[0].body = 'Otra parte'; }),
    changed(base, v => { v.parts.reverse(); v.parts.forEach((part, index) => { part.part_index = index + 1; }); }),
    changed(base, v => { v.parts = [{ part_index: 1, part_count: 1, body: 'Una sola parte' }]; }),
    changed(base, v => { v.artifact_projection = { artifact_id: `ca-${'c'.repeat(64)}`, artifact_type: 'draft', generation_operation: 'draft', generation_task_id: `cgt-${'d'.repeat(64)}`, ordered_lineage_artifact_ids: [] }; }),
  ];
  for (const variant of variants) assert.notEqual(reservationBinding(variant), original);
});

test('Ticket 75D.0A binding has no caller metadata or delivery/provider-evidence input surface', () => {
  const value = fixture();
  const withJunk = { ...value, provider_message_sid: 'SMsecret', delivery_status: 'sent', metadata: { arbitrary: true } };
  assert.equal(reservationBinding(value), reservationBinding(withJunk));
  assert.equal(Object.hasOwn(value, 'provider_message_sid'), false);
});

test('Ticket 75D.0A rejects incomplete/malformed physical representations rather than repairing them', () => {
  const cases = [
    changed(fixture(), v => { v.parts[1].part_index = 1; }),
    changed(fixture(), v => { v.parts[1].part_count = 1; }),
    changed(fixture(), v => { v.parts[0].body = ''; }),
    changed(fixture(), v => { v.artifact_projection = { artifact_id: 'ca-x', artifact_type: 'draft', generation_operation: 'draft', generation_task_id: 'cgt-x', ordered_lineage_artifact_ids: ['ca-x', 'ca-x'] }; }),
  ];
  for (const value of cases) assert.throws(() => reservationBinding(value), ApprovedReplyReservationBindingError);
});

test('Ticket 75D.0A vector can be checked by PostgreSQL SHA-256 over the same UTF-8 preimage', () => {
  const input = fixture({ text: '¡Ñandú!\r\nLínea dos — €' });
  input.approved_response_digest = approvedResponseDigest('¡Ñandú!\r\nLínea dos — €');
  const preimage = canonicalReservationBindingPreimage(input);
  const digest = crypto.createHash('sha256').update(preimage, 'utf8').digest('hex');
  assert.equal(reservationBinding(input), `rrb-${digest}`);
  assert.ok(Buffer.byteLength(preimage, 'utf8') > preimage.length);
});
