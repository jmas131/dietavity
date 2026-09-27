'use strict';

const { diagnosticCompanion } = require('./turn-orchestrator');

const CONTRACT_VERSION = 'ticket-75-shadow-v1';
const STAGES = new Set(['context','interpretation','resolution','guidance_resolution','guidance_assessment','artifact_assessment','planning','action_execution','final_composer_input','composer','final_gate']);
const FAILURE_STAGES = new Set(['entry','claim_verification','authority','context','interpretation','resolution','guidance_resolution','guidance_assessment','artifact_assessment','planning','action_execution','final_composer_input','composer','final_gate','runtime','deadline']);
const FAILURE_CODES = new Set(['unauthenticated','forbidden_route','malformed_request','claim_not_owned','claim_expired','already_has_reply','context_invalid','authority_unavailable','authority_unresolved','action_lifecycle_unavailable','deadline_exceeded','internal_unclassified','runtime_not_configured','response_ineligible','interpretation_failed','resolution_failed','guidance_resolution_failed','guidance_assessment_unavailable','artifact_assessment_unavailable','planning_failed','action_execution_unavailable','final_composer_input_failed','composer_unavailable','final_response_assessment_unavailable','final_response_blocked','final_response_binding_invalid']);
const RETRIES = new Set(['none','transient_same_identity','ambiguous_no_blind_retry','operator_required']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const trace = value => Array.isArray(value) && value.length <= 16 && value.every(item => plain(item) && Object.keys(item).length === 2 && STAGES.has(item.stage) && ['completed','failed'].includes(item.status)) ? value.map(item => ({ stage: item.stage, status: item.status })) : [];
function gate(value) { const input = plain(value) ? value : {}; const output = {}; for (const name of ['guidance_status','artifact_status','final_status']) if (typeof input[name] === 'string' && /^[a-z0-9_:-]{1,80}$/.test(input[name])) output[name] = input[name]; return output; }
function actions(value) { return Array.isArray(value) && value.length <= 1 && value.every(item => plain(item) && /^act-[a-f0-9]{64}$/.test(item.action_id) && /^aek-[a-f0-9]{64}$/.test(item.execution_key) && ['provide_checkout_destination','provide_holding_page_destination'].includes(item.action_type) && ['succeeded','failed_retryable','failed_terminal','in_progress','not_executed'].includes(item.execution_status)) ? value.map(item => ({ action_id: item.action_id, execution_key: item.execution_key, action_type: item.action_type, execution_status: item.execution_status })) : []; }
function valid(value) {
  if (!plain(value) || Object.keys(value).some(key => !new Set(['contract_version','invocation_identity','turn_id','mode','outcome','response_eligibility','stage_trace','gate_projection','action_projection','reservation_state','failure_stage','failure_code','retry_class','latency_ms']).has(key)) || value.contract_version !== CONTRACT_VERSION || !/^cti-[a-f0-9]{64}$/.test(value.invocation_identity || '') || !/^v2t-[a-f0-9-]{36}$/.test(value.turn_id || '') || value.mode !== 'shadow' || !['completed','failed'].includes(value.outcome) || !['eligible','ineligible','unknown'].includes(value.response_eligibility) || JSON.stringify(trace(value.stage_trace)) !== JSON.stringify(value.stage_trace) || JSON.stringify(gate(value.gate_projection)) !== JSON.stringify(value.gate_projection) || JSON.stringify(actions(value.action_projection)) !== JSON.stringify(value.action_projection) || value.reservation_state !== 'not_executed' || !RETRIES.has(value.retry_class) || !Number.isInteger(value.latency_ms) || value.latency_ms < 0 || value.latency_ms > 120000) return false;
  if (value.failure_stage !== undefined && !FAILURE_STAGES.has(value.failure_stage)) return false;
  if (value.failure_code !== undefined && !FAILURE_CODES.has(value.failure_code)) return false;
  return true;
}
function success({ output, invocationIdentity, turnId, latencyMs }) {
  const turn = output?.turn_result; const companion = diagnosticCompanion(turn);
  const value = { contract_version: CONTRACT_VERSION, invocation_identity: invocationIdentity, turn_id: turnId, mode: 'shadow', outcome: 'completed', response_eligibility: output?.status === 'response_eligible' ? 'eligible' : 'ineligible', stage_trace: trace(turn?.stage_trace), gate_projection: gate(companion.gate_projection), action_projection: actions(companion.action_projection), reservation_state: 'not_executed', retry_class: 'none', latency_ms: Math.min(120000, Math.max(0, Math.trunc(latencyMs))) };
  if (output?.status === 'response_ineligible') { value.failure_stage = turn?.failure_stage || 'runtime'; value.failure_code = turn?.failure_code || 'response_ineligible'; }
  if (!valid(value)) throw new TypeError('SHADOW_RESULT_INVALID'); return Object.freeze(value);
}
function failure({ invocationIdentity, turnId, failureStage, failureCode, retryClass, latencyMs }) {
  const value = { contract_version: CONTRACT_VERSION, invocation_identity: invocationIdentity, turn_id: turnId, mode: 'shadow', outcome: 'failed', response_eligibility: 'unknown', stage_trace: [], gate_projection: {}, action_projection: [], reservation_state: 'not_executed', failure_stage: FAILURE_STAGES.has(failureStage) ? failureStage : 'runtime', failure_code: FAILURE_CODES.has(failureCode) ? failureCode : 'internal_unclassified', retry_class: RETRIES.has(retryClass) ? retryClass : 'operator_required', latency_ms: Math.min(120000, Math.max(0, Math.trunc(latencyMs))) };
  if (!valid(value)) throw new TypeError('SHADOW_RESULT_INVALID'); return Object.freeze(value);
}
module.exports = { CONTRACT_VERSION, failure, success, valid };
