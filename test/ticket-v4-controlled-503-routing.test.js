'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');

const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const requestId = '11111111-1111-4111-8111-111111111111';
const node = name => {
  const value = workflow.nodes.find(candidate => candidate.name === name);
  assert.ok(value, `missing node ${name}`);
  return value;
};
const run = (name, input) => vm.runInNewContext(`(function(){${node(name).parameters.jsCode}})()`, {
  $input: { first: () => ({ json: input }) },
  $: target => {
    assert.equal(target, 'Build V4 Conversation Engine Request');
    return { item: { json: { request_id: requestId } } };
  },
})[0].json;
const controlled = {
  contract_version: 'conversation-engine-v4-response-v1',
  engine_version: 'conversation-engine-v4-primary-v1',
  request_id: requestId,
  generation_status: 'infrastructure_failure',
  failure_category: 'engine_unavailable',
};
const axiosWrapped503 = { error: { httpCode: 503, message: `503 - ${JSON.stringify(JSON.stringify(controlled))}` } };

test('V4 classifier recognizes only the exact Axios-wrapped controlled 503', () => {
  assert.equal(run('Classify V4 Conversation Engine Result', axiosWrapped503).result_kind, 'ticket85_recovery_candidate');
  assert.equal(run('Classify V4 Conversation Engine Recovery Result', axiosWrapped503).result_kind, 'unrecoverable_failure');
});

test('V4 classifier fails closed for invalid wrappers, uncorrelated results, and unrelated 5xx errors', () => {
  assert.equal(run('Classify V4 Conversation Engine Result', { error: { httpCode: 503, message: '503 - not-json' } }).result_kind, 'unrecoverable_failure');
  assert.equal(run('Classify V4 Conversation Engine Result', { error: { httpCode: 503, message: `503 - ${JSON.stringify(JSON.stringify({ ...controlled, request_id: '22222222-2222-4222-8222-222222222222' }))}` } }).result_kind, 'unrecoverable_failure');
  assert.equal(run('Classify V4 Conversation Engine Result', { error: { httpCode: 502, message: `502 - ${JSON.stringify(JSON.stringify(controlled))}` } }).result_kind, 'unrecoverable_failure');
});

test('V4 recovery keeps the existing one-second, ownership-gated, no-outbound path', () => {
  const authorizer = node('Authorize V4 Conversation Engine Recovery').parameters.query;
  assert.match(authorizer, /processing_owner IS DISTINCT FROM input\.payload->>'processing_owner'/);
  assert.match(authorizer, /processing_lease_until <= NOW\(\)/);
  assert.match(authorizer, /outbound\.in_reply_to_id = anchor\.id/);
  assert.match(authorizer, /ticket85_conversation_engine_recovery_attempted_at/);
  assert.match(authorizer, /FOR UPDATE OF member/);
  const wait = node('Wait Before V4 Conversation Engine Recovery').parameters;
  assert.equal(wait.amount, 1);
  // Wait v1.1 defaults a missing timeInterval unit to seconds in n8n 2.46.4.
  assert.equal(wait.unit ?? 'seconds', 'seconds');
  for (const name of ['Call V4 Conversation Engine', 'Call V4 Conversation Engine Recovery']) {
    const call = node(name);
    assert.equal(call.parameters.options.timeout, 30000);
    assert.equal(call.parameters.options.retry, undefined);
    assert.equal(call.retryOnFail, undefined);
  }
});
