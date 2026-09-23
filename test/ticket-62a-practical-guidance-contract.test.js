'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateModelOutput } = require('../lib/sales-engine-v2/interpreter-validator');
const { createFactResolver } = require('../lib/sales-engine-v2/fact-resolver');
const { createPolicyResolver } = require('../lib/sales-engine-v2/policy-resolver');
const { resolveObligations } = require('../lib/sales-engine-v2/resolution-orchestrator');
const { normativeResolvedValid, practicalGuidanceTerminalValid, RESOLVED_OBLIGATION_KEYS } = require('../lib/sales-engine-v2/resolved-obligation-validator');
const { resolvedValid: ticket62ResolvedValid } = require('../lib/sales-engine-v2/resolution-orchestrator-validator');

const root = path.join(__dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'docs/contracts/sales-engine-v2-contract.schema.json'), 'utf8'));
const facts = JSON.parse(fs.readFileSync(path.join(root, 'config/sales-engine-v2/product-facts.json'), 'utf8')).facts;
const membershipDefinitions = JSON.parse(fs.readFileSync(path.join(root, 'config/sales-engine-v2/fact-membership.json'), 'utf8'));
const policies = JSON.parse(fs.readFileSync(path.join(root, 'config/sales-engine-v2/policies.json'), 'utf8')).policies;
const asOf = '2026-09-22T00:00:01.000Z';

function context() { return { contract_version: '2.0', context_id: 'c-62a', locale: 'es-MX', current_message: { role: 'customer', text: 'mensaje actual', occurred_at: asOf, source_id: 'm-current' }, history: [], history_metadata: { ordering: 'occurred_at', history_truncated: false, retained_prior_turns: 0, retained_prior_characters: 0 }, conversation_artifacts: [], conversation_artifacts_metadata: { ordering: 'occurred_at', artifacts_truncated: false, retained_artifacts: 0, retained_artifact_characters: 0 }, session_state: { session_id: 's-62a' }, offer_context: { offer_version: '28d-149-v1' }, customer_state: {}, commercial_state: { checkout_sent: false, valid_purchase_confirmation: false }, metadata: { channel: 'whatsapp', campaign: 'standard' }, authoritative_context: {}, informational_context: { knowledge: [] } }; }
function source(type, id = 'source-1') { return type === 'generated_guidance' ? { type, id, version: '1', model_run_id: 'run-1', generation_stage: 'bounded_reasoning' } : { type, id, version: '1' }; }
function base(authority, sourceValue) { return { obligation_id: 'o-1', resolution_status: 'resolved', authority, source: sourceValue, allowed_claims: [], prohibited_claims: [], customer_uncertainty_required: false, llm_reasoning_permitted: false }; }
function payload(unit) { return { semantic_safety_validation_required: true, units: [unit] }; }
function practicalObligation(id, taskKind, inputCount = 2, firstInputId = 1) { return { id, category: 'practical_guidance', current_turn_evidence: 'mensaje actual', confidence: 'high', ambiguous: false, practical_task: { task_kind: taskKind, bounded_inputs: Array.from({ length: inputCount }, (_, index) => ({ id: `bi-${firstInputId + index}`, input_type: 'preparation_step', value: `paso ${index + 1}`, origin: 'current_turn' })) } }; }

test('Ticket 62A schema closes practical task, bounded input, and guidance unit vocabularies', () => {
  assert.deepEqual(schema.$defs.practicalTask.properties.task_kind.enum, ['knowledge_question', 'transformation', 'organization']);
  assert.deepEqual(schema.$defs.boundedInput.properties.input_type.enum, ['meal_name', 'ingredient', 'preparation_step', 'meal_component', 'schedule_constraint', 'time_constraint', 'user_preference']);
  assert.deepEqual(schema.$defs.guidanceUnit.properties.unit_type.enum, ['reviewed_information', 'practical_instruction', 'transformation', 'organization']);
  assert.deepEqual([...RESOLVED_OBLIGATION_KEYS].sort(), Object.keys(schema.$defs.resolvedObligation.properties).sort());
});

test('Ticket 62A interpreter distinguishes knowledge, transformation, medication, and provider capability without history extraction', () => {
  const knowledge = validateModelOutput({ obligations: [{ category: 'practical_guidance', subject: 'food_storage', current_turn_evidence: 'Cuánto tiempo puedo guardar esta comida cocida', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'knowledge_question', bounded_inputs: [] } }] }, '¿Cuánto tiempo puedo guardar esta comida cocida en el refri?');
  assert.equal(knowledge[0].practical_task.task_kind, 'knowledge_question');
  const transformText = 'Ordena: cortar verduras, hornear pollo y servir arroz';
  const transformation = validateModelOutput({ obligations: [{ category: 'practical_guidance', subject: 'cooking_order', current_turn_evidence: transformText, confidence: 'high', ambiguous: false, practical_task: { task_kind: 'organization', bounded_inputs: [{ input_type: 'preparation_step', value: 'cortar verduras' }, { input_type: 'preparation_step', value: 'hornear pollo' }, { input_type: 'preparation_step', value: 'servir arroz' }] } }] }, transformText);
  assert.deepEqual(transformation[0].practical_task.bounded_inputs.map(value => value.id), ['bi-1', 'bi-2', 'bi-3']);
  assert.equal(transformation[0].practical_task.bounded_inputs.every(value => value.origin === 'current_turn'), true);
  const siblingInputs = validateModelOutput({ obligations: [
    { category: 'practical_guidance', subject: 'first_order', current_turn_evidence: 'Paso A', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'organization', bounded_inputs: [{ input_type: 'preparation_step', value: 'Paso A' }] } },
    { category: 'practical_guidance', subject: 'second_order', current_turn_evidence: 'Paso B', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'organization', bounded_inputs: [{ input_type: 'preparation_step', value: 'Paso B' }] } },
  ] }, 'Paso A y Paso B');
  assert.deepEqual(siblingInputs.map(item => item.practical_task.bounded_inputs[0].id), ['bi-1', 'bi-2']);
  assert.throws(() => validateModelOutput({ obligations: [{ category: 'medication_management', subject: 'dose_change', current_turn_evidence: 'organiza cómo cambio mi dosis', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'transformation', bounded_inputs: [{ input_type: 'preparation_step', value: 'cambio mi dosis' }] } }] }, 'organiza cómo cambio mi dosis'), error => error.code === 'INTERPRETER_PRACTICAL_TASK_INVALID');
  assert.throws(() => validateModelOutput({ obligations: [{ category: 'provider_service_fact', subject: 'automatic_meal_prep_adaptation', current_turn_evidence: 'Adaptan todas mis cenas', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'transformation', bounded_inputs: [{ input_type: 'meal_name', value: 'cenas' }] } }] }, '¿Adaptan todas mis cenas?'), error => error.code === 'INTERPRETER_PRACTICAL_TASK_INVALID');
  assert.throws(() => validateModelOutput({ obligations: [{ category: 'practical_guidance', subject: 'cooking_order', current_turn_evidence: 'ordena estos pasos', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'organization', bounded_inputs: [{ input_type: 'preparation_step', value: 'paso de ayer' }] } }] }, 'ordena estos pasos'), error => error.code === 'INTERPRETER_BOUNDED_INPUT_INVALID');
});

test('Ticket 62A validates future reviewed and generated terminal guidance shapes', () => {
  const reference = source('reviewed_knowledge', 'knowledge-1');
  const reviewed = { ...base('reviewed_knowledge', source('reviewed_knowledge', 'resolution-1')), retrieved_knowledge_references: [reference], guidance_payload: payload({ unit_type: 'reviewed_information', content: 'Contenido sujeto a validación semántica.', reviewed_knowledge_reference_ids: ['knowledge-1'] }) };
  const generated = { ...base('generated_guidance', source('generated_guidance', 'guidance-1')), llm_reasoning_permitted: true, guidance_payload: payload({ unit_type: 'organization', content: 'Contenido generado sujeto a validación semántica.', bounded_input_ids: ['bi-1', 'bi-2'] }) };
  assert.equal(normativeResolvedValid(reviewed), true);
  assert.equal(normativeResolvedValid(generated), true);
  assert.equal(ticket62ResolvedValid(reviewed), false);
  assert.equal(ticket62ResolvedValid(generated), false);
  assert.equal(normativeResolvedValid({ ...generated, source: { ...generated.source, generation_stage: 'composer' } }), false);
  assert.equal(normativeResolvedValid({ ...generated, source: { type: 'generated_guidance', id: 'g', version: '1' } }), false);
  assert.equal(normativeResolvedValid({ ...reviewed, source: source('canonical_fact') }), false);
});

test('Ticket 62A keeps deferred Ticket 62 output terminal-payload-free and represents future missing/failure outcomes', () => {
  const deferred = resolveObligations({ context: context(), obligations: [{ id: 'o-1', category: 'practical_guidance', subject: 'food_storage', current_turn_evidence: 'mensaje actual', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'knowledge_question', bounded_inputs: [] } }], factResolver: createFactResolver({ facts, membershipDefinitions }), policyResolver: createPolicyResolver({ policies }), asOf }).resolved_obligations[0];
  assert.equal(deferred.resolution_status, 'deferred');
  assert.equal(Object.hasOwn(deferred, 'guidance_payload'), false);
  assert.equal(ticket62ResolvedValid(deferred), true);
  const missing = { ...base('bounded_unknown', null), resolution_status: 'unknown', customer_uncertainty_required: true };
  const failed = { ...base('resolver_failure', null), resolution_status: 'failed' };
  assert.equal(normativeResolvedValid(missing), true);
  assert.equal(normativeResolvedValid(failed), true);
  assert.equal(normativeResolvedValid({ ...deferred, guidance_payload: payload({ unit_type: 'organization', content: 'x', bounded_input_ids: ['bi-1'] }) }), false);
});

test('Ticket 62A guidance units require one exclusive grounding mode and expose semantic-gate need', () => {
  const reference = source('reviewed_knowledge', 'knowledge-1');
  const generatedWithKnowledge = { ...base('generated_guidance', source('generated_guidance')), llm_reasoning_permitted: true, retrieved_knowledge_references: [reference], guidance_payload: payload({ unit_type: 'practical_instruction', content: 'Texto natural no autorizado para producción sin una puerta semántica posterior.', reviewed_knowledge_reference_ids: ['knowledge-1'] }) };
  assert.equal(normativeResolvedValid(generatedWithKnowledge), true);
  assert.equal(normativeResolvedValid({ ...generatedWithKnowledge, guidance_payload: { units: generatedWithKnowledge.guidance_payload.units, semantic_safety_validation_required: false } }), false);
  assert.equal(normativeResolvedValid({ ...generatedWithKnowledge, guidance_payload: payload({ unit_type: 'practical_instruction', content: 'x', reviewed_knowledge_reference_ids: ['knowledge-1'], bounded_input_ids: ['bi-1'] }) }), false);
});

test('Ticket 62A context-aware terminal validation enforces exact bounded-input ownership and task-unit mapping', () => {
  const origin = practicalObligation('o-1', 'organization');
  const result = { ...base('generated_guidance', source('generated_guidance')), llm_reasoning_permitted: true, guidance_payload: payload({ unit_type: 'organization', content: 'Contenido generado sujeto a validación semántica.', bounded_input_ids: ['bi-1', 'bi-2'] }) };
  assert.equal(normativeResolvedValid(result), true);
  assert.equal(practicalGuidanceTerminalValid(origin, result), true);
  assert.equal(practicalGuidanceTerminalValid(origin, { ...result, guidance_payload: payload({ unit_type: 'organization', content: 'x', bounded_input_ids: ['bi-3'] }) }), false);
  assert.equal(practicalGuidanceTerminalValid(origin, { ...result, obligation_id: 'o-other' }), false);
  const sibling = practicalObligation('o-sibling', 'organization', 2, 3);
  assert.equal(practicalGuidanceTerminalValid(origin, { ...result, guidance_payload: payload({ unit_type: 'organization', content: 'x', bounded_input_ids: [sibling.practical_task.bounded_inputs[0].id] }) }), false);
  assert.equal(practicalGuidanceTerminalValid({ ...origin, category: 'provider_service_fact' }, result), false);
  assert.equal(practicalGuidanceTerminalValid(practicalObligation('o-1', 'transformation'), result), false);
  assert.equal(practicalGuidanceTerminalValid(origin, { ...result, guidance_payload: payload({ unit_type: 'organization', content: 'x', bounded_input_ids: ['bi-1', 'bi-1'] }) }), false);
});

test('Ticket 62A context-aware validation accepts globally allocated later IDs and rejects sibling ownership', () => {
  const obligations = validateModelOutput({ obligations: [
    { category: 'practical_guidance', subject: 'first_order', current_turn_evidence: 'Paso A', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'organization', bounded_inputs: [{ input_type: 'preparation_step', value: 'Paso A' }] } },
    { category: 'practical_guidance', subject: 'second_order', current_turn_evidence: 'Paso B', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'organization', bounded_inputs: [{ input_type: 'preparation_step', value: 'Paso B' }] } },
  ] }, 'Paso A y Paso B');
  const [first, second] = obligations;
  assert.deepEqual([first.practical_task.bounded_inputs[0].id, second.practical_task.bounded_inputs[0].id], ['bi-1', 'bi-2']);
  const secondResult = { ...base('generated_guidance', source('generated_guidance')), obligation_id: second.id, llm_reasoning_permitted: true, guidance_payload: payload({ unit_type: 'organization', content: 'Contenido generado sujeto a validación semántica.', bounded_input_ids: ['bi-2'] }) };
  assert.equal(practicalGuidanceTerminalValid(second, secondResult), true);
  const firstResultUsingSibling = { ...secondResult, obligation_id: first.id };
  assert.equal(practicalGuidanceTerminalValid(first, firstResultUsingSibling), false);
});

test('Ticket 62A context-aware validation preserves reviewed knowledge and Ticket 62 stage boundaries', () => {
  const origin = practicalObligation('o-1', 'knowledge_question', 0);
  const reference = source('reviewed_knowledge', 'knowledge-1');
  const reviewed = { ...base('reviewed_knowledge', source('reviewed_knowledge', 'resolution-1')), retrieved_knowledge_references: [reference], guidance_payload: payload({ unit_type: 'reviewed_information', content: 'Contenido sujeto a validación semántica.', reviewed_knowledge_reference_ids: ['knowledge-1'] }) };
  assert.equal(practicalGuidanceTerminalValid(origin, reviewed), true);
  assert.equal(ticket62ResolvedValid(reviewed), false);
});
