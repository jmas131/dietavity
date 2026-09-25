'use strict';

const crypto = require('node:crypto');
const { normativeResolvedValid, plainObject } = require('./resolved-obligation-validator');
const { bindingValid } = require('./guidance-assessment-context');

const TERMINAL_GUIDANCE_BINDING_VERSION = 'ticket-64b-v1';
const DIGEST = /^[0-9a-f]{64}$/;

function terminalGuidanceBindingValid(value) {
  return plainObject(value) && Object.keys(value).length === 2 && value.version === TERMINAL_GUIDANCE_BINDING_VERSION && typeof value.digest === 'string' && DIGEST.test(value.digest);
}

function sourceProjection(source) {
  return source.type === 'generated_guidance'
    ? [source.type, source.id, source.version, source.model_run_id, source.generation_stage]
    : [source.type, source.id, source.version];
}

function unitProjection(unit) {
  return [unit.unit_type, unit.content, unit.reviewed_knowledge_reference_ids === undefined ? null : [...unit.reviewed_knowledge_reference_ids], unit.bounded_input_ids === undefined ? null : [...unit.bounded_input_ids]];
}

function terminalGuidanceResultValid(value) {
  return normativeResolvedValid(value) && value.resolution_status === 'resolved' && ['reviewed_knowledge', 'generated_guidance'].includes(value.authority) && value.guidance_payload?.semantic_safety_validation_required === true && bindingValid(value.assessment_context_binding);
}

function terminalGuidanceProjection(result) {
  if (!terminalGuidanceResultValid(result)) throw new TypeError('TERMINAL_GUIDANCE_BINDING_INPUT_INVALID');
  return [
    TERMINAL_GUIDANCE_BINDING_VERSION,
    result.obligation_id,
    result.resolution_status,
    result.authority,
    sourceProjection(result.source),
    result.llm_reasoning_permitted,
    result.guidance_payload.semantic_safety_validation_required,
    result.guidance_payload.units.map(unitProjection),
    result.retrieved_knowledge_references === undefined ? null : result.retrieved_knowledge_references.map(sourceProjection),
    [result.assessment_context_binding.version, result.assessment_context_binding.digest],
  ];
}

function deriveTerminalGuidanceBinding(result) {
  return Object.freeze({ version: TERMINAL_GUIDANCE_BINDING_VERSION, digest: crypto.createHash('sha256').update(JSON.stringify(terminalGuidanceProjection(result)), 'utf8').digest('hex') });
}

module.exports = { TERMINAL_GUIDANCE_BINDING_VERSION, deriveTerminalGuidanceBinding, terminalGuidanceBindingValid, terminalGuidanceProjection, terminalGuidanceResultValid };
