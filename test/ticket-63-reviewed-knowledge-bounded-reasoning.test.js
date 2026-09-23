'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReviewedKnowledgeStore, ReviewedKnowledgeStoreError } = require('../lib/sales-engine-v2/reviewed-knowledge-store');
const { PracticalGuidanceResolverError, resolvePracticalGuidance } = require('../lib/sales-engine-v2/practical-guidance-resolver');
const { practicalGuidanceTerminalValid } = require('../lib/sales-engine-v2/resolved-obligation-validator');
const { REVIEWED_KNOWLEDGE_ROUTING } = require('../config/sales-engine-v2/practical-guidance-routing');

const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config/sales-engine-v2/reviewed-knowledge.json'), 'utf8'));
const asOf = '2026-09-22T00:00:01.000Z';
function deferred(id) { return { obligation_id: id, resolution_status: 'deferred', authority: null, source: null, allowed_claims: [], prohibited_claims: [], customer_uncertainty_required: false, llm_reasoning_permitted: false, next_stage: 'reviewed_knowledge_or_reasoning' }; }
function obligation(id, taskKind, subject = 'food_storage', inputs = []) { return { id, category: 'practical_guidance', subject, current_turn_evidence: 'material actual', confidence: 'high', ambiguous: false, practical_task: { task_kind: taskKind, bounded_inputs: inputs } }; }
function input(obligationValue, extra = {}) { return { obligation: obligationValue, deferredResolution: deferred(obligationValue.id), locale: 'es-MX', asOf, knowledgeStore: createReviewedKnowledgeStore({ items: corpus.items }), ...extra }; }
function currentInput(id = 'bi-1', value = 'cortar verduras') { return { id, input_type: 'preparation_step', value, origin: 'current_turn' }; }
function unavailableStore() { return { retrieve() { throw new ReviewedKnowledgeStoreError('KNOWLEDGE_STORE_UNAVAILABLE'); } }; }

test('Ticket 63 retrieves only exact active, locale-matched, effective reviewed knowledge', () => {
  const store = createReviewedKnowledgeStore({ items: corpus.items });
  assert.equal(store.retrieve({ topic: 'food_storage', locale: 'es-MX', asOf, allowedUse: 'direct_reviewed' }).id, 'rk-food-storage-basics');
  assert.equal(store.retrieve({ topic: 'food_storage', locale: 'en-US', asOf, allowedUse: 'direct_reviewed' }), null);
  const variants = ['draft', 'deprecated'].map((status, index) => ({ ...corpus.items[0], id: `rk-${status}`, status, version: index + 2 }));
  variants.push({ ...corpus.items[0], id: 'rk-future', version: 4, valid_from: '2027-01-01T00:00:00.000Z' });
  variants.push({ ...corpus.items[0], id: 'rk-expired', version: 5, valid_from: '2026-09-21T00:00:00.000Z', valid_to: '2026-09-22T00:00:00.000Z' });
  assert.equal(createReviewedKnowledgeStore({ items: variants }).retrieve({ topic: 'food_storage', locale: 'es-MX', asOf, allowedUse: 'direct_reviewed' }), null);
  assert.throws(() => createReviewedKnowledgeStore({ items: [corpus.items[0], { ...corpus.items[0], id: 'rk-overlap', version: 2 }] }).retrieve({ topic: 'food_storage', locale: 'es-MX', asOf, allowedUse: 'direct_reviewed' }), error => error.code === 'KNOWLEDGE_STORE_AMBIGUOUS');
  assert.throws(() => createReviewedKnowledgeStore({ items: [{ ...corpus.items[0], content: '' }] }).retrieve({ topic: 'food_storage', locale: 'es-MX', asOf, allowedUse: 'direct_reviewed' }), error => error.code === 'KNOWLEDGE_ITEM_INVALID');
});

test('Ticket 63 routing is closed subject-to-topic data without ignored behavioral configuration', () => {
  assert.deepEqual(REVIEWED_KNOWLEDGE_ROUTING, { food_storage: { topic: 'food_storage' }, meal_preparation: { topic: 'meal_preparation' } });
  assert.equal(Object.values(REVIEWED_KNOWLEDGE_ROUTING).every(route => Object.keys(route).length === 1 && !Object.hasOwn(route, 'resolution_mode')), true);
});

test('Ticket 63 requires structured reviewed architectural-seed provenance', () => {
  const valid = corpus.items[0];
  assert.equal(createReviewedKnowledgeStore({ items: [valid] }).retrieve({ topic: valid.topic, locale: valid.locale, asOf, allowedUse: 'direct_reviewed' }).id, valid.id);
  const invalidProvenance = [
    'reviewed seed prose',
    { ...valid.provenance, review_status: 'draft' },
    { ...valid.provenance, source_class: 'production_source' },
    { ...valid.provenance, reference: '' },
  ];
  for (const provenance of invalidProvenance) assert.throws(() => createReviewedKnowledgeStore({ items: [{ ...valid, provenance }] }).retrieve({ topic: valid.topic, locale: valid.locale, asOf, allowedUse: 'direct_reviewed' }), error => error.code === 'KNOWLEDGE_ITEM_INVALID');
});

test('Ticket 63 direct reviewed resolution has exact provenance and never calls a model', () => {
  let called = false;
  const origin = obligation('o-storage', 'knowledge_question');
  const result = resolvePracticalGuidance(input(origin, { reasoningModel() { called = true; }, modelRunId: 'run-ignored' }));
  assert.equal(result.authority, 'reviewed_knowledge');
  assert.equal(result.llm_reasoning_permitted, false);
  assert.equal(result.guidance_payload.semantic_safety_validation_required, true);
  assert.deepEqual(result.retrieved_knowledge_references, [{ type: 'reviewed_knowledge', id: 'rk-food-storage-basics', version: '1' }]);
  assert.deepEqual(result.guidance_payload.units[0].reviewed_knowledge_reference_ids, ['rk-food-storage-basics']);
  assert.equal(called, false);
  assert.equal(practicalGuidanceTerminalValid(origin, result), true);
  assert.equal('action_authorization' in result, false);
});

test('Ticket 63 gives truthful unknown outcomes for unmapped and missing reviewed knowledge, and localizes only store unavailability', () => {
  const unmapped = obligation('o-unmapped', 'knowledge_question', 'unmapped_subject');
  const missing = obligation('o-missing', 'knowledge_question');
  const empty = createReviewedKnowledgeStore({ items: [] });
  for (const result of [resolvePracticalGuidance(input(unmapped)), resolvePracticalGuidance(input(missing, { knowledgeStore: empty }))]) {
    assert.deepEqual({ status: result.resolution_status, authority: result.authority, source: result.source, uncertainty: result.customer_uncertainty_required }, { status: 'unknown', authority: 'bounded_unknown', source: null, uncertainty: true });
    assert.equal('guidance_payload' in result, false);
  }
  const failed = resolvePracticalGuidance(input(missing, { knowledgeStore: unavailableStore() }));
  assert.deepEqual({ status: failed.resolution_status, authority: failed.authority, source: failed.source }, { status: 'failed', authority: 'resolver_failure', source: null });
});

test('Ticket 63 generated transformation and organization receive only typed bounded reasoning input', () => {
  for (const taskKind of ['transformation', 'organization']) {
    const origin = obligation(`o-${taskKind}`, taskKind, 'cooking_order', [currentInput('bi-4'), currentInput('bi-5', 'hornear pollo')]);
    let modelRequest;
    const result = resolvePracticalGuidance(input(origin, { modelRunId: `run-${taskKind}`, reasoningModel(request) { modelRequest = request; return { units: [{ unit_type: taskKind, content: 'Prosa estructuralmente válida incluso si fuera insegura.', bounded_input_ids: ['bi-4', 'bi-5'] }] }; } }));
    assert.deepEqual(Object.keys(modelRequest.input).sort(), ['bounded_inputs', 'locale', 'obligation_id', 'prompt_version', 'subject', 'task_kind']);
    assert.equal(JSON.stringify(modelRequest.input).includes('material actual'), false);
    assert.equal(result.authority, 'generated_guidance');
    assert.equal(result.source.model_run_id, `run-${taskKind}`);
    assert.equal(result.llm_reasoning_permitted, true);
    assert.equal(result.guidance_payload.semantic_safety_validation_required, true);
    assert.equal(practicalGuidanceTerminalValid(origin, result), true);
  }
});

test('Ticket 63 rejects non-owned or malformed model output rather than trusting model authority', () => {
  const origin = obligation('o-organize', 'organization', 'cooking_order', [currentInput()]);
  const badOutputs = [
    { units: [{ unit_type: 'transformation', content: 'x', bounded_input_ids: ['bi-1'] }] },
    { units: [{ unit_type: 'organization', content: 'x', bounded_input_ids: ['bi-2'] }] },
    { units: [{ unit_type: 'organization', content: 'x', bounded_input_ids: ['bi-1', 'bi-1'] }] },
    { units: [{ unit_type: 'organization', content: '', bounded_input_ids: ['bi-1'] }] },
    { units: [{ unit_type: 'organization', content: 'x', bounded_input_ids: ['bi-1'], authority: 'reviewed_knowledge' }] },
    { units: [{ unit_type: 'organization', content: 'x', bounded_input_ids: ['bi-1'], action: {} }] },
    { authority: 'generated_guidance' },
  ];
  for (const output of badOutputs) assert.throws(() => resolvePracticalGuidance(input(origin, { modelRunId: 'run-1', reasoningModel() { return output; } })), error => error.code === 'PRACTICAL_GUIDANCE_MODEL_OUTPUT_INVALID' || error.code === 'PRACTICAL_GUIDANCE_OUTPUT_INVALID');
  assert.throws(() => resolvePracticalGuidance(input(origin, { modelRunId: 'run-1', reasoningModel() { throw new Error('bad response'); } })), error => error.message === 'bad response');
  const failed = resolvePracticalGuidance(input(origin, { modelRunId: 'run-1', reasoningModel() { const error = new Error('down'); error.code = 'REASONING_MODEL_UNAVAILABLE'; throw error; } }));
  assert.equal(failed.authority, 'resolver_failure');
});

test('Ticket 63 accepts only the matching Ticket 62 deferred practical input and has no sibling API', () => {
  const origin = obligation('o-only', 'organization', 'cooking_order', [currentInput()]);
  assert.throws(() => resolvePracticalGuidance(input({ ...origin, category: 'provider_service_fact' }, { modelRunId: 'run-1', reasoningModel() {} })), error => error.code === 'PRACTICAL_GUIDANCE_INPUT_INVALID');
  assert.throws(() => resolvePracticalGuidance({ ...input(origin, { modelRunId: 'run-1', reasoningModel() {} }), deferredResolution: { ...deferred('o-other') } }), error => error.code === 'PRACTICAL_GUIDANCE_INPUT_INVALID');
  assert.throws(() => resolvePracticalGuidance({ ...input(origin, { modelRunId: 'run-1', reasoningModel() {} }), deferredResolution: { ...deferred(origin.id), next_stage: 'response_composition' } }), error => error.code === 'PRACTICAL_GUIDANCE_INPUT_INVALID');
  assert.throws(() => resolvePracticalGuidance({ ...input(origin, { modelRunId: 'run-1', reasoningModel() {} }), deferredResolution: { ...deferred(origin.id), resolution_status: 'resolved', authority: 'generated_guidance' } }), error => error.code === 'PRACTICAL_GUIDANCE_INPUT_INVALID');
  assert.throws(() => resolvePracticalGuidance(input(obligation('o-no-input', 'organization', 'cooking_order'), { modelRunId: 'run-1', reasoningModel() {} })), error => error.code === 'PRACTICAL_GUIDANCE_INPUT_INVALID');
});
