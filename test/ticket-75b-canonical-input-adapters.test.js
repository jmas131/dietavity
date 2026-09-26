'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const facts = require('../config/sales-engine-v2/product-fact-authority.json');
const knowledge = require('../config/sales-engine-v2/reviewed-nutrition-knowledge.json');
const { createCanonicalClaimVerifier, createCanonicalInputAdapter } = require('../lib/sales-engine-v2/canonical-input-adapters');
const id = '11111111-1111-4111-8111-000000000075';
const request = { canonical_inbound_message_id: id, session_id: 'session-75', processing_owner: 'owner-75', claimed_lease_until: '2026-09-26T12:05:00.000Z' };
function rows() { return facts.authority_sets.flatMap(set => set.facts.map(fact => ({ ...fact, authority_set_id: set.authority_set_id, authority_version: set.authority_version, status: set.status, scope: set.scope }))); }
function reader(overrides = {}) { return { async readClaim() { return { id, direction: 'inbound', session_id: 'session-75', processing_owner: 'owner-75', processing_lease_until: '2026-09-26T12:05:00.000Z', processing_completed_at: null, has_outbound_reply: false }; }, async readContext() { return { currentTurn: { id: 'SM75', canonical_message_id: id, text: 'Hola', received_at: '2026-09-26T12:00:00.000Z' }, memory: [{ source_id: 'm1', role: 'assistant', text: '¿En qué te ayudo?', occurred_at: '2026-09-26T11:00:00.000Z' }], conversationArtifacts: [], runtimeMetadata: { conversation_id: 'conversation-75', session_id: 'session-75', channel: 'whatsapp', offer_version: '28d-149-v1' } }; }, async readFactAuthority() { return rows(); }, async readKnowledgeAuthority() { return knowledge.knowledge_sets.map(set => ({ ...set, created_at: '2026-09-01T00:00:00.000Z', records: set.records })); }, ...overrides }; }
test('canonical claim verifier validates Ticket17 state without trusting request lease', async () => {
  const verifier = createCanonicalClaimVerifier({ reader: reader(), now: () => Date.parse('2026-09-26T12:01:00.000Z') }); assert.equal((await verifier({ request, signal: undefined })).status, 'valid');
  for (const patch of [{ direction: 'outbound' }, { session_id: 'wrong' }, { processing_owner: 'wrong' }, { processing_lease_until: null }, { processing_lease_until: '2026-09-26T11:00:00.000Z' }, { processing_completed_at: '2026-09-26T11:00:00.000Z' }, { has_outbound_reply: true }]) { const value = await createCanonicalClaimVerifier({ reader: reader({ async readClaim() { return { ...(await reader().readClaim()), ...patch }; } }), now: () => Date.parse('2026-09-26T12:01:00.000Z') })({ request }); assert.equal(value.status, 'invalid'); }
});
test('input bundle creates existing ConversationContext and validated authority snapshots', async () => {
  const adapter = createCanonicalInputAdapter({ reader: reader() }); const bundle = await adapter.build({ request, claim: { canonical_inbound_message_id: id }, signal: undefined });
  assert.equal(bundle.conversation_context.current_message.canonical_message_id, id); assert.equal(bundle.conversation_context.history.length, 1); assert.equal(bundle.product_fact_authority.authority_contract_version, 'ticket-71-v1'); assert.ok(bundle.reviewed_knowledge_authority.store.retrieve({ topic: 'food_storage', locale: 'es-MX', allowedUse: 'knowledge_question', asOf: '2026-09-26T12:00:00.000Z' })); assert.equal(Object.isFrozen(bundle), true);
});
test('adapter fails closed for ambiguous chronology, malformed artifacts, unavailable and unresolved authority, and abort', async () => {
  const ambiguous = reader({ async readContext() { const value = await reader().readContext(); value.memory.push({ source_id: 'm2', role: 'customer', text: 'x', occurred_at: value.memory[0].occurred_at }); return value; } });
  await assert.rejects(() => createCanonicalInputAdapter({ reader: ambiguous }).build({ request, claim: {}, signal: undefined }), /context_invalid/);
  await assert.rejects(() => createCanonicalInputAdapter({ reader: reader({ async readFactAuthority() { throw new Error('db'); } }) }).build({ request, claim: {}, signal: undefined }), /context_invalid/);
  await assert.rejects(() => createCanonicalInputAdapter({ reader: reader({ async readKnowledgeAuthority() { return []; } }) }).build({ request, claim: {}, signal: undefined }), /authority_unresolved/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(() => createCanonicalClaimVerifier({ reader: reader() })({ request, signal: controller.signal }), /deadline_exceeded/);
});
