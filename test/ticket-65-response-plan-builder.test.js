'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildResponsePlan, ResponsePlanError } = require('../lib/sales-engine-v2/response-plan-builder');
const { UNCERTAINTY_REASONS, responsePlanValid } = require('../lib/sales-engine-v2/response-plan-validator');
const { deriveCommercialAuthorizationSubject } = require('../lib/sales-engine-v2/commercial-authorization-subject');
const { deriveAuthorizedActionIdentity } = require('../lib/sales-engine-v2/authorized-action-identity');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs/contracts/sales-engine-v2-contract.schema.json'), 'utf8'));
const at = '2026-09-23T18:00:00.000Z';
function context({ text = 'mensaje actual', artifacts = [], history = [] } = {}) { return { contract_version: '2.0', context_id: 'c-65', locale: 'es-MX', current_message: { role: 'customer', text, occurred_at: at, source_id: 'm-65', canonical_message_id: '11111111-1111-4111-8111-000000000065' }, history, history_metadata: { ordering: 'occurred_at', history_truncated: false, retained_prior_turns: history.length, retained_prior_characters: history.reduce((total, item) => total + item.text.length, 0) }, conversation_artifacts: artifacts, conversation_artifacts_metadata: { ordering: 'occurred_at', artifacts_truncated: false, retained_artifacts: artifacts.length, retained_artifact_characters: artifacts.reduce((total, item) => total + item.text.length, 0) }, session_state: { session_id: 's-65' }, offer_context: { offer_version: '28d-149-v1' }, customer_state: {}, commercial_state: { checkout_sent: false, valid_purchase_confirmation: false }, metadata: { channel: 'whatsapp' }, authoritative_context: {}, informational_context: { knowledge: [] } }; }
function artifact(id, text, index, { operation = 'draft', lineage = [] } = {}) { return { artifact_id: id, artifact_type: operation === 'summarize' ? 'summary' : 'draft', generation_operation: operation, generation_task_id: `cgt-${id.slice(3)}`, logical_reply_key: `reply-${id.slice(3)}`, anchor_message_id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, text, lineage_artifact_ids: lineage, occurred_at: `2026-09-${String(10 + index).padStart(2, '0')}T18:00:00.000Z` }; }
function conversationalTask(operation, artifact_ids = [], current_turn_constraints = [], current_turn_inputs = []) { return { operation, artifact_ids, current_turn_constraints, current_turn_inputs }; }
function obligation(id, category = 'product_fact', extra = {}) { return { id, category, current_turn_evidence: 'mensaje actual', confidence: 'high', ambiguous: false, ...extra, ...(category === 'commercial_purchase_intent' ? deriveCommercialAuthorizationSubject({ campaign: 'standard', offerVersion: '28d-149-v1' }) : {}), ...(category === 'practical_guidance' ? { practical_task: { task_kind: 'organization', bounded_inputs: [{ id: 'bi-1', input_type: 'preparation_step', value: 'cortar', origin: 'current_turn' }] } } : {}), ...(category === 'conversational_task' && !extra.conversational_task ? { conversational_task: conversationalTask('draft', [], [], [{ input_type: 'draft_specification', value: 'mensaje', origin: 'current_turn' }]) } : {}) }; }
function base(id, fields) { return { obligation_id: id, allowed_claims: [], prohibited_claims: [], customer_uncertainty_required: false, llm_reasoning_permitted: false, ...fields }; }
function fact(id) { return base(id, { resolution_status: 'resolved', authority: 'canonical_fact', source: { type: 'canonical_fact', id: 'offer.price', version: '1' }, factual_payload: { amount: 149, currency: 'MXN' } }); }
function policy(id, authority = 'deterministic_policy', extra = {}) { return base(id, { resolution_status: authority === 'prohibited' ? 'prohibited' : 'resolved', authority, source: { type: 'deterministic_policy', id: 'policy-65', version: '1' }, policy_decision: { reason_code: 'TEST' }, ...extra }); }
function commercial(id, policyId, actionType) { const subject = deriveCommercialAuthorizationSubject({ campaign: actionType === 'provide_holding_page_destination' ? 'glp1_validation' : 'standard', offerVersion: '28d-149-v1' }); const identity = deriveAuthorizedActionIdentity({ canonicalMessageId: '11111111-1111-4111-8111-000000000065', authorizationSubject: subject, actionType, policy: { id: policyId, version: '1' } }); const action = { action_identity_version: identity.action_identity_version, action_id: identity.action_id, action_type: actionType, authorization_source: 'deterministic_policy', authorizing_rule: `${policyId}.v1`, parameters: {}, preconditions: [], constraints: {}, idempotency: { required: true, key_scope: 'inbound_message', execution_key_version: identity.execution_key_version, execution_key: identity.execution_key }, status: 'authorized' }; return base(id, { resolution_status: 'resolved', authority: 'commercial_authorization', source: { type: 'deterministic_policy', id: policyId, version: '1' }, policy_decision: { outcome: 'authorized', reason_code: 'CHECKOUT_AUTHORIZED' }, action_authorization: action }); }
function guidance(id, authority = 'generated_guidance') { return base(id, { resolution_status: 'resolved', authority, source: authority === 'generated_guidance' ? { type: authority, id: 'resolver', version: '1', model_run_id: 'run-65', generation_stage: 'bounded_reasoning' } : { type: authority, id: 'resolver', version: '1' }, ...(authority === 'reviewed_knowledge' ? { retrieved_knowledge_references: [{ type: 'reviewed_knowledge', id: 'rk-65', version: '1' }] } : {}), llm_reasoning_permitted: authority === 'generated_guidance', guidance_payload: { semantic_safety_validation_required: true, units: authority === 'reviewed_knowledge' ? [{ unit_type: 'reviewed_information', content: 'Contenido revisado.', reviewed_knowledge_reference_ids: ['rk-65'] }] : [{ unit_type: 'organization', content: 'Primero corta.', bounded_input_ids: ['bi-1'] }] } }); }
function gate(id, status = 'cleared') { const finding = status === 'blocked' ? { code: 'commercial_claim', severity: 'blocking', unit_index: 0, rationale: 'riesgo' } : status === 'indeterminate' ? { code: 'unsupported_external_fact', severity: 'review_required', unit_index: 0, rationale: 'revisión' } : null; return { obligation_id: id, gate_id: 'semantic-guidance-safety-gate', gate_version: 'ticket-64-v1', gate_status: status, findings: finding ? [finding] : [], assessment_source: { assessment_stage: 'semantic_guidance_safety', assessor_run_id: 'a-65', outcome: 'completed' } }; }
function input(obligations, resolved, gates = [], authorizedActions = [], contextValue = context()) { return { context: contextValue, obligations, resolvedObligations: resolved, semanticGuidanceGates: gates, authorizedActions }; }

test('Ticket 65 builds a closed, deterministic plan for facts, policy, unknown, clarification, and cleared guidance', () => {
  const obligations = [obligation('o-fact'), obligation('o-policy', 'medication_management'), obligation('o-unknown', 'provider_service_fact'), obligation('o-clarify', 'clarification', { subject: 'timing' }), obligation('o-guide', 'practical_guidance')];
  const resolved = [fact('o-fact'), policy('o-policy', 'prohibited', { prohibited_claims: ['medication_change'] }), base('o-unknown', { resolution_status: 'unknown', authority: 'bounded_unknown', source: null, customer_uncertainty_required: true }), base('o-clarify', { resolution_status: 'clarification_required', authority: 'clarification_required', source: null }), guidance('o-guide')];
  const raw = input(obligations, resolved, [gate('o-guide')]); const before = structuredClone(raw);
  const plan = buildResponsePlan(raw);
  assert.deepEqual(plan.obligation_ids, obligations.map(value => value.id));
  assert.deepEqual(plan.required_coverage.map(value => value.handling), ['express_fact', 'express_policy', 'express_uncertainty', 'request_clarification', 'express_guidance']);
  assert.equal(plan.question_budget, 1); assert.equal(plan.permitted_guidance.length, 1); assert.equal(plan.permitted_guidance[0].semantic_gate.gate_status, 'cleared');
  assert.deepEqual(raw, before); assert.deepEqual(buildResponsePlan(raw), plan); assert.equal(responsePlanValid(plan), true);
});

test('Ticket 65 blocks or bounds unsafe guidance without leaking its natural-language content', () => {
  for (const status of ['blocked', 'indeterminate']) {
    const raw = input([obligation('o-guide', 'practical_guidance')], [guidance('o-guide')], [gate('o-guide', status)]);
    const plan = buildResponsePlan(raw);
    assert.equal(plan.permitted_guidance.length, 0);
    assert.equal(plan.required_coverage[0].handling, status === 'blocked' ? 'withhold_safety' : 'withhold_indeterminate');
    assert.equal(JSON.stringify(plan).includes('Primero corta.'), false);
    assert.equal(plan.bounded_uncertainties.length, status === 'indeterminate' ? 1 : 0);
  }
});

test('Ticket 65 permits reviewed guidance, accepts an empty upstream obligation set, and caps multiple clarifications at one question', () => {
  const reviewedPlan = buildResponsePlan(input([obligation('o-reviewed', 'practical_guidance')], [guidance('o-reviewed', 'reviewed_knowledge')], [gate('o-reviewed')]));
  assert.equal(reviewedPlan.permitted_guidance[0].authority, 'reviewed_knowledge');
  const empty = buildResponsePlan(input([], []));
  assert.deepEqual(empty.obligation_ids, []); assert.equal(empty.question_budget, 0); assert.equal(responsePlanValid(empty), true);
  const clarifications = buildResponsePlan(input([obligation('o-c1', 'clarification'), obligation('o-c2', 'clarification')], [base('o-c1', { resolution_status: 'clarification_required', authority: 'clarification_required', source: null }), base('o-c2', { resolution_status: 'clarification_required', authority: 'clarification_required', source: null })]));
  assert.equal(clarifications.clarification_requirements.length, 2); assert.equal(clarifications.question_budget, 1);
});

test('Ticket 65 preserves bounded deferred handling and resolver failures without making them answerable', () => {
  const obligations = [obligation('o-task', 'conversational_task'), obligation('o-support', 'support_account'), obligation('o-social', 'social_acknowledgement'), obligation('o-fail', 'product_fact')];
  const deferred = stage => base(stage === 'conversational_generation' ? 'o-task' : stage === 'support_resolution' ? 'o-support' : 'o-social', { resolution_status: 'deferred', authority: null, source: null, next_stage: stage });
  const plan = buildResponsePlan(input(obligations, [deferred('conversational_generation'), deferred('support_resolution'), deferred('response_composition'), base('o-fail', { resolution_status: 'failed', authority: 'resolver_failure', source: null })]));
  assert.deepEqual(plan.required_coverage.map(value => value.handling), ['conversational_handling', 'support_unresolved', 'social_acknowledgement', 'resolution_unavailable']);
  assert.deepEqual(plan.bounded_uncertainties.map(value => value.reason), ['support_unresolved', 'resolver_failure']);
  assert.deepEqual(plan.conversational_generation, [{ obligation_id: 'o-task', operation: 'draft', current_turn_inputs: [{ input_type: 'draft_specification', value: 'mensaje', origin: 'current_turn' }], current_turn_constraints: [], artifacts: [] }]);
});

test('Ticket 65A.0 gives Ticket 63 practical bounded_unknown its own terminal uncertainty semantic', () => {
  const practical = obligation('o-practical', 'practical_guidance');
  const product = obligation('o-product', 'product_fact');
  const practicalUnknown = base('o-practical', { resolution_status: 'unknown', authority: 'bounded_unknown', source: null, customer_uncertainty_required: true });
  const productUnknown = base('o-product', { resolution_status: 'unknown', authority: 'bounded_unknown', source: null, customer_uncertainty_required: true });
  const plan = buildResponsePlan(input([practical, product], [practicalUnknown, productUnknown]));
  assert.deepEqual(plan.required_coverage, [{ obligation_id: 'o-practical', handling: 'express_uncertainty' }, { obligation_id: 'o-product', handling: 'express_uncertainty' }]);
  assert.deepEqual(plan.bounded_uncertainties, [
    { obligation_id: 'o-practical', reason: 'practical_guidance_unknown', prohibited_claims: [] },
    { obligation_id: 'o-product', reason: 'canonical_fact_unknown', prohibited_claims: [] },
  ]);
  assert.equal(plan.deferred_obligations.some(item => item.obligation_id === 'o-practical'), false);
  assert.equal(JSON.stringify(plan.bounded_uncertainties).includes('reviewed_knowledge'), false);
  assert.equal(plan.permitted_guidance.length, 0);
  assert.equal(responsePlanValid(plan), true);
  assert.equal(responsePlanValid({ ...plan, bounded_uncertainties: [{ ...plan.bounded_uncertainties[0], source: null }, plan.bounded_uncertainties[1]] }), false);
  assert.equal(responsePlanValid({ ...plan, bounded_uncertainties: [{ ...plan.bounded_uncertainties[0], reason: 'unknown_reason' }, plan.bounded_uncertainties[1]] }), false);
});

test('Ticket 65 validates one-to-one identity and semantic-gate alignment fail closed', () => {
  const raw = input([obligation('o-1')], [fact('o-1')]);
  for (const bad of [{ ...raw, obligations: [obligation('o-1'), obligation('o-1')] }, { ...raw, resolvedObligations: [] }, { ...raw, resolvedObligations: [fact('o-other')] }, { ...raw, semanticGuidanceGates: [gate('o-1')] }, input([obligation('o-guide', 'practical_guidance')], [guidance('o-guide')])]) assert.throws(() => buildResponsePlan(bad), error => error instanceof ResponsePlanError);
  assert.throws(() => buildResponsePlan({ ...raw, resolvedObligations: [fact('o-1'), fact('o-1')] }), error => error.code === 'RESPONSE_PLAN_RESOLUTION_IDS_DUPLICATE');
  assert.throws(() => buildResponsePlan(input([obligation('o-guide', 'practical_guidance')], [guidance('o-guide')], [gate('o-guide'), gate('o-guide')])), error => error.code === 'RESPONSE_PLAN_GATE_IDS_DUPLICATE');
});

test('Ticket 60B-R rejects obsolete reminder actions while preserving launch action alignment', () => {
  const action = { action_type: 'schedule_reminder', authorization_source: 'deterministic_policy', authorizing_rule: 'reminder.v1', parameters: { scheduled_for: '2026-09-24T18:00:00.123+05:30' }, preconditions: [], constraints: {}, idempotency: { required: true, key_scope: 'inbound_message' }, status: 'authorized' };
  const resolution = policy('o-reminder', 'deterministic_policy', { action_authorization: action });
  const raw = input([obligation('o-reminder', 'reminder_request')], [resolution], [], [action]);
  assert.throws(() => buildResponsePlan(raw), error => error.code === 'RESPONSE_PLAN_ACTION_INVALID');
  const launchResolution = commercial('o-buy', 'commercial.checkout.standard', 'provide_checkout_destination');
  const launchRaw = input([obligation('o-buy', 'commercial_purchase_intent')], [launchResolution], [], [launchResolution.action_authorization]);
  assert.deepEqual(buildResponsePlan(launchRaw).authorized_actions, [launchResolution.action_authorization]);
});

test('Ticket 65 prevents authority and action laundering', () => {
  assert.throws(() => buildResponsePlan(input([obligation('o-guide', 'practical_guidance')], [{ ...guidance('o-guide'), authority: 'canonical_fact', source: { type: 'canonical_fact', id: 'f', version: '1' }, llm_reasoning_permitted: false }], [])), error => error instanceof ResponsePlanError);
  const plan = buildResponsePlan(input([obligation('o-social', 'social_acknowledgement')], [base('o-social', { resolution_status: 'deferred', authority: null, source: null, next_stage: 'response_composition' })]));
  assert.deepEqual(plan.authorized_actions, []); assert.equal(plan.prohibited_actions.length, 6); assert.deepEqual(plan.canonical_facts, []); assert.deepEqual(plan.policy_outcomes, []);
});

test('Ticket 65 central schema removes unsafe placeholder fields and closes plan vocabularies', () => {
  const definition = schema.properties.ResponsePlan;
  assert.equal(definition.additionalProperties, false);
  assert.equal(Object.hasOwn(definition.properties, 'resolved_obligations'), false);
  assert.equal(Object.hasOwn(definition.properties, 'permitted_reasoning'), false);
  assert.deepEqual(definition.properties.question_budget.enum, [0, 1]);
  assert.equal(definition.properties.permitted_guidance.items.properties.semantic_gate.properties.gate_status.const, 'cleared');
  assert.deepEqual(definition.properties.conversational_generation.items.properties.operation.enum, ['draft', 'transform', 'summarize', 'show']);
  assert.deepEqual(definition.properties.commercial_semantics.items.properties.commercial_intent.enum, ['checkout_offer', 'holding_page_offer']);
  assert.equal(definition.properties.commercial_semantics.items.properties.semantics_version.const, 'ticket-65c-v1');
  assert.equal(definition.properties.prohibited_actions.uniqueItems, true);
});

test('Ticket 65 schema conditionally couples permitted-guidance authority, provenance, and reviewed references', () => {
  const item = schema.properties.ResponsePlan.properties.permitted_guidance.items;
  const [reviewed, generated] = item.allOf;
  assert.equal(reviewed.if.properties.authority.const, 'reviewed_knowledge');
  assert.equal(reviewed.then.properties.source.allOf[1].properties.type.const, 'reviewed_knowledge');
  assert.deepEqual(reviewed.then.required, ['retrieved_knowledge_references']);
  assert.equal(reviewed.then.properties.retrieved_knowledge_references.minItems, 1);
  assert.equal(generated.if.properties.authority.const, 'generated_guidance');
  assert.equal(generated.then.properties.source.allOf[1].properties.type.const, 'generated_guidance');
  assert.equal(generated.then.required, undefined);
});

test('Ticket 65 executable validator rejects guidance authority laundering and missing reviewed references', () => {
  const generatedPlan = buildResponsePlan(input([obligation('o-generated', 'practical_guidance')], [guidance('o-generated')], [gate('o-generated')]));
  assert.equal(responsePlanValid(generatedPlan), true);
  assert.equal(responsePlanValid({ ...generatedPlan, permitted_guidance: [{ ...generatedPlan.permitted_guidance[0], authority: 'reviewed_knowledge' }] }), false);
  const reviewedPlan = buildResponsePlan(input([obligation('o-reviewed', 'practical_guidance')], [guidance('o-reviewed', 'reviewed_knowledge')], [gate('o-reviewed')]));
  assert.equal(responsePlanValid(reviewedPlan), true);
  assert.equal(responsePlanValid({ ...reviewedPlan, permitted_guidance: [{ ...reviewedPlan.permitted_guidance[0], authority: 'generated_guidance' }] }), false);
  const { retrieved_knowledge_references, ...withoutReferences } = reviewedPlan.permitted_guidance[0];
  assert.equal(responsePlanValid({ ...reviewedPlan, permitted_guidance: [withoutReferences] }), false);
  assert.equal(responsePlanValid({ ...generatedPlan, permitted_guidance: [{ ...generatedPlan.permitted_guidance[0], retrieved_knowledge_references: undefined }] }), false);
  const { retrieved_knowledge_references: generatedReferences, ...generatedWithoutReferences } = generatedPlan.permitted_guidance[0];
  assert.equal(responsePlanValid({ ...generatedPlan, permitted_guidance: [generatedWithoutReferences] }), true);
});

test('Ticket 65 bounds canonical and practical unknown provenance distinctly', () => {
  const plan = buildResponsePlan(input([obligation('o-unknown', 'provider_service_fact')], [base('o-unknown', { resolution_status: 'unknown', authority: 'bounded_unknown', source: null, customer_uncertainty_required: true })]));
  assert.equal(responsePlanValid(plan), true);
  assert.equal(responsePlanValid({ ...plan, bounded_uncertainties: [{ ...plan.bounded_uncertainties[0], source: { type: 'generated_guidance', id: 'x', version: '1', model_run_id: 'run', generation_stage: 'bounded_reasoning' } }] }), false);
  const uncertainty = schema.properties.ResponsePlan.properties.bounded_uncertainties.items;
  assert.equal(UNCERTAINTY_REASONS.has('practical_guidance_unknown'), true);
  assert.equal(uncertainty.properties.reason.enum.includes('practical_guidance_unknown'), true);
  assert.equal(uncertainty.allOf[0].then.properties.source.anyOf[1].allOf[1].properties.type.const, 'canonical_fact');
  assert.equal(uncertainty.allOf[1].if.properties.reason.enum.includes('practical_guidance_unknown'), true);
  assert.deepEqual(uncertainty.allOf[1].then.not.required, ['source']);
});

test('Ticket 65B projects explicit bounded draft material rather than extraction evidence', () => {
  const text = 'Escribe un mensaje para decirle a mi hermana que llegaré tarde.';
  const task = conversationalTask('draft', [], [], [{ input_type: 'draft_specification', value: 'un mensaje para decirle a mi hermana que llegaré tarde', origin: 'current_turn' }]);
  const raw = input([obligation('o-draft', 'conversational_task', { current_turn_evidence: 'Escribe un mensaje', conversational_task: task })], [base('o-draft', { resolution_status: 'deferred', authority: null, source: null, next_stage: 'conversational_generation' })], [], [], context({ text }));
  const plan = buildResponsePlan(raw);
  assert.deepEqual(plan.conversational_generation, [{ obligation_id: 'o-draft', operation: 'draft', current_turn_inputs: task.current_turn_inputs, current_turn_constraints: [], artifacts: [] }]);
  assert.equal(JSON.stringify(plan.conversational_generation).includes('Escribe un mensaje'), false);
  assert.deepEqual(raw.obligations[0].conversational_task, task);
});

test('Ticket 65B projects only selected Ticket 60A artifacts in explicit deterministic order', () => {
  const draft = artifact('ca-draft', 'Borrador con precio antiguo de $99.', 1);
  const transformed = artifact('ca-transform', 'Versión corta.', 2, { operation: 'transform', lineage: ['ca-draft'] });
  const summary = artifact('ca-summary', 'Resumen breve.', 3, { operation: 'summarize', lineage: ['ca-draft', 'ca-transform'] });
  const text = 'Hazlo más corto y luego resúmelos.';
  const transformTask = conversationalTask('transform', ['ca-transform'], [{ value: 'más corto', origin: 'current_turn' }]);
  const summarizeTask = conversationalTask('summarize', ['ca-draft', 'ca-summary']);
  const obligations = [obligation('o-transform', 'conversational_task', { current_turn_evidence: 'Hazlo más corto', conversational_task: transformTask }), obligation('o-summary', 'conversational_task', { current_turn_evidence: 'resúmelos', conversational_task: summarizeTask })];
  const deferred = id => base(id, { resolution_status: 'deferred', authority: null, source: null, next_stage: 'conversational_generation' });
  const plan = buildResponsePlan(input(obligations, [deferred('o-transform'), deferred('o-summary')], [], [], context({ text, artifacts: [draft, transformed, summary], history: [{ role: 'assistant', text: 'historial ordinario', occurred_at: '2026-09-01T18:00:00.000Z', source_id: 'm-history', final_visible: true }] })));
  assert.deepEqual(plan.conversational_generation, [
    { obligation_id: 'o-transform', operation: 'transform', current_turn_inputs: [], current_turn_constraints: [{ value: 'más corto', origin: 'current_turn' }], artifacts: [{ artifact_id: 'ca-transform', text: 'Versión corta.' }] },
    { obligation_id: 'o-summary', operation: 'summarize', current_turn_inputs: [], current_turn_constraints: [], artifacts: [{ artifact_id: 'ca-draft', text: 'Borrador con precio antiguo de $99.' }, { artifact_id: 'ca-summary', text: 'Resumen breve.' }] }
  ]);
  assert.equal(JSON.stringify(plan.conversational_generation).includes('historial ordinario'), false);
  assert.deepEqual(plan.canonical_facts, []); assert.deepEqual(plan.policy_outcomes, []); assert.deepEqual(plan.authorized_actions, []);
});

test('Ticket 65B projects show exactly once and rejects missing, invented, and malformed conversational semantics', () => {
  const shown = artifact('ca-show', 'Material para mostrar.', 1);
  const task = conversationalTask('show', ['ca-show']);
  const raw = input([obligation('o-show', 'conversational_task', { current_turn_evidence: 'Muéstramelo otra vez', conversational_task: task })], [base('o-show', { resolution_status: 'deferred', authority: null, source: null, next_stage: 'conversational_generation' })], [], [], context({ text: 'Muéstramelo otra vez', artifacts: [shown] }));
  const plan = buildResponsePlan(raw);
  assert.deepEqual(plan.conversational_generation[0].artifacts, [{ artifact_id: 'ca-show', text: 'Material para mostrar.' }]);
  assert.equal(responsePlanValid({ ...plan, conversational_generation: [] }), false);
  assert.equal(responsePlanValid({ ...plan, conversational_generation: [...plan.conversational_generation, plan.conversational_generation[0]] }), false);
  assert.equal(responsePlanValid({ ...plan, conversational_generation: [{ ...plan.conversational_generation[0], operation: 'draft' }] }), false);
  const invented = structuredClone(raw); invented.obligations[0].conversational_task.artifact_ids = ['ca-missing'];
  assert.throws(() => buildResponsePlan(invented), error => error.code === 'RESPONSE_PLAN_OBLIGATION_INVALID');
  const copiedHistory = structuredClone(raw); copiedHistory.obligations[0].conversational_task.current_turn_inputs = [{ input_type: 'draft_specification', value: 'Material para mostrar.', origin: 'current_turn' }];
  assert.throws(() => buildResponsePlan(copiedHistory), error => error.code === 'RESPONSE_PLAN_OBLIGATION_INVALID');
});

test('Ticket 65B keeps a current product fact independent from a selected stale conversational artifact', () => {
  const selected = artifact('ca-price-draft', 'El precio es $99.', 1);
  const task = conversationalTask('transform', ['ca-price-draft'], [{ value: 'más corto', origin: 'current_turn' }]);
  const obligations = [
    obligation('o-transform', 'conversational_task', { current_turn_evidence: 'Hazlo más corto', conversational_task: task }),
    obligation('o-price', 'product_fact', { current_turn_evidence: 'cuesta $149' })
  ];
  const resolutions = [
    base('o-transform', { resolution_status: 'deferred', authority: null, source: null, next_stage: 'conversational_generation' }),
    fact('o-price')
  ];
  const plan = buildResponsePlan(input(obligations, resolutions, [], [], context({ text: 'Hazlo más corto y cuesta $149.', artifacts: [selected] })));
  assert.deepEqual(plan.conversational_generation[0].artifacts, [{ artifact_id: 'ca-price-draft', text: 'El precio es $99.' }]);
  assert.deepEqual(plan.canonical_facts, [{ obligation_id: 'o-price', source: { type: 'canonical_fact', id: 'offer.price', version: '1' }, factual_payload: { amount: 149, currency: 'MXN' }, allowed_claims: [], prohibited_claims: [] }]);
  assert.equal(plan.policy_outcomes.length, 0); assert.equal(plan.authorized_actions.length, 0);
});

test('Ticket 65C maps only reachable standard checkout and holding-page authorizations to closed commercial semantics', () => {
  const standard = commercial('o-buy', 'commercial.checkout.standard', 'provide_checkout_destination');
  const holding = commercial('o-hold', 'commercial.checkout.glp1_canary', 'provide_holding_page_destination');
  const obligations = [obligation('o-buy', 'commercial_purchase_intent'), obligation('o-hold', 'commercial_purchase_intent')];
  const raw = input(obligations, [standard, holding], [], [standard.action_authorization, holding.action_authorization]);
  const before = structuredClone(raw);
  const plan = buildResponsePlan(raw);
  assert.deepEqual(plan.required_coverage.map(item => item.handling), ['commercial_handling', 'commercial_handling']);
  assert.deepEqual(plan.commercial_semantics, [
    { obligation_id: 'o-buy', semantics_version: 'ticket-65c-v1', commercial_intent: 'checkout_offer', destination: { status: 'authorized_to_provide' } },
    { obligation_id: 'o-hold', semantics_version: 'ticket-65c-v1', commercial_intent: 'holding_page_offer', destination: { status: 'authorized_to_provide' } }
  ]);
  assert.equal(JSON.stringify(plan.commercial_semantics).includes('CHECKOUT_AUTHORIZED'), false);
  assert.equal(JSON.stringify(plan.commercial_semantics).includes('provide_checkout_destination'), false);
  assert.equal(JSON.stringify(plan.commercial_semantics).includes('parameters'), false);
  assert.deepEqual(raw, before); assert.deepEqual(plan.authorized_actions, [standard.action_authorization, holding.action_authorization]);
});

test('Ticket 65C fails closed for unmapped commercial authorization and standalone plan violations', () => {
  const known = commercial('o-buy', 'commercial.checkout.standard', 'provide_checkout_destination');
  const raw = input([obligation('o-buy', 'commercial_purchase_intent')], [known], [], [known.action_authorization]);
  const plan = buildResponsePlan(raw);
  assert.equal(responsePlanValid({ ...plan, commercial_semantics: [] }), false);
  assert.equal(responsePlanValid({ ...plan, commercial_semantics: [...plan.commercial_semantics, plan.commercial_semantics[0]] }), false);
  assert.equal(responsePlanValid({ ...plan, commercial_semantics: [{ ...plan.commercial_semantics[0], obligation_id: 'o-other' }] }), false);
  assert.equal(responsePlanValid({ ...plan, commercial_semantics: [{ ...plan.commercial_semantics[0], semantics_version: 'ticket-65c-v2' }] }), false);
  const { semantics_version, ...withoutVersion } = plan.commercial_semantics[0];
  assert.equal(responsePlanValid({ ...plan, commercial_semantics: [withoutVersion] }), false);
  assert.equal(responsePlanValid({ ...plan, commercial_semantics: [{ ...plan.commercial_semantics[0], destination: { status: 'delivered' } }] }), false);
  const unknown = commercial('o-buy', 'commercial.checkout.unknown', 'provide_checkout_destination');
  assert.throws(() => buildResponsePlan(input([obligation('o-buy', 'commercial_purchase_intent')], [unknown], [], [unknown.action_authorization])), error => error.code === 'RESPONSE_PLAN_COMMERCIAL_SEMANTICS_INVALID');
});

test('Ticket 65C keeps product facts and Ticket 65B conversational material independent from purchase semantics', () => {
  const purchase = commercial('o-buy', 'commercial.checkout.standard', 'provide_checkout_destination');
  const task = conversationalTask('draft', [], [], [{ input_type: 'draft_specification', value: 'mensaje', origin: 'current_turn' }]);
  const obligations = [obligation('o-price'), obligation('o-buy', 'commercial_purchase_intent'), obligation('o-draft', 'conversational_task', { conversational_task: task })];
  const deferred = base('o-draft', { resolution_status: 'deferred', authority: null, source: null, next_stage: 'conversational_generation' });
  const plan = buildResponsePlan(input(obligations, [fact('o-price'), purchase, deferred], [], [purchase.action_authorization]));
  assert.equal(plan.canonical_facts.length, 1);
  assert.deepEqual(plan.commercial_semantics, [{ obligation_id: 'o-buy', semantics_version: 'ticket-65c-v1', commercial_intent: 'checkout_offer', destination: { status: 'authorized_to_provide' } }]);
  assert.deepEqual(plan.conversational_generation, [{ obligation_id: 'o-draft', operation: 'draft', current_turn_inputs: task.current_turn_inputs, current_turn_constraints: [], artifacts: [] }]);
});
