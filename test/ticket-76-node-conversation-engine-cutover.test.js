'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');

const UUID = '11111111-1111-4111-8111-111111111111';

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

function assertN8nExpressionSyntax(expression, name) {
  assert.match(expression, /^=\{\{/, name);
  assert.equal(expression.endsWith('}}'), true, `${name} must close its n8n expression`);
  const source = expression.slice(3, -2).trim();
  assert.doesNotThrow(() => new vm.Script(`(${source})`), name);
}

test('V4 begins immediately after acquired claim and preserves deferred and busy Ticket 82/83A branches', () => {
  assert.deepEqual(outputs('Route Session Claim State', 0), ['Get V4 Conversation Context']);
  assert.deepEqual(outputs('Route Session Claim State', 1), ['Wait For Turn Quiet Period']);
  assert.deepEqual(outputs('Route Session Claim State', 2), ['End — Turn Already Owned']);
});

test('V4 builds a technical request from only claimed logical input, canonical history, and durable memory', () => {
  const history = [{ role: 'customer', text: 'Tengo pollo.' }, { role: 'assistant', text: '¿Qué más tienes?' }];
  const durable_memory = { allergies: ['cacahuate'], dietary_restrictions: ['cerdo'], preferences: ['le gusta el picante'] };
  const claimed = { id: UUID, session_id: 'synthetic-session', processing_order: 3, combined_body: 'Tengo pollo\ny calabacitas', body: 'Tengo pollo' };
  const built = runCode('Build V4 Conversation Engine Request', { canonical_history: history, durable_memory }, target => {
    assert.equal(target, 'Claim Next Session Inbound');
    return claimed;
  });
  assert.deepEqual(JSON.parse(JSON.stringify(built)), {
    request_id: UUID, session_id: 'synthetic-session', claimed_inbound_message_id: UUID,
    processing_order: 3, current_message: 'Tengo pollo\ny calabacitas', canonical_history: history, durable_memory,
  });
  assert.throws(() => runCode('Build V4 Conversation Engine Request', { canonical_history: history, durable_memory: { ...durable_memory, inventory: ['pollo'] } }, () => claimed), /CONVERSATION_V4_REQUEST_INVALID/);
});

test('V4 canonical context query projects ledger-only chronological history and active durable memory', () => {
  const query = node('Get V4 Conversation Context').parameters.query;
  assert.match(query, /LIMIT 30/);
  assert.match(query, /canonical_customer_turns AS/);
  assert.match(query, /STRING_AGG\(COALESCE\(member\.body, ''\), E'\\n'/);
  assert.match(query, /canonical_assistant_turns AS/);
  assert.match(query, /COALESCE\(NULLIF\(assistant_response, ''\), body\)/);
  assert.match(query, /MIN\(id::text\)::uuid AS id/);
  assert.doesNotMatch(query, /MIN\(id\) AS id/);
  assert.match(query, /BOOL_AND\(delivery_status IN \('accepted', 'sent', 'delivered'\)/);
  assert.match(query, /read_conversation_durable_memory\(current_inbound\.session_id, current_inbound\.user_id\)/);
  assert.doesNotMatch(query, /inventory|obligation|buyer_signal|conversation_stage|semantic_context/iu);
});

test('V4 uses the authenticated V4 route, structural validation, and atomic reservation before delivery', () => {
  const http = node('Call V4 Conversation Engine');
  assert.equal(http.parameters.url, 'http://172.18.0.1:12751/internal/conversation-engine/v4/resolve');
  assert.equal(http.parameters.options.timeout, 30000);
  assert.deepEqual(outputs('Build V4 Conversation Engine Request'), ['Call V4 Conversation Engine']);
  assert.deepEqual(outputs('Route V4 Conversation Engine Result', 0), ['Validate V4 Conversation Engine Response']);
  assert.deepEqual(outputs('Validate V4 Conversation Engine Response'), ['Prepare V4 WhatsApp Message Parts']);
  assert.deepEqual(outputs('Prepare V4 WhatsApp Message Parts'), ['Reserve V4 Reply With Memory']);
  assert.deepEqual(outputs('Reserve V4 Reply With Memory'), ['Loop V4 WhatsApp Parts']);
  assert.match(node('Reserve V4 Reply With Memory').parameters.query, /reserve_conversation_v4_reply_with_memory/);
  const reservationReplacement = node('Reserve V4 Reply With Memory').parameters.options.queryReplacement;
  assert.match(reservationReplacement, /^=\{\{ JSON\.stringify\(\{/);
  assert.match(reservationReplacement, /user_id: \$\('Claim Next Session Inbound'\)\.item\.json\.user_id \} : \{\}/);
  assert.match(reservationReplacement, /memory_updates/);
  for (const v4Postgres of workflow.nodes.filter(candidate => candidate.type === 'n8n-nodes-base.postgres' && candidate.name.includes('V4'))) {
    assert.equal(typeof v4Postgres.parameters.options?.queryReplacement, 'string', v4Postgres.name);
    assertN8nExpressionSyntax(v4Postgres.parameters.options.queryReplacement, v4Postgres.name);
  }
  assert.deepEqual(outputs('Loop V4 WhatsApp Parts', 0), ['Respond to V4 Chat']);
  assert.deepEqual(outputs('Loop V4 WhatsApp Parts', 1), ['Mark Session Inbound Complete']);
});

test('V4 n8n response validation preserves arbitrary natural language and validates only structure', () => {
  const response = {
    contract_version: 'conversation-engine-v4-response-v1', engine_version: 'conversation-engine-v4-primary-v1',
    request_id: UUID, model: 'gpt-6.1-sol', generation_status: 'generated',
    response: 'Con huauzontlez puedes hacer algo rico aunque la palabra esté escrita distinto.',
    memory_updates: [{ kind: 'preference', action: 'add', value: 'le gustan los huauzontles' }], memory_update_count: 1,
  };
  const validated = runCode('Validate V4 Conversation Engine Response', { response }, target => {
    assert.equal(target, 'Build V4 Conversation Engine Request');
    return { request_id: UUID };
  });
  assert.equal(validated.assistant_response, response.response);
  assert.deepEqual(JSON.parse(JSON.stringify(validated.memory_updates)), response.memory_updates);
  assert.throws(() => runCode('Validate V4 Conversation Engine Response', { response: { ...response, memory_update_count: 2 } }, () => ({ request_id: UUID })), /CONVERSATION_V4_RESPONSE_INVALID/);
});

test('V4 Ticket 85 retry is narrow and the recovery request is identical', () => {
  assert.deepEqual(outputs('Route V4 Conversation Engine Result', 1), ['Authorize V4 Conversation Engine Recovery']);
  assert.deepEqual(outputs('Route V4 Conversation Engine Result', 2), ['Fail Closed V4 Conversation Engine Result']);
  assert.deepEqual(outputs('Authorize V4 Conversation Engine Recovery'), ['Route V4 Conversation Engine Recovery Authorization']);
  assert.deepEqual(outputs('Route V4 Conversation Engine Recovery Authorization', 0), ['Wait Before V4 Conversation Engine Recovery']);
  assert.deepEqual(outputs('Wait Before V4 Conversation Engine Recovery'), ['Call V4 Conversation Engine Recovery']);
  assert.match(node('Call V4 Conversation Engine Recovery').parameters.jsonBody, /Build V4 Conversation Engine Request/);
  assert.deepEqual(outputs('Classify V4 Conversation Engine Recovery Result'), ['Route V4 Conversation Engine Result']);
});

test('the acquired V4 graph cannot reach V3 semantics or V3 sales state persistence', () => {
  const forbidden = new Set([
    'Get User from Supabase', 'Detect Portal Recovery Request', 'If Portal Recovery Requested',
    'Initialize Sales Lead v3', 'Get Direct RAG Conversation History', 'Select Direct RAG Backend',
    'Build Direct RAG Conversation Context', 'Interpret Sales Obligations', 'Parse Direct RAG Obligations',
    'Resolve Direct RAG Obligations', 'Compose Grounded Sales Response', 'Final Direct RAG Customer Response Gate',
    'Build Sales Response Persistence Envelope', 'Reserve Sales Reply', 'Persist Sales Response State and Events',
  ]);
  const seen = new Set(['Get V4 Conversation Context']);
  const queue = ['Get V4 Conversation Context'];
  while (queue.length) for (const next of outputs(queue.shift())) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  for (const name of forbidden) assert.equal(seen.has(name), false, name);
});
