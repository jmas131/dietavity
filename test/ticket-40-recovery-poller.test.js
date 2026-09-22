'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', name), 'utf8'));
const sales = read('Dietavity Sales Engine (Ticket 10).json');
const poller = read('Dietavity WhatsApp Recovery Poller.json');
const node = (workflow, name) => workflow.nodes.find(n => n.name === name);
const outputs = (workflow, name) => workflow.connections[name].main[0].map(edge => edge.node);

test('poller is an inactive three-node workflow with valid edges and existing error handling', () => {
  assert.equal(poller.active, false);
  assert.equal(sales.active, false);
  assert.equal(poller.nodes.length, 3);
  assert.equal(poller.settings.errorWorkflow, sales.settings.errorWorkflow);
  assert.equal(poller.settings.timezone, sales.settings.timezone);
  for (const [source, groups] of Object.entries(poller.connections)) {
    assert.ok(node(poller, source));
    for (const edge of groups.main.flat()) assert.ok(node(poller, edge.node));
  }
  assert.deepEqual(outputs(poller, 'Resume Verified WhatsApp Requests'), ['Find Verified WhatsApp Sessions']);
});

test('empty SELECT stops before invocation; no empty-item or error fallback can dispatch', () => {
  const finder = node(poller, 'Find Verified WhatsApp Sessions');
  assert.equal(finder.parameters.operation, 'executeQuery');
  assert.match(finder.parameters.query, /^SELECT DISTINCT message.session_id\n/);
  assert.notEqual(finder.alwaysOutputData, true);
  assert.notEqual(finder.continueOnFail, true);
  assert.equal(finder.onError, undefined);
  assert.deepEqual(outputs(poller, finder.name), ['Execute Dietavity Sales Engine']);
  assert.equal(Object.values(poller.connections).flatMap(c => c.main.flat())
    .filter(edge => edge.node === 'Execute Dietavity Sales Engine').length, 1);
});

test('nonempty batches pass unchanged to the Sales Engine canonical claim entry', () => {
  const call = node(poller, 'Execute Dietavity Sales Engine');
  assert.equal(call.type, 'n8n-nodes-base.executeWorkflow');
  assert.equal(call.typeVersion, 1);
  assert.deepEqual(call.parameters, {
    source: 'database', workflowId: sales.id, mode: 'once',
    options: { waitForSubWorkflow: true },
  });
  const trigger = node(sales, 'Receive Verified WhatsApp Sessions');
  assert.equal(trigger.type, 'n8n-nodes-base.executeWorkflowTrigger');
  assert.equal(trigger.typeVersion, 1);
  assert.deepEqual(trigger.parameters, {});
  assert.deepEqual(outputs(sales, trigger.name), ['Claim Next Session Inbound']);
  assert.equal(sales.settings.callerPolicy, 'workflowsFromSameOwner');
  for (const name of ['Resume Verified WhatsApp Requests', 'Find Verified WhatsApp Sessions']) {
    assert.equal(node(sales, name), undefined);
    assert.equal(sales.connections[name], undefined);
  }
});
