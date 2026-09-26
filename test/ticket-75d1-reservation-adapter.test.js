'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { approvedResponseDigest, reservationBinding } = require('../lib/sales-engine-v2/approved-reply-reservation-binding');
const { ApprovedReplyReservationAdapterError, createSupabaseApprovedReplyReservationAdapter } = require('../lib/sales-engine-v2/approved-reply-reservation-adapter');

function input() {
  const value = { contract_version: 'ticket-75d1-v1', canonical_inbound_message_id: '11111111-1111-4111-8111-000000007501', session_id: 's', processing_owner: 'owner', logical_reply_key: `lrk-${'a'.repeat(64)}`, eligible_response_binding: `pgrsp-${'b'.repeat(64)}`, approved_response_text: 'Texto exacto', approved_response_digest: approvedResponseDigest('Texto exacto'), parts: [{ part_index: 1, part_count: 1, body: 'parte física' }], artifact_projection: null };
  value.reservation_binding = reservationBinding(value); return value;
}
test('T75D.1 Node adapter submits only the closed request to the reservation RPC', async () => {
  const calls = [];
  const adapter = createSupabaseApprovedReplyReservationAdapter({ supabase: { rpc(name, args) { calls.push([name, args]); return Promise.resolve({ data: { state: 'reserved_new', physical_logical_reply_key: 'reply:SMx:paid', messages: [{ id: 'x' }] }, error: null }); } } });
  const result = await adapter.reserve(input());
  assert.equal(result.state, 'reserved_new'); assert.equal(calls[0][0], 'reserve_v2_approved_logical_reply'); assert.deepEqual(Object.keys(calls[0][1]), ['p']);
});
test('T75D.1 Node adapter rejects malformed request and ambiguous RPC output', async () => {
  const adapter = createSupabaseApprovedReplyReservationAdapter({ supabase: { rpc() { return Promise.resolve({ data: null, error: { message: 'no' } }); } } });
  await assert.rejects(() => adapter.reserve({}), /APPROVED_REPLY_RESERVATION_INPUT_INVALID/);
  await assert.rejects(() => adapter.reserve(input()), ApprovedReplyReservationAdapterError);
});
