'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { merge, preservationManifest, PROTECTED_NODES, sha256, stable } = require('../scripts/merge-ticket-75g3d-production-workflow');

const root = path.join(__dirname, '..');
const candidatePath = path.join(root, 'n8n/candidates/Ticket75G3D-Dietavity-Sales-Engine-shadow-candidate.json');
const manifestPath = path.join(root, 'n8n/candidates/Ticket75G3D-Dietavity-Sales-Engine-preservation-manifest.json');
const genericPath = path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json');
const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const generic = JSON.parse(fs.readFileSync(genericPath, 'utf8'));
const nodeMap = workflow => new Map(workflow.nodes.map(node => [node.name, node]));
const out = (workflow, name, index = 0) => (workflow.connections[name]?.main?.[index] || []).map(edge => edge.node);
const t75 = node => /^75(?:e1|f2|g3b|g3c)/.test(String(node.id || ''));

// The operator export is intentionally not committed.  This exact inverse is
// used only as a deterministic test fixture for the merge algorithm.
function reconstructedFreshBase() {
  const base = JSON.parse(JSON.stringify(candidate));
  const names = new Set(base.nodes.filter(t75).map(node => node.name));
  base.nodes = base.nodes.filter(node => !names.has(node.name));
  for (const name of names) delete base.connections[name];
  base.connections['Route Session Claim State'].main[0] = [{ node: 'Get User from Supabase', type: 'main', index: 0 }];
  base.active = true;
  return base;
}

test('G.3D candidate records the verified fresh production source and preserves identity while importing inactive', () => {
  assert.deepEqual(manifest.source_identity, { workflow_id: '9oRFrbGVuK91LaAD', workflow_name: 'Dietavity Sales Engine (Ticket 10)', active: true, node_count: 183, sha256: '7914e39b874e5dbe7654a80ecc255c1b80d72bf883cf02c84d92cf3496af3fe8' });
  assert.equal(candidate.id, manifest.source_identity.workflow_id); assert.equal(candidate.name, manifest.source_identity.workflow_name); assert.equal(candidate.active, false); assert.equal(candidate.nodes.length, 207);
  assert.equal(candidate.settings.errorWorkflow, 'sa10JQEAbxNYvCGG');
  assert.ok(manifest.differences.length > 0); assert.ok(manifest.differences.every(change => ['ticket75_added_node', 'ticket75_added_edge', 'ticket75_required_modified_edge', 'ticket75_required_setting'].includes(change.category)));
});

test('G.3D merge is deterministic and only classifies Ticket75 additions, the acquired edge, and inactive setting', () => {
  const base = reconstructedFreshBase(); const first = merge({ fresh: base, template: generic }); const second = merge({ fresh: base, template: generic });
  assert.equal(stable(first), stable(second)); assert.equal(stable(first), stable(candidate));
  assert.deepEqual(preservationManifest(base, first, manifest.source_identity.sha256), manifest);
});

test('G.3D preserves all protected production nodes, busy path, legacy path, paid transport, completion, and error handler', () => {
  const base = reconstructedFreshBase(); const before = nodeMap(base); const after = nodeMap(candidate);
  for (const name of PROTECTED_NODES) assert.deepEqual(after.get(name), before.get(name), name);
  assert.deepEqual(out(candidate, 'Route Session Claim State', 1), out(base, 'Route Session Claim State', 1));
  assert.deepEqual(out(candidate, 'Wait Before Session Claim Retry'), ['Claim Next Session Inbound']);
  assert.deepEqual(out(base, 'Get User from Supabase'), out(candidate, 'Get User from Supabase'));
  for (const name of ['Prepare Paid WhatsApp Message Parts', 'Reserve Paid Assistant Reply', 'Loop Paid WhatsApp Parts', 'Send All Intents Message', 'Update Paid Assistant Reply Delivery', 'Assert Paid Assistant Reply Accepted', 'Update Last Assistant Message', 'Mark Session Inbound Complete']) {
    assert.deepEqual(after.get(name), before.get(name), name); assert.deepEqual(candidate.connections[name], base.connections[name], name);
  }
  assert.equal(candidate.settings.errorWorkflow, base.settings.errorWorkflow);
  assert.deepEqual(out(candidate, 'Route Session Claim State'), ['Route Sales Engine V2 Claim']);
  assert.deepEqual(out(candidate, 'Route Session Claim State', 1), ['Wait Before Session Claim Retry']);
});

test('G.3D route is fail-closed by default; legacy/non-cohort sign and invoke nothing, while shadow signs and invokes at most once', () => {
  const nodes = nodeMap(candidate); const route = nodes.get('Route Sales Engine V2 Claim').parameters.jsCode;
  assert.match(route, /SALES_ENGINE_V2_CONTROL \|\| 'disabled'/); assert.match(route, /SALES_ENGINE_V2_SHADOW_COHORT_IDS/); assert.doesNotMatch(route, /random|percentage/i);
  assert.deepEqual(out(candidate, 'Route Sales Engine V2 Mode'), ['Get User from Supabase']);
  assert.deepEqual(out(candidate, 'Route Sales Engine V2 Mode', 1), ['Prepare V2 Shadow Assertion']);
  assert.deepEqual(out(candidate, 'Route Sales Engine V2 Mode', 2), ['Prepare V2 Live Assertion']);
  assert.deepEqual(out(candidate, 'Route V2 Shadow Signed Assertion', 0), ['Invoke V2 Shadow Claimed Turn']);
  assert.deepEqual(out(candidate, 'Route V2 Shadow Signed Assertion', 1), ['Classify V2 Shadow Signing Failure']);
  assert.equal(nodes.get('Invoke V2 Shadow Claimed Turn').retryOnFail, undefined); assert.equal(nodes.get('Invoke V2 Shadow Claimed Turn').onError, 'continueRegularOutput');
  assert.deepEqual(out(candidate, 'Classify V2 Shadow Signing Failure'), ['Get User from Supabase']);
  assert.deepEqual(out(candidate, 'Normalize V2 Shadow Outcome'), ['Get User from Supabase', 'Build V2 Shadow Structural Diagnostic']);
  assert.equal(out(candidate, 'Invoke V2 Live Claimed Turn').includes('Get User from Supabase'), false);
});

test('G.3D retains G.3C signing boundary, G.3B privacy/correlation boundary, and no shadow reservation dependency', () => {
  const nodes = nodeMap(candidate); const text = JSON.stringify(candidate);
  for (const name of ['Mint V2 Shadow RS256 Assertion', 'Mint V2 Live RS256 Assertion']) {
    const signer = nodes.get(name); assert.equal(signer.type, 'n8n-nodes-base.jwt'); assert.equal(signer.credentials.jwtAuth.id, '__T75G3C_RS256_SIGNING_CREDENTIAL__'); assert.equal(signer.parameters.options.algorithm, 'RS256');
  }
  assert.doesNotMatch(text, /-----BEGIN (?:RSA )?(?:PRIVATE|PUBLIC) KEY-----|eyJ[a-zA-Z0-9_-]{20,}|SALES_ENGINE_V2_(?:SHADOW|LIVE)_COHORT_IDS\s*[:=]\s*['"][0-9a-f]/i);
  const request = nodes.get('Invoke V2 Shadow Claimed Turn'); assert.match(request.parameters.headerParameters.parameters[0].value, /v2_assertion/); assert.equal(request.credentials, undefined);
  const normalize = nodes.get('Normalize V2 Shadow Outcome').parameters.jsCode; const diagnostic = nodes.get('Build V2 Shadow Structural Diagnostic').parameters.jsCode;
  for (const forbidden of ['delivery.text', 'turn_result', 'customer_response', 'provider_sid', 'result.destination', 'result.prompt', 'result.history', 'structural.assertion', 'structural.token']) { assert.doesNotMatch(normalize + diagnostic, new RegExp(forbidden, 'i'), forbidden); }
  assert.match(normalize, /result\.invocation_identity/); assert.match(diagnostic, /structural\.invocation_identity/);
  const shadowNodes = ['Route V2 Shadow Signed Assertion', 'Invoke V2 Shadow Claimed Turn', 'Normalize V2 Shadow Outcome', 'Build V2 Shadow Structural Diagnostic', 'Record V2 Shadow Structural Diagnostic'];
  for (const name of shadowNodes) assert.equal(JSON.stringify(candidate.connections[name] || {}).includes('Reserve Paid Assistant Reply'), false, name);
  assert.equal(JSON.stringify(candidate.connections['Normalize V2 Shadow Outcome']).includes('Loop Paid WhatsApp Parts'), false);
});

test('G.3D fails closed for an unexpected production identity, missing acquired/busy seam, or Ticket75 collision', () => {
  const wrongId = reconstructedFreshBase(); wrongId.id = 'wrong'; assert.throws(() => merge({ fresh: wrongId, template: generic }), /expected workflow id/);
  const missingBusy = reconstructedFreshBase(); missingBusy.connections['Wait Before Session Claim Retry'].main[0] = []; assert.throws(() => merge({ fresh: missingBusy, template: generic }), /busy retry/);
  const collisionTemplate = JSON.parse(JSON.stringify(generic)); collisionTemplate.nodes.find(t75).name = 'Loop Paid WhatsApp Parts'; assert.throws(() => merge({ fresh: reconstructedFreshBase(), template: collisionTemplate }), /duplicate node name|collides/);
});

test('G.3D candidate and manifest have stable fingerprints', () => {
  assert.equal(sha256(fs.readFileSync(candidatePath, 'utf8')), '55904a8e3e97cf29a83590dfa95f783d7469fddb2d44b91e1594818aa60da26f');
  assert.equal(sha256(fs.readFileSync(manifestPath, 'utf8')), 'b30d7588d37f0e325a3288c5edaab058f81fb4daa0374a6bafb16e2729e9e084');
});
