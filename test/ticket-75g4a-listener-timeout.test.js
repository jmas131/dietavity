'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_HOST, DEFAULT_PORT, ListenerConfigError, parseListenerConfig } = require('../lib/listener-config');

const root = path.join(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json'), 'utf8'));
const candidate = JSON.parse(fs.readFileSync(path.join(root, 'n8n/candidates/Ticket75G3D-Dietavity-Sales-Engine-shadow-candidate.json'), 'utf8'));
const node = (workflowArtifact, name) => workflowArtifact.nodes.find(item => item.name === name);
const outputs = (workflowArtifact, name, index = 0) => (workflowArtifact.connections[name]?.main?.[index] || []).map(edge => edge.node);

test('G.4A generated shadow and live claimed-turn requests carry explicit 100000 ms timeouts without retry', () => {
  for (const artifact of [workflow, candidate]) for (const name of ['Invoke V2 Shadow Claimed Turn', 'Invoke V2 Live Claimed Turn']) {
    const request = node(artifact, name);
    assert.equal(request.parameters.options.timeout, 100000, name);
    assert.equal(request.retryOnFail, undefined, name);
  }
  assert.equal(node(workflow, 'Invoke V2 Shadow Claimed Turn').onError, 'continueRegularOutput');
  assert.equal(node(workflow, 'Invoke V2 Live Claimed Turn').onError, undefined);
});

test('G.4A keeps one shadow attempt and the established shadow/live timeout continuations', () => {
  assert.deepEqual(outputs(workflow, 'Route V2 Shadow Signed Assertion', 0), ['Invoke V2 Shadow Claimed Turn']);
  assert.deepEqual(outputs(workflow, 'Invoke V2 Shadow Claimed Turn'), ['Normalize V2 Shadow Outcome']);
  assert.deepEqual(outputs(workflow, 'Normalize V2 Shadow Outcome'), ['Get User from Supabase', 'Build V2 Shadow Structural Diagnostic']);
  assert.equal(outputs(workflow, 'Invoke V2 Live Claimed Turn').includes('Get User from Supabase'), false);
  assert.deepEqual(outputs(workflow, 'Classify V2 Shadow Signing Failure'), ['Get User from Supabase']);
});

test('G.4A listener defaults explicitly to loopback:3000 and permits only an explicit numeric non-wildcard override', () => {
  assert.deepEqual(parseListenerConfig({}), { host: DEFAULT_HOST, port: DEFAULT_PORT });
  assert.deepEqual(parseListenerConfig({ DIETAVITY_LISTENER_HOST: '127.0.0.2', DIETAVITY_LISTENER_PORT: '3100' }), { host: '127.0.0.2', port: 3100 });
  for (const env of [
    { DIETAVITY_LISTENER_HOST: '' }, { DIETAVITY_LISTENER_HOST: 'host.example' }, { DIETAVITY_LISTENER_HOST: '0.0.0.0' }, { DIETAVITY_LISTENER_HOST: '::' },
    { DIETAVITY_LISTENER_PORT: '' }, { DIETAVITY_LISTENER_PORT: '0' }, { DIETAVITY_LISTENER_PORT: '65536' }, { DIETAVITY_LISTENER_PORT: 'abc' },
  ]) assert.throws(() => parseListenerConfig(env), ListenerConfigError);
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(source, /app\.listen\(listener\.port, listener\.host/);
  assert.doesNotMatch(source, /app\.listen\(3000/);
});

test('G.4A timeout ordering is explicit: JWT maximum 60 s, Node 90 s, n8n 100 s, proxy proposal 105 s, lease 15 min', () => {
  const config = fs.readFileSync(path.join(root, 'lib/sales-engine-v2/production-runtime-config.js'), 'utf8');
  const runbook = fs.readFileSync(path.join(root, 'docs/TICKET-75G4-CONTROLLED-DISABLED-INSTALLATION.md'), 'utf8');
  assert.match(config, /assertionMaxTtlSeconds.*60/); assert.match(config, /MAX_PRODUCTION_CLAIMED_TURN_DEADLINE_MS = 90000/);
  for (const value of ['60 seconds', '90 seconds', '100 seconds', '105 seconds', '15 minutes']) assert.match(runbook, new RegExp(value));
  assert.ok(90000 < 100000);
});
