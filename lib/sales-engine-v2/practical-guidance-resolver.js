'use strict';

const { REVIEWED_KNOWLEDGE_ROUTING } = require('../../config/sales-engine-v2/practical-guidance-routing');
const { PROMPT_VERSION, SYSTEM_PROMPT } = require('../../config/sales-engine-v2/bounded-reasoning-prompt');
const { PracticalGuidanceResolverError, assertInputs, assertTerminal } = require('./practical-guidance-resolver-validator');
const { deriveGuidanceAssessmentContextBinding } = require('./guidance-assessment-context');

const RESOLVER_ID = 'practical-guidance-resolver';
const RESOLVER_VERSION = 'ticket-63-v1';
function base(obligation, fields) { return { obligation_id: obligation.id, allowed_claims: [], prohibited_claims: [], customer_uncertainty_required: false, llm_reasoning_permitted: false, ...fields }; }
function unknown(obligation) { return base(obligation, { resolution_status: 'unknown', authority: 'bounded_unknown', source: null, customer_uncertainty_required: true }); }
function failure(obligation) { return base(obligation, { resolution_status: 'failed', authority: 'resolver_failure', source: null }); }
function reviewedId(item) { return item.knowledge_id || item.id; }
function reviewedVersion(item) { return String(item.knowledge_version || item.version); }
function reviewedSource(item) { return { type: 'reviewed_knowledge', id: reviewedId(item), version: reviewedVersion(item) }; }
function withAssessmentBinding({ obligation, result, locale, reviewedKnowledgeItems = [] }) {
  return { ...result, assessment_context_binding: deriveGuidanceAssessmentContextBinding({ obligation, terminalResult: result, locale, reviewedKnowledgeItems }) };
}
function directResult(obligation, item, locale) {
  const reference = reviewedSource(item);
  const bindingItem = { id: reviewedId(item), version: Number(item.knowledge_version || item.version), content: item.content };
  const result = base(obligation, { resolution_status: 'resolved', authority: 'reviewed_knowledge', source: { type: 'reviewed_knowledge', id: RESOLVER_ID, version: RESOLVER_VERSION }, retrieved_knowledge_references: [reference], guidance_payload: { semantic_safety_validation_required: true, units: [{ unit_type: 'reviewed_information', content: item.content, reviewed_knowledge_reference_ids: [reviewedId(item)] }] } });
  return withAssessmentBinding({ obligation, result, locale, reviewedKnowledgeItems: [bindingItem] });
}
function reasoningInput(obligation, locale) { return { prompt_version: PROMPT_VERSION, obligation_id: obligation.id, task_kind: obligation.practical_task.task_kind, ...(obligation.subject === undefined ? {} : { subject: obligation.subject }), locale, bounded_inputs: obligation.practical_task.bounded_inputs.map(({ id, input_type, value, origin }) => ({ id, input_type, value, origin })) }; }
function validateModelOutput(output, taskKind) {
  if (!output || typeof output !== 'object' || Array.isArray(output) || Object.keys(output).length !== 1 || !Array.isArray(output.units) || !output.units.length) throw new PracticalGuidanceResolverError('PRACTICAL_GUIDANCE_MODEL_OUTPUT_INVALID');
  const expected = taskKind === 'transformation' ? 'transformation' : 'organization';
  for (const unit of output.units) if (!unit || typeof unit !== 'object' || Array.isArray(unit) || Object.keys(unit).some(key => !new Set(['unit_type', 'content', 'bounded_input_ids']).has(key)) || unit.unit_type !== expected || typeof unit.content !== 'string' || !unit.content || !Array.isArray(unit.bounded_input_ids) || !unit.bounded_input_ids.length || new Set(unit.bounded_input_ids).size !== unit.bounded_input_ids.length || unit.bounded_input_ids.some(id => typeof id !== 'string' || !/^bi-[1-9][0-9]*$/.test(id))) throw new PracticalGuidanceResolverError('PRACTICAL_GUIDANCE_MODEL_OUTPUT_INVALID');
  return structuredClone(output.units);
}
function generatedResult(obligation, units, modelRunId, locale) {
  const result = base(obligation, { resolution_status: 'resolved', authority: 'generated_guidance', source: { type: 'generated_guidance', id: RESOLVER_ID, version: RESOLVER_VERSION, model_run_id: modelRunId, generation_stage: 'bounded_reasoning' }, llm_reasoning_permitted: true, guidance_payload: { semantic_safety_validation_required: true, units } });
  return withAssessmentBinding({ obligation, result, locale });
}
function storeUnavailable(error) { return error && error.code === 'KNOWLEDGE_STORE_UNAVAILABLE'; }
function modelUnavailable(error) { return error && error.code === 'REASONING_MODEL_UNAVAILABLE'; }

function resolvePracticalGuidance(rawInput) {
  const input = assertInputs(rawInput); const { obligation } = input; const task = obligation.practical_task.task_kind;
  if (task === 'knowledge_question') {
    const route = obligation.subject === undefined ? undefined : REVIEWED_KNOWLEDGE_ROUTING[obligation.subject];
    if (!route) return assertTerminal(obligation, unknown(obligation));
    let item;
    try {
      if (typeof input.knowledgeStore.resolve === 'function') {
        const resolution = input.knowledgeStore.resolve({ topic: route.topic, task_kind: task, bounded_inputs: obligation.practical_task.bounded_inputs, locale: input.locale });
        item = resolution.status === 'resolved' ? { ...resolution.record, knowledge_version: resolution.source.version } : null;
      } else item = input.knowledgeStore.retrieve({ topic: route.topic, locale: input.locale, asOf: input.asOf, allowedUse: 'direct_reviewed' });
    }
    catch (error) { if (storeUnavailable(error)) return assertTerminal(obligation, failure(obligation)); throw error; }
    if (!item) return assertTerminal(obligation, unknown(obligation));
    return assertTerminal(obligation, directResult(obligation, item, input.locale));
  }
  let output;
  try { output = input.reasoningModel({ system_prompt: SYSTEM_PROMPT, input: reasoningInput(obligation, input.locale) }); }
  catch (error) { if (modelUnavailable(error)) return assertTerminal(obligation, failure(obligation)); throw error; }
  const finalize = value => assertTerminal(obligation, generatedResult(obligation, validateModelOutput(value, task), input.modelRunId, input.locale));
  if (output && typeof output.then === 'function') return output.then(finalize, error => { if (modelUnavailable(error) || error?.code === 'MODEL_RUNTIME_UNAVAILABLE' || error?.code === 'MODEL_RUNTIME_DEADLINE_EXCEEDED') return assertTerminal(obligation, failure(obligation)); throw error; });
  return finalize(output);
}

module.exports = { PracticalGuidanceResolverError, RESOLVER_ID, RESOLVER_VERSION, directResult, generatedResult, reasoningInput, resolvePracticalGuidance, validateModelOutput, withAssessmentBinding };
