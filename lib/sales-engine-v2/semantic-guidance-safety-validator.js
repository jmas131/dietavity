'use strict';

const { plainObject, practicalGuidanceTerminalValid } = require('./resolved-obligation-validator');
const { FINDING_SEVERITIES } = require('../../config/sales-engine-v2/semantic-guidance-safety-policy');

class SemanticGuidanceSafetyGateError extends Error {
  constructor(code, cause) { super(code); this.name = 'SemanticGuidanceSafetyGateError'; this.code = code; this.cause = cause; }
}
const INPUT_KEYS = new Set(['originatingObligation', 'terminalResult', 'locale', 'reviewedKnowledgeItems', 'semanticAssessor', 'assessorRunId']);
const ASSESSOR_KEYS = new Set(['findings']);
const FINDING_KEYS = new Set(['code', 'unit_index', 'rationale']);
const REVIEWED_ITEM_KEYS = new Set(['id', 'version', 'content']);
function only(value, keys) { return Object.keys(value).every(key => keys.has(key)); }
function validReviewedItem(item) { return plainObject(item) && only(item, REVIEWED_ITEM_KEYS) && typeof item.id === 'string' && !!item.id && (typeof item.version === 'number' || typeof item.version === 'string') && String(item.version) && typeof item.content === 'string' && !!item.content; }
function assertReviewedAlignment(result, items) {
  const references = result.retrieved_knowledge_references || [];
  if (result.authority !== 'reviewed_knowledge' && (!items || items.length === 0)) return [];
  if (!Array.isArray(items) || !items.every(validReviewedItem)) throw new SemanticGuidanceSafetyGateError('SEMANTIC_GUIDANCE_REVIEWED_KNOWLEDGE_INVALID');
  const expected = new Map(references.map(reference => [reference.id, String(reference.version)]));
  if (expected.size !== references.length || items.length !== expected.size) throw new SemanticGuidanceSafetyGateError('SEMANTIC_GUIDANCE_REVIEWED_KNOWLEDGE_MISMATCH');
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id) || expected.get(item.id) !== String(item.version)) throw new SemanticGuidanceSafetyGateError('SEMANTIC_GUIDANCE_REVIEWED_KNOWLEDGE_MISMATCH');
    seen.add(item.id);
  }
  return structuredClone(items);
}
function assertInput(raw) {
  if (!plainObject(raw) || !only(raw, INPUT_KEYS) || !plainObject(raw.originatingObligation) || !plainObject(raw.terminalResult) || typeof raw.locale !== 'string' || !raw.locale || typeof raw.semanticAssessor !== 'function' || typeof raw.assessorRunId !== 'string' || !raw.assessorRunId) throw new SemanticGuidanceSafetyGateError('SEMANTIC_GUIDANCE_GATE_INPUT_INVALID');
  if (!practicalGuidanceTerminalValid(raw.originatingObligation, raw.terminalResult) || raw.terminalResult.resolution_status !== 'resolved' || !['reviewed_knowledge', 'generated_guidance'].includes(raw.terminalResult.authority) || raw.terminalResult.guidance_payload?.semantic_safety_validation_required !== true) throw new SemanticGuidanceSafetyGateError('SEMANTIC_GUIDANCE_GATE_INELIGIBLE');
  return { originatingObligation: structuredClone(raw.originatingObligation), terminalResult: structuredClone(raw.terminalResult), locale: raw.locale, reviewedKnowledgeItems: assertReviewedAlignment(raw.terminalResult, raw.reviewedKnowledgeItems), semanticAssessor: raw.semanticAssessor, assessorRunId: raw.assessorRunId };
}
function validateAssessment(output, unitCount) {
  if (!plainObject(output) || !only(output, ASSESSOR_KEYS) || !Array.isArray(output.findings)) throw new SemanticGuidanceSafetyGateError('SEMANTIC_ASSESSOR_OUTPUT_INVALID');
  const used = new Set();
  return output.findings.map(finding => {
    if (!plainObject(finding) || !only(finding, FINDING_KEYS) || !Object.hasOwn(FINDING_SEVERITIES, finding.code) || !Number.isInteger(finding.unit_index) || finding.unit_index < 0 || finding.unit_index >= unitCount || typeof finding.rationale !== 'string' || !finding.rationale || used.has(`${finding.code}:${finding.unit_index}`)) throw new SemanticGuidanceSafetyGateError('SEMANTIC_ASSESSOR_OUTPUT_INVALID');
    used.add(`${finding.code}:${finding.unit_index}`);
    return { code: finding.code, severity: FINDING_SEVERITIES[finding.code], unit_index: finding.unit_index, rationale: finding.rationale };
  });
}
function semanticGuidanceGateValid(value) {
  if (!plainObject(value) || !only(value, new Set(['obligation_id', 'gate_id', 'gate_version', 'gate_status', 'findings', 'assessment_source'])) || !/^o-[A-Za-z0-9._-]+$/.test(value.obligation_id) || value.gate_id !== 'semantic-guidance-safety-gate' || value.gate_version !== 'ticket-64-v1' || !['cleared', 'blocked', 'indeterminate'].includes(value.gate_status) || !Array.isArray(value.findings) || !plainObject(value.assessment_source) || !only(value.assessment_source, new Set(['assessment_stage', 'assessor_run_id', 'outcome', 'failure_code'])) || value.assessment_source.assessment_stage !== 'semantic_guidance_safety' || typeof value.assessment_source.assessor_run_id !== 'string' || !value.assessment_source.assessor_run_id || !['completed', 'unavailable'].includes(value.assessment_source.outcome)) return false;
  if (value.assessment_source.outcome === 'unavailable') return value.gate_status === 'indeterminate' && value.findings.length === 0 && value.assessment_source.failure_code === 'SEMANTIC_ASSESSOR_UNAVAILABLE';
  if ('failure_code' in value.assessment_source) return false;
  const codes = new Set();
  for (const finding of value.findings) {
    if (!plainObject(finding) || !only(finding, new Set(['code', 'severity', 'unit_index', 'rationale'])) || !Object.hasOwn(FINDING_SEVERITIES, finding.code) || finding.severity !== FINDING_SEVERITIES[finding.code] || !Number.isInteger(finding.unit_index) || finding.unit_index < 0 || typeof finding.rationale !== 'string' || !finding.rationale || codes.has(`${finding.code}:${finding.unit_index}`)) return false;
    codes.add(`${finding.code}:${finding.unit_index}`);
  }
  const hasBlocking = value.findings.some(finding => finding.severity === 'blocking');
  const hasReview = value.findings.some(finding => finding.severity === 'review_required');
  return value.gate_status === (hasBlocking ? 'blocked' : hasReview ? 'indeterminate' : 'cleared');
}
module.exports = { FINDING_KEYS, INPUT_KEYS, SemanticGuidanceSafetyGateError, assertInput, semanticGuidanceGateValid, validateAssessment };
