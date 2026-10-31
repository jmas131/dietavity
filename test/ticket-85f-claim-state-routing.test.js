'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json'), 'utf8'));
const routeName = 'Route Session Claim State';
const route = workflow.nodes.find((node) => node.name === routeName);
const reconcile = workflow.nodes.find((node) => node.name === 'Reconcile V4 Outbound Reservation');

assert.ok(route, 'missing Session Claim State router');
assert.ok(reconcile, 'missing reconciliation node');
assert.equal(route.parameters.rules.values.length, 5);
assert.deepEqual(route.parameters.rules.values.map((rule) => rule.conditions.conditions[0].rightValue), ['acquired', 'deferred', 'busy', 'reconciliation', 'empty']);
assert.deepEqual(
  workflow.connections[routeName].main.map((branch) => branch[0]?.node),
  ['Get V4 Conversation Context', 'Wait For Turn Quiet Period', 'End — Turn Already Owned', 'Reconcile V4 Outbound Reservation', 'End — Turn Already Owned', 'Fail Closed Invalid Session Claim State'],
);
const reconciliation = route.parameters.rules.values[3].conditions.conditions;
assert.equal(reconciliation.length, 3);
assert.equal(reconciliation[1].operator.operation, 'notEmpty');
assert.equal(reconciliation[2].operator.operation, 'notEmpty');
const failClosed = workflow.nodes.find((node) => node.name === 'Fail Closed Invalid Session Claim State');
assert.equal(failClosed.parameters.jsCode, "throw new Error('V4_INVALID_SESSION_CLAIM_STATE');");
assert.match(reconcile.parameters.query, /claim_v4_outbound_reconciliation/);

const destination = (input) => {
  if (input.claim_state === 'acquired') return 0;
  if (input.claim_state === 'deferred') return 1;
  if (input.claim_state === 'busy') return 2;
  if (input.claim_state === 'reconciliation' && input.id && input.session_id) return 3;
  if (input.claim_state === 'empty') return 4;
  return 5;
};
const valid = { id: 'synthetic-inbound-id', session_id: 'synthetic-session' };
const expected = [
  [{ claim_state: 'acquired', ...valid }, 'Get V4 Conversation Context'],
  [{ claim_state: 'deferred', ...valid }, 'Wait For Turn Quiet Period'],
  [{ claim_state: 'busy', ...valid }, 'End — Turn Already Owned'],
  [{ claim_state: 'reconciliation', ...valid }, 'Reconcile V4 Outbound Reservation'],
  [{ claim_state: 'empty', id: null, session_id: valid.session_id }, 'End — Turn Already Owned'],
  [{ claim_state: 'unknown', ...valid }, 'Fail Closed Invalid Session Claim State'],
  [{ claim_state: null, ...valid }, 'Fail Closed Invalid Session Claim State'],
  [{ claim_state: 'reconciliation', id: null, session_id: valid.session_id }, 'Fail Closed Invalid Session Claim State'],
  [{ claim_state: 'reconciliation', id: valid.id, session_id: null }, 'Fail Closed Invalid Session Claim State'],
];
for (const [input, name] of expected) {
  assert.equal(workflow.connections[routeName].main[destination(input)][0].node, name);
}

console.log('PASS Ticket 85F claim-state routing artifact (9 cases)');
