'use strict';

const { SYSTEM_PROMPT } = require('../../config/sales-engine-v2/semantic-guidance-safety-prompt');
const { ASSESSMENT_STAGE, GATE_ID, GATE_VERSION } = require('../../config/sales-engine-v2/semantic-guidance-safety-policy');
const { SemanticGuidanceSafetyGateError, assertInput, validateAssessment } = require('./semantic-guidance-safety-validator');
const { assessmentContextFields } = require('./guidance-assessment-context');
const { deriveTerminalGuidanceBinding } = require('./terminal-guidance-binding');

function assessmentInput(input) {
  return assessmentContextFields({ obligation: input.originatingObligation, terminalResult: input.terminalResult, locale: input.locale, reviewedKnowledgeItems: input.reviewedKnowledgeItems });
}
function source(assessorRunId, outcome, failureCode) { return { assessment_stage: ASSESSMENT_STAGE, assessor_run_id: assessorRunId, outcome, ...(failureCode ? { failure_code: failureCode } : {}) }; }
function gate(result, findings, assessorRunId) {
  const gate_status = findings.some(finding => finding.severity === 'blocking') ? 'blocked' : findings.some(finding => finding.severity === 'review_required') ? 'indeterminate' : 'cleared';
  return { obligation_id: result.obligation_id, gate_id: GATE_ID, gate_version: GATE_VERSION, terminal_guidance_binding: deriveTerminalGuidanceBinding(result), gate_status, findings, assessment_source: source(assessorRunId, 'completed') };
}
function semanticAssessorUnavailable(error) { return error && error.code === 'SEMANTIC_ASSESSOR_UNAVAILABLE'; }
function assessSemanticGuidance(rawInput) {
  const input = assertInput(rawInput);
  let output;
  try { output = input.semanticAssessor({ system_prompt: SYSTEM_PROMPT, input: assessmentInput(input) }); }
  catch (error) {
    if (semanticAssessorUnavailable(error)) return { obligation_id: input.terminalResult.obligation_id, gate_id: GATE_ID, gate_version: GATE_VERSION, terminal_guidance_binding: deriveTerminalGuidanceBinding(input.terminalResult), gate_status: 'indeterminate', findings: [], assessment_source: source(input.assessorRunId, 'unavailable', 'SEMANTIC_ASSESSOR_UNAVAILABLE') };
    throw error;
  }
  const finalize = value => gate(input.terminalResult, validateAssessment(value, input.terminalResult.guidance_payload.units.length), input.assessorRunId);
  if (output && typeof output.then === 'function') return output.then(finalize, error => { if (semanticAssessorUnavailable(error) || error?.code === 'MODEL_RUNTIME_UNAVAILABLE' || error?.code === 'MODEL_RUNTIME_DEADLINE_EXCEEDED') return unavailable(input); throw error; });
  return finalize(output);
}
function unavailable(input) { return { obligation_id: input.terminalResult.obligation_id, gate_id: GATE_ID, gate_version: GATE_VERSION, terminal_guidance_binding: deriveTerminalGuidanceBinding(input.terminalResult), gate_status: 'indeterminate', findings: [], assessment_source: source(input.assessorRunId, 'unavailable', 'SEMANTIC_ASSESSOR_UNAVAILABLE') }; }
module.exports = { GATE_ID, GATE_VERSION, SemanticGuidanceSafetyGateError, assessSemanticGuidance, assessmentInput };
