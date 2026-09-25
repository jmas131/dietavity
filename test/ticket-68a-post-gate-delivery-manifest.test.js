'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createConversationContext } = require('../lib/sales-engine-v2/memory-adapter');
const { runSalesEngineV2Turn, postGateEligibilityCompanion } = require('../lib/sales-engine-v2/turn-orchestrator');
const { PostGateDeliveryManifestError, assertPostGateDeliveryManifest, buildPostGateDeliveryManifest, postGateDeliveryManifestValid } = require('../lib/sales-engine-v2/post-gate-delivery-manifest');

function context(id = '11111111-1111-4111-8111-000000006801', artifacts = []) {
  return createConversationContext({ currentTurn: { id: `inbound-${id}`, canonical_message_id: id, text: 'hazlo un borrador breve', received_at: '2026-09-25T12:00:00.000Z' }, memory: [], conversationArtifacts: artifacts, runtimeMetadata: { conversation_id: 'conversation-68a', session_id: 'session-68a', channel: 'whatsapp', offer_version: '28d-149-v1', campaign: 'standard' } });
}
function source(id = 'ca-source-a', text = 'Texto previo.') { const suffix = id.endsWith('b') ? '801' : '800'; const minute = id.endsWith('b') ? '01' : '00'; const anchor = `11111111-1111-4111-8111-000000006${suffix}`; return { artifact: { contract_version: '1.0', artifact_id: id, artifact_type: 'draft', generation_operation: 'draft', generation_task_id: `cgt-${id.slice(3)}`, logical_reply_key: `prior-${id}`, anchor_message_id: anchor }, lineage: [], messages: [{ id: anchor, direction: 'outbound', body: text, timestamp: `2026-09-25T11:${minute}:00.000Z`, idempotency_key: `prior-${id}`, metadata: { logical_reply_key: `prior-${id}`, part_index: 1, part_count: 1 } }] }; }
function obligation(operation = null) {
  if (!operation) return { category: 'social_acknowledgement', current_turn_evidence: 'hazlo', confidence: 'high', ambiguous: false };
  return { category: 'conversational_task', subject: operation, current_turn_evidence: 'hazlo', confidence: 'high', ambiguous: false, attributes: { task_operation: operation }, conversational_task: { operation, artifact_ids: operation === 'draft' ? [] : operation === 'summarize' ? ['ca-source-a', 'ca-source-b'] : ['ca-source-a'], current_turn_constraints: operation === 'transform' ? [{ value: 'breve' }] : [], current_turn_inputs: operation === 'draft' ? [{ input_type: 'draft_specification', value: 'un borrador' }] : [] } };
}
function dependencies(obligations, findings = []) { return { interpreterAdapter: async () => ({ obligations }), factResolver: { resolveFact() { throw new Error('unused'); } }, policyResolver: { resolvePolicy() { throw new Error('unused'); } }, artifactReproductionAssessor: () => ({ findings: [] }), composerAdapter: request => ({ segments: request.input.obligation_outcomes.map(outcome => ({ obligation_id: outcome.obligation_id, text: `Respuesta ${outcome.obligation_id}.` })) }), finalResponseAssessor: () => ({ findings }) }; }
const runContext = { asOf: '2026-09-25T12:00:00.000Z', composerModelRunId: 'model-a', finalResponseAssessorRunId: 'gate-a', artifactReproductionAssessorRunId: 'artifact-a' };
async function eligible({ id, operation, findings, multiple = false } = {}) {
  const artifacts = multiple ? [source()] : operation ? (operation === 'draft' ? [] : operation === 'summarize' ? [source('ca-source-a'), source('ca-source-b')] : [source()]) : [];
  const obligations = multiple ? [obligation('draft'), obligation('transform')] : [obligation(operation)];
  return runSalesEngineV2Turn({ conversationContext: context(id, artifacts), dependencies: dependencies(obligations, findings), runContext });
}

test('Ticket 68A makes one immutable minimal manifest for an ordinary eligible result', async () => {
  const result = await eligible(); const manifest = buildPostGateDeliveryManifest({ turnResult: result });
  assert.equal(manifest.contract_version, 'ticket-68a-v1'); assert.equal(manifest.artifact_projection, null); assert.equal(postGateDeliveryManifestValid(manifest, { turnResult: result }), true);
  assert.equal(JSON.stringify(manifest).includes(result.customer_response.text), false); assert.equal(JSON.stringify(manifest).match(/sent|delivered|accepted|received/i), null);
  assert.equal(Object.isFrozen(manifest), true); assert.equal(Object.isFrozen(manifest.ticket67_candidate_binding), true);
  assert.throws(() => { manifest.logical_reply_key = 'forged'; }, TypeError);
});

test('Ticket 68A is deterministic and binds canonical inbound and the exact eligible result', async () => {
  const result = await eligible(); const first = buildPostGateDeliveryManifest({ turnResult: result }); const retry = buildPostGateDeliveryManifest({ turnResult: result });
  assert.deepEqual(first, retry);
  const other = buildPostGateDeliveryManifest({ turnResult: await eligible({ id: '11111111-1111-4111-8111-000000006802' }) });
  assert.notEqual(first.conversation_context_binding, other.conversation_context_binding); assert.notEqual(first.logical_reply_key, other.logical_reply_key);
  const altered = structuredClone(result); altered.customer_response.text = 'Otra respuesta.';
  assert.equal(postGateDeliveryManifestValid(first, { turnResult: altered }), false);
  assert.throws(() => buildPostGateDeliveryManifest({ turnResult: altered }), /COMPANION_UNAVAILABLE/);
});

test('Ticket 68A refuses forged, unavailable, blocked, and indeterminate eligibility', async () => {
  assert.throws(() => buildPostGateDeliveryManifest({ turnResult: { status: 'response_eligible' } }), /COMPANION_UNAVAILABLE/);
  for (const findings of [[{ code: 'other_semantic_risk', evidence: { excerpt: 'Respuesta o-1.', rationale: 'blocked' } }]]) {
    const result = await eligible({ findings }); assert.equal(result.status, 'response_ineligible'); assert.throws(() => buildPostGateDeliveryManifest({ turnResult: result }), /COMPANION_UNAVAILABLE/);
  }
  const result = await eligible(); const manifest = buildPostGateDeliveryManifest({ turnResult: result });
  assert.equal(postGateDeliveryManifestValid({ ...manifest, extra: true }, { turnResult: result }), false);
  assert.equal(postGateDeliveryManifestValid({ ...manifest, ticket67_candidate_binding: { ...manifest.ticket67_candidate_binding, digest: '0'.repeat(64) } }, { turnResult: result }), false);
  const companion = postGateEligibilityCompanion(result); companion.final_gate.gate_status = 'blocked';
  // Accessors return copies; mutation cannot replace Ticket 68's trusted state.
  assert.equal(postGateDeliveryManifestValid(manifest, { turnResult: result }), true);
});

test('Ticket 68A projects Ticket 65B.1 intents and fails closed for multiple producing intents', async () => {
  for (const [operation, expectedType, expectedLineage] of [['draft', 'draft', []], ['transform', 'draft', ['ca-source-a']], ['summarize', 'summary', ['ca-source-a', 'ca-source-b']]]) {
    const result = await eligible({ operation }); assert.equal(result.status, 'response_eligible', JSON.stringify(result)); const manifest = buildPostGateDeliveryManifest({ turnResult: result });
    assert.equal(manifest.artifact_projection.artifact_type, expectedType); assert.equal(manifest.artifact_projection.generation_operation, operation); assert.deepEqual(manifest.artifact_projection.ordered_lineage_artifact_ids, expectedLineage);
    assert.equal(JSON.stringify(manifest).includes('Texto previo.'), false);
    assert.equal(postGateDeliveryManifestValid({ ...manifest, artifact_projection: { ...manifest.artifact_projection, generation_task_id: `cgt-${'0'.repeat(64)}` } }, { turnResult: result }), false);
  }
  const show = buildPostGateDeliveryManifest({ turnResult: await eligible({ operation: 'show' }) }); assert.equal(show.artifact_projection, null);
  const multiple = await eligible({ multiple: true });
  assert.throws(() => buildPostGateDeliveryManifest({ turnResult: multiple }), error => error instanceof PostGateDeliveryManifestError && error.code === 'POST_GATE_DELIVERY_MANIFEST_MULTIPLE_ARTIFACT_INTENTS');
});

test('Ticket 68A runtime/schema closed-shape parity is explicit', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs/contracts/sales-engine-v2-contract.schema.json'), 'utf8'));
  const definition = schema.$defs.PostGateDeliveryManifest;
  assert.equal(schema.properties.PostGateDeliveryManifest.$ref, '#/$defs/PostGateDeliveryManifest'); assert.equal(definition.additionalProperties, false);
  assert.equal(definition.properties.contract_version.const, 'ticket-68a-v1'); assert.deepEqual(definition.required.length, 12);
  assert.equal(definition.properties.artifact_projection.type.includes('null'), true);
  assert.throws(() => assertPostGateDeliveryManifest({}), /POST_GATE_DELIVERY_MANIFEST_INVALID/);
});
