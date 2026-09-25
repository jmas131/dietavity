'use strict';

const crypto = require('node:crypto');
const { assertFinalComposerInput } = require('./final-composer-input');
const { assertComposerResult } = require('./response-composer');
const { ASSESSOR_PROMPT_VERSION, SYSTEM_PROMPT } = require('../../config/sales-engine-v2/final-customer-response-gate-prompt');
const { ASSESSMENT_STAGE, ASSESSOR_UNAVAILABLE, BINDING_VERSION, FINDING_SEVERITIES, GATE_ID, GATE_VERSION } = require('../../config/sales-engine-v2/final-customer-response-gate-policy');

const INPUT_KEYS = new Set(['finalComposerInput', 'composerResult', 'semanticAssessor', 'assessorRunId']);
const ASSESSOR_KEYS = new Set(['findings']);
const FINDING_KEYS = new Set(['code', 'evidence']);
const EVIDENCE_KEYS = new Set(['excerpt', 'rationale']);
const GATE_KEYS = new Set(['gate_id', 'gate_version', 'context_id', 'candidate_binding', 'gate_status', 'findings', 'assessment_source']);
const only = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.has(key));
const clone = value => structuredClone(value);
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

class FinalCustomerResponseGateError extends Error {
  constructor(code, cause) { super(code); this.name = 'FinalCustomerResponseGateError'; this.code = code; this.cause = cause; }
}

function candidateBinding(composerResult) {
  const result = composerResult;
  return {
    version: BINDING_VERSION,
    digest: digest(['final-customer-response-candidate-v1', result.composer_result_version, result.context_id, result.locale, result.response_text, result.covered_obligation_ids, result.expressed_destination_refs, result.model_provenance]),
  };
}

function assessmentPayload(input) {
  // Sources/model provenance are audit material and are intentionally omitted:
  // they cannot expand linguistic authority. All semantic outcome data remains.
  const envelope = {
    composer_input_version: input.finalComposerInput.composer_input_version,
    contract_version: input.finalComposerInput.contract_version,
    context_id: input.finalComposerInput.context_id,
    locale: input.finalComposerInput.locale,
    obligation_ids: clone(input.finalComposerInput.obligation_ids),
    obligation_outcomes: input.finalComposerInput.obligation_outcomes.map(outcome => {
      const { source, ...semanticOutcome } = outcome;
      return clone(semanticOutcome);
    }),
    prohibited_claims: clone(input.finalComposerInput.prohibited_claims),
    prohibited_actions: clone(input.finalComposerInput.prohibited_actions),
    question_budget: input.finalComposerInput.question_budget,
    completion_requirement: input.finalComposerInput.completion_requirement,
  };
  return {
    assessor_prompt_version: ASSESSOR_PROMPT_VERSION,
    authoritative_semantic_envelope: envelope,
    candidate: {
      composer_result_version: input.composerResult.composer_result_version,
      context_id: input.composerResult.context_id,
      locale: input.composerResult.locale,
      response_text: input.composerResult.response_text,
      covered_obligation_ids: clone(input.composerResult.covered_obligation_ids),
      expressed_destination_refs: clone(input.composerResult.expressed_destination_refs),
    },
  };
}

function assertInput(raw) {
  if (!only(raw, INPUT_KEYS) || typeof raw.semanticAssessor !== 'function' || typeof raw.assessorRunId !== 'string' || !raw.assessorRunId) throw new FinalCustomerResponseGateError('FINAL_RESPONSE_GATE_INPUT_INVALID');
  let finalComposerInput; let composerResult;
  try { finalComposerInput = assertFinalComposerInput(raw.finalComposerInput); } catch (error) { throw new FinalCustomerResponseGateError('FINAL_RESPONSE_FINAL_COMPOSER_INPUT_INVALID', error); }
  try { composerResult = assertComposerResult(raw.composerResult, { finalComposerInput }); } catch (error) { throw new FinalCustomerResponseGateError('FINAL_RESPONSE_COMPOSER_RESULT_INVALID', error); }
  return { finalComposerInput, composerResult, semanticAssessor: raw.semanticAssessor, assessorRunId: raw.assessorRunId };
}

function validateAssessment(value) {
  if (!only(value, ASSESSOR_KEYS) || !Array.isArray(value.findings) || value.findings.length > 20) throw new FinalCustomerResponseGateError('FINAL_RESPONSE_ASSESSOR_OUTPUT_INVALID');
  const seen = new Set();
  return value.findings.map(finding => {
    if (!only(finding, FINDING_KEYS) || !Object.hasOwn(FINDING_SEVERITIES, finding.code) || !only(finding.evidence, EVIDENCE_KEYS) || typeof finding.evidence.excerpt !== 'string' || !finding.evidence.excerpt.trim() || finding.evidence.excerpt.length > 500 || typeof finding.evidence.rationale !== 'string' || !finding.evidence.rationale.trim() || finding.evidence.rationale.length > 500 || seen.has(`${finding.code}:${finding.evidence.excerpt}`)) throw new FinalCustomerResponseGateError('FINAL_RESPONSE_ASSESSOR_OUTPUT_INVALID');
    seen.add(`${finding.code}:${finding.evidence.excerpt}`);
    return { code: finding.code, severity: FINDING_SEVERITIES[finding.code], evidence: clone(finding.evidence) };
  });
}

function source(assessorRunId, outcome, failureCode) { return { assessment_stage: ASSESSMENT_STAGE, assessor_run_id: assessorRunId, outcome, ...(failureCode ? { failure_code: failureCode } : {}) }; }
function unavailable(input) { return { gate_id: GATE_ID, gate_version: GATE_VERSION, context_id: input.finalComposerInput.context_id, candidate_binding: candidateBinding(input.composerResult), gate_status: 'indeterminate', findings: [], assessment_source: source(input.assessorRunId, 'unavailable', ASSESSOR_UNAVAILABLE) }; }

function assessFinalCustomerResponse(rawInput) {
  const input = assertInput(rawInput);
  let output;
  try { output = input.semanticAssessor({ system_prompt: SYSTEM_PROMPT, input: assessmentPayload(input) }); }
  catch (error) {
    if (error?.code === ASSESSOR_UNAVAILABLE) return unavailable(input);
    throw error;
  }
  const findings = validateAssessment(output);
  return { gate_id: GATE_ID, gate_version: GATE_VERSION, context_id: input.finalComposerInput.context_id, candidate_binding: candidateBinding(input.composerResult), gate_status: findings.length ? 'blocked' : 'cleared', findings, assessment_source: source(input.assessorRunId, 'completed') };
}

function finalCustomerResponseGateValid(value) {
  if (!only(value, GATE_KEYS) || value.gate_id !== GATE_ID || value.gate_version !== GATE_VERSION || typeof value.context_id !== 'string' || !value.context_id || !only(value.candidate_binding, new Set(['version', 'digest'])) || value.candidate_binding.version !== BINDING_VERSION || !/^[0-9a-f]{64}$/u.test(value.candidate_binding.digest || '') || !['cleared', 'blocked', 'indeterminate'].includes(value.gate_status) || !Array.isArray(value.findings) || !only(value.assessment_source, new Set(['assessment_stage', 'assessor_run_id', 'outcome', 'failure_code'])) || value.assessment_source.assessment_stage !== ASSESSMENT_STAGE || typeof value.assessment_source.assessor_run_id !== 'string' || !value.assessment_source.assessor_run_id || !['completed', 'unavailable'].includes(value.assessment_source.outcome)) return false;
  if (value.assessment_source.outcome === 'unavailable') return value.gate_status === 'indeterminate' && value.findings.length === 0 && value.assessment_source.failure_code === ASSESSOR_UNAVAILABLE;
  if (Object.hasOwn(value.assessment_source, 'failure_code')) return false;
  if (value.findings.length > 20) return false;
  const seen = new Set();
  if (value.findings.some(finding => !only(finding, new Set(['code', 'severity', 'evidence'])) || !Object.hasOwn(FINDING_SEVERITIES, finding.code) || finding.severity !== FINDING_SEVERITIES[finding.code] || !only(finding.evidence, EVIDENCE_KEYS) || typeof finding.evidence.excerpt !== 'string' || !finding.evidence.excerpt.trim() || finding.evidence.excerpt.length > 500 || typeof finding.evidence.rationale !== 'string' || !finding.evidence.rationale.trim() || finding.evidence.rationale.length > 500 || seen.has(`${finding.code}:${finding.evidence.excerpt}`) || !seen.add(`${finding.code}:${finding.evidence.excerpt}`))) return false;
  return value.gate_status === (value.findings.length ? 'blocked' : 'cleared');
}

function customerResponseEligible({ finalComposerInput, composerResult, finalGate }) {
  try {
    const input = assertFinalComposerInput(finalComposerInput);
    const result = assertComposerResult(composerResult, { finalComposerInput: input });
    return finalCustomerResponseGateValid(finalGate) && finalGate.gate_status === 'cleared' && finalGate.context_id === input.context_id && finalGate.candidate_binding.version === BINDING_VERSION && finalGate.candidate_binding.digest === candidateBinding(result).digest;
  } catch { return false; }
}

module.exports = { ASSESSOR_UNAVAILABLE, BINDING_VERSION, FINDING_SEVERITIES, FinalCustomerResponseGateError, assessFinalCustomerResponse, assessmentPayload, candidateBinding, customerResponseEligible, finalCustomerResponseGateValid, validateAssessment };
