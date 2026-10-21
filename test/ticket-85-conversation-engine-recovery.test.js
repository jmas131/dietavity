'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');

const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const ordering = require('../lib/session-ordering');

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const node = name => {
  const value = workflow.nodes.find(candidate => candidate.name === name);
  assert.ok(value, `missing node ${name}`);
  return value;
};
const outputs = (name, branch = 0) => (workflow.connections[name]?.main?.[branch] || []).map(edge => edge.node);
const runCode = (name, input) => vm.runInNewContext(`(function(){${node(name).parameters.jsCode}})()`, {
  $input: { first: () => ({ json: input }) },
  $: target => {
    assert.equal(target, 'Build Conversation Engine Request');
    return { item: { json: { request_id: REQUEST_ID, preserved: 'original-request' } } };
  },
})[0].json;

const controlled503 = {
  contract_version: 'conversation-engine-response-v1',
  engine_version: 'direct-rag-v3-v1_3',
  request_id: REQUEST_ID,
  resolution: { status: 'infrastructure_failure', type: 'engine_unavailable', delivery_permitted: false },
  assistant_response: null,
  persistence: null,
  diagnostics: { recommendation: null, llm: { obligations: 'unavailable', composition: 'unavailable' } },
};
const resolvedResponse = {
  contract_version: 'conversation-engine-response-v1',
  engine_version: 'direct-rag-v3-v1_3',
  request_id: REQUEST_ID,
  resolution: { status: 'resolved', type: 'direct_rag_response', delivery_permitted: true },
  assistant_response: 'Respuesta segura.',
  persistence: { pending_action: 'respond', strategy: 'direct_rag_v3_response', buyer_signal: null, topic: null, conversation_stage: null, goal: null, next_last_question_type: null, events: [] },
  diagnostics: { recommendation: { source: null, status: null, failure_code: null }, llm: { obligations: 'valid', composition: 'valid' } },
};

test('Ticket 85 routes only the first exact controlled 503 to one authorized recovery, then returns to the normal reservation tail', () => {
  assert.deepEqual(outputs('Call Conversation Engine'), ['Classify Conversation Engine Result']);
  assert.deepEqual(outputs('Classify Conversation Engine Result'), ['Route Conversation Engine Result']);
  assert.deepEqual(outputs('Route Conversation Engine Result', 0), ['Validate/Adapt Conversation Engine Response']);
  assert.deepEqual(outputs('Route Conversation Engine Result', 1), ['Authorize Conversation Engine Recovery']);
  assert.deepEqual(outputs('Authorize Conversation Engine Recovery'), ['Route Conversation Engine Recovery Authorization']);
  assert.deepEqual(outputs('Route Conversation Engine Recovery Authorization', 0), ['Wait Before Conversation Engine Recovery']);
  assert.deepEqual(outputs('Wait Before Conversation Engine Recovery'), ['Call Conversation Engine Recovery']);
  assert.deepEqual(outputs('Call Conversation Engine Recovery'), ['Classify Conversation Engine Recovery Result']);
  assert.deepEqual(outputs('Classify Conversation Engine Recovery Result'), ['Route Conversation Engine Result']);
  assert.deepEqual(outputs('Validate/Adapt Conversation Engine Response'), ['Build Sales Response Persistence Envelope']);

  const classified = runCode('Classify Conversation Engine Result', { error: { httpCode: 503, response: { body: controlled503 } } });
  assert.equal(classified.result_kind, 'ticket85_recovery_candidate');
  const recovered = runCode('Classify Conversation Engine Recovery Result', resolvedResponse);
  assert.equal(recovered.result_kind, 'success');
  assert.deepEqual(recovered.response, resolvedResponse);
  assert.equal(node('Wait Before Conversation Engine Recovery').parameters.amount, 1);
  assert.equal(node('Wait Before Conversation Engine Recovery').parameters.unit, 'seconds');
  assert.equal(node('Call Conversation Engine Recovery').parameters.jsonBody, "={{ JSON.stringify($('Build Conversation Engine Request').item.json) }}");
});

test('Ticket 85 makes a second controlled 503 terminal and leaves ordinary CE failures on the existing failure path', () => {
  const exhausted = runCode('Classify Conversation Engine Recovery Result', { error: { httpCode: 503, response: { body: controlled503 } } });
  assert.equal(exhausted.result_kind, 'unrecoverable_failure');
  assert.deepEqual(outputs('Route Conversation Engine Result', 2), ['Fail Closed Conversation Engine Result']);
  assert.deepEqual(outputs('Route Conversation Engine Recovery Authorization', 1), ['Fail Closed Conversation Engine Result']);
  assert.equal(workflow.connections['Fail Closed Conversation Engine Result'], undefined);

  const nonInfrastructure = runCode('Classify Conversation Engine Result', { error: { httpCode: 500, response: { body: controlled503 } } });
  assert.equal(nonInfrastructure.result_kind, 'unrecoverable_failure');
  const malformed = runCode('Classify Conversation Engine Result', { error: { httpCode: 503, response: { body: { error: 'unavailable' } } } });
  assert.equal(malformed.result_kind, 'unrecoverable_failure');
});

test('Ticket 85 database authorization fails closed for wrong owners, finished turns, existing outbound reservations, and prior attempts', () => {
  const sql = ordering.AUTHORIZE_CONVERSATION_ENGINE_RECOVERY_SQL;
  assert.match(sql, /member\.processing_owner IS DISTINCT FROM input\.payload->>'processing_owner'/);
  assert.match(sql, /member\.processing_lease_until <= NOW\(\)/);
  assert.match(sql, /member\.processing_completed_at IS NOT NULL/);
  assert.match(sql, /outbound\.in_reply_to_id = anchor\.id/);
  assert.match(sql, /outbound\.direction = 'outbound'/);
  assert.match(sql, /ticket85_conversation_engine_recovery_attempted_at/);
  assert.match(sql, /'authorized' ELSE 'ineligible'/);
  assert.match(sql, /FOR UPDATE OF member/);
});

test('Ticket 85 preserves Ticket 82/83A ownership and canonical outbound idempotency, without generic HTTP retries', () => {
  assert.equal(ordering.TURN_QUIET_SECONDS, 10);
  assert.deepEqual(outputs('Route Session Claim State', 2), ['End — Turn Already Owned']);
  assert.equal(workflow.connections['End — Turn Already Owned'], undefined);
  assert.match(ordering.RESERVE_MULTIPART_OUTBOUND_SQL, /ON CONFLICT \(idempotency_key\)/);
  assert.match(ordering.RESERVE_MULTIPART_OUTBOUND_SQL, /WHERE EXISTS \(SELECT 1 FROM renewed_claim\)/);
  for (const name of ['Call Conversation Engine', 'Call Conversation Engine Recovery']) {
    const http = node(name);
    assert.equal(http.parameters.options.timeout, 30000);
    assert.equal(http.parameters.options.retry, undefined);
    assert.equal(http.parameters.retryOnFail, undefined);
    assert.doesNotMatch(JSON.stringify(http.parameters), /retry/i);
  }
});
