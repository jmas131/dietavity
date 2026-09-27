'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { createSupabaseAssertionReplayAdapter } = require('../lib/sales-engine-v2/assertion-replay-adapter');
const { createProductionClaimedTurnRuntime } = require('../lib/sales-engine-v2/production-runtime');
const { parseProductionRuntimeConfig } = require('../lib/sales-engine-v2/production-runtime-config');
const { createReplayGuard, AUDIENCE, CONTRACT_VERSION } = require('../lib/sales-engine-v2/claimed-turn-runtime');

const inbound = '11111111-1111-4111-8111-000000007530';
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const baseEnv = () => ({ SALES_ENGINE_V2_CONTROL: 'shadow', SALES_ENGINE_V2_ROUTE_GENERATION: 'g75g3a', SALES_ENGINE_V2_SHADOW_COHORT_IDS: inbound, SALES_ENGINE_V2_JWT_ISSUER: 'dietavity-n8n', SALES_ENGINE_V2_JWT_PUBLIC_KEYS_JSON: JSON.stringify({ 'n8n-kid': { client_id: 'n8n-sales', public_key: pair.publicKey.export({ type: 'spki', format: 'pem' }) } }), SALES_ENGINE_V2_PSEUDONYM_KEY: 'diagnostic-pseudonym-key-minimum', SALES_ENGINE_V2_CLAIMED_TURN_DEADLINE_MS: '90000', SALES_ENGINE_V2_MODEL_IDS_JSON: JSON.stringify(Object.fromEntries(['interpreter','bounded_reasoning','semantic_guidance_assessor','artifact_reproduction_assessor','composer','final_response_assessor'].map(stage => [stage, 'local-stub']))), SALES_ENGINE_V2_ASSERTION_REPLAY_MODE: 'durable', SALES_ENGINE_V2_BACKEND_ADAPTER: 'supabase_service_role', SALES_ENGINE_V2_DIAGNOSTICS_ENABLED: 'true' });
const body = () => ({ contract_version: CONTRACT_VERSION, canonical_inbound_message_id: inbound, session_id: 'session-75g3a', processing_owner: 'owner-75g3a', claimed_lease_until: '2026-09-27T12:05:00.000Z', claim_attempt_id: 'attempt-75g3a', route_generation: 'g75g3a', mode: 'shadow', workflow_execution_id: 'workflow-75g3a' });
function token(jti = crypto.randomUUID(), overrides = {}) { return jwt.sign({ client_id: overrides.clientId || 'n8n-sales', jti }, pair.privateKey, { algorithm: 'RS256', keyid: overrides.kid || 'n8n-kid', issuer: overrides.issuer || 'dietavity-n8n', audience: overrides.audience || AUDIENCE, expiresIn: overrides.expiresIn || 60, notBefore: '0s' }); }
async function invoke(handler, credential) { const result = {}; await handler({ body: body(), headers: { authorization: `Bearer ${credential}` } }, { status(code) { result.status = code; return this; }, json(value) { result.body = value; return this; } }); return result; }
function dependencies(replayGuard, counters = {}) { return { supabase: { rpc: async () => ({ data: [{ state: 'consumed' }] }) }, replayGuard, modelClient: { complete: async () => { counters.model = (counters.model || 0) + 1; return { output: {} }; } }, claimVerifier: async () => ({ status: 'valid', claim: {} }), inputAdapter: { build: async () => ({}) }, composition: { run: async () => ({ contract_version: 'ticket-75c3-runtime-v1', status: 'response_eligible', turn_result: { status: 'response_eligible' }, delivery: { text: 'never logged', post_gate_delivery_manifest: { contract_version: 'ticket-68a-v1' } } }) } }; }

test('production configuration defaults disabled and rejects malformed activation settings without exposing values', () => {
  assert.deepEqual(parseProductionRuntimeConfig({}), { control: 'disabled', enabled: false, audience: AUDIENCE });
  for (const env of [{ SALES_ENGINE_V2_CONTROL: 'random' }, { ...baseEnv(), SALES_ENGINE_V2_SHADOW_COHORT_IDS: '' }, { ...baseEnv(), SALES_ENGINE_V2_JWT_PUBLIC_KEYS_JSON: '{bad' }]) assert.throws(() => parseProductionRuntimeConfig(env), error => error.code === 'CLAIMED_TURN_CONFIGURATION_INVALID' && !error.message.includes('PSEUDONYM'));
});
test('durable replay adapter maps one atomic result and fails closed for ambiguity', async () => {
  const calls = []; const adapter = createSupabaseAssertionReplayAdapter({ supabase: { async rpc(name, payload) { calls.push({ name, payload }); return { data: [{ state: 'consumed' }] }; } } });
  assert.equal(await adapter.consume({ issuer: 'issuer', clientId: 'client', jti: 'jti-75g3a', exp: Math.floor(Date.now() / 1000) + 60 }), true);
  assert.equal(calls[0].name, 'consume_sales_engine_v2_assertion_replay'); assert.equal(Object.keys(calls[0].payload.p).sort().join(','), 'client_id,contract_version,expires_at,issuer,jti');
  const ambiguous = createSupabaseAssertionReplayAdapter({ supabase: { async rpc() { return { error: { message: 'secret provider body' } }; } } });
  await assert.rejects(() => ambiguous.consume({ issuer: 'issuer', clientId: 'client', jti: 'jti-75g3b', exp: Math.floor(Date.now() / 1000) + 60 }), error => error.code === 'ASSERTION_REPLAY_UNAVAILABLE' && !error.message.includes('secret'));
});
test('two production runtime instances share durable replay semantics; exact JWT checks remain intact', async () => {
  const consumed = new Set(); const replayGuard = { kind: 'durable_assertion_replay', async consume(input) { const key = `${input.issuer}:${input.clientId}:${input.jti}`; if (consumed.has(key)) return false; consumed.add(key); return true; } };
  const first = createProductionClaimedTurnRuntime({ env: baseEnv(), dependencies: dependencies(replayGuard) }); const second = createProductionClaimedTurnRuntime({ env: baseEnv(), dependencies: dependencies(replayGuard) });
  const once = token('shared-jti-75g3a'); assert.equal((await invoke(first, once)).status, 200); assert.equal((await invoke(second, once)).status, 401);
  for (const altered of [token('issuer-75', { issuer: 'wrong' }), token('aud-75', { audience: 'wrong' }), token('kid-75', { kid: 'unknown' }), token('client-75', { clientId: 'wrong' })]) assert.equal((await invoke(createProductionClaimedTurnRuntime({ env: baseEnv(), dependencies: dependencies(replayGuard) }), altered)).status, 401);
});
test('unsafe local replay guard and disabled mode cannot invoke model, action, reservation, diagnostics, or consume replay', async () => {
  const counters = {}; const disabled = createProductionClaimedTurnRuntime({ env: {}, dependencies: dependencies({ kind: 'durable_assertion_replay', async consume() { counters.consume = (counters.consume || 0) + 1; return true; } }, counters) });
  assert.equal((await invoke(disabled, token('disabled-75'))).status, 401); assert.deepEqual(counters, {});
  const unsafe = createProductionClaimedTurnRuntime({ env: baseEnv(), dependencies: dependencies(createReplayGuard(), counters) }); assert.equal((await invoke(unsafe, token('unsafe-75'))).status, 401); assert.equal(counters.model, undefined);
});
test('route cohort and generation are deterministic and cannot be changed by request input', async () => {
  const replayGuard = { kind: 'durable_assertion_replay', async consume() { return true; } }; const handler = createProductionClaimedTurnRuntime({ env: baseEnv(), dependencies: dependencies(replayGuard) });
  const wrong = body(); wrong.route_generation = 'other'; const result = {}; await handler({ body: wrong, headers: { authorization: `Bearer ${token('generation-75')}` } }, { status(code) { result.status = code; return this; }, json(value) { result.body = value; return this; } }); assert.equal(result.status, 403); assert.equal(result.body.failure_code, 'forbidden_route');
});
