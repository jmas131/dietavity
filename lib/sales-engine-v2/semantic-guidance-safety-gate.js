'use strict';

const { SYSTEM_PROMPT } = require('../../config/sales-engine-v2/semantic-guidance-safety-prompt');
const { ASSESSMENT_STAGE, GATE_ID, GATE_VERSION } = require('../../config/sales-engine-v2/semantic-guidance-safety-policy');
const { SemanticGuidanceSafetyGateError, assertInput, validateAssessment } = require('./semantic-guidance-safety-validator');

function assessmentInput(input) {
  const result = input.terminalResult;
  return {
    obligation_id: result.obligation_id,
    task_kind: input.originatingObligation.practical_task.task_kind,
    ...(input.originatingObligation.subject === undefined ? {} : { subject: input.originatingObligation.subject }),
    locale: input.locale,
    guidance_units: structuredClone(result.guidance_payload.units),
    authority: result.authority,
    source: structuredClone(result.source),
    ...(result.authority === 'reviewed_knowledge' ? { reviewed_knowledge_items: structuredClone(input.reviewedKnowledgeItems) } : { bounded_inputs: structuredClone(input.originatingObligation.practical_task.bounded_inputs) }),
  };
}
function source(assessorRunId, outcome, failureCode) { return { assessment_stage: ASSESSMENT_STAGE, assessor_run_id: assessorRunId, outcome, ...(failureCode ? { failure_code: failureCode } : {}) }; }
function gate(result, findings, assessorRunId) {
  const gate_status = findings.some(finding => finding.severity === 'blocking') ? 'blocked' : findings.some(finding => finding.severity === 'review_required') ? 'indeterminate' : 'cleared';
  return { obligation_id: result.obligation_id, gate_id: GATE_ID, gate_version: GATE_VERSION, gate_status, findings, assessment_source: source(assessorRunId, 'completed') };
}
function semanticAssessorUnavailable(error) { return error && error.code === 'SEMANTIC_ASSESSOR_UNAVAILABLE'; }
function assessSemanticGuidance(rawInput) {
  const input = assertInput(rawInput);
  let output;
  try { output = input.semanticAssessor({ system_prompt: SYSTEM_PROMPT, input: assessmentInput(input) }); }
  catch (error) {
    if (semanticAssessorUnavailable(error)) return { obligation_id: input.terminalResult.obligation_id, gate_id: GATE_ID, gate_version: GATE_VERSION, gate_status: 'indeterminate', findings: [], assessment_source: source(input.assessorRunId, 'unavailable', 'SEMANTIC_ASSESSOR_UNAVAILABLE') };
    throw error;
  }
  return gate(input.terminalResult, validateAssessment(output, input.terminalResult.guidance_payload.units.length), input.assessorRunId);
}
module.exports = { GATE_ID, GATE_VERSION, SemanticGuidanceSafetyGateError, assessSemanticGuidance, assessmentInput };
