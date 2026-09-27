'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { AUDIENCE, CONTRACT_VERSION, assertClaimedTurnRequest, createClaimedTurnRuntime, createReplayGuard, createRouteAuthorizer, invocationIdentity, responseValid } = require('../lib/sales-engine-v2/claimed-turn-runtime');

const serverPath = require.resolve('../server');
const supabasePath = require.resolve('../lib/supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { from() { throw new Error('not used by Ticket75A'); } } };
const app = require(serverPath);

const inbound = '11111111-1111-4111-8111-000000000075';
const base = () => ({ contract_version: CONTRACT_VERSION, canonical_inbound_message_id: inbound, session_id: 'session-75', processing_owner: 'ticket17-owner-75', claimed_lease_until: '2026-09-26T12:05:00.000Z', claim_attempt_id: 'claim-75', route_generation: 'g75a', mode: 'shadow', workflow_execution_id: 'workflow-75' });
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
function auth() { return { issuer: 'dietavity-n8n', audience: AUDIENCE, keys: { 'n8n-2026-09': { clientId: 'n8n-sales-engine', publicKey: pair.publicKey } }, replayGuard: createReplayGuard() }; }
function token({ issuer = 'dietavity-n8n', audience = AUDIENCE, clientId = 'n8n-sales-engine', jti = crypto.randomUUID(), expiresIn = 60, notBefore = '0s' } = {}) { return jwt.sign({ client_id: clientId, jti }, pair.privateKey, { algorithm: 'RS256', keyid: 'n8n-2026-09', issuer, audience, expiresIn, notBefore }); }
async function invoke(runtime, { body = base(), credential = token() } = {}) { const result = {}; await runtime({ body, headers: credential ? { authorization: `Bearer ${credential}` } : {} }, { status(code) { result.status = code; return this; }, json(value) { result.body = value; return this; } }); return result; }
function runtime(options = {}) { return createClaimedTurnRuntime({ auth: auth(), routeAuthorizer: createRouteAuthorizer({ state: 'shadow', generation: 'g75a' }), claimVerifier: async () => ({ status: 'valid' }), ...options }); }

test('server exposes only the internal claimed-turn skeleton route', () => {
  const layer = app.router.stack.find(item => item.route?.path === '/internal/sales-engine-v2/claimed-turn');
  assert.ok(layer); assert.equal(layer.route.methods.post, true);
});
test('strict request contract accepts bounded claim capability only', () => {
  assert.deepEqual(assertClaimedTurnRequest(base()), base());
  for (const mutation of [{ contract_version: 'other' }, { canonical_inbound_message_id: 'bad' }, { claimed_lease_until: 'not-date' }, { session_id: 'x'.repeat(257) }, { customer_message: 'hola' }, { facts: {} }, { action_parameters: {} }]) assert.throws(() => assertClaimedTurnRequest({ ...base(), ...mutation }), /malformed_request/);
  const missing = base(); delete missing.claim_attempt_id; assert.throws(() => assertClaimedTurnRequest(missing), /malformed_request/);
});
test('JWT authentication rejects missing, malformed, wrong issuer/audience/client, expiry, nbf, and replay', async () => {
  const guard = createReplayGuard(); const configured = { issuer: 'dietavity-n8n', audience: AUDIENCE, keys: { 'n8n-2026-09': { clientId: 'n8n-sales-engine', publicKey: pair.publicKey } }, replayGuard: guard };
  const handler = createClaimedTurnRuntime({ auth: configured, routeAuthorizer: createRouteAuthorizer({ state: 'shadow', generation: 'g75a' }), claimVerifier: async () => ({ status: 'valid' }) });
  for (const credential of [null, 'bad', token({ issuer: 'wrong' }), token({ audience: 'wrong' }), token({ clientId: 'wrong' }), token({ expiresIn: -1 }), token({ notBefore: 60 })]) { const value = await invoke(handler, { credential }); assert.equal(value.status, 401); assert.equal(value.body.failure_code, 'unauthenticated'); }
  const once = token({ jti: 'same-jti-75' }); assert.equal((await invoke(handler, { credential: once })).status, 503); assert.equal((await invoke(handler, { credential: once })).status, 401);
});
test('route mode is server-authoritative and disabled by default', async () => {
  const disabled = createClaimedTurnRuntime({ auth: auth(), claimVerifier: async () => ({ status: 'valid' }) });
  assert.equal((await invoke(disabled)).status, 403);
  const shadowOnly = runtime(); assert.equal((await invoke(shadowOnly, { body: { ...base(), mode: 'live' } })).status, 403);
  assert.equal((await invoke(shadowOnly)).status, 503);
});
test('claim verifier is required and maps canonical lease states fail closed', async () => {
  const absent = createClaimedTurnRuntime({ auth: auth(), routeAuthorizer: createRouteAuthorizer({ state: 'shadow', generation: 'g75a' }) });
  assert.equal((await invoke(absent)).body.failure_code, 'context_invalid');
  for (const code of ['claim_not_owned', 'claim_expired', 'already_has_reply']) { const value = await invoke(runtime({ claimVerifier: async () => ({ status: 'invalid', code }) })); assert.equal(value.status, 409); assert.equal(value.body.failure_code, code); }
});
test('deadline and unknown exceptions have closed machine responses without side effects', async () => {
  let calls = 0; const expired = runtime({ deadlineMs: 1, claimVerifier: async ({ signal }) => { calls += 1; await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(signal.aborted, true); return { status: 'valid' }; } });
  const timed = await invoke(expired); assert.equal(timed.status, 504); assert.equal(timed.body.failure_code, 'deadline_exceeded'); assert.equal(calls, 1);
  const broken = runtime({ claimVerifier: async () => { throw new Error('secret value'); } }); const result = await invoke(broken); assert.equal(result.status, 500); assert.equal(result.body.failure_code, 'internal_unclassified'); assert.equal(JSON.stringify(result.body).includes('secret value'), false);
});
test('logging is bounded and stub cannot invoke actions, transport, persistence, or completion', async () => {
  const events = []; const result = await invoke(runtime({ logger: event => events.push(event), pseudonymKey: 'minimum-test-correlation-key' }));
  assert.equal(result.status, 503); assert.equal(result.body.failure_code, 'runtime_not_configured'); assert.equal(responseValid(result.body), true);
  assert.equal(events.length, 1); assert.equal(JSON.stringify(events).includes('session-75'), false); assert.equal(JSON.stringify(events).includes('workflow-75'), false); assert.equal(JSON.stringify(events).includes('canonical_inbound_message_id'), false);
});
test('invocation identity is stable and never includes customer content', () => {
  const identity = invocationIdentity({ ...base(), routeGeneration: 'g75a' }); assert.match(identity, /^cti-[a-f0-9]{64}$/); assert.equal(identity, invocationIdentity({ ...base(), routeGeneration: 'g75a' })); assert.notEqual(identity, invocationIdentity({ ...base(), processing_owner: 'other-owner', routeGeneration: 'g75a' }));
});
