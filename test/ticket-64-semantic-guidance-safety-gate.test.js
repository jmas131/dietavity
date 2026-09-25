'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessSemanticGuidance, assessmentInput } = require('../lib/sales-engine-v2/semantic-guidance-safety-gate');
const { semanticGuidanceGateValid } = require('../lib/sales-engine-v2/semantic-guidance-safety-validator');
const { deriveGuidanceAssessmentContextBinding } = require('../lib/sales-engine-v2/guidance-assessment-context');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs/contracts/sales-engine-v2-contract.schema.json'), 'utf8'));
function origin(taskKind = 'organization', id = 'o-64') { return { id, category: 'practical_guidance', subject: 'cooking_order', current_turn_evidence: 'cortar verduras y hornear pollo', confidence: 'high', ambiguous: false, practical_task: { task_kind: taskKind, bounded_inputs: taskKind === 'knowledge_question' ? [] : [{ id: 'bi-1', input_type: 'preparation_step', value: 'cortar verduras', origin: 'current_turn' }, { id: 'bi-2', input_type: 'preparation_step', value: 'hornear pollo', origin: 'current_turn' }] } }; }
function generated(taskKind = 'organization', id = 'o-64', content = 'Primero corta las verduras y después hornea el pollo.') { return { obligation_id: id, resolution_status: 'resolved', authority: 'generated_guidance', source: { type: 'generated_guidance', id: 'practical-guidance-resolver', version: 'ticket-63-v1', model_run_id: 'reasoning-run', generation_stage: 'bounded_reasoning' }, allowed_claims: [], prohibited_claims: [], customer_uncertainty_required: false, llm_reasoning_permitted: true, guidance_payload: { semantic_safety_validation_required: true, units: [{ unit_type: taskKind, content, bounded_input_ids: ['bi-1', 'bi-2'] }] } }; }
function reviewed(id = 'o-64') { return { obligation_id: id, resolution_status: 'resolved', authority: 'reviewed_knowledge', source: { type: 'reviewed_knowledge', id: 'practical-guidance-resolver', version: 'ticket-63-v1' }, allowed_claims: [], prohibited_claims: [], customer_uncertainty_required: false, llm_reasoning_permitted: false, retrieved_knowledge_references: [{ type: 'reviewed_knowledge', id: 'rk-1', version: '1' }], guidance_payload: { semantic_safety_validation_required: true, units: [{ unit_type: 'reviewed_information', content: 'Guarda la comida en un recipiente limpio y cerrado.', reviewed_knowledge_reference_ids: ['rk-1'] }] } }; }
function request(overrides = {}) {
  const value = { originatingObligation: origin(), terminalResult: generated(), locale: 'es-MX', reviewedKnowledgeItems: [], assessorRunId: 'assessor-run-64', semanticAssessor() { return { findings: [] }; }, ...overrides };
  try {
    if (['reviewed_knowledge', 'generated_guidance'].includes(value.terminalResult.authority)) value.terminalResult = { ...value.terminalResult, assessment_context_binding: deriveGuidanceAssessmentContextBinding({ obligation: value.originatingObligation, terminalResult: value.terminalResult, locale: value.locale, reviewedKnowledgeItems: value.reviewedKnowledgeItems }) };
  } catch { /* Intentionally malformed terminal fixtures remain malformed. */ }
  return value;
}
function finding(code) { return { findings: [{ code, unit_index: 0, rationale: 'Hallazgo estructurado de prueba.' }] }; }
function gate({ status = 'cleared', findings = [], outcome = 'completed', failureCode } = {}) { return { obligation_id: 'o-64', gate_id: 'semantic-guidance-safety-gate', gate_version: 'ticket-64-v1', gate_status: status, findings, assessment_source: { assessment_stage: 'semantic_guidance_safety', assessor_run_id: 'assessor-run-64', outcome, ...(failureCode ? { failure_code: failureCode } : {}) } }; }
function gateFinding(severity) { return { code: severity === 'blocking' ? 'commercial_claim' : 'unsupported_external_fact', severity, unit_index: 0, rationale: 'Hallazgo estructurado de prueba.' }; }

test('Ticket 64 central schema and executable artifact close the semantic gate contract', () => {
  assert.deepEqual(schema.$defs.semanticGuidanceGate.properties.gate_status.enum, ['cleared', 'blocked', 'indeterminate']);
  assert.equal(schema.properties.SemanticGuidanceGate.$ref, '#/$defs/semanticGuidanceGate');
  assert.deepEqual(schema.$defs.semanticGuidanceGate.oneOf.map(branch => branch.title), [
    'completed assessment with no findings clears',
    'completed assessment with a blocking finding blocks',
    'completed assessment with review-only findings is indeterminate',
    'unavailable assessment is empty and indeterminate',
  ]);
  assert.equal(schema.$defs.semanticGuidanceGate.oneOf[0].properties.findings.maxItems, 0);
  assert.equal(schema.$defs.semanticGuidanceGate.oneOf[1].properties.findings.contains.properties.severity.const, 'blocking');
  assert.equal(schema.$defs.semanticGuidanceGate.oneOf[2].properties.findings.contains.properties.severity.const, 'review_required');
  assert.equal(schema.$defs.semanticGuidanceGate.oneOf[2].not.properties.findings.contains.properties.severity.const, 'blocking');
  assert.equal(schema.$defs.semanticGuidanceGate.oneOf[3].properties.findings.maxItems, 0);
  const result = assessSemanticGuidance(request());
  assert.equal(result.gate_status, 'cleared');
  assert.equal(semanticGuidanceGateValid(result), true);
});

test('Ticket 64 executable gate validator has central-schema state-machine parity', () => {
  const accepted = [
    gate(),
    gate({ status: 'blocked', findings: [gateFinding('blocking')] }),
    gate({ status: 'indeterminate', findings: [gateFinding('review_required')] }),
    gate({ status: 'indeterminate', outcome: 'unavailable', failureCode: 'SEMANTIC_ASSESSOR_UNAVAILABLE' }),
  ];
  for (const value of accepted) assert.equal(semanticGuidanceGateValid(value), true);
  const rejected = [
    gate({ status: 'blocked' }),
    gate({ status: 'indeterminate' }),
    gate({ status: 'cleared', findings: [gateFinding('blocking')] }),
    gate({ status: 'indeterminate', findings: [gateFinding('blocking')] }),
    gate({ status: 'cleared', findings: [gateFinding('review_required')] }),
    gate({ status: 'blocked', findings: [gateFinding('review_required')] }),
    gate({ status: 'cleared', outcome: 'unavailable', failureCode: 'SEMANTIC_ASSESSOR_UNAVAILABLE' }),
    gate({ status: 'blocked', outcome: 'unavailable', failureCode: 'SEMANTIC_ASSESSOR_UNAVAILABLE' }),
    gate({ status: 'indeterminate', findings: [gateFinding('review_required')], outcome: 'unavailable', failureCode: 'SEMANTIC_ASSESSOR_UNAVAILABLE' }),
    gate({ failureCode: 'SEMANTIC_ASSESSOR_UNAVAILABLE' }),
  ];
  for (const value of rejected) assert.equal(semanticGuidanceGateValid(value), false);
});

test('Ticket 64 accepts only valid terminal practical guidance results', () => {
  const invalid = [
    request({ originatingObligation: { ...origin(), category: 'product_fact' } }),
    request({ terminalResult: generated('organization', 'o-other') }),
    request({ terminalResult: { ...generated(), resolution_status: 'deferred', authority: null, source: null, llm_reasoning_permitted: false, guidance_payload: undefined, next_stage: 'reviewed_knowledge_or_reasoning' } }),
    request({ terminalResult: { ...generated(), authority: 'bounded_unknown', resolution_status: 'unknown', source: null, llm_reasoning_permitted: false, customer_uncertainty_required: true, guidance_payload: undefined } }),
    request({ terminalResult: { ...generated(), authority: 'resolver_failure', resolution_status: 'failed', source: null, llm_reasoning_permitted: false, guidance_payload: undefined } }),
    request({ terminalResult: { ...generated(), authority: 'canonical_fact', source: { type: 'canonical_fact', id: 'f', version: '1' }, llm_reasoning_permitted: false } }),
    request({ terminalResult: { ...generated(), authority: 'deterministic_policy', source: { type: 'deterministic_policy', id: 'p', version: '1' }, llm_reasoning_permitted: false } }),
    request({ terminalResult: { ...generated(), guidance_payload: { ...generated().guidance_payload, semantic_safety_validation_required: false } } }),
    request({ terminalResult: { ...generated(), guidance_payload: { ...generated().guidance_payload, units: [{ unit_type: 'organization', content: 'x', bounded_input_ids: ['bi-9'] }] } } }),
  ];
  for (const value of invalid) assert.throws(() => assessSemanticGuidance(value), error => error.code === 'SEMANTIC_GUIDANCE_GATE_INELIGIBLE');
});

test('Ticket 64 accepts generated transformations and organizations plus direct reviewed guidance', () => {
  for (const taskKind of ['transformation', 'organization']) assert.equal(assessSemanticGuidance(request({ originatingObligation: origin(taskKind), terminalResult: generated(taskKind) })).gate_status, 'cleared');
  const reviewedItems = [{ id: 'rk-1', version: 1, content: 'Guarda la comida en un recipiente limpio y cerrado.' }];
  assert.equal(assessSemanticGuidance(request({ originatingObligation: origin('knowledge_question'), terminalResult: reviewed(), reviewedKnowledgeItems: reviewedItems })).gate_status, 'cleared');
});

test('Ticket 64 deterministic severity and gate mappings do not trust assessor authorization', () => {
  assert.equal(assessSemanticGuidance(request({ semanticAssessor() { return finding('unsupported_external_fact'); } })).gate_status, 'indeterminate');
  assert.equal(assessSemanticGuidance(request({ semanticAssessor() { return finding('product_or_provider_claim'); } })).gate_status, 'blocked');
  assert.equal(assessSemanticGuidance(request({ semanticAssessor() { return { findings: [finding('medication_management').findings[0], finding('safety_sensitive_guidance').findings[0]] }; } })).gate_status, 'blocked');
  for (const code of ['commercial_claim', 'medication_management', 'diagnosis_or_prescription', 'unauthorized_action_claim', 'reviewed_knowledge_contradiction']) assert.equal(assessSemanticGuidance(request({ semanticAssessor() { return finding(code); } })).gate_status, 'blocked');
  for (const code of ['bounded_input_semantic_drift', 'safety_sensitive_guidance']) assert.equal(assessSemanticGuidance(request({ semanticAssessor() { return finding(code); } })).gate_status, 'indeterminate');
  assert.throws(() => assessSemanticGuidance(request({ semanticAssessor() { return { findings: [], gate_status: 'cleared', action: {} }; } })), error => error.code === 'SEMANTIC_ASSESSOR_OUTPUT_INVALID');
});

test('Ticket 64 fails malformed assessor output closed and keeps unknown errors observable', () => {
  const outputs = [{}, { findings: [{ code: 'invented', unit_index: 0, rationale: 'x' }] }, { findings: [{ code: 'commercial_claim', severity: 'blocking', unit_index: 0, rationale: 'x' }] }, { findings: [{ code: 'commercial_claim', unit_index: 3, rationale: 'x' }] }, { findings: [{ code: 'commercial_claim', unit_index: -1, rationale: 'x' }] }, { findings: [{ code: 'commercial_claim', unit_index: 0, rationale: '' }] }, []];
  for (const output of outputs) assert.throws(() => assessSemanticGuidance(request({ semanticAssessor() { return output; } })), error => error.code === 'SEMANTIC_ASSESSOR_OUTPUT_INVALID');
  assert.throws(() => assessSemanticGuidance(request({ semanticAssessor() { throw new Error('runtime'); } })), /runtime/);
});

test('Ticket 64 makes only recognized assessor unavailability indeterminate', () => {
  const result = assessSemanticGuidance(request({ semanticAssessor() { const error = new Error('down'); error.code = 'SEMANTIC_ASSESSOR_UNAVAILABLE'; throw error; } }));
  assert.deepEqual({ status: result.gate_status, findings: result.findings, outcome: result.assessment_source.outcome, failure: result.assessment_source.failure_code }, { status: 'indeterminate', findings: [], outcome: 'unavailable', failure: 'SEMANTIC_ASSESSOR_UNAVAILABLE' });
});

test('Ticket 64 aligns reviewed items exactly and minimizes assessor input', () => {
  const item = { id: 'rk-1', version: 1, content: 'Guarda la comida en un recipiente limpio y cerrado.' };
  for (const items of [[], [{ ...item, version: 2 }], [{ ...item, id: 'rk-other' }], [item, { id: 'rk-extra', version: 1, content: 'extra' }], [item, item]]) assert.throws(() => assessSemanticGuidance(request({ originatingObligation: origin('knowledge_question'), terminalResult: reviewed(), reviewedKnowledgeItems: items })), error => error.code === 'SEMANTIC_GUIDANCE_REVIEWED_KNOWLEDGE_MISMATCH');
  let received;
  assessSemanticGuidance(request({ semanticAssessor(value) { received = value.input; return { findings: [] }; } }));
  assert.deepEqual(Object.keys(received).sort(), ['authority', 'bounded_inputs', 'guidance_units', 'locale', 'obligation_id', 'source', 'subject', 'task_kind']);
  assert.equal(JSON.stringify(received).includes('current_turn_evidence'), false);
  assert.deepEqual(received.bounded_inputs.map(input => input.id), ['bi-1', 'bi-2']);
  const reviewedInput = assessmentInput({ ...request({ originatingObligation: origin('knowledge_question'), terminalResult: reviewed(), reviewedKnowledgeItems: [item] }), reviewedKnowledgeItems: [item] });
  assert.deepEqual(Object.keys(reviewedInput).sort(), ['authority', 'guidance_units', 'locale', 'obligation_id', 'reviewed_knowledge_items', 'source', 'subject', 'task_kind']);
  assert.deepEqual(reviewedInput.reviewed_knowledge_items, [item]);
});

test('Ticket 63A refuses to assess a terminal result when its durable context binding no longer matches', () => {
  const baseline = request();
  assert.throws(() => assessSemanticGuidance({ ...baseline, originatingObligation: { ...baseline.originatingObligation, subject: 'different_subject' } }), error => error.code === 'SEMANTIC_GUIDANCE_CONTEXT_BINDING_MISMATCH');
  assert.throws(() => assessSemanticGuidance({ ...baseline, terminalResult: { ...baseline.terminalResult, guidance_payload: { ...baseline.terminalResult.guidance_payload, units: [{ ...baseline.terminalResult.guidance_payload.units[0], content: 'Texto modificado.' }] } } }), error => error.code === 'SEMANTIC_GUIDANCE_CONTEXT_BINDING_MISMATCH');
  const item = { id: 'rk-1', version: 1, content: 'Guarda la comida en un recipiente limpio y cerrado.' };
  const reviewedRequest = request({ originatingObligation: origin('knowledge_question'), terminalResult: reviewed(), reviewedKnowledgeItems: [item] });
  assert.throws(() => assessSemanticGuidance({ ...reviewedRequest, reviewedKnowledgeItems: [{ ...item, content: 'Contenido modificado.' }] }), error => error.code === 'SEMANTIC_GUIDANCE_CONTEXT_BINDING_MISMATCH');
});

test('Ticket 64 never mutates source artifacts and structurally bad Ticket 63 prose is not self-cleared', () => {
  const input = request({ terminalResult: generated('organization', 'o-64', 'Primero corta verduras y baja tu dosis de GLP-1.') });
  const before = structuredClone({ obligation: input.originatingObligation, terminal: input.terminalResult, reviewed: input.reviewedKnowledgeItems });
  assert.equal(assessSemanticGuidance({ ...input, semanticAssessor() { return finding('medication_management'); } }).gate_status, 'blocked');
  assert.deepEqual({ obligation: input.originatingObligation, terminal: input.terminalResult, reviewed: input.reviewedKnowledgeItems }, before);
});
