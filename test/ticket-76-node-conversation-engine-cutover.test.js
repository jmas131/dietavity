'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');

const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const { validateRequest, validateResponse } = require('../lib/conversation-engine/contracts');

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function node(name) {
  const value = workflow.nodes.find(candidate => candidate.name === name);
  assert.ok(value, `missing node ${name}`);
  return value;
}

function outputs(name, branch = null) {
  const main = workflow.connections[name]?.main || [];
  return (branch === null ? main.flat() : main[branch] || []).map(edge => edge.node);
}

function runCode(name, input, lookup) {
  return vm.runInNewContext(`(function(){${node(name).parameters.jsCode}})()`, {
    $input: { first: () => ({ json: input }) },
    $: target => ({ item: { json: lookup(target) } }),
  })[0].json;
}

test('B1 selector preserves legacy as its only default backend', () => {
  const selector = node('Select Direct RAG Backend');
  assert.equal(selector.type, 'n8n-nodes-base.switch');
  assert.equal(selector.typeVersion, 3.4);
  const values = selector.parameters.rules.values;
  assert.equal(values.length, 2);
  assert.equal(values[0].conditions.conditions[0].leftValue, 'legacy');
  assert.equal(values[0].conditions.conditions[0].rightValue, 'legacy');
  assert.equal(values[1].conditions.conditions[0].leftValue, 'legacy');
  assert.equal(values[1].conditions.conditions[0].rightValue, 'node');
  assert.deepEqual(outputs(selector.name, 0), ['Build Direct RAG Conversation Context']);
  assert.deepEqual(outputs(selector.name, 1), ['Build Conversation Engine Request']);
});

test('B1 builds an ordered closed Node request from claimed canonical inputs only', () => {
  const history = [
    { role: 'customer', text: 'Tengo pollo.', source_processing_order: 1 },
    { role: 'assistant', text: '¿Qué quieres comer?', source_processing_order: 1 },
    { role: 'customer', text: 'También tengo tortillas.', source_processing_order: 2 },
  ];
  const claimed = { id: UUID_A, session_id: 'synthetic-session', processing_order: 3, body: '¿Qué me recomiendas?' };
  const built = runCode('Build Conversation Engine Request', { canonical_history: history }, target => {
    assert.equal(target, 'Claim Next Session Inbound');
    return claimed;
  });
  assert.deepEqual(JSON.parse(JSON.stringify(built)), {
    contract_version: 'conversation-engine-request-v1', request_id: UUID_A,
    session_id: 'synthetic-session', inbound_message_id: UUID_A,
    processing_order: 3, current_message: '¿Qué me recomiendas?', canonical_history: history,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(validateRequest(built))), JSON.parse(JSON.stringify(built)));
  assert.throws(() => runCode('Build Conversation Engine Request', {
    canonical_history: [{ role: 'assistant', text: 'Primero', source_processing_order: 1 }, { role: 'customer', text: 'Después', source_processing_order: 1 }],
  }, () => claimed), /CONVERSATION_ENGINE_REQUEST_INVALID/);
});

test('B1 history query preserves canonical roles, source order, delivery filtering, and current-turn exclusion', () => {
  const query = node('Get Direct RAG Conversation History').parameters.query;
  assert.match(query, /LIMIT 12/);
  assert.match(query, /message\.id <> current_inbound\.id/);
  assert.match(query, /CASE WHEN message\.direction = 'outbound' THEN 'assistant' ELSE 'customer' END AS role/);
  assert.match(query, /WHEN message\.direction = 'outbound' THEN replied_inbound\.processing_order/);
  assert.match(query, /ORDER BY source_processing_order ASC, role_sort ASC, timestamp ASC, id ASC/);
  assert.match(query, /message\.delivery_status IN \('accepted', 'sent', 'delivered'\)/);
  assert.match(query, /provider_acceptance_evidence/);
});

test('B1 validates and adapts only a correlated delivery-permitted Node response', () => {
  const valid = {
    contract_version: 'conversation-engine-response-v1', engine_version: 'direct-rag-v3-v1_3', request_id: UUID_A,
    resolution: { status: 'resolved', type: 'direct_rag_response', delivery_permitted: true },
    assistant_response: 'Prepara tacos de pollo con aguacate.',
    persistence: { pending_action: 'respond', strategy: 'direct_rag_response', buyer_signal: null, topic: 'food_decision', conversation_stage: null, goal: null, next_last_question_type: null, events: [] },
    diagnostics: { recommendation: { source: 'meal_recommendation_engine_v1_3', status: 'resolved', failure_code: null }, llm: { obligations: 'valid', composition: 'valid' } },
  };
  assert.equal(validateResponse(valid), valid);
  const output = runCode('Validate/Adapt Conversation Engine Response', valid, target => {
    assert.equal(target, 'Build Conversation Engine Request');
    return { request_id: UUID_A };
  });
  assert.equal(output.output, valid.assistant_response);
  assert.equal(output.pending_action, 'respond');
  assert.equal(output.session_id, undefined);
  assert.equal(output.conversation_engine.recommendation_source, 'meal_recommendation_engine_v1_3');
  assert.throws(() => runCode('Validate/Adapt Conversation Engine Response', { ...valid, request_id: UUID_B }, () => ({ request_id: UUID_A })), /CONVERSATION_ENGINE_RESPONSE_INVALID/);
  assert.throws(() => runCode('Validate/Adapt Conversation Engine Response', { ...valid, resolution: { ...valid.resolution, delivery_permitted: false } }, () => ({ request_id: UUID_A })), /CONVERSATION_ENGINE_RESPONSE_INVALID/);
});

test('B1 Node branch is isolated from legacy intelligence and rejoins the existing reservation tail', () => {
  assert.deepEqual(outputs('Build Conversation Engine Request'), ['Call Conversation Engine']);
  assert.deepEqual(outputs('Call Conversation Engine'), ['Validate/Adapt Conversation Engine Response']);
  assert.deepEqual(outputs('Validate/Adapt Conversation Engine Response'), ['Build Sales Response Persistence Envelope']);
  assert.deepEqual(outputs('Final Direct RAG Customer Response Gate'), ['Build Sales Response Persistence Envelope']);
  assert.deepEqual(outputs('Build Sales Response Persistence Envelope'), ['Reserve Sales Reply']);
  const seen = new Set(['Build Conversation Engine Request']);
  const queue = ['Build Conversation Engine Request'];
  while (queue.length) {
    const current = queue.shift();
    if (current === 'Build Sales Response Persistence Envelope') continue;
    for (const next of outputs(current)) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  for (const legacy of ['Build Direct RAG Conversation Context', 'Interpret Sales Obligations', 'Sales Obligations Model', 'Parse Direct RAG Obligations', 'Resolve Direct RAG Obligations', 'Route Direct RAG Authorized Action', 'Build Direct RAG Composition Envelope', 'Compose Grounded Sales Response', 'Grounded Sales Response Model', 'Final Direct RAG Customer Response Gate']) assert.equal(seen.has(legacy), false, legacy);
});

test('B1 HTTP node has one credential placeholder, a bounded timeout, and no serialized secret', () => {
  const http = node('Call Conversation Engine');
  assert.equal(http.type, 'n8n-nodes-base.httpRequest');
  assert.equal(http.parameters.method, 'POST');
  assert.equal(http.parameters.url, 'http://127.0.0.1:3000/internal/conversation-engine/v1/resolve');
  assert.equal(http.parameters.options.timeout, 30000);
  assert.equal(http.parameters.genericAuthType, 'httpHeaderAuth');
  assert.deepEqual(Object.keys(http.credentials), ['httpHeaderAuth']);
  assert.equal(http.credentials.httpHeaderAuth.name, 'Dietavity Conversation Engine Internal Header Auth');
  const cutover = JSON.stringify([http, node('Build Conversation Engine Request'), node('Validate/Adapt Conversation Engine Response')]);
  assert.doesNotMatch(cutover, /DIETAVITY_CONVERSATION_ENGINE_SECRET|x-dietavity-conversation-engine-secret\s*[:=]\s*[^\s]/i);
});

test('B1 preserves live omitted defaults for unrelated batch and session-claim retry nodes', () => {
  assert.deepEqual(node('Loop Paid WhatsApp Parts').parameters, { options: {} });
  assert.deepEqual(node('Wait Before Session Claim Retry').parameters, {});
});
