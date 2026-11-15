#!/usr/bin/env node
'use strict';

// Applies only Ticket 85F's approved semantic delta to the current canonical
// export. It deliberately preserves all existing nodes, credentials, settings,
// metadata, and connections outside this router.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const routeName = 'Route Session Claim State';
const safeEnd = 'End — Turn Already Owned';
const failClosedName = 'Fail Closed Invalid Session Claim State';
assert.equal(workflow.id, 'DbdFTtuPwxTZSkp3');
const route = workflow.nodes.find((node) => node.name === routeName);
assert.ok(route, 'missing Session Claim State router');
assert.deepEqual(route.parameters.rules.values.map((rule) => rule.conditions.conditions[0].rightValue), ['acquired', 'deferred', 'busy']);
assert.deepEqual(workflow.connections[routeName].main.map((branch) => branch[0]?.node), [
  'Get V4 Conversation Context', 'Wait For Turn Quiet Period', safeEnd, 'Reconcile V4 Outbound Reservation',
]);
assert.equal(workflow.nodes.filter((node) => node.name === failClosedName).length, 0, 'fail-closed node already exists');

const options = route.parameters.rules.values[0].conditions.options;
const condition = (id, leftValue, rightValue, operation = 'equals') => ({
  id, leftValue, rightValue, operator: { type: 'string', operation },
});
route.parameters.mode = 'rules';
route.parameters.looseTypeValidation = false;
route.parameters.options = { fallbackOutput: 'extra' };
route.parameters.rules.values.push(
  { conditions: { options, conditions: [
    condition('ticket85f-reconciliation', '={{ $json.claim_state }}', 'reconciliation'),
    condition('ticket85f-id', '={{ $json.id }}', '', 'notEmpty'),
    condition('ticket85f-sessionid', '={{ $json.session_id }}', '', 'notEmpty'),
  ], combinator: 'and' }, renameOutput: false },
  { conditions: { options, conditions: [
    condition('ticket85f-empty', '={{ $json.claim_state }}', 'empty'),
  ], combinator: 'and' }, renameOutput: false },
);
for (const rule of route.parameters.rules.values.slice(0, 3)) rule.renameOutput = false;
workflow.nodes.push({
  parameters: { jsCode: "throw new Error('V4_INVALID_SESSION_CLAIM_STATE');" },
  type: 'n8n-nodes-base.code', typeVersion: 2, position: [6288, 5936],
  id: '1f718f0d-9500-4469-a8e1-700000000085', name: failClosedName,
});
workflow.connections[routeName].main = [
  workflow.connections[routeName].main[0], workflow.connections[routeName].main[1],
  workflow.connections[routeName].main[2], workflow.connections[routeName].main[3],
  [{ node: safeEnd, type: 'main', index: 0 }],
  [{ node: failClosedName, type: 'main', index: 0 }],
];
fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log('PASS: applied only Ticket 85F workflow delta');
