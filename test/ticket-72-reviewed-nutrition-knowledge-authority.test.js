'use strict';
const fs = require('node:fs'); const path = require('node:path');
const test = require('node:test'); const assert = require('node:assert/strict');
const { createReviewedKnowledgeAuthority, ReviewedKnowledgeAuthorityError, validateAuthority } = require('../lib/sales-engine-v2/reviewed-knowledge-authority');
const { resolvePracticalGuidance } = require('../lib/sales-engine-v2/practical-guidance-resolver');
const { bindingMatches } = require('../lib/sales-engine-v2/guidance-assessment-context');
const { assessSemanticGuidance } = require('../lib/sales-engine-v2/semantic-guidance-safety-gate');
const { loadAuthority, seedJson } = require('../scripts/generate-sales-engine-v2-reviewed-knowledge-seed');
const authority = loadAuthority(); const resolver = createReviewedKnowledgeAuthority({ authority });
const request = { topic: 'food_storage', task_kind: 'knowledge_question', bounded_inputs: [], locale: 'es-MX' };
function deferred(id) { return { obligation_id: id, resolution_status: 'deferred', authority: null, source: null, allowed_claims: [], prohibited_claims: [], customer_uncertainty_required: false, llm_reasoning_permitted: false, next_stage: 'reviewed_knowledge_or_reasoning' }; }
function practical(task_kind = 'knowledge_question', subject = 'food_storage', bounded_inputs = []) { const obligation = { id: 'o-72', category: 'practical_guidance', subject, current_turn_evidence: 'bounded', confidence: 'high', ambiguous: false, practical_task: { task_kind, bounded_inputs } }; return { obligation, deferredResolution: deferred(obligation.id), locale: 'es-MX', asOf: '2026-09-25T00:00:00.000Z', knowledgeStore: resolver }; }

test('Ticket 72 resolves exact active reviewed knowledge with reproducible pinned provenance', () => {
  const first = resolver.resolve(request); const pinned = resolver.resolve({ ...request, knowledge_version: '1' });
  assert.deepEqual(first, pinned); assert.deepEqual(first.source, { type: 'reviewed_knowledge', id: 'rk-food-storage-basics', version: '1' });
  assert.equal(first.authority, 'reviewed_knowledge'); assert.equal(JSON.stringify(first).match(/model_run_id|action|canonical_fact|deterministic_policy/), null);
  assert.deepEqual(resolver.resolve({ ...request, locale: 'en-US' }), { status: 'unknown', authority: 'bounded_unknown', source: null, record: null });
});
test('Ticket 72 excludes draft/retired/conflicting lifecycle states and malformed or fuzzy requests', () => {
  for (const status of ['draft', 'retired']) { const copy = structuredClone(authority); copy.knowledge_sets[0].status = status; assert.equal(createReviewedKnowledgeAuthority({ authority: copy }).resolve(request).authority, 'bounded_unknown'); }
  const conflict = structuredClone(authority); conflict.knowledge_sets.push({ ...structuredClone(conflict.knowledge_sets[0]), knowledge_set_id: 'conflict' });
  assert.throws(() => createReviewedKnowledgeAuthority({ authority: conflict }), error => error.code === 'KNOWLEDGE_AUTHORITY_AMBIGUOUS');
  for (const bad of [{ ...request, topic: 'food' }, { ...request, topic: 'food_storage ', raw_customer_message: 'dime algo' }, { ...request, bounded_inputs: [{ id: 'bi-1', input_type: 'unbounded', value: 'x', origin: 'current_turn' }] }]) assert.throws(() => resolver.resolve(bad), error => error.code === 'KNOWLEDGE_REQUEST_INVALID');
  const recordConflict = structuredClone(authority); recordConflict.knowledge_sets[0].records.push({ ...structuredClone(recordConflict.knowledge_sets[0].records[0]), knowledge_id: 'rk-conflict' });
  assert.throws(() => createReviewedKnowledgeAuthority({ authority: recordConflict }).resolve(request), error => error.code === 'KNOWLEDGE_AUTHORITY_AMBIGUOUS');
});
test('Ticket 72 structurally permits only nutrition-practical records, never product, policy, medication, commercial, or action capabilities', () => {
  for (const change of [
    record => { record.knowledge_domain = 'medication_management'; }, record => { record.knowledge_domain = 'commercial'; }, record => { record.knowledge_domain = 'canonical_fact'; }, record => { record.topic = 'glp1_medication_management'; }, record => { record.topic = 'offer_price'; }, record => { record.task_kinds = ['authorized_action']; },
  ]) { const copy = structuredClone(authority); change(copy.knowledge_sets[0].records[0]); assert.throws(() => validateAuthority(copy), error => error instanceof ReviewedKnowledgeAuthorityError && error.code === 'KNOWLEDGE_AUTHORITY_MALFORMED'); }
});
test('Ticket 72 does not semantically classify reviewed prose; Ticket 64 remains the natural-language safety gate', () => {
  const copy = structuredClone(authority); copy.knowledge_sets[0].records[0].content = 'Si una persona usa un medicamento, conserva la comida cocida en un recipiente limpio y cerrado.';
  const sensitiveAuthority = createReviewedKnowledgeAuthority({ authority: copy }); const data = practical(); data.knowledgeStore = sensitiveAuthority;
  const terminal = resolvePracticalGuidance(data);
  assert.equal(terminal.authority, 'reviewed_knowledge');
  assert.equal(terminal.guidance_payload.units[0].content, copy.knowledge_sets[0].records[0].content);
  const gate = assessSemanticGuidance({ originatingObligation: data.obligation, terminalResult: terminal, locale: 'es-MX', reviewedKnowledgeItems: [{ id: 'rk-food-storage-basics', version: 1, content: copy.knowledge_sets[0].records[0].content }], assessorRunId: 'assessor-72', semanticAssessor() { return { findings: [{ code: 'medication_management', unit_index: 0, rationale: 'Semantic safety assessment.' }] }; } });
  assert.equal(gate.gate_status, 'blocked');
  assert.equal(JSON.stringify(terminal).match(/canonical_fact|deterministic_policy|commercial_authorization|action_authorization/), null);
});
test('Ticket 72 preserves Ticket 63 reviewed binding and keeps transformation/organization generated', () => {
  const direct = resolvePracticalGuidance(practical()); assert.equal(direct.authority, 'reviewed_knowledge');
  assert.equal(bindingMatches({ obligation: practical().obligation, terminalResult: direct, locale: 'es-MX', reviewedKnowledgeItems: [{ id: 'rk-food-storage-basics', version: 1, content: authority.knowledge_sets[0].records[0].content }] }, direct.assessment_context_binding), true);
  for (const task of ['transformation', 'organization']) { const data = practical(task, 'cooking_order', [{ id: 'bi-1', input_type: 'preparation_step', value: 'cortar verduras', origin: 'current_turn' }]); data.modelRunId = `run-${task}`; data.reasoningModel = () => ({ units: [{ unit_type: task, content: 'Texto generado.', bounded_input_ids: ['bi-1'] }] }); const result = resolvePracticalGuidance(data); assert.equal(result.authority, 'generated_guidance'); assert.equal(result.source.type, 'generated_guidance'); }
});
test('Ticket 72 generated SQL seed is in parity with the sole authority manifest and migration keeps local ACL boundary', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'database/migrations/20260925_ticket_72_reviewed_nutrition_knowledge_authority.sql'), 'utf8');
  const snapshot = fs.readFileSync(path.join(__dirname, '..', 'database/schema.sql'), 'utf8');
  assert.equal(migration.match(/\$ticket_72_seed\$(.*?)\$ticket_72_seed\$/s)[1], seedJson());
  for (const source of [migration, snapshot]) assert.match(source, /knowledge_domain/);
  assert.match(migration, /knowledge_domain IN \('nutrition_practical'\)/); assert.match(migration, /FORCE ROW LEVEL SECURITY/); assert.match(migration, /reviewed_nutrition_knowledge_one_active_locale/); assert.match(migration, /activate_reviewed_nutrition_knowledge_set/);
});
