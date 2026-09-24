'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationContextError, validateConversationContext } = require('../lib/sales-engine-v2/conversation-context-validator');
const { createConversationContext, normalizeOnboardingChatMemoryRow } = require('../lib/sales-engine-v2/memory-adapter');

const currentTurn = { id: 'inbound-3', canonical_message_id: '11111111-1111-4111-8111-000000000003', text: '¿Cuánto cuesta?', received_at: '2026-09-22T12:00:00.000Z' };
const runtimeMetadata = { conversation_id: 'conversation-1', session_id: 'session-opaque-1', channel: 'whatsapp', offer_version: '28d-149-v1', campaign: 'standard', commercial_state: { checkout_sent: false } };
const entry = (source_id, role, text, occurred_at) => ({ source_id, role, text, occurred_at });
const productionRow = (id, type, content, created_at) => ({ id, session_id: 'session-opaque-1', created_at, updated_at: created_at, message: { type, content, additional_kwargs: { ignored: 'never visible' } } });
const errorCode = (fn, code) => assert.throws(fn, error => error instanceof ConversationContextError && error.code === code);
const messageId = suffix => `11111111-1111-4111-8111-${String(suffix).padStart(12, '0')}`;
const artifact = ({ id = 'ca-draft-1', type = 'draft', operation = 'draft', task = 'cgt-1', key = 'reply-1', anchor = messageId(1), lineage = [], parts = ['Borrador'], occurred_at = '2026-09-22T11:00:00.000Z' } = {}) => ({
  artifact: { contract_version: '1.0', artifact_id: id, artifact_type: type, generation_operation: operation, generation_task_id: task, logical_reply_key: key, anchor_message_id: anchor },
  lineage: lineage.map((source_artifact_id, index) => ({ artifact_id: id, source_artifact_id, position: index + 1 })),
  messages: parts.map((body, index) => ({ id: index === 0 ? anchor : messageId(Number(anchor.slice(-12)) + index), direction: 'outbound', body, timestamp: occurred_at, idempotency_key: index === 0 ? key : `${key}:part:${String(index + 1).padStart(3, '0')}`, metadata: { logical_reply_key: key, part_index: index + 1, part_count: parts.length } })),
});

test('Ticket 60 creates an empty, structurally separate canonical ConversationContext', () => {
  const context = createConversationContext({ currentTurn, runtimeMetadata });
  assert.equal(context.context_id, 'conversation-1:inbound-3');
  assert.deepEqual(context.current_message, { source_id: 'inbound-3', canonical_message_id: '11111111-1111-4111-8111-000000000003', role: 'customer', text: '¿Cuánto cuesta?', occurred_at: '2026-09-22T12:00:00.000Z' });
  assert.deepEqual(context.history, []);
  assert.deepEqual(context.history_metadata, { ordering: 'occurred_at', history_truncated: false, retained_prior_turns: 0, retained_prior_characters: 0 });
  assert.deepEqual(context.conversation_artifacts, []);
  assert.deepEqual(context.conversation_artifacts_metadata, { ordering: 'occurred_at', artifacts_truncated: false, retained_artifacts: 0, retained_artifact_characters: 0 });
  assert.equal(validateConversationContext(context), null);
});

test('Ticket 60B-R requires a canonical ledger UUID distinct from the message source ID', () => {
  const context = createConversationContext({ currentTurn, runtimeMetadata });
  const retried = createConversationContext({ currentTurn: structuredClone(currentTurn), runtimeMetadata: structuredClone(runtimeMetadata) });
  assert.equal(context.current_message.canonical_message_id, currentTurn.canonical_message_id);
  assert.equal(retried.current_message.canonical_message_id, context.current_message.canonical_message_id);
  errorCode(() => createConversationContext({ currentTurn: { ...currentTurn, canonical_message_id: currentTurn.id }, runtimeMetadata }), 'CURRENT_TURN_INVALID');
  errorCode(() => createConversationContext({ currentTurn: { id: currentTurn.canonical_message_id, text: currentTurn.text, received_at: currentTurn.received_at }, runtimeMetadata }), 'CURRENT_TURN_INVALID');
});

test('Ticket 60A projects only valid Ticket 17A draft and summary records, not ordinary assistant history', () => {
  const draft = artifact();
  const summary = artifact({ id: 'ca-summary-2', type: 'summary', operation: 'summarize', task: 'cgt-2', key: 'reply-2', anchor: messageId(2), lineage: ['ca-draft-1'], parts: ['Resumen'], occurred_at: '2026-09-22T11:02:00.000Z' });
  const context = createConversationContext({ currentTurn, runtimeMetadata, memory: [entry('ordinary-assistant', 'assistant', 'Borrador sin metadata', '2026-09-22T10:00:00.000Z')], conversationArtifacts: [summary, draft] });
  assert.deepEqual(context.history.map(item => item.source_id), ['ordinary-assistant']);
  assert.deepEqual(context.conversation_artifacts.map(item => [item.artifact_id, item.text, item.lineage_artifact_ids]), [['ca-draft-1', 'Borrador', []], ['ca-summary-2', 'Resumen', ['ca-draft-1']]]);
});

test('Ticket 60A preserves transform lineage and reconstructs multipart artifacts in canonical part order', () => {
  const draft = artifact();
  const transformed = artifact({ id: 'ca-draft-2', operation: 'transform', task: 'cgt-2', key: 'reply-2', anchor: messageId(2), lineage: ['ca-draft-1'], parts: ['Parte uno', 'Parte dos'], occurred_at: '2026-09-22T11:02:00.000Z' });
  transformed.messages.reverse();
  const context = createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [draft, transformed] });
  assert.deepEqual(context.conversation_artifacts[1], {
    artifact_id: 'ca-draft-2', artifact_type: 'draft', generation_operation: 'transform', generation_task_id: 'cgt-2', logical_reply_key: 'reply-2', anchor_message_id: messageId(2), text: 'Parte uno\nParte dos', lineage_artifact_ids: ['ca-draft-1'], occurred_at: '2026-09-22T11:02:00.000Z',
  });
});

test('Ticket 60A fails closed for malformed metadata, missing anchors, broken lineage, duplicate identity, and ambiguous multipart content', () => {
  const draft = artifact();
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [{ ...draft, artifact: { ...draft.artifact, artifact_type: 'other' } }] }), 'CONVERSATION_ARTIFACT_INVALID');
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [{ ...draft, artifact: { ...draft.artifact, anchor_message_id: messageId(99) } }] }), 'CONVERSATION_ARTIFACT_ANCHOR_INVALID');
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [artifact({ id: 'ca-draft-2', operation: 'transform', task: 'cgt-2', key: 'reply-2', anchor: messageId(2), lineage: ['ca-absent'] })] }), 'CONVERSATION_ARTIFACT_LINEAGE_INVALID');
  const cycleA = artifact({ id: 'ca-cycle-a', operation: 'transform', task: 'cgt-cycle-a', key: 'reply-cycle-a', anchor: messageId(3), lineage: ['ca-cycle-b'] });
  const cycleB = artifact({ id: 'ca-cycle-b', operation: 'transform', task: 'cgt-cycle-b', key: 'reply-cycle-b', anchor: messageId(4), lineage: ['ca-cycle-a'], occurred_at: '2026-09-22T11:02:00.000Z' });
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [cycleA, cycleB] }), 'CONVERSATION_ARTIFACT_LINEAGE_INVALID');
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [draft, artifact({ task: 'cgt-2', key: 'reply-2', anchor: messageId(2) })] }), 'CONVERSATION_ARTIFACT_DUPLICATE_ID');
  const multipart = artifact({ parts: ['uno', 'dos'] }); multipart.messages[1].metadata.part_index = 1;
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [multipart] }), 'CONVERSATION_ARTIFACT_CONTENT_AMBIGUOUS');
});

test('Ticket 60A applies explicit deterministic artifact bounds without injecting authority semantics', () => {
  const first = artifact({ id: 'ca-draft-1', parts: ['uno'] });
  const second = artifact({ id: 'ca-draft-2', task: 'cgt-2', key: 'reply-2', anchor: messageId(2), parts: ['dos'], occurred_at: '2026-09-22T11:02:00.000Z' });
  const context = createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [second, first], options: { maxConversationArtifacts: 1, maxConversationArtifactCharacters: 3 } });
  assert.deepEqual(context.conversation_artifacts.map(item => item.artifact_id), ['ca-draft-2']);
  assert.deepEqual(context.conversation_artifacts_metadata, { ordering: 'occurred_at', artifacts_truncated: true, retained_artifacts: 1, retained_artifact_characters: 3 });
  assert.equal(validateConversationContext({ ...context, conversation_artifacts: [{ ...context.conversation_artifacts[0], authority: 'canonical_fact' }] }), 'CONVERSATION_ARTIFACT_FIELDS_INVALID');
  assert.equal(JSON.stringify(context.conversation_artifacts).match(/authority|policy|safety|authorized|delivery|execution/i), null);
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [first], options: { maxConversationArtifacts: -1 } }), 'MEMORY_ADAPTER_CONFIGURATION_INVALID');
});

test('Ticket 60A bounds artifacts as complete newest-first lineage closures', () => {
  const draft = artifact({ id: 'ca-draft-1', parts: ['aa'] });
  const transformed = artifact({ id: 'ca-transform-2', operation: 'transform', task: 'cgt-2', key: 'reply-2', anchor: messageId(2), lineage: ['ca-draft-1'], parts: ['bb'], occurred_at: '2026-09-22T11:02:00.000Z' });
  const full = createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [draft, transformed], options: { maxConversationArtifacts: 2, maxConversationArtifactCharacters: 4 } });
  assert.deepEqual(full.conversation_artifacts.map(item => item.artifact_id), ['ca-draft-1', 'ca-transform-2']);
  assert.deepEqual(full.conversation_artifacts_metadata, { ordering: 'occurred_at', artifacts_truncated: false, retained_artifacts: 2, retained_artifact_characters: 4 });

  const countBound = createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [draft, transformed], options: { maxConversationArtifacts: 1, maxConversationArtifactCharacters: 4 } });
  assert.deepEqual(countBound.conversation_artifacts.map(item => item.artifact_id), ['ca-draft-1']);
  assert.equal(countBound.conversation_artifacts_metadata.artifacts_truncated, true);

  const characterBound = createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [draft, transformed], options: { maxConversationArtifacts: 2, maxConversationArtifactCharacters: 3 } });
  assert.deepEqual(characterBound.conversation_artifacts.map(item => item.artifact_id), ['ca-draft-1']);
  assert.equal(characterBound.conversation_artifacts_metadata.retained_artifact_characters, 2);
});

test('Ticket 60A retains only complete transitive closures and permits fitting independent artifacts', () => {
  const draft = artifact({ id: 'ca-draft-1', parts: ['a'] });
  const transformed = artifact({ id: 'ca-transform-2', operation: 'transform', task: 'cgt-2', key: 'reply-2', anchor: messageId(2), lineage: ['ca-draft-1'], parts: ['b'], occurred_at: '2026-09-22T11:02:00.000Z' });
  const summary = artifact({ id: 'ca-summary-3', type: 'summary', operation: 'summarize', task: 'cgt-3', key: 'reply-3', anchor: messageId(3), lineage: ['ca-transform-2'], parts: ['c'], occurred_at: '2026-09-22T11:03:00.000Z' });
  const full = createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [summary, transformed, draft], options: { maxConversationArtifacts: 3, maxConversationArtifactCharacters: 3 } });
  assert.deepEqual(full.conversation_artifacts.map(item => item.artifact_id), ['ca-draft-1', 'ca-transform-2', 'ca-summary-3']);
  const partial = createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [summary, transformed, draft], options: { maxConversationArtifacts: 2, maxConversationArtifactCharacters: 2 } });
  assert.deepEqual(partial.conversation_artifacts.map(item => item.artifact_id), ['ca-draft-1', 'ca-transform-2']);
  assert.equal(partial.conversation_artifacts_metadata.artifacts_truncated, true);

  const largeDraft = artifact({ id: 'ca-draft-large', parts: ['aa'] });
  const largeTransform = artifact({ id: 'ca-transform-large', operation: 'transform', task: 'cgt-large', key: 'reply-large', anchor: messageId(4), lineage: ['ca-draft-large'], parts: ['bb'], occurred_at: '2026-09-22T11:02:00.000Z' });
  const independent = artifact({ id: 'ca-draft-independent', task: 'cgt-independent', key: 'reply-independent', anchor: messageId(5), parts: ['c'], occurred_at: '2026-09-22T11:03:00.000Z' });
  const independentResult = createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [largeDraft, largeTransform, independent], options: { maxConversationArtifacts: 3, maxConversationArtifactCharacters: 3 } });
  assert.deepEqual(independentResult.conversation_artifacts.map(item => item.artifact_id), ['ca-draft-large', 'ca-draft-independent']);
  assert.deepEqual(independentResult.conversation_artifacts_metadata, { ordering: 'occurred_at', artifacts_truncated: true, retained_artifacts: 2, retained_artifact_characters: 3 });
});

test('Ticket 60A validator rejects manually constructed dangling retained lineage', () => {
  const draft = artifact({ parts: ['a'] });
  const transformed = artifact({ id: 'ca-transform-2', operation: 'transform', task: 'cgt-2', key: 'reply-2', anchor: messageId(2), lineage: ['ca-draft-1'], parts: ['b'], occurred_at: '2026-09-22T11:02:00.000Z' });
  const context = createConversationContext({ currentTurn, runtimeMetadata, conversationArtifacts: [draft, transformed] });
  const dangling = { ...context, conversation_artifacts: [context.conversation_artifacts[1]], conversation_artifacts_metadata: { ordering: 'occurred_at', artifacts_truncated: true, retained_artifacts: 1, retained_artifact_characters: 1 } };
  assert.equal(validateConversationContext(dangling), 'CONVERSATION_ARTIFACT_LINEAGE_INCOMPLETE');
});

test('Ticket 60 normalizes production rows and harness-shaped entries through the same history contract', () => {
  const production = [
    productionRow('row-2', 'ai', 'Respuesta final', '2026-09-22T11:01:00.000Z'),
    productionRow('row-1', 'human', 'Hola  con espacios', '2026-09-22T11:00:00.000Z'),
  ];
  const harness = [
    entry('row-2', 'assistant', 'Respuesta final', '2026-09-22T11:01:00.000Z'),
    entry('row-1', 'user', 'Hola  con espacios', '2026-09-22T11:00:00.000Z'),
  ];
  const a = createConversationContext({ currentTurn, memory: production, runtimeMetadata });
  const b = createConversationContext({ currentTurn, memory: harness, runtimeMetadata });
  assert.deepEqual(a.history, b.history);
  assert.deepEqual(a.history, [
    { source_id: 'row-1', role: 'customer', text: 'Hola  con espacios', occurred_at: '2026-09-22T11:00:00.000Z' },
    { source_id: 'row-2', role: 'assistant', text: 'Respuesta final', occurred_at: '2026-09-22T11:01:00.000Z' },
  ]);
  assert.equal(JSON.stringify(a).includes('ignored'), false);
  assert.deepEqual(normalizeOnboardingChatMemoryRow({ ...production[0], message: { type: 'ai', data: { content: 'Respuesta final' } } }), a.history[1]);
});

test('Ticket 60 orders distinct timestamps and bounds the newest prior window', () => {
  const memory = [entry('b', 'assistant', 'BBBB', '2026-09-22T11:00:01.000Z'), entry('a', 'human', 'AAA', '2026-09-22T11:00:00.000Z'), entry('c', 'assistant', 'CC', '2026-09-22T11:01:00.000Z')];
  const full = createConversationContext({ currentTurn, memory, runtimeMetadata });
  assert.deepEqual(full.history.map(item => item.source_id), ['a', 'b', 'c']);
  const bounded = createConversationContext({ currentTurn, memory, runtimeMetadata, options: { maxPriorTurns: 2, maxPriorCharacters: 6 } });
  assert.deepEqual(bounded.history.map(item => item.source_id), ['b', 'c']);
  assert.equal(bounded.history_metadata.history_truncated, true);
  assert.equal(bounded.history_metadata.retained_prior_characters, 6);
  assert.equal(bounded.current_message.text, currentTurn.text);
});

test('Ticket 60 fails closed when equal timestamps have no authoritative durable order', () => {
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, memory: [
    entry('7f6ff0ea-5d90-4edc-9708-0f5b5a95a1c2', 'human', 'Primero desconocido', '2026-09-22T11:00:00.000Z'),
    entry('0a5bf7a1-0e3d-4b62-8f61-1b302fabcf6e', 'assistant', 'Después desconocido', '2026-09-22T11:00:00.000Z'),
  ] }), 'MEMORY_ORDER_AMBIGUOUS');
});

test('Ticket 60 deduplicates only the exact current source identity and fails closed for duplicates', () => {
  const snapshot = [entry('inbound-3', 'human', '¿Cuánto cuesta?', '2026-09-22T12:00:00.000Z'), entry('prior-1', 'ai', 'Hola', '2026-09-22T11:59:00.000Z')];
  const context = createConversationContext({ currentTurn, memory: snapshot, runtimeMetadata });
  assert.deepEqual(context.history.map(item => item.source_id), ['prior-1']);
  errorCode(() => createConversationContext({ currentTurn, memory: [...snapshot, entry('inbound-3', 'human', '¿Cuánto cuesta?', '2026-09-22T12:00:00.000Z')], runtimeMetadata }), 'CURRENT_TURN_DUPLICATED');
  errorCode(() => createConversationContext({ currentTurn, memory: [entry('same', 'human', 'a', '2026-09-22T11:00:00.000Z'), entry('same', 'assistant', 'b', '2026-09-22T11:01:00.000Z')], runtimeMetadata }), 'MEMORY_DUPLICATE_ID');
});

test('Ticket 60 keeps stale claims as text and supplies no fact, policy, intent, or generated-response authority', () => {
  const context = createConversationContext({ currentTurn, runtimeMetadata, memory: [
    entry('old-customer', 'human', 'Quiero comprar', '2026-09-22T11:00:00.000Z'),
    entry('old-assistant', 'ai', 'El programa cuesta $99 y cambia tu dosis.', '2026-09-22T11:01:00.000Z'),
  ] });
  assert.match(context.history[0].text, /Quiero comprar/);
  assert.match(context.history[1].text, /\$99/);
  assert.deepEqual(context.commercial_state, { checkout_sent: false });
  assert.deepEqual(context.authoritative_context, {});
  assert.deepEqual(context.informational_context, { knowledge: [] });
  assert.equal('price' in context, false);
  assert.equal('current_purchase_request' in context.commercial_state, false);
  assert.equal('safety_clear' in context.commercial_state, false);
});

test('Ticket 60 rejects malformed input, unknown roles, invalid trusted metadata, and invalid bounds without side effects', () => {
  errorCode(() => createConversationContext({ currentTurn: { ...currentTurn, text: '' }, runtimeMetadata }), 'CURRENT_TURN_INVALID');
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, memory: [entry('x', 'system', 'hidden', '2026-09-22T11:00:00.000Z')] }), 'MEMORY_ROLE_UNSUPPORTED');
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata: { ...runtimeMetadata, campaign: 'from_customer_text' } }), 'RUNTIME_METADATA_INVALID');
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata: { ...runtimeMetadata, untrusted: true } }), 'RUNTIME_METADATA_INVALID');
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, options: { maxPriorTurns: -1 } }), 'MEMORY_ADAPTER_CONFIGURATION_INVALID');
  errorCode(() => createConversationContext({ currentTurn, runtimeMetadata, memory: [entry('x', 'human', 'x', 'not-a-time')] }), 'MEMORY_TIMESTAMP_INVALID');
});

test('Ticket 60 has no policy, fact, LLM, database, or provider dependency', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sales-engine-v2', 'memory-adapter.js'), 'utf8');
  assert.doesNotMatch(source, /policy-resolver|fact-resolver|openai|fetch\(|supabase|postgres|twilio|stripe|node:(?:fs|net|http|https)/i);
});
