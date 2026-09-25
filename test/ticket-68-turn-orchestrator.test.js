'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationContext } = require('../lib/sales-engine-v2/memory-adapter');
const { createFactResolver } = require('../lib/sales-engine-v2/fact-resolver');
const { createPolicyResolver } = require('../lib/sales-engine-v2/policy-resolver');
const { createReviewedKnowledgeStore } = require('../lib/sales-engine-v2/reviewed-knowledge-store');
const { artifactOutputIntentCompanion, runSalesEngineV2Turn, turnResultValid, FAILURE_STAGES, executeLaunchActions, launchCardinalitySupported } = require('../lib/sales-engine-v2/turn-orchestrator');
const facts = require('../config/sales-engine-v2/product-facts.json');
const membership = require('../config/sales-engine-v2/fact-membership.json');
const policies = require('../config/sales-engine-v2/policies.json');
const knowledge = require('../config/sales-engine-v2/reviewed-knowledge.json');

function context(text = 'Gracias', conversationArtifacts = []) {
  return createConversationContext({
    currentTurn: { id: 'inbound-68', canonical_message_id: '11111111-1111-4111-8111-000000000068', text, received_at: '2026-09-25T12:00:00.000Z' },
    memory: [], conversationArtifacts,
    runtimeMetadata: { conversation_id: 'conversation-68', session_id: 'session-68', channel: 'whatsapp', offer_version: '28d-149-v1', campaign: 'standard' },
  });
}
function artifact() { return { artifact: { contract_version: '1.0', artifact_id: 'ca-68', artifact_type: 'draft', generation_operation: 'draft', generation_task_id: 'cgt-68', logical_reply_key: 'reply-68', anchor_message_id: '11111111-1111-4111-8111-000000000067' }, lineage: [], messages: [{ id: '11111111-1111-4111-8111-000000000067', direction: 'outbound', body: 'Texto previo.', timestamp: '2026-09-25T11:00:00.000Z', idempotency_key: 'reply-68', metadata: { logical_reply_key: 'reply-68', part_index: 1, part_count: 1 } }] }; }
function dependencies({ finalFindings = [] } = {}) {
  return {
    interpreterAdapter: async () => ({ obligations: [{ category: 'social_acknowledgement', current_turn_evidence: 'Gracias', confidence: 'high', ambiguous: false }] }),
    factResolver: { resolveFact() { throw new Error('not used'); } }, policyResolver: { resolvePolicy() { throw new Error('not used'); } },
    composerAdapter: () => ({ segments: [{ obligation_id: 'o-1', text: 'Gracias.' }] }),
    finalResponseAssessor: () => ({ findings: finalFindings }),
  };
}
const runContext = { asOf: '2026-09-25T12:00:00.000Z', composerModelRunId: 'composer-68', finalResponseAssessorRunId: 'gate-68' };

function canonicalDependencies(obligations, options = {}) {
  return {
    interpreterAdapter: async () => ({ obligations }),
    factResolver: createFactResolver({ facts: facts.facts, membershipDefinitions: membership }),
    policyResolver: createPolicyResolver({ policies: policies.policies }),
    knowledgeStore: createReviewedKnowledgeStore({ items: knowledge.items }),
    boundedReasoningAdapter: () => ({ units: [{ unit_type: 'organization', content: 'Ordena este paso.', bounded_input_ids: ['bi-1'] }] }),
    semanticGuidanceAssessor: () => ({ findings: options.guidanceFindings || [] }),
    artifactReproductionAssessor: () => ({ findings: options.artifactFindings || [] }),
    composerAdapter: request => ({ segments: request.input.obligation_outcomes.map(outcome => ({ obligation_id: outcome.obligation_id, text: outcome.type === 'permitted_guidance' ? outcome.guidance_payload.units[0].content : outcome.type === 'bounded_uncertainty' ? 'No puedo confirmarlo en esta respuesta.' : outcome.type === 'support_unresolved' ? 'No puedo resolver esa solicitud en esta respuesta.' : outcome.type === 'conversational_generation' && outcome.safety_outcome !== 'reproduction_allowed' ? 'No puedo proporcionarlo en esta respuesta.' : 'Gracias.' })) }),
    finalResponseAssessor: () => ({ findings: options.finalFindings || [] }),
  };
}
const fullRunContext = { ...runContext, boundedReasoningRunId: 'reason-68', semanticGuidanceAssessorRunId: 'guidance-68', artifactReproductionAssessorRunId: 'artifact-68' };

test('Ticket 68 coordinates canonical social stages, exposes no delivery claim, and is deterministic', async () => {
  const input = { conversationContext: context(), dependencies: dependencies(), runContext };
  const first = await runSalesEngineV2Turn(input);
  const second = await runSalesEngineV2Turn(input);
  assert.deepEqual(first, second);
  assert.equal(turnResultValid(first), true);
  assert.equal(first.status, 'response_eligible');
  assert.equal(first.customer_response.text, 'Gracias.');
  assert.equal(JSON.stringify(first).match(/delivered|sent|twilio/i), null);
  assert.deepEqual(first.stage_trace.map(item => item.stage), ['context', 'interpretation', 'resolution', 'guidance_resolution', 'planning', 'artifact_assessment', 'action_execution', 'final_composer_input', 'composer', 'final_gate']);
});

test('Ticket 68 fails closed for malformed context and a blocked final gate', async () => {
  const invalid = await runSalesEngineV2Turn({ conversationContext: {}, dependencies: dependencies(), runContext });
  assert.deepEqual(invalid, { turn_result_version: 'ticket-68-v1', contract_version: '2.0', status: 'response_ineligible', failure_stage: 'context', failure_code: 'context_invalid', stage_trace: [{ stage: 'context', status: 'failed' }] });
  assert.equal(turnResultValid(invalid), true);
  const blocked = await runSalesEngineV2Turn({ conversationContext: context(), dependencies: dependencies({ finalFindings: [{ code: 'other_semantic_risk', evidence: { excerpt: 'Gracias.', rationale: 'test' } }] }), runContext });
  assert.equal(blocked.status, 'response_ineligible');
  assert.equal(blocked.failure_code, 'final_response_blocked');
  assert.equal('customer_response' in blocked, false);
});

test('Ticket 68 runs reviewed and generated guidance through canonical Ticket 63/63A/64/64B lifecycle', async () => {
  const reviewed = [{ category: 'practical_guidance', subject: 'meal_preparation', current_turn_evidence: 'preparar', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'knowledge_question', bounded_inputs: [] } }];
  const generated = [{ category: 'practical_guidance', subject: 'organizar', current_turn_evidence: 'organizar', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'organization', bounded_inputs: [{ input_type: 'preparation_step', value: 'organizar' }] } }];
  for (const obligations of [reviewed, generated]) {
    const value = await runSalesEngineV2Turn({ conversationContext: context(obligations[0].current_turn_evidence), dependencies: canonicalDependencies(obligations), runContext: fullRunContext });
    assert.equal(value.status, 'response_eligible', JSON.stringify(value));
  }
});

test('Ticket 68 retains blocked and indeterminate guidance as withheld bounded semantics', async () => {
  const obligations = [{ category: 'practical_guidance', subject: 'organizar', current_turn_evidence: 'organizar', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'organization', bounded_inputs: [{ input_type: 'preparation_step', value: 'organizar' }] } }];
  for (const findings of [[{ code: 'commercial_claim', unit_index: 0, rationale: 'blocked' }], [{ code: 'safety_sensitive_guidance', unit_index: 0, rationale: 'review' }]]) {
    let seen; const deps = canonicalDependencies(obligations, { guidanceFindings: findings }); const original = deps.composerAdapter; deps.composerAdapter = request => { seen = request.input; return original(request); };
    const value = await runSalesEngineV2Turn({ conversationContext: context('organizar'), dependencies: deps, runContext: fullRunContext });
    assert.equal(value.status, 'response_eligible'); assert.equal(JSON.stringify(seen).includes('Ordena este paso.'), false);
  }
});

test('Ticket 68 preserves support and social deferred handling through Ticket 65E', async () => {
  const obligations = [{ category: 'support_account', subject: 'other', current_turn_evidence: 'ayuda', confidence: 'high', ambiguous: false }, { category: 'social_acknowledgement', current_turn_evidence: 'gracias', confidence: 'high', ambiguous: false }];
  const value = await runSalesEngineV2Turn({ conversationContext: context('ayuda gracias'), dependencies: canonicalDependencies(obligations), runContext: fullRunContext });
  assert.equal(value.status, 'response_eligible');
});

test('Ticket 68 runtime/schema failure vocabulary is closed', () => {
  assert.deepEqual([...FAILURE_STAGES], ['context', 'interpretation', 'resolution', 'guidance_resolution', 'guidance_assessment', 'artifact_assessment', 'planning', 'action_execution', 'final_composer_input', 'composer', 'final_gate']);
  assert.equal(turnResultValid({ turn_result_version: 'ticket-68-v1', contract_version: '2.0', status: 'response_ineligible', failure_stage: 'forged', failure_code: 'composer_unavailable', stage_trace: [] }), false);
});

test('Ticket 68 launch boundary rejects a multiple-action plan before executor selection', async () => {
  const actions = [{ action_id: 'act-a' }, { action_id: 'act-b' }]; let executorCalls = 0; let providerCalls = 0;
  const result = await executeLaunchActions(actions, async () => { executorCalls += 1; providerCalls += 1; });
  assert.equal(launchCardinalitySupported(actions), false);
  assert.equal(result, null);
  assert.equal(executorCalls, 0); assert.equal(providerCalls, 0);
});

test('Ticket 68 routes draft and reproduction operations through Ticket 64A without leaking withheld artifacts', async () => {
  const source = artifact();
  for (const [operation, findings] of [['draft', []], ['show', []], ['transform', [{ code: 'commercial_claim', artifact_id: 'ca-68', rationale: 'blocked' }]], ['summarize', [{ code: 'other_reproduction_risk', artifact_id: 'ca-68', rationale: 'review' }]]]) {
    const task = operation === 'draft' ? { operation, artifact_ids: [], current_turn_constraints: [], current_turn_inputs: [{ input_type: 'draft_specification', value: 'un mensaje' }] } : { operation, artifact_ids: ['ca-68'], current_turn_constraints: operation === 'transform' ? [{ value: 'corto' }] : [], current_turn_inputs: [] };
    const text = operation === 'transform' ? 'corto' : operation === 'draft' ? 'un mensaje' : 'muestralo'; const obligations = [{ category: 'conversational_task', subject: operation, current_turn_evidence: text, confidence: 'high', ambiguous: false, attributes: { task_operation: operation }, conversational_task: task }];
    let seen; const deps = canonicalDependencies(obligations, { artifactFindings: findings }); const original = deps.composerAdapter; deps.composerAdapter = request => { seen = request.input; return original(request); };
    const value = await runSalesEngineV2Turn({ conversationContext: context(text, operation === 'draft' ? [] : [source]), dependencies: deps, runContext: fullRunContext });
    assert.equal(value.status, 'response_eligible'); if (findings.length) assert.equal(seen.obligation_outcomes[0].artifacts.length, 0);
  }
});

test('Ticket 68 privately preserves pre-composition artifact output intent only for an eligible response', async () => {
  const obligations = [{ category: 'conversational_task', subject: 'draft', current_turn_evidence: 'un mensaje', confidence: 'high', ambiguous: false, attributes: { task_operation: 'draft' }, conversational_task: { operation: 'draft', artifact_ids: [], current_turn_constraints: [], current_turn_inputs: [{ input_type: 'draft_specification', value: 'un mensaje' }] } }];
  const value = await runSalesEngineV2Turn({ conversationContext: context('un mensaje'), dependencies: canonicalDependencies(obligations), runContext: fullRunContext });
  assert.equal(value.status, 'response_eligible'); assert.equal(Object.hasOwn(value, 'artifact_output_intents'), false);
  const companion = artifactOutputIntentCompanion(value); assert.equal(companion.length, 1); assert.match(companion[0].artifact_id, /^ca-[0-9a-f]{64}$/);
  companion[0].artifact_id = 'ca-forged'; assert.notEqual(artifactOutputIntentCompanion(value)[0].artifact_id, 'ca-forged');
  const blocked = await runSalesEngineV2Turn({ conversationContext: context('un mensaje'), dependencies: canonicalDependencies(obligations, { finalFindings: [{ code: 'other_semantic_risk', evidence: { excerpt: 'Gracias.', rationale: 'blocked' } }] }), runContext: fullRunContext });
  assert.equal(blocked.status, 'response_ineligible'); assert.equal(artifactOutputIntentCompanion(blocked), null);
});

test('Ticket 68 executes one canonical commercial action before composition and reuses its durable result', async () => {
  const calls = []; let completed;
  const obligation = [{ category: 'commercial_purchase_intent', subject: 'explicit_current_request', current_turn_evidence: 'quiero comprar', confidence: 'high', ambiguous: false }];
  const deps = canonicalDependencies(obligation);
  deps.actionReservationStore = { async reserve(input) { calls.push(['reserve', input]); return completed ? { state: 'already_succeeded', action_id: input.action_id, execution_key: input.execution_key, result: completed } : { state: 'acquired', action_id: input.action_id, execution_key: input.execution_key }; }, async succeed(input) { calls.push(['succeed', input]); completed = input.result; }, async fail() {} };
  deps.actionProviders = { async createCheckoutDestination(input) { calls.push(['provider', input]); return { kind: 'checkout', url: 'https://checkout.stripe.com/c/ticket68' }; } };
  deps.composerAdapter = request => ({ segments: request.input.obligation_outcomes.map(outcome => ({ obligation_id: outcome.obligation_id, text: `Aquí: ${outcome.customer_action_result.url}` })) });
  const first = await runSalesEngineV2Turn({ conversationContext: context('quiero comprar'), dependencies: deps, runContext: fullRunContext });
  const second = await runSalesEngineV2Turn({ conversationContext: context('quiero comprar'), dependencies: deps, runContext: fullRunContext });
  assert.equal(first.status, 'response_eligible'); assert.equal(second.status, 'response_eligible');
  assert.deepEqual(calls.map(item => item[0]), ['reserve', 'provider', 'succeed', 'reserve']);
  assert.equal(first.action_execution_summary[0].action_id, completed.action_id);
  assert.equal(JSON.stringify(first).match(/delivered|sent|received/i), null);
});

test('Ticket 68 maps composer and final-assessor availability failures without prose, while programming errors propagate', async () => {
  const unavailable = dependencies(); unavailable.composerAdapter = () => { const error = new Error('down'); error.code = 'COMPOSER_MODEL_UNAVAILABLE'; throw error; };
  const composer = await runSalesEngineV2Turn({ conversationContext: context(), dependencies: unavailable, runContext });
  assert.equal(composer.failure_code, 'composer_unavailable'); assert.equal('customer_response' in composer, false);
  const assessor = dependencies(); assessor.finalResponseAssessor = () => { const error = new Error('down'); error.code = 'FINAL_RESPONSE_ASSESSOR_UNAVAILABLE'; throw error; };
  const gate = await runSalesEngineV2Turn({ conversationContext: context(), dependencies: assessor, runContext });
  assert.equal(gate.failure_code, 'final_response_assessment_unavailable'); assert.equal('customer_response' in gate, false);
  const broken = dependencies(); broken.finalResponseAssessor = () => { throw new TypeError('programming fault'); };
  await assert.rejects(() => runSalesEngineV2Turn({ conversationContext: context(), dependencies: broken, runContext }), /programming fault/);
});
