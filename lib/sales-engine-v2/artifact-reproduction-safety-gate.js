'use strict';

const { SYSTEM_PROMPT } = require('../../config/sales-engine-v2/artifact-reproduction-safety-prompt');
const { ASSESSMENT_STAGE, GATE_ID, GATE_VERSION } = require('../../config/sales-engine-v2/artifact-reproduction-safety-policy');
const { ArtifactReproductionSafetyGateError, assertInput, bindings, constraintDigest, validateAssessment } = require('./artifact-reproduction-safety-validator');

function assessmentInput(input) {
  const task = input.conversationalGeneration;
  return { locale: input.locale, operation: task.operation, artifacts: task.artifacts.map(item => ({ artifact_id: item.artifact_id, text: item.text })), current_turn_inputs: task.current_turn_inputs, current_turn_constraints: task.current_turn_constraints };
}
function source(assessorRunId, outcome, failureCode) { return { assessment_stage: ASSESSMENT_STAGE, assessor_run_id: assessorRunId, outcome, ...(failureCode ? { failure_code: failureCode } : {}) }; }
function unavailable(input) { const task = input.conversationalGeneration; return { obligation_id: task.obligation_id, gate_id: GATE_ID, gate_version: GATE_VERSION, operation: task.operation, artifact_bindings: bindings(task), constraint_digest: constraintDigest(task), gate_status: 'indeterminate', findings: [], assessment_source: source(input.assessorRunId, 'unavailable', 'ARTIFACT_REPRODUCTION_ASSESSOR_UNAVAILABLE') }; }
function assessArtifactReproduction(rawInput) {
  const input = assertInput(rawInput); const task = input.conversationalGeneration;
  let output;
  try { output = input.artifactAssessor({ system_prompt: SYSTEM_PROMPT, input: assessmentInput(input) }); }
  catch (error) {
    if (error?.code === 'ARTIFACT_REPRODUCTION_ASSESSOR_UNAVAILABLE') return unavailable(input);
    throw error;
  }
  const findings = validateAssessment(output, new Set(task.artifacts.map(item => item.artifact_id)));
  const gate_status = findings.some(item => item.severity === 'blocking') ? 'blocked' : findings.some(item => item.severity === 'review_required') ? 'indeterminate' : 'cleared';
  return { obligation_id: task.obligation_id, gate_id: GATE_ID, gate_version: GATE_VERSION, operation: task.operation, artifact_bindings: bindings(task), constraint_digest: constraintDigest(task), gate_status, findings, assessment_source: source(input.assessorRunId, 'completed') };
}

module.exports = { ArtifactReproductionSafetyGateError, assessArtifactReproduction, assessmentInput };
