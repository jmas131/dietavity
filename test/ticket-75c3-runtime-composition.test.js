'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const facts = require('../config/sales-engine-v2/product-fact-authority.json');
const knowledge = require('../config/sales-engine-v2/reviewed-nutrition-knowledge.json');
const { createCanonicalInputAdapter, createCanonicalClaimVerifier } = require('../lib/sales-engine-v2/canonical-input-adapters');
const { createClaimedTurnComposition } = require('../lib/sales-engine-v2/claimed-turn-composition');
const { createClaimedTurnRuntime, createReplayGuard, createRouteAuthorizer, AUDIENCE, CONTRACT_VERSION, responseValid } = require('../lib/sales-engine-v2/claimed-turn-runtime');

const inbound = '11111111-1111-4111-8111-000000000075';
const request = mode => ({ contract_version: CONTRACT_VERSION, canonical_inbound_message_id: inbound, session_id: 'session-75c3', processing_owner: 'owner-75c3', claimed_lease_until: '2026-09-26T12:05:00.000Z', claim_attempt_id: 'claim-75c3', mode, workflow_execution_id: 'workflow-75c3' });
function authorityRows() { return facts.authority_sets.flatMap(set => set.facts.map(fact => ({ ...fact, authority_set_id: set.authority_set_id, authority_version: set.authority_version, status: set.status, scope: set.scope }))); }
function reader({ text = 'Gracias', campaign = 'standard', offer = '28d-149-v1' } = {}) { return { async readClaim() { return { id: inbound, direction: 'inbound', session_id: 'session-75c3', processing_owner: 'owner-75c3', processing_lease_until: '2026-09-26T12:05:00.000Z', processing_completed_at: null, has_outbound_reply: false }; }, async readContext() { return { currentTurn: { id: 'SM75C3', canonical_message_id: inbound, text, received_at: '2026-09-26T12:00:00.000Z' }, memory: [], conversationArtifacts: [], runtimeMetadata: { conversation_id: 'conversation-75c3', session_id: 'session-75c3', channel: 'whatsapp', ...(offer === null ? {} : { offer_version: offer }), campaign } }; }, async readFactAuthority() { return authorityRows(); }, async readKnowledgeAuthority() { return knowledge.knowledge_sets.map(set => ({ ...set, created_at: '2026-09-01T00:00:00.000Z', records: set.records })); } }; }
function stages(kind = 'social_acknowledgement') { return { interpreterAdapter: async () => ({ obligations: [{ category: kind, ...(kind === 'commercial_purchase_intent' ? { subject: 'explicit_current_request' } : {}), current_turn_evidence: kind === 'commercial_purchase_intent' ? 'quiero comprar' : 'Gracias', confidence: 'high', ambiguous: false }] }), boundedReasoningAdapter: () => ({ units: [] }), semanticGuidanceAssessor: () => ({ findings: [] }), artifactReproductionAssessor: () => ({ findings: [] }), composerAdapter: input => ({ segments: input.input.obligation_outcomes.map(item => ({ obligation_id: item.obligation_id, text: 'Gracias.' })) }), finalResponseAssessor: () => ({ findings: [] }) }; }
async function bundle(options) { const inputAdapter = createCanonicalInputAdapter({ reader: reader(options), now: () => '2026-09-26T12:00:00.000Z' }); return inputAdapter.build({ request: request('shadow'), claim: { canonical_inbound_message_id: inbound }, signal: undefined }); }

test('T75C.3 composes canonical input through Ticket68 and Ticket68A without delivery side effects', async () => {
  const composition = createClaimedTurnComposition({ stageAdapters: stages() });
  const output = await composition.run({ canonicalInput: await bundle(), mode: 'shadow', invocationIdentity: 'cti-test', signal: undefined });
  assert.equal(output.status, 'response_eligible'); assert.equal(output.delivery.text, 'Gracias.');
  assert.match(output.delivery.post_gate_delivery_manifest.logical_reply_key, /^lrk-/);
  assert.equal(JSON.stringify(output).match(/twilio|outbound|completion|sent|delivered/i), null);
});

test('T75C.3 action-bearing shadow is explicitly not_executed with zero reservation/provider calls', async () => {
  const calls = []; const composition = createClaimedTurnComposition({
    stageAdapters: stages('commercial_purchase_intent'),
    actionReservationStore: { async reserve() { calls.push('reserve'); }, async succeed() { calls.push('succeed'); }, async fail() { calls.push('fail'); } },
    actionProviders: { async createCheckoutDestination() { calls.push('stripe'); } },
    shadowActionExecutor: async ({ authorizedAction }) => { calls.push('shadow'); return { action_execution_state: 'not_executed', action_id: authorizedAction.action_id, action_type: authorizedAction.action_type }; }
  });
  const output = await composition.run({ canonicalInput: await bundle({ text: 'quiero comprar' }), mode: 'shadow', invocationIdentity: 'cti-shadow', signal: undefined });
  assert.equal(output.status, 'response_eligible', JSON.stringify(output)); assert.equal(output.turn_result.action_execution_summary[0].execution_status, 'not_executed');
  assert.deepEqual(calls, ['shadow']);
});

test('T75C.3 live action uses the injected Ticket65D executor path only after composition', async () => {
  const calls = []; const composition = createClaimedTurnComposition({ stageAdapters: stages('commercial_purchase_intent'), actionReservationStore: { async reserve(input) { calls.push('reserve'); return { state: 'acquired', action_id: input.action_id, execution_key: input.execution_key }; }, async succeed() { calls.push('succeed'); }, async fail() { calls.push('fail'); } }, actionProviders: { async createCheckoutDestination({ execution_key }) { calls.push(`provider:${execution_key.slice(0, 4)}`); return { kind: 'checkout', url: 'https://checkout.stripe.com/c/t75c3' }; } } });
  const output = await composition.run({ canonicalInput: await bundle({ text: 'quiero comprar' }), mode: 'live', invocationIdentity: 'cti-live', signal: undefined });
  assert.equal(output.status, 'response_eligible'); assert.deepEqual(calls.map(value => value.split(':')[0]), ['reserve', 'provider', 'succeed']);
});

test('T75C.3 claimed runtime returns only a bounded eligible result and remains deadline fail-closed', async () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); const auth = { issuer: 'dietavity-n8n', audience: AUDIENCE, keys: { key: { clientId: 'n8n', publicKey: pair.publicKey } }, replayGuard: createReplayGuard() };
  const inputReader = reader(); const adapter = createCanonicalInputAdapter({ reader: inputReader, now: () => '2026-09-26T12:00:00.000Z' }); const composition = createClaimedTurnComposition({ stageAdapters: stages() });
  const runtime = createClaimedTurnRuntime({ auth, routeAuthorizer: createRouteAuthorizer({ state: 'shadow', generation: 'g75c3' }), claimVerifier: createCanonicalClaimVerifier({ reader: inputReader, now: () => Date.parse('2026-09-26T12:01:00.000Z') }), inputAdapter: adapter, runtime: input => composition.run({ ...input, mode: input.request.mode }), deadlineMs: 1000 });
  const credential = jwt.sign({ client_id: 'n8n', jti: 'jti-75c3' }, pair.privateKey, { algorithm: 'RS256', keyid: 'key', issuer: auth.issuer, audience: AUDIENCE, expiresIn: 60, notBefore: '0s' }); const result = {};
  await runtime({ body: request('shadow'), headers: { authorization: `Bearer ${credential}` } }, { status(code) { result.status = code; return this; }, json(value) { result.body = value; return this; } });
  assert.equal(result.status, 200); assert.equal(responseValid(result.body), true); assert.equal(Object.hasOwn(result.body, 'conversation_context'), false);
});
