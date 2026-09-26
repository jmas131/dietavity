'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const facts = require('../config/sales-engine-v2/product-fact-authority.json');
const knowledge = require('../config/sales-engine-v2/reviewed-nutrition-knowledge.json');
const { CanonicalInputError, createCanonicalInputAdapter } = require('../lib/sales-engine-v2/canonical-input-adapters');
const { createSupabaseCanonicalReader } = require('../lib/sales-engine-v2/supabase-canonical-reader');

const inboundId = '11111111-1111-4111-8111-000000000075';
const anchorId = '11111111-1111-4111-8111-000000000076';
const sourceAnchorId = '11111111-1111-4111-8111-000000000077';
const request = { canonical_inbound_message_id: inboundId, session_id: 'session-75' };

function ok(data) { return { data, error: null }; }
function fakeSupabase(responses) {
  const calls = [];
  return { calls, from(table) {
    const response = (responses[table] || []).shift() || ok([]); const call = { table, actions: [] }; calls.push(call);
    const query = {
      select(value) { call.actions.push(['select', value]); return query; }, eq(...value) { call.actions.push(['eq', ...value]); return query; }, in(...value) { call.actions.push(['in', ...value]); return query; }, order(...value) { call.actions.push(['order', ...value]); return query; }, limit(value) { call.actions.push(['limit', value]); return query; }, maybeSingle() { call.actions.push(['maybeSingle']); return query; }, abortSignal(signal) { call.actions.push(['abortSignal', signal]); return query; }, then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
    }; return query;
  } };
}
function callsFor(client, table) { return client.calls.filter(call => call.table === table); }

test('T75B.1b projects typed Ticket17A lineage and ordered multipart bodies without prose inference', async () => {
  const client = fakeSupabase({
    messages: [
      ok({ id: inboundId, provider_message_sid: 'SMcurrent', body: 'Mensaje actual', timestamp: '2026-09-26T12:00:00.000Z', direction: 'inbound', session_id: 'session-75' }),
      ok([{ id: anchorId, provider_message_sid: 'SManchor', body: 'Parte uno', timestamp: '2026-09-26T11:00:00.000Z', direction: 'outbound', in_reply_to_id: inboundId, metadata: {}, idempotency_key: 'reply-1', delivery_status: 'delivered' }]),
      ok([
        { id: anchorId, direction: 'outbound', body: 'Parte uno', timestamp: '2026-09-26T11:00:00.000Z', idempotency_key: 'reply-1', metadata: { logical_reply_key: 'reply-1', part_index: 1, part_count: 2 } },
        { id: '11111111-1111-4111-8111-000000000078', direction: 'outbound', body: 'Parte dos', timestamp: '2026-09-26T11:00:01.000Z', idempotency_key: 'reply-1:part:002', metadata: { logical_reply_key: 'reply-1', part_index: 2, part_count: 2 } },
      ]),
    ],
    onboarding_chat_memory: [ok([])], onboarding_sessions: [ok({ session_id: 'session-75', offer_version: '28d-149-v1' })],
    conversation_artifacts: [ok([{ artifact_id: 'ca-summary-1', artifact_type: 'summary', generation_operation: 'summarize', generation_task_id: 'cgt-1', logical_reply_key: 'reply-1', anchor_message_id: anchorId }])],
    conversation_artifact_lineage: [ok([])],
  });
  const source = await createSupabaseCanonicalReader({ supabase: client }).readContext({ canonicalInboundMessageId: inboundId, sessionId: 'session-75' });
  assert.deepEqual(source.conversationArtifacts, [{ artifact: { contract_version: '1.0', artifact_id: 'ca-summary-1', artifact_type: 'summary', generation_operation: 'summarize', generation_task_id: 'cgt-1', logical_reply_key: 'reply-1', anchor_message_id: anchorId }, lineage: [], messages: [
    { id: anchorId, direction: 'outbound', body: 'Parte uno', timestamp: '2026-09-26T11:00:00.000Z', idempotency_key: 'reply-1', metadata: { logical_reply_key: 'reply-1', part_index: 1, part_count: 2 } },
    { id: '11111111-1111-4111-8111-000000000078', direction: 'outbound', body: 'Parte dos', timestamp: '2026-09-26T11:00:01.000Z', idempotency_key: 'reply-1:part:002', metadata: { logical_reply_key: 'reply-1', part_index: 2, part_count: 2 } },
  ] }]);
  assert.equal(callsFor(client, 'conversation_artifacts')[0].actions[0][1], 'artifact_id,artifact_type,generation_operation,generation_task_id,logical_reply_key,anchor_message_id');
  assert.equal(callsFor(client, 'conversation_artifact_lineage')[0].actions[0][1], 'artifact_id,source_artifact_id,position');
  assert.equal(callsFor(client, 'messages')[2].actions[0][1], 'id,direction,body,timestamp,idempotency_key,metadata');
});

test('T75B.1b preserves transitive lineage and leaves incomplete, cyclic, or malformed projection to Ticket60A', async () => {
  const current = ok({ id: inboundId, provider_message_sid: 'SMcurrent', body: 'Actual', timestamp: '2026-09-26T12:00:00.000Z' });
  const history = ok([{ id: anchorId, timestamp: '2026-09-26T11:00:00.000Z', direction: 'outbound', body: 'x', in_reply_to_id: inboundId, metadata: {}, idempotency_key: 'reply-2', delivery_status: 'delivered' }]);
  const client = fakeSupabase({
    messages: [current, history, ok([{ id: anchorId, direction: 'outbound', body: 'Incomplete', timestamp: '2026-09-26T11:00:00.000Z', idempotency_key: 'reply-2', metadata: { logical_reply_key: 'reply-2', part_index: 1, part_count: 2 } }])],
    onboarding_chat_memory: [ok([])], onboarding_sessions: [ok({ session_id: 'session-75', offer_version: '28d-149-v1' })],
    conversation_artifacts: [ok([{ artifact_id: 'ca-summary-2', artifact_type: 'summary', generation_operation: 'summarize', generation_task_id: 'cgt-2', logical_reply_key: 'reply-2', anchor_message_id: anchorId }]), ok([{ artifact_id: 'ca-draft-2', artifact_type: 'draft', generation_operation: 'draft', generation_task_id: 'cgt-3', logical_reply_key: 'reply-3', anchor_message_id: sourceAnchorId }])],
    conversation_artifact_lineage: [ok([{ artifact_id: 'ca-summary-2', source_artifact_id: 'ca-draft-2', position: 1 }]), ok([{ artifact_id: 'ca-draft-2', source_artifact_id: 'ca-summary-2', position: 1 }])],
  });
  const reader = createSupabaseCanonicalReader({ supabase: client });
  const source = await reader.readContext({ canonicalInboundMessageId: inboundId, sessionId: 'session-75' });
  assert.equal(source.conversationArtifacts[0].lineage[0].position, 1);
  assert.equal(source.conversationArtifacts.some(record => record.artifact.artifact_id === 'ca-draft-2'), true);
  const incomplete = { ...source, runtimeMetadata: { ...source.runtimeMetadata } };
  const adapterReader = { async readContext() { return incomplete; }, async readFactAuthority() { return factRows(); }, async readKnowledgeAuthority() { return knowledgeRows(); } };
  await assert.rejects(() => createCanonicalInputAdapter({ reader: adapterReader }).build({ request, claim: {} }), error => error.code === 'context_invalid');
});

function factRows() { return facts.authority_sets.flatMap(set => set.facts.map(fact => ({ ...fact, authority_set_id: set.authority_set_id, authority_version: set.authority_version, status: set.status, scope: set.scope }))); }
function knowledgeRows() { return knowledge.knowledge_sets.map(set => ({ ...set, created_at: '2026-09-01T00:00:00.000Z', records: set.records })); }
function context(offerVersion) { return { currentTurn: { id: 'SMcurrent', canonical_message_id: inboundId, text: 'Hola', received_at: '2026-09-26T12:00:00.000Z' }, memory: [], conversationArtifacts: [], runtimeMetadata: { conversation_id: 'session-75', session_id: 'session-75', channel: 'whatsapp', offer_version: offerVersion } }; }
function authorityReader(offerVersion, rows = factRows()) { return { async readContext() { return context(offerVersion); }, async readFactAuthority() { return rows; }, async readKnowledgeAuthority() { return knowledgeRows(); } }; }

test('T75B.1b represents provider and offer authority independently without offer defaults', async () => {
  const absent = await createCanonicalInputAdapter({ reader: authorityReader(null) }).build({ request, claim: {} });
  assert.deepEqual(absent.conversation_context.offer_context, {});
  assert.equal(absent.product_fact_authority_scope.provider.status, 'available');
  assert.deepEqual(absent.product_fact_authority_scope.offer, { status: 'unresolved', reason: 'canonical_offer_binding_absent', offer_version: null });
  const known = await createCanonicalInputAdapter({ reader: authorityReader('28d-149-v1') }).build({ request, claim: {} });
  assert.deepEqual(known.product_fact_authority_scope.offer, { status: 'available', offer_version: '28d-149-v1' });
  const unknown = await createCanonicalInputAdapter({ reader: authorityReader('future-offer-v1') }).build({ request, claim: {} });
  assert.deepEqual(unknown.product_fact_authority_scope.offer, { status: 'unresolved', reason: 'reviewed_offer_authority_absent', offer_version: 'future-offer-v1' });
  assert.equal(Object.isFrozen(absent.product_fact_authority_scope), true);
});

test('T75B.1b keeps unavailable and malformed authority distinct from unresolved offer scope', async () => {
  await assert.rejects(() => createCanonicalInputAdapter({ reader: authorityReader(null, [{ authority_set_id: 'bad' }]) }).build({ request, claim: {} }), error => error.code === 'authority_unavailable');
  const outage = authorityReader(null); outage.readFactAuthority = async () => { throw new CanonicalInputError('authority_unavailable'); };
  await assert.rejects(() => createCanonicalInputAdapter({ reader: outage }).build({ request, claim: {} }), error => error.code === 'authority_unavailable');
});

test('T75B.1b normalizes artifact query failure and aborts before any artifact read', async () => {
  const client = fakeSupabase({
    messages: [ok({ id: inboundId, provider_message_sid: 'SMcurrent', body: 'Actual', timestamp: '2026-09-26T12:00:00.000Z' }), ok([{ id: anchorId, timestamp: '2026-09-26T11:00:00.000Z', direction: 'outbound', body: 'x', in_reply_to_id: inboundId, metadata: {}, idempotency_key: 'reply', delivery_status: 'delivered' }])],
    onboarding_chat_memory: [ok([])], onboarding_sessions: [ok({ session_id: 'session-75', offer_version: null })],
    conversation_artifacts: [{ data: null, error: new Error('artifact database details') }],
  });
  await assert.rejects(() => createSupabaseCanonicalReader({ supabase: client }).readContext({ canonicalInboundMessageId: inboundId, sessionId: 'session-75' }), error => error.code === 'authority_unavailable' && !/artifact database details/.test(error.message));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => createSupabaseCanonicalReader({ supabase: fakeSupabase({}) }).readContext({ canonicalInboundMessageId: inboundId, sessionId: 'session-75', signal: controller.signal }), error => error.code === 'deadline_exceeded');
});
