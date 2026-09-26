'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { approvedResponseDigest, reservationBinding } = require('../lib/sales-engine-v2/approved-reply-reservation-binding');
const { ApprovedReplyReservationInputError, approvedReplyReservationInputValid, buildApprovedReplyReservationInput } = require('../lib/sales-engine-v2/approved-reply-reservation-input');
const { buildPostGateDeliveryManifest } = require('../lib/sales-engine-v2/post-gate-delivery-manifest');
const { createConversationContext } = require('../lib/sales-engine-v2/memory-adapter');
const { runSalesEngineV2Turn } = require('../lib/sales-engine-v2/turn-orchestrator');

async function eligible() {
  const conversationContext = createConversationContext({ currentTurn: { id: 'inbound-75d0b', canonical_message_id: '11111111-1111-4111-8111-000000007501', text: 'hola', received_at: '2026-09-26T12:00:00.000Z' }, memory: [], conversationArtifacts: [], runtimeMetadata: { conversation_id: 'c', session_id: 'session-75d0b', channel: 'whatsapp', campaign: 'standard' } });
  const dependencies = { interpreterAdapter: async () => ({ obligations: [{ category: 'social_acknowledgement', current_turn_evidence: 'hola', confidence: 'high', ambiguous: false }] }), factResolver: { resolveFact() { throw new Error('unused'); } }, policyResolver: { resolvePolicy() { throw new Error('unused'); } }, artifactReproductionAssessor: () => ({ findings: [] }), composerAdapter: async request => ({ segments: request.input.obligation_outcomes.map(outcome => ({ obligation_id: outcome.obligation_id, text: 'Respuesta final exacta.\nConserva espacios.' })) }), finalResponseAssessor: () => ({ findings: [] }) };
  const result = await runSalesEngineV2Turn({ conversationContext, dependencies, runContext: { asOf: '2026-09-26T12:00:00.000Z', composerModelRunId: 'model', finalResponseAssessorRunId: 'gate', artifactReproductionAssessorRunId: 'artifact' } });
  return { result, manifest: buildPostGateDeliveryManifest({ turnResult: result }) };
}

test('Ticket75D.0B exact UTF-8 approved-response digests distinguish whitespace, newlines, and Unicode', () => {
  const exact = ' ¡Hola, José!\r\n🙂  fin ';
  assert.equal(approvedResponseDigest(exact), crypto.createHash('sha256').update(exact, 'utf8').digest('hex'));
  for (const altered of ['¡Hola, José!\r\n🙂  fin ', ' ¡Hola, José!\n🙂  fin ', ' ¡Hola, Jose!\r\n🙂  fin ', ' ¡Hola, José!\r\n🙂 fin ']) assert.notEqual(approvedResponseDigest(exact), approvedResponseDigest(altered));
});

test('Ticket75D.0B reservation binding commits to the verified digest while independently binding physical parts', () => {
  const input = { canonical_inbound_message_id: '11111111-1111-4111-8111-000000007501', session_id: 's', logical_reply_key: `lrk-${'a'.repeat(64)}`, eligible_response_binding: `pgrsp-${'b'.repeat(64)}`, approved_response_digest: approvedResponseDigest('Texto aprobado'), parts: [{ part_index: 1, part_count: 2, body: 'Formato ' }, { part_index: 2, part_count: 2, body: 'físico' }], artifact_projection: null };
  const binding = reservationBinding(input);
  assert.notEqual(input.parts.map(part => part.body).join(''), 'Texto aprobado');
  assert.notEqual(reservationBinding({ ...input, approved_response_digest: approvedResponseDigest('Otro texto') }), binding);
  assert.notEqual(reservationBinding({ ...input, parts: [{ ...input.parts[0], body: 'Otro ' }, input.parts[1]] }), binding);
});

test('Ticket75D.0B recovery fixture has one exact source on every existing multipart row', () => {
  const source = 'Texto Ticket67\nexacto'; const hash = approvedResponseDigest(source);
  const rows = [{ assistant_response: source, metadata: { recovery_source_hash: hash, part_index: 1, part_count: 2 } }, { assistant_response: source, metadata: { recovery_source_hash: hash, part_index: 2, part_count: 2 } }];
  for (const row of rows) assert.equal(approvedResponseDigest(row.assistant_response), row.metadata.recovery_source_hash);
});

test('Ticket75D.0B source field is required before the future RPC and cannot be inferred from physical parts', () => {
  const source = 'Texto aprobado\ncon delimitador'; const parts = [{ part_index: 1, part_count: 2, body: 'Texto aprobado' }, { part_index: 2, part_count: 2, body: 'con delimitador' }];
  assert.notEqual(parts.map(part => part.body).join(''), source);
  assert.equal(approvedResponseDigest(source), approvedResponseDigest(source));
});

test('Ticket75D.0B only emits a closed request from a Ticket68A-eligible final response', async () => {
  const { result, manifest } = await eligible();
  const input = buildApprovedReplyReservationInput({ turnResult: result, manifest, session_id: 'session-75d0b', processing_owner: 'worker-75d0b', parts: [{ part_index: 1, part_count: 1, body: 'Formato físico distinto' }] });
  assert.equal(input.approved_response_text, result.customer_response.text);
  assert.equal(input.approved_response_digest, approvedResponseDigest(result.customer_response.text));
  assert.equal(approvedReplyReservationInputValid(input), true);
  assert.deepEqual(Object.keys(input).sort(), ['approved_response_digest', 'approved_response_text', 'artifact_projection', 'canonical_inbound_message_id', 'contract_version', 'eligible_response_binding', 'logical_reply_key', 'parts', 'processing_owner', 'reservation_binding', 'session_id']);
  const blocked = { ...result, status: 'response_ineligible' };
  assert.throws(() => buildApprovedReplyReservationInput({ turnResult: blocked, manifest, session_id: 'session-75d0b', processing_owner: 'worker', parts: input.parts }), ApprovedReplyReservationInputError);
});
