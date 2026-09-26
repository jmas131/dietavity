'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HISTORY_QUERY_LIMIT,
  CLAIM_COLUMNS,
  REPLY_COLUMNS,
  CURRENT_COLUMNS,
  CANONICAL_HISTORY_COLUMNS,
  LEGACY_HISTORY_COLUMNS,
  SESSION_COLUMNS,
  FACT_SET_COLUMNS,
  FACT_RECORD_COLUMNS,
  KNOWLEDGE_SET_COLUMNS,
  KNOWLEDGE_RECORD_COLUMNS,
  createSupabaseCanonicalReader,
} = require('../lib/sales-engine-v2/supabase-canonical-reader');

const inboundId = '11111111-1111-4111-8111-000000000075';

function fakeSupabase(responses) {
  const calls = [];
  return {
    calls,
    from(table) {
      const response = (responses[table] || []).shift();
      const call = { table, actions: [] };
      calls.push(call);
      const query = {
        select(value) { call.actions.push(['select', value]); return query; },
        eq(...value) { call.actions.push(['eq', ...value]); return query; },
        in(...value) { call.actions.push(['in', ...value]); return query; },
        order(...value) { call.actions.push(['order', ...value]); return query; },
        limit(value) { call.actions.push(['limit', value]); return query; },
        maybeSingle() { call.actions.push(['maybeSingle']); return query; },
        abortSignal(signal) { call.actions.push(['abortSignal', signal]); return query; },
        then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
      };
      return query;
    },
  };
}

function ok(data) { return { data, error: null }; }
function call(client, table, index = 0) { return client.calls.filter(item => item.table === table)[index]; }
function action(query, name) { return query.actions.find(item => item[0] === name); }

test('T75B.1a readClaim uses explicit projections and bounded outbound sibling evidence', async () => {
  const client = fakeSupabase({
    messages: [ok({ id: inboundId, direction: 'inbound', session_id: 'session-75', processing_owner: 'owner', processing_lease_until: '2026-09-26T12:05:00.000Z', processing_completed_at: null, processing_order: 4 }), ok([])],
  });
  const reader = createSupabaseCanonicalReader({ supabase: client });
  const result = await reader.readClaim({ canonicalInboundMessageId: inboundId });
  assert.equal(result.has_outbound_reply, false);
  assert.equal(action(call(client, 'messages', 0), 'select')[1], CLAIM_COLUMNS);
  assert.deepEqual(action(call(client, 'messages', 0), 'eq'), ['eq', 'id', inboundId]);
  assert.equal(action(call(client, 'messages', 1), 'select')[1], REPLY_COLUMNS);
  assert.deepEqual(call(client, 'messages', 1).actions.filter(item => item[0] === 'eq'), [['eq', 'in_reply_to_id', inboundId], ['eq', 'direction', 'outbound']]);
  assert.deepEqual(action(call(client, 'messages', 1), 'limit'), ['limit', 1]);
  const repliedClient = fakeSupabase({ messages: [ok({ id: inboundId }), ok([{ id: 'reply' }])] });
  assert.equal((await createSupabaseCanonicalReader({ supabase: repliedClient }).readClaim({ canonicalInboundMessageId: inboundId })).has_outbound_reply, true);
});

test('T75B.1a readContext projects bounded, timestamp-ordered history and exact offer state', async () => {
  const client = fakeSupabase({
    messages: [
      ok({ id: inboundId, provider_message_sid: 'SMcurrent', body: 'Hola', timestamp: '2026-09-26T12:00:00.000Z', direction: 'inbound', session_id: 'session-75' }),
      ok([
        { id: 'out-later', provider_message_sid: 'SMlater', body: 'Final', timestamp: '2026-09-26T11:30:00.000Z', direction: 'outbound', in_reply_to_id: inboundId, metadata: {}, idempotency_key: 'later', delivery_status: 'delivered' },
        { id: 'out-failed', provider_message_sid: 'SMfailed', body: 'No', timestamp: '2026-09-26T11:20:00.000Z', direction: 'outbound', in_reply_to_id: inboundId, metadata: {}, idempotency_key: 'failed', delivery_status: 'failed' },
        { id: 'out-earlier', provider_message_sid: null, body: 'Earlier', timestamp: '2026-09-26T11:10:00.000Z', direction: 'outbound', in_reply_to_id: inboundId, metadata: {}, idempotency_key: 'earlier', delivery_status: 'sent' },
      ]),
    ],
    onboarding_chat_memory: [ok([{ id: 'legacy-later', session_id: 'session-75', created_at: '2026-09-26T11:40:00.000Z', updated_at: '2026-09-26T11:40:00.000Z', message: { type: 'ai', content: 'Legacy' } }])],
    onboarding_sessions: [ok({ session_id: 'session-75', offer_version: null })],
  });
  const result = await createSupabaseCanonicalReader({ supabase: client }).readContext({ canonicalInboundMessageId: inboundId, sessionId: 'session-75' });
  assert.deepEqual(result.currentTurn, { id: 'SMcurrent', canonical_message_id: inboundId, text: 'Hola', received_at: '2026-09-26T12:00:00.000Z' });
  assert.deepEqual(result.memory.slice(0, 2).map(item => item.source_id), ['out-earlier', 'SMlater']);
  assert.equal(result.memory[2].id, 'legacy-later');
  assert.equal(result.runtimeMetadata.offer_version, null);
  assert.equal('offer_version' in result.runtimeMetadata, true);
  assert.deepEqual(result.conversationArtifacts, []);
  assert.equal(action(call(client, 'messages', 0), 'select')[1], CURRENT_COLUMNS);
  assert.equal(action(call(client, 'messages', 1), 'select')[1], CANONICAL_HISTORY_COLUMNS);
  assert.deepEqual(action(call(client, 'messages', 1), 'order'), ['order', 'timestamp', { ascending: false }]);
  assert.deepEqual(action(call(client, 'messages', 1), 'limit'), ['limit', HISTORY_QUERY_LIMIT]);
  assert.equal(action(call(client, 'onboarding_chat_memory'), 'select')[1], LEGACY_HISTORY_COLUMNS);
  assert.deepEqual(action(call(client, 'onboarding_chat_memory'), 'limit'), ['limit', HISTORY_QUERY_LIMIT]);
  assert.equal(action(call(client, 'onboarding_sessions'), 'select')[1], SESSION_COLUMNS);
});

test('T75B.1a reader normalizes database failures and aborts without exposing database errors', async () => {
  const failed = createSupabaseCanonicalReader({ supabase: fakeSupabase({ messages: [{ data: null, error: new Error('database details') }] }) });
  await assert.rejects(() => failed.readClaim({ canonicalInboundMessageId: inboundId }), error => error.code === 'authority_unavailable' && !/database details/.test(error.message));
  const controller = new AbortController(); controller.abort();
  const reader = createSupabaseCanonicalReader({ supabase: fakeSupabase({}) });
  await assert.rejects(() => reader.readKnowledgeAuthority({ locale: 'es-MX', signal: controller.signal }), error => error.code === 'deadline_exceeded');
});

test('T75B.1a context and both authority reads fail closed on database errors and aborts', async () => {
  const unavailable = error => error.code === 'authority_unavailable';
  await assert.rejects(
    () => createSupabaseCanonicalReader({ supabase: fakeSupabase({ messages: [{ data: null, error: new Error('context database failure') }] }) }).readContext({ canonicalInboundMessageId: inboundId, sessionId: 'session-75' }),
    unavailable,
  );
  await assert.rejects(
    () => createSupabaseCanonicalReader({ supabase: fakeSupabase({ product_fact_authority_sets: [{ data: null, error: new Error('facts database failure') }] }) }).readFactAuthority(),
    unavailable,
  );
  await assert.rejects(
    () => createSupabaseCanonicalReader({ supabase: fakeSupabase({ reviewed_nutrition_knowledge_sets: [{ data: null, error: new Error('knowledge database failure') }] }) }).readKnowledgeAuthority({ locale: 'es-MX' }),
    unavailable,
  );
  for (const method of [
    reader => reader.readContext({ canonicalInboundMessageId: inboundId, sessionId: 'session-75' }),
    reader => reader.readFactAuthority(),
    reader => reader.readKnowledgeAuthority({ locale: 'es-MX' }),
  ]) {
    const controller = new AbortController(); controller.abort();
    const reader = createSupabaseCanonicalReader({ supabase: fakeSupabase({}) });
    await assert.rejects(() => method({ ...reader, readContext: args => reader.readContext({ ...args, signal: controller.signal }), readFactAuthority: () => reader.readFactAuthority({ signal: controller.signal }), readKnowledgeAuthority: args => reader.readKnowledgeAuthority({ ...args, signal: controller.signal }) }), error => error.code === 'deadline_exceeded');
  }
});

test('T75B.1a Ticket71 and Ticket72 reads use only their explicit authority projections', async () => {
  const client = fakeSupabase({
    product_fact_authority_sets: [ok([{ authority_set_id: 'provider-v1', authority_version: '1', status: 'reviewed_active', scope: { scope_type: 'provider' } }])],
    product_fact_authority_records: [ok([{ fact_id: 'fact-1', authority_set_id: 'provider-v1', fact_key: 'service.glp1_medication_sale', state: 'known_false', value_type: 'boolean', value: false }])],
    reviewed_nutrition_knowledge_sets: [ok([{ knowledge_set_id: 'knowledge-v1', knowledge_version: '1', locale: 'es-MX', status: 'reviewed_active', created_at: '2026-09-01T00:00:00.000Z' }])],
    reviewed_nutrition_knowledge_records: [ok([{ knowledge_id: 'knowledge-1', knowledge_set_id: 'knowledge-v1', knowledge_domain: 'nutrition_practical', topic: 'food_storage', task_kinds: ['knowledge_question'], applicable_input_types: [], content: 'Contenido', provenance: { source_class: 'architectural_seed', reference: 'test' } }])],
  });
  const reader = createSupabaseCanonicalReader({ supabase: client });
  assert.deepEqual(await reader.readFactAuthority(), [{ authority_set_id: 'provider-v1', authority_version: '1', status: 'reviewed_active', scope: { scope_type: 'provider' }, fact_id: 'fact-1', fact_key: 'service.glp1_medication_sale', state: 'known_false', value_type: 'boolean', value: false }]);
  assert.equal(action(call(client, 'product_fact_authority_sets'), 'select')[1], FACT_SET_COLUMNS);
  assert.equal(action(call(client, 'product_fact_authority_records'), 'select')[1], FACT_RECORD_COLUMNS);
  assert.deepEqual(action(call(client, 'product_fact_authority_records'), 'in'), ['in', 'authority_set_id', ['provider-v1']]);
  const knowledge = await reader.readKnowledgeAuthority({ locale: 'es-MX' });
  assert.equal(knowledge[0].records[0].knowledge_id, 'knowledge-1');
  assert.equal(action(call(client, 'reviewed_nutrition_knowledge_sets'), 'select')[1], KNOWLEDGE_SET_COLUMNS);
  assert.deepEqual(action(call(client, 'reviewed_nutrition_knowledge_sets'), 'eq'), ['eq', 'locale', 'es-MX']);
  assert.equal(action(call(client, 'reviewed_nutrition_knowledge_records'), 'select')[1], KNOWLEDGE_RECORD_COLUMNS);
});

test('T75B.1a reader has exactly four read methods and no generic or write surface', () => {
  const reader = createSupabaseCanonicalReader({ supabase: fakeSupabase({}) });
  assert.deepEqual(Object.keys(reader).sort(), ['readClaim', 'readContext', 'readFactAuthority', 'readKnowledgeAuthority']);
  const source = require('node:fs').readFileSync(require.resolve('../lib/sales-engine-v2/supabase-canonical-reader'), 'utf8');
  assert.doesNotMatch(source, /select\(\s*['"]\*['"]\s*\)|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
  assert.doesNotMatch(source, /SUPABASE_(?:URL|SERVICE_ROLE_KEY)|console\.(?:log|error|warn)/);
});
