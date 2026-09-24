'use strict';

const crypto = require('node:crypto');
const { ASSESSMENT_STAGE, FINDING_SEVERITIES, GATE_ID, GATE_VERSION } = require('../../config/sales-engine-v2/artifact-reproduction-safety-policy');

class ArtifactReproductionSafetyGateError extends Error { constructor(code, cause) { super(code); this.name = 'ArtifactReproductionSafetyGateError'; this.code = code; this.cause = cause; } }
const INPUT_KEYS = new Set(['conversationalGeneration', 'locale', 'artifactAssessor', 'assessorRunId']);
const TASK_KEYS = new Set(['obligation_id', 'operation', 'current_turn_inputs', 'current_turn_constraints', 'artifacts']);
const FINDING_KEYS = new Set(['code', 'artifact_id', 'rationale']);
const only = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.has(key));
const artifactId = value => typeof value === 'string' && /^ca-[A-Za-z0-9._-]+$/.test(value);
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

function taskValid(value) {
  return only(value, TASK_KEYS) && typeof value.obligation_id === 'string' && /^o-[A-Za-z0-9._-]+$/.test(value.obligation_id) && ['show', 'transform', 'summarize'].includes(value.operation) && Array.isArray(value.current_turn_inputs) && Array.isArray(value.current_turn_constraints) && Array.isArray(value.artifacts) && value.artifacts.length > 0 && value.artifacts.every(item => only(item, new Set(['artifact_id', 'text'])) && artifactId(item.artifact_id) && typeof item.text === 'string' && !!item.text) && new Set(value.artifacts.map(item => item.artifact_id)).size === value.artifacts.length && value.current_turn_inputs.every(item => only(item, new Set(['input_type', 'value', 'origin'])) && item.input_type === 'draft_specification' && typeof item.value === 'string' && !!item.value && item.origin === 'current_turn') && value.current_turn_constraints.every(item => only(item, new Set(['value', 'origin'])) && typeof item.value === 'string' && !!item.value && item.origin === 'current_turn') && (value.operation === 'summarize' || value.artifacts.length === 1);
}
function bindings(task) { return task.artifacts.map(item => ({ artifact_id: item.artifact_id, content_digest: digest(['artifact-text-v1', item.text]) })); }
function constraintDigest(task) { return digest(['artifact-reproduction-request-v1', task.operation, task.current_turn_inputs.map(item => [item.input_type, item.value, item.origin]), task.current_turn_constraints.map(item => [item.value, item.origin])]); }
function assertInput(raw) {
  if (!only(raw, INPUT_KEYS) || !taskValid(raw.conversationalGeneration) || typeof raw.locale !== 'string' || !raw.locale || typeof raw.artifactAssessor !== 'function' || typeof raw.assessorRunId !== 'string' || !raw.assessorRunId) throw new ArtifactReproductionSafetyGateError('ARTIFACT_REPRODUCTION_GATE_INPUT_INVALID');
  return { conversationalGeneration: structuredClone(raw.conversationalGeneration), locale: raw.locale, artifactAssessor: raw.artifactAssessor, assessorRunId: raw.assessorRunId };
}
function validateAssessment(value, selectedArtifactIds) {
  if (!only(value, new Set(['findings'])) || !Array.isArray(value.findings)) throw new ArtifactReproductionSafetyGateError('ARTIFACT_REPRODUCTION_ASSESSOR_OUTPUT_INVALID');
  const used = new Set();
  return value.findings.map(finding => {
    if (!only(finding, FINDING_KEYS) || !Object.hasOwn(FINDING_SEVERITIES, finding.code) || !selectedArtifactIds.has(finding.artifact_id) || typeof finding.rationale !== 'string' || !finding.rationale || used.has(`${finding.code}:${finding.artifact_id}`)) throw new ArtifactReproductionSafetyGateError('ARTIFACT_REPRODUCTION_ASSESSOR_OUTPUT_INVALID');
    used.add(`${finding.code}:${finding.artifact_id}`);
    return { code: finding.code, severity: FINDING_SEVERITIES[finding.code], artifact_id: finding.artifact_id, rationale: finding.rationale };
  });
}
function artifactReproductionGateValid(value) {
  if (!only(value, new Set(['obligation_id', 'gate_id', 'gate_version', 'operation', 'artifact_bindings', 'constraint_digest', 'gate_status', 'findings', 'assessment_source'])) || typeof value.obligation_id !== 'string' || !/^o-[A-Za-z0-9._-]+$/.test(value.obligation_id) || value.gate_id !== GATE_ID || value.gate_version !== GATE_VERSION || !['show', 'transform', 'summarize'].includes(value.operation) || !Array.isArray(value.artifact_bindings) || value.artifact_bindings.length === 0 || !/^[0-9a-f]{64}$/.test(value.constraint_digest || '') || !['cleared', 'blocked', 'indeterminate'].includes(value.gate_status) || !Array.isArray(value.findings) || !only(value.assessment_source, new Set(['assessment_stage', 'assessor_run_id', 'outcome', 'failure_code'])) || value.assessment_source.assessment_stage !== ASSESSMENT_STAGE || typeof value.assessment_source.assessor_run_id !== 'string' || !value.assessment_source.assessor_run_id || !['completed', 'unavailable'].includes(value.assessment_source.outcome)) return false;
  const ids = new Set();
  if (value.artifact_bindings.some(item => !only(item, new Set(['artifact_id', 'content_digest'])) || !artifactId(item.artifact_id) || !/^[0-9a-f]{64}$/.test(item.content_digest || '') || ids.has(item.artifact_id) || !ids.add(item.artifact_id))) return false;
  if (value.assessment_source.outcome === 'unavailable') return value.gate_status === 'indeterminate' && value.findings.length === 0 && value.assessment_source.failure_code === 'ARTIFACT_REPRODUCTION_ASSESSOR_UNAVAILABLE';
  if (Object.hasOwn(value.assessment_source, 'failure_code')) return false;
  const findings = new Set();
  if (value.findings.some(item => !only(item, new Set(['code', 'severity', 'artifact_id', 'rationale'])) || !Object.hasOwn(FINDING_SEVERITIES, item.code) || item.severity !== FINDING_SEVERITIES[item.code] || !ids.has(item.artifact_id) || typeof item.rationale !== 'string' || !item.rationale || findings.has(`${item.code}:${item.artifact_id}`) || !findings.add(`${item.code}:${item.artifact_id}`))) return false;
  const blocking = value.findings.some(item => item.severity === 'blocking'); const review = value.findings.some(item => item.severity === 'review_required');
  return value.gate_status === (blocking ? 'blocked' : review ? 'indeterminate' : 'cleared');
}
function gateMatches(task, gate) {
  return taskValid(task) && artifactReproductionGateValid(gate) && gate.obligation_id === task.obligation_id && gate.operation === task.operation && JSON.stringify(gate.artifact_bindings) === JSON.stringify(bindings(task)) && gate.constraint_digest === constraintDigest(task);
}

module.exports = { ArtifactReproductionSafetyGateError, artifactReproductionGateValid, assertInput, bindings, constraintDigest, gateMatches, validateAssessment };
