'use strict';

const crypto = require('node:crypto');

const CONTRACT_VERSION = 'ticket-75f1-v1';
const STAGES = new Set(['claim','route','invocation','context','interpretation','resolution','guidance_resolution','guidance_assessment','artifact_assessment','planning','action_execution','final_composer_input','composer','final_gate','reservation','transport','completion','reconciliation']);
const STATUSES = new Set(['started','selected','completed','eligible','ineligible','blocked','failed','ambiguous','not_executed','handed_off','accepted','reconciliation_required']);
const ACTION_STATES = new Set(['succeeded','failed_retryable','failed_terminal','in_progress','not_executed']);
const ACTION_TYPES = new Set(['provide_checkout_destination','provide_holding_page_destination']);
const RETRY_CLASSES = new Set(['none','transient_same_identity','ambiguous_no_blind_retry','operator_required']);
const FAILURE_STAGES = new Set(['entry','claim_verification','authority','context','interpretation','resolution','guidance_resolution','guidance_assessment','artifact_assessment','planning','action_execution','final_composer_input','composer','final_gate','runtime','deadline','reservation','transport','completion','reconciliation']);
const FAILURE_CODES = new Set(['unauthenticated','forbidden_route','malformed_request','claim_not_owned','claim_expired','already_has_reply','context_invalid','authority_unavailable','authority_unresolved','action_lifecycle_unavailable','reservation_precondition_failed','deadline_exceeded','internal_unclassified','runtime_not_configured','response_ineligible','interpretation_failed','resolution_failed','guidance_resolution_failed','guidance_assessment_unavailable','artifact_assessment_unavailable','planning_failed','action_execution_unavailable','final_composer_input_failed','composer_unavailable','final_response_assessment_unavailable','final_response_blocked','final_response_binding_invalid','reservation_unavailable','reservation_conflict']);

class DiagnosticProjectionError extends Error { constructor(code) { super(code); this.name = 'DiagnosticProjectionError'; this.code = code; } }
const only = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.has(key));
const key = (domain, value) => `v2d-${crypto.createHash('sha256').update(`${domain}\n${value}`, 'utf8').digest('hex')}`;
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function projection(input) {
  if (!only(input, new Set(['event_key','invocation_identity','turn_id','claim_attempt_id','workflow_execution_id','canonical_inbound_message_id','session_correlation','route_mode','route_generation','lifecycle_stage','lifecycle_status','failure_stage','failure_code','retry_class','latency_ms','stage_trace','gate_projection','action_projection','reservation_projection','provider_outcome','completion_outcome']))) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  const event = { contract_version: CONTRACT_VERSION, ...input };
  if (!/^v2d-[0-9a-f]{64}$/.test(event.event_key || '') || !/^cti-[0-9a-f]{64}$/.test(event.invocation_identity || '') || !STAGES.has(event.lifecycle_stage) || !STATUSES.has(event.lifecycle_status)) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  if (event.turn_id !== undefined && !/^v2t-[0-9a-f-]{36}$/.test(event.turn_id)) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  for (const name of ['claim_attempt_id','workflow_execution_id','route_generation']) if (event[name] !== undefined && !opaque(event[name])) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  if (event.canonical_inbound_message_id !== undefined && !uuid(event.canonical_inbound_message_id)) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  if (event.session_correlation !== undefined && !/^psn-[0-9a-f]{24}$/.test(event.session_correlation)) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  if (event.route_mode !== undefined && !['legacy','shadow','live'].includes(event.route_mode)) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  if (event.retry_class !== undefined && !RETRY_CLASSES.has(event.retry_class)) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  if (event.failure_stage !== undefined && !FAILURE_STAGES.has(event.failure_stage)) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  if (event.failure_code !== undefined && !FAILURE_CODES.has(event.failure_code)) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  if (event.latency_ms !== undefined && (!Number.isInteger(event.latency_ms) || event.latency_ms < 0 || event.latency_ms > 120000)) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  if (event.stage_trace !== undefined && (!Array.isArray(event.stage_trace) || event.stage_trace.length > 16 || !event.stage_trace.every(item => only(item, new Set(['stage','status'])) && STAGES.has(item.stage) && ['completed','failed'].includes(item.status)))) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  if (event.gate_projection !== undefined && (!only(event.gate_projection, new Set(['guidance_status','artifact_status','final_status','finding_codes'])) || Object.values(event.gate_projection).some(value => !(typeof value === 'string' || (Array.isArray(value) && value.every(code => typeof code === 'string' && /^[a-z0-9_:-]{1,80}$/.test(code))))))) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  if (event.action_projection !== undefined && (!Array.isArray(event.action_projection) || event.action_projection.length > 1 || !event.action_projection.every(item => only(item, new Set(['action_id','execution_key','action_type','execution_status'])) && /^act-[0-9a-f]{64}$/.test(item.action_id) && /^aek-[0-9a-f]{64}$/.test(item.execution_key) && ACTION_TYPES.has(item.action_type) && ACTION_STATES.has(item.execution_status)))) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  if (event.reservation_projection !== undefined) {
    const value = event.reservation_projection;
    if (!only(value, new Set(['state','logical_reply_key','part_count','message_ids'])) || !['reserved_new','reserved_existing','not_executed'].includes(value.state) || (value.logical_reply_key !== undefined && !/^reply:[A-Za-z0-9._:-]{1,256}$/.test(value.logical_reply_key)) || (value.part_count !== undefined && (!Number.isInteger(value.part_count) || value.part_count < 1 || value.part_count > 999)) || (value.message_ids !== undefined && (!Array.isArray(value.message_ids) || value.message_ids.length > 999 || !value.message_ids.every(uuid)))) throw new DiagnosticProjectionError('diagnostic_projection_invalid');
  }
  return Object.freeze(structuredClone(event));
}

function projectTurnOutcome({ invocationIdentity, turnId, request, route, turnResult, actionProjection = [], gateProjection = {}, reservation, latencyMs, sessionCorrelation }) {
  const eligible = turnResult?.status === 'response_eligible';
  const reservationProjection = reservation ? { state: reservation.state, logical_reply_key: reservation.physical_logical_reply_key, part_count: reservation.messages?.length, message_ids: reservation.messages?.map(row => row.id) } : { state: 'not_executed' };
  return projection({ event_key: key('turn-outcome', `${invocationIdentity}\n${turnId}`), invocation_identity: invocationIdentity, turn_id: turnId, claim_attempt_id: request.claim_attempt_id, workflow_execution_id: request.workflow_execution_id, canonical_inbound_message_id: request.canonical_inbound_message_id, session_correlation: sessionCorrelation, route_mode: route.mode, route_generation: route.generation, lifecycle_stage: eligible ? 'reservation' : (turnResult?.failure_stage || 'final_gate'), lifecycle_status: eligible ? (reservation ? 'handed_off' : 'not_executed') : 'ineligible', failure_stage: eligible ? undefined : turnResult?.failure_stage, failure_code: eligible ? undefined : turnResult?.failure_code, retry_class: 'none', latency_ms: latencyMs, stage_trace: turnResult?.stage_trace || [], gate_projection: gateProjection, action_projection: actionProjection, reservation_projection: reservationProjection });
}

function createBestEffortDiagnosticObserver({ recorder, log = () => {} } = {}) {
  if (!recorder || typeof recorder.record !== 'function') throw new TypeError('DIAGNOSTIC_RECORDER_REQUIRED');
  return Object.freeze({ observe(event) {
    let safe;
    try { safe = projection(event); } catch { log({ event: 'v2_diagnostic_projection_rejected' }); return; }
    Promise.resolve().then(() => recorder.record(safe)).catch(() => log({ event: 'v2_diagnostic_record_failed', code: 'diagnostic_unavailable' }));
  } });
}

function createSupabaseDiagnosticRecorder({ client } = {}) {
  if (!client || typeof client.rpc !== 'function') throw new TypeError('DIAGNOSTIC_CLIENT_REQUIRED');
  return Object.freeze({ async record(event) { const safe = projection(event); const { data, error } = await client.rpc('record_v2_lifecycle_diagnostic', { p: safe }); if (error || !Array.isArray(data) || !['recorded','recorded_existing'].includes(data[0]?.state)) throw new Error('DIAGNOSTIC_RECORD_FAILED'); return data[0]; } });
}

module.exports = { CONTRACT_VERSION, DiagnosticProjectionError, createBestEffortDiagnosticObserver, createSupabaseDiagnosticRecorder, diagnosticEventKey: key, projectTurnOutcome, projection };
