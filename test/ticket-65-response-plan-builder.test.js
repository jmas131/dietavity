'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildResponsePlan, ResponsePlanError } = require('../lib/sales-engine-v2/response-plan-builder');
const { responsePlanValid } = require('../lib/sales-engine-v2/response-plan-validator');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs/contracts/sales-engine-v2-contract.schema.json'), 'utf8'));
const at = '2026-09-23T18:00:00.000Z';
function context() { return { contract_version: '2.0', context_id: 'c-65', locale: 'es-MX', current_message: { role: 'customer', text: 'mensaje actual', occurred_at: at, source_id: 'm-65' }, history: [], history_metadata: { ordering: 'occurred_at', history_truncated: false, retained_prior_turns: 0, retained_prior_characters: 0 }, session_state: { session_id: 's-65' }, offer_context: {}, customer_state: {}, commercial_state: { checkout_sent: false, valid_purchase_confirmation: false }, metadata: { channel: 'whatsapp' }, authoritative_context: {}, informational_context: { knowledge: [] } }; }
function obligation(id, category = 'product_fact', extra = {}) { return { id, category, current_turn_evidence: 'mensaje actual', confidence: 'high', ambiguous: false, ...extra, ...(category === 'practical_guidance' ? { practical_task: { task_kind: 'organization', bounded_inputs: [{ id: 'bi-1', input_type: 'preparation_step', value: 'cortar', origin: 'current_turn' }] } } : {}) }; }
function base(id, fields) { return { obligation_id: id, allowed_claims: [], prohibited_claims: [], customer_uncertainty_required: false, llm_reasoning_permitted: false, ...fields }; }
function fact(id) { return base(id, { resolution_status: 'resolved', authority: 'canonical_fact', source: { type: 'canonical_fact', id: 'offer.price', version: '1' }, factual_payload: { amount: 149, currency: 'MXN' } }); }
function policy(id, authority = 'deterministic_policy', extra = {}) { return base(id, { resolution_status: authority === 'prohibited' ? 'prohibited' : 'resolved', authority, source: { type: 'deterministic_policy', id: 'policy-65', version: '1' }, policy_decision: { reason_code: 'TEST' }, ...extra }); }
function guidance(id, authority = 'generated_guidance') { return base(id, { resolution_status: 'resolved', authority, source: authority === 'generated_guidance' ? { type: authority, id: 'resolver', version: '1', model_run_id: 'run-65', generation_stage: 'bounded_reasoning' } : { type: authority, id: 'resolver', version: '1' }, ...(authority === 'reviewed_knowledge' ? { retrieved_knowledge_references: [{ type: 'reviewed_knowledge', id: 'rk-65', version: '1' }] } : {}), llm_reasoning_permitted: authority === 'generated_guidance', guidance_payload: { semantic_safety_validation_required: true, units: authority === 'reviewed_knowledge' ? [{ unit_type: 'reviewed_information', content: 'Contenido revisado.', reviewed_knowledge_reference_ids: ['rk-65'] }] : [{ unit_type: 'organization', content: 'Primero corta.', bounded_input_ids: ['bi-1'] }] } }); }
function gate(id, status = 'cleared') { const finding = status === 'blocked' ? { code: 'commercial_claim', severity: 'blocking', unit_index: 0, rationale: 'riesgo' } : status === 'indeterminate' ? { code: 'unsupported_external_fact', severity: 'review_required', unit_index: 0, rationale: 'revisión' } : null; return { obligation_id: id, gate_id: 'semantic-guidance-safety-gate', gate_version: 'ticket-64-v1', gate_status: status, findings: finding ? [finding] : [], assessment_source: { assessment_stage: 'semantic_guidance_safety', assessor_run_id: 'a-65', outcome: 'completed' } }; }
function input(obligations, resolved, gates = [], authorizedActions = []) { return { context: context(), obligations, resolvedObligations: resolved, semanticGuidanceGates: gates, authorizedActions }; }

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
});

test('Ticket 65 validates one-to-one identity and semantic-gate alignment fail closed', () => {
  const raw = input([obligation('o-1')], [fact('o-1')]);
  for (const bad of [{ ...raw, obligations: [obligation('o-1'), obligation('o-1')] }, { ...raw, resolvedObligations: [] }, { ...raw, resolvedObligations: [fact('o-other')] }, { ...raw, semanticGuidanceGates: [gate('o-1')] }, input([obligation('o-guide', 'practical_guidance')], [guidance('o-guide')])]) assert.throws(() => buildResponsePlan(bad), error => error instanceof ResponsePlanError);
  assert.throws(() => buildResponsePlan({ ...raw, resolvedObligations: [fact('o-1'), fact('o-1')] }), error => error.code === 'RESPONSE_PLAN_RESOLUTION_IDS_DUPLICATE');
  assert.throws(() => buildResponsePlan(input([obligation('o-guide', 'practical_guidance')], [guidance('o-guide')], [gate('o-guide'), gate('o-guide')])), error => error.code === 'RESPONSE_PLAN_GATE_IDS_DUPLICATE');
});

test('Ticket 65 preserves only exact deterministic-policy authorized actions, including reminder timing', () => {
  const action = { action_type: 'schedule_reminder', authorization_source: 'deterministic_policy', authorizing_rule: 'reminder.v1', parameters: { scheduled_for: '2026-09-24T18:00:00.123+05:30' }, preconditions: [], constraints: {}, idempotency: { required: true, key_scope: 'inbound_message' }, status: 'authorized' };
  const resolution = policy('o-reminder', 'commercial_authorization', { action_authorization: action });
  const raw = input([obligation('o-reminder', 'reminder_request')], [resolution], [], [action]);
  assert.deepEqual(buildResponsePlan(raw).authorized_actions, [action]);
  assert.throws(() => buildResponsePlan({ ...raw, authorizedActions: [] }), error => error.code === 'RESPONSE_PLAN_ACTION_ALIGNMENT_INVALID');
  assert.throws(() => buildResponsePlan({ ...raw, authorizedActions: [{ ...action, parameters: {} }] }), error => error.code === 'RESPONSE_PLAN_ACTION_INVALID');
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

test('Ticket 65 bounds uncertainty provenance to canonical unknowns only', () => {
  const plan = buildResponsePlan(input([obligation('o-unknown', 'provider_service_fact')], [base('o-unknown', { resolution_status: 'unknown', authority: 'bounded_unknown', source: null, customer_uncertainty_required: true })]));
  assert.equal(responsePlanValid(plan), true);
  assert.equal(responsePlanValid({ ...plan, bounded_uncertainties: [{ ...plan.bounded_uncertainties[0], source: { type: 'generated_guidance', id: 'x', version: '1', model_run_id: 'run', generation_stage: 'bounded_reasoning' } }] }), false);
  const uncertainty = schema.properties.ResponsePlan.properties.bounded_uncertainties.items;
  assert.equal(uncertainty.allOf[0].then.properties.source.anyOf[1].allOf[1].properties.type.const, 'canonical_fact');
  assert.deepEqual(uncertainty.allOf[1].then.not.required, ['source']);
});
