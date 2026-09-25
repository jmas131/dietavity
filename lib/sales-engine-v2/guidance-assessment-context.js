'use strict';

const crypto = require('node:crypto');

const GUIDANCE_ASSESSMENT_CONTEXT_VERSION = 'ticket-63a-v1';
const GUIDANCE_ASSESSMENT_BINDING_VERSION = 'ticket-63a-v1';
const DIGEST = /^[0-9a-f]{64}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function bindingValid(value) {
  return plain(value) && Object.keys(value).length === 2 && value.version === GUIDANCE_ASSESSMENT_BINDING_VERSION && typeof value.digest === 'string' && DIGEST.test(value.digest);
}

function sourceProjection(source) {
  return source.type === 'generated_guidance'
    ? [source.type, source.id, source.version, source.model_run_id, source.generation_stage]
    : [source.type, source.id, source.version];
}

function unitProjection(unit) {
  return [unit.unit_type, unit.content, unit.reviewed_knowledge_reference_ids === undefined ? null : [...unit.reviewed_knowledge_reference_ids], unit.bounded_input_ids === undefined ? null : [...unit.bounded_input_ids]];
}

function assessmentContextFields({ obligation, terminalResult, locale, reviewedKnowledgeItems = [] }) {
  if (!plain(obligation?.practical_task) || !plain(terminalResult) || !['reviewed_knowledge', 'generated_guidance'].includes(terminalResult.authority) || typeof locale !== 'string' || !locale) throw new TypeError('GUIDANCE_ASSESSMENT_CONTEXT_INPUT_INVALID');
  const task = obligation.practical_task;
  return {
    obligation_id: terminalResult.obligation_id,
    task_kind: task.task_kind,
    ...(obligation.subject === undefined ? {} : { subject: obligation.subject }),
    locale,
    guidance_units: structuredClone(terminalResult.guidance_payload.units),
    authority: terminalResult.authority,
    source: structuredClone(terminalResult.source),
    ...(terminalResult.authority === 'generated_guidance'
      ? { bounded_inputs: structuredClone(task.bounded_inputs) }
      : { reviewed_knowledge_items: structuredClone(reviewedKnowledgeItems) }),
  };
}

function assessmentContextProjection(input) {
  const fields = assessmentContextFields(input);
  const common = [GUIDANCE_ASSESSMENT_CONTEXT_VERSION, fields.obligation_id, fields.task_kind, fields.subject === undefined ? null : fields.subject, fields.locale, fields.authority, sourceProjection(fields.source), input.terminalResult.guidance_payload.semantic_safety_validation_required, fields.guidance_units.map(unitProjection)];
  if (fields.authority === 'generated_guidance') return [...common, 'bounded_inputs', fields.bounded_inputs.map(item => [item.id, item.input_type, item.value, item.origin])];
  return [...common, 'reviewed_knowledge_items', fields.reviewed_knowledge_items.map(item => [item.id, String(item.version), item.content])];
}

function deriveGuidanceAssessmentContextBinding(input) {
  const projection = assessmentContextProjection(input);
  return Object.freeze({ version: GUIDANCE_ASSESSMENT_BINDING_VERSION, digest: crypto.createHash('sha256').update(JSON.stringify(projection), 'utf8').digest('hex') });
}

function bindingMatches(input, binding) {
  if (!bindingValid(binding)) return false;
  try { return binding.digest === deriveGuidanceAssessmentContextBinding(input).digest; } catch { return false; }
}

module.exports = { GUIDANCE_ASSESSMENT_BINDING_VERSION, GUIDANCE_ASSESSMENT_CONTEXT_VERSION, assessmentContextFields, assessmentContextProjection, bindingMatches, bindingValid, deriveGuidanceAssessmentContextBinding };
