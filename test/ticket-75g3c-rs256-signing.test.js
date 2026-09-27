'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const path = require('node:path');
const { createClaimedTurnRuntime, createRouteAuthorizer, AUDIENCE, CONTRACT_VERSION } = require('../lib/sales-engine-v2/claimed-turn-runtime');

const root = path.join(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json'), 'utf8'));
const nodes = new Map(workflow.nodes.map(node => [node.name, node]));
const outputs = (name, index = 0) => (workflow.connections[name]?.main?.[index] || []).map(edge => edge.node);
const inbound = '11111111-1111-4111-8111-0000000075c3';
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const request = () => ({ contract_version: CONTRACT_VERSION, canonical_inbound_message_id: inbound, session_id: 'session-75g3c', processing_owner: 'owner-75g3c', claimed_lease_until: '2026-09-27T12:05:00.000Z', claim_attempt_id: 'attempt-75g3c', route_generation: 'g75g3c', mode: 'shadow', workflow_execution_id: 'workflow-75g3c' });

function sign({ kid = 'n8n-current', issuer = 'dietavity-n8n', audience = AUDIENCE, clientId = 'n8n-sales', jti = crypto.randomUUID(), ttl = 60 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iss: issuer, aud: audience, client_id: clientId, jti, iat: now, nbf: now - 5, exp: now + ttl }, pair.privateKey, { algorithm: 'RS256', keyid: kid });
}
function runtime(consumed = new Set()) {
  return createClaimedTurnRuntime({
    auth: { issuer: 'dietavity-n8n', audience: AUDIENCE, maxAssertionTtlSeconds: 60, keys: { 'n8n-current': { clientId: 'n8n-sales', publicKey: pair.publicKey }, 'n8n-previous': { clientId: 'n8n-sales', publicKey: pair.publicKey } }, replayGuard: { async consume({ issuer, clientId, jti }) { const key = `${issuer}|${clientId}|${jti}`; if (consumed.has(key)) return false; consumed.add(key); return true; } } },
    routeAuthorizer: createRouteAuthorizer({ state: 'shadow', generation: 'g75g3c', cohortIds: [inbound] }),
    claimVerifier: async () => ({ status: 'valid', claim: { canonical_inbound_message_id: inbound } }),
    inputAdapter: { build: async () => ({}) },
    runtime: async () => ({ contract_version: 'ticket-75c3-runtime-v1', status: 'response_ineligible', turn_result: { status: 'response_ineligible', stage_trace: [] } }),
  });
}
async function invoke(handler, assertion) { const result = {}; await handler({ body: request(), headers: { authorization: `Bearer ${assertion}` } }, { status(code) { result.status = code; return this; }, json(value) { result.body = value; return this; } }); return result; }

test('G.3C native signing chain uses encrypted jwtAuth, RS256, kid, random JTI, and an Authorization-only assertion', () => {
  for (const mode of ['Shadow', 'Live']) {
    const cryptoNode = nodes.get(`Generate V2 ${mode} Assertion JTI`); const signer = nodes.get(`Mint V2 ${mode} RS256 Assertion`); const requestNode = nodes.get(`Invoke V2 ${mode} Claimed Turn`);
    assert.equal(cryptoNode.type, 'n8n-nodes-base.crypto'); assert.equal(cryptoNode.parameters.encodingType, 'uuid');
    assert.equal(signer.type, 'n8n-nodes-base.jwt'); assert.equal(signer.credentials.jwtAuth.id, '__T75G3C_RS256_SIGNING_CREDENTIAL__'); assert.equal(signer.parameters.options.algorithm, 'RS256'); assert.match(signer.parameters.options.kid, /SALES_ENGINE_V2_ASSERTION_KID/);
    for (const claim of ['iss:', 'aud:', 'client_id:', 'jti:', 'iat:', 'nbf:', 'exp:']) assert.match(signer.parameters.claimsJson, new RegExp(claim));
    assert.equal(requestNode.parameters.authentication, 'none'); assert.match(requestNode.parameters.headerParameters.parameters[0].value, /Bearer.*v2_assertion/); assert.equal(requestNode.credentials, undefined);
  }
  const signingNodes = ['Mint V2 Shadow RS256 Assertion', 'Mint V2 Live RS256 Assertion', 'Invoke V2 Shadow Claimed Turn', 'Invoke V2 Live Claimed Turn'].map(name => JSON.stringify(nodes.get(name))).join('\n'); assert.doesNotMatch(signingNodes, /-----BEGIN (?:RSA )?PRIVATE KEY-----|eyJ[a-zA-Z0-9_-]{20,}|httpHeaderAuth/i);
});

test('G.3C RS256 assertions satisfy exact kid, issuer, audience, client, bounded expiry, rotation, and durable replay semantics', async () => {
  const consumed = new Set(); const handler = runtime(consumed); const firstJti = crypto.randomUUID(); const first = sign({ jti: firstJti });
  const decoded = jwt.verify(first, pair.publicKey, { algorithms: ['RS256'], issuer: 'dietavity-n8n', audience: AUDIENCE }); assert.equal(jwt.decode(first, { complete: true }).header.kid, 'n8n-current'); assert.equal(decoded.client_id, 'n8n-sales'); assert.equal(decoded.exp - decoded.iat, 60); assert.equal(decoded.nbf, decoded.iat - 5);
  assert.equal((await invoke(handler, first)).status, 200); assert.equal((await invoke(handler, first)).status, 401);
  assert.equal((await invoke(runtime(new Set()), sign({ kid: 'n8n-previous' }))).status, 200);
  for (const assertion of [sign({ kid: 'unknown' }), sign({ issuer: 'wrong' }), sign({ audience: 'wrong' }), sign({ clientId: 'wrong' }), sign({ ttl: 61 })]) assert.equal((await invoke(runtime(new Set()), assertion)).status, 401);
  assert.notEqual(crypto.randomUUID(), crypto.randomUUID());
});

test('G.3C signing failure makes zero Node calls in shadow, rejoins legacy once, and keeps live fail-closed', () => {
  assert.deepEqual(outputs('Route V2 Shadow Assertion Configuration', 1), ['Classify V2 Shadow Signing Failure']);
  assert.deepEqual(outputs('Route V2 Shadow Assertion JTI', 1), ['Classify V2 Shadow Signing Failure']);
  assert.deepEqual(outputs('Route V2 Shadow Signed Assertion', 1), ['Classify V2 Shadow Signing Failure']);
  assert.deepEqual(outputs('Classify V2 Shadow Signing Failure'), ['Get User from Supabase']);
  assert.equal(outputs('Classify V2 Shadow Signing Failure').filter(name => name === 'Get User from Supabase').length, 1);
  assert.equal(outputs('Route V2 Shadow Signed Assertion', 1).includes('Invoke V2 Shadow Claimed Turn'), false);
  assert.deepEqual(outputs('Route V2 Live Assertion Configuration', 1), ['Fail V2 Live Signing']); assert.deepEqual(outputs('Route V2 Live Assertion JTI', 1), ['Fail V2 Live Signing']); assert.deepEqual(outputs('Route V2 Live Signed Assertion', 1), ['Fail V2 Live Signing']);
  assert.equal(outputs('Fail V2 Live Signing').includes('Get User from Supabase'), false);
});

test('G.3C keeps assertions out of diagnostics and disabled/non-cohort routes out of signing', () => {
  const diagnostic = nodes.get('Build V2 Shadow Structural Diagnostic').parameters.jsCode; assert.doesNotMatch(diagnostic, /assertion|token|authorization|bearer/i);
  const route = nodes.get('Route Sales Engine V2 Claim').parameters.jsCode; assert.match(route, /'disabled'/); assert.equal(outputs('Route Sales Engine V2 Mode', 0)[0], 'Get User from Supabase');
  assert.equal(nodes.get('Invoke V2 Shadow Claimed Turn').retryOnFail, undefined);
});
