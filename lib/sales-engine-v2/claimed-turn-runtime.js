'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const CONTRACT_VERSION = 'ticket-75-claimed-turn-v1';
const AUDIENCE = 'dietavity.sales-engine-v2.claimed-turn';
const MODES = new Set(['live', 'shadow']);
const ROUTE_STATES = new Set(['disabled', 'shadow', 'live']);
const RETRY_CLASSES = new Set(['none', 'transient_same_identity', 'ambiguous_no_blind_retry', 'operator_required']);
const ERROR_CODES = new Set(['unauthenticated', 'forbidden_route', 'malformed_request', 'claim_not_owned', 'claim_expired', 'already_has_reply', 'context_invalid', 'authority_unavailable', 'authority_unresolved', 'action_lifecycle_unavailable', 'reservation_precondition_failed', 'deadline_exceeded', 'internal_unclassified', 'runtime_not_configured', 'response_ineligible']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE = /^[A-Za-z0-9._:-]+$/;
const REQUEST_KEYS = new Set(['contract_version', 'canonical_inbound_message_id', 'session_id', 'processing_owner', 'claimed_lease_until', 'claim_attempt_id', 'mode', 'workflow_execution_id']);

class ClaimedTurnError extends Error {
  constructor(code, { stage = 'entry', retryClass = 'operator_required', status = 400, cause } = {}) {
    super(code); this.name = 'ClaimedTurnError'; this.code = code; this.stage = stage; this.retryClass = retryClass; this.status = status; this.cause = cause;
  }
}

function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validOpaque(value, max = 128) { return typeof value === 'string' && value.length >= 1 && value.length <= max && OPAQUE.test(value); }
function validDate(value) { return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value; }
function fail(code, options) { throw new ClaimedTurnError(code, options); }

function assertClaimedTurnRequest(value) {
  if (!plain(value) || Object.keys(value).some(key => !REQUEST_KEYS.has(key))) fail('malformed_request');
  for (const key of ['contract_version', 'canonical_inbound_message_id', 'session_id', 'processing_owner', 'claimed_lease_until', 'claim_attempt_id', 'mode']) if (!Object.hasOwn(value, key)) fail('malformed_request');
  if (value.contract_version !== CONTRACT_VERSION || !UUID.test(value.canonical_inbound_message_id) || !validOpaque(value.session_id, 256) || !validOpaque(value.processing_owner, 128) || !validDate(value.claimed_lease_until) || !validOpaque(value.claim_attempt_id, 128) || !MODES.has(value.mode) || (value.workflow_execution_id !== undefined && !validOpaque(value.workflow_execution_id, 128))) fail('malformed_request');
  return Object.freeze({ ...value, canonical_inbound_message_id: value.canonical_inbound_message_id.toLowerCase() });
}

function invocationIdentity({ canonical_inbound_message_id, processing_owner, routeGeneration }) {
  if (!UUID.test(canonical_inbound_message_id) || !validOpaque(processing_owner, 128) || !validOpaque(routeGeneration, 64)) throw new TypeError('CLAIMED_TURN_IDENTITY_INVALID');
  return `cti-${crypto.createHash('sha256').update(`${canonical_inbound_message_id.toLowerCase()}\n${processing_owner}\n${routeGeneration}`, 'utf8').digest('hex')}`;
}
function pseudonym(value, key) {
  if (typeof key !== 'string' || key.length < 16) return null;
  return `psn-${crypto.createHmac('sha256', key).update(value, 'utf8').digest('hex').slice(0, 24)}`;
}
function createTurnId() { return `v2t-${crypto.randomUUID()}`; }

function createDeadline({ timeoutMs, now = () => Date.now() } = {}) {
  if (timeoutMs === undefined || timeoutMs === null) return { signal: undefined, remainingMs: () => null, abort: () => {}, clear: () => {}, isExpired: () => false };
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new TypeError('CLAIMED_TURN_DEADLINE_INVALID');
  const controller = new AbortController(); const started = now();
  const timer = setTimeout(() => controller.abort(new Error('deadline_exceeded')), timeoutMs);
  return { signal: controller.signal, remainingMs: () => Math.max(0, timeoutMs - (now() - started)), abort: () => controller.abort(new Error('deadline_exceeded')), clear: () => clearTimeout(timer), isExpired: () => controller.signal.aborted };
}

function createReplayGuard({ now = () => Date.now(), maxEntries = 10000 } = {}) {
  const used = new Map();
  return Object.freeze({
    async consume({ issuer, clientId, jti, exp }) {
      if (!validOpaque(issuer, 128) || !validOpaque(clientId, 128) || !validOpaque(jti, 128) || !Number.isInteger(exp) || exp * 1000 <= now()) return false;
      for (const [key, expiry] of used) if (expiry <= now()) used.delete(key);
      if (used.size >= maxEntries) return false;
      const key = `${issuer}\n${clientId}\n${jti}`;
      if (used.has(key)) return false;
      used.set(key, exp * 1000); return true;
    }
  });
}

function bearer(req) {
  const value = req.headers?.authorization;
  const header = Array.isArray(value) ? value[0] : value;
  const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9._-]+)$/.exec(header) : null;
  return match ? match[1] : null;
}
async function authenticate(req, auth) {
  if (!auth || !validOpaque(auth.issuer, 128) || auth.audience !== AUDIENCE || !auth.keys || typeof auth.keys !== 'object' || !auth.replayGuard?.consume) fail('unauthenticated', { status: 401 });
  const token = bearer(req); if (!token) fail('unauthenticated', { status: 401 });
  let decoded;
  try { decoded = jwt.decode(token, { complete: true }); } catch { fail('unauthenticated', { status: 401 }); }
  const kid = decoded?.header?.kid;
  if (decoded?.header?.alg !== 'RS256' || !validOpaque(kid, 128) || !Object.hasOwn(auth.keys, kid)) fail('unauthenticated', { status: 401 });
  let claims;
  try { claims = jwt.verify(token, auth.keys[kid].publicKey, { algorithms: ['RS256'], issuer: auth.issuer, audience: AUDIENCE, clockTolerance: 0 }); } catch { fail('unauthenticated', { status: 401 }); }
  if (!validOpaque(claims.client_id, 128) || claims.client_id !== auth.keys[kid].clientId || !validOpaque(claims.jti, 128) || !Number.isInteger(claims.exp) || claims.nbf === undefined) fail('unauthenticated', { status: 401 });
  if (!(await auth.replayGuard.consume({ issuer: claims.iss, clientId: claims.client_id, jti: claims.jti, exp: claims.exp }))) fail('unauthenticated', { status: 401 });
  return { clientId: claims.client_id, keyId: kid };
}

function createRouteAuthorizer({ state = 'disabled', generation = 'disabled' } = {}) {
  if (!ROUTE_STATES.has(state) || !validOpaque(generation, 64)) throw new TypeError('CLAIMED_TURN_ROUTE_CONFIGURATION_INVALID');
  return Object.freeze({ authorize(request) {
    if (state === 'disabled' || request.mode !== state) fail('forbidden_route', { status: 403 });
    return { mode: state, generation };
  } });
}
function errorResponse({ turnId, request, error }) {
  return { contract_version: CONTRACT_VERSION, outcome: 'ineligible', turn_id: turnId, canonical_inbound_message_id: request?.canonical_inbound_message_id || null, processing_owner: request?.processing_owner || null, failure_stage: error.stage || 'entry', failure_code: ERROR_CODES.has(error.code) ? error.code : 'internal_unclassified', retry_class: RETRY_CLASSES.has(error.retryClass) ? error.retryClass : 'operator_required' };
}
function responseValid(value) {
  if (!plain(value) || value.contract_version !== CONTRACT_VERSION || !['eligible', 'ineligible'].includes(value.outcome) || typeof value.turn_id !== 'string' || !UUID.test(value.canonical_inbound_message_id || '') || !validOpaque(value.processing_owner, 128)) return false;
  if (value.outcome === 'eligible') return plain(value.turn_result) && value.turn_result.status === 'response_eligible' && plain(value.delivery) && typeof value.delivery.text === 'string' && plain(value.delivery.post_gate_delivery_manifest) && value.retry_class === 'none';
  return typeof value.failure_stage === 'string' && ERROR_CODES.has(value.failure_code) && RETRY_CLASSES.has(value.retry_class) && Object.keys(value).every(key => new Set(['contract_version', 'outcome', 'turn_id', 'canonical_inbound_message_id', 'processing_owner', 'failure_stage', 'failure_code', 'retry_class']).has(key));
}
function createClaimedTurnRuntime({ auth, routeAuthorizer = createRouteAuthorizer(), claimVerifier, inputAdapter, runtime, deadlineMs, logger = () => {}, now, pseudonymKey } = {}) {
  return async function claimedTurn(req, res) {
    const started = Date.now(); const turnId = createTurnId(); let request;
    const emit = (event, fields = {}) => logger({ event, turn_id: turnId, latency_ms: Date.now() - started, ...fields });
    try {
      const caller = await authenticate(req, auth);
      request = assertClaimedTurnRequest(req.body);
      const route = routeAuthorizer.authorize(request);
      const deadline = createDeadline({ timeoutMs: deadlineMs, now });
      try {
        if (deadline.isExpired()) fail('deadline_exceeded', { stage: 'deadline', retryClass: 'ambiguous_no_blind_retry', status: 504 });
        if (typeof claimVerifier !== 'function') fail('context_invalid', { stage: 'claim_verification', retryClass: 'operator_required', status: 503 });
        const verified = await claimVerifier({ request, signal: deadline.signal, invocationIdentity: invocationIdentity({ ...request, routeGeneration: route.generation }) });
        if (deadline.isExpired()) fail('deadline_exceeded', { stage: 'deadline', retryClass: 'ambiguous_no_blind_retry', status: 504 });
        if (!verified || verified.status !== 'valid') {
          const code = verified?.code && ERROR_CODES.has(verified.code) ? verified.code : 'claim_not_owned';
          fail(code, { stage: 'claim_verification', retryClass: 'operator_required', status: 409 });
        }
        if (inputAdapter) {
          if (typeof inputAdapter.build !== 'function') fail('context_invalid', { stage: 'context', retryClass: 'operator_required', status: 503 });
          let canonicalInput;
          try { canonicalInput = await inputAdapter.build({ request, claim: verified.claim, signal: deadline.signal }); }
          catch (error) { if (error?.code === 'deadline_exceeded') fail('deadline_exceeded', { stage: 'deadline', retryClass: 'ambiguous_no_blind_retry', status: 504 }); if (error?.code === 'authority_unavailable') fail('authority_unavailable', { stage: 'authority', retryClass: 'transient_same_identity', status: 503 }); if (error?.code === 'authority_unresolved') fail('authority_unresolved', { stage: 'authority', retryClass: 'operator_required', status: 409 }); fail('context_invalid', { stage: 'context', retryClass: 'operator_required', status: 409 }); }
          if (typeof runtime !== 'function') fail('runtime_not_configured', { stage: 'runtime', retryClass: 'operator_required', status: 503 });
          let output;
          try { output = await runtime({ canonicalInput, request, route, signal: deadline.signal, invocationIdentity: invocationIdentity({ ...request, routeGeneration: route.generation }) }); }
          catch (error) { if (error?.code === 'deadline_exceeded' || deadline.isExpired()) fail('deadline_exceeded', { stage: 'deadline', retryClass: 'ambiguous_no_blind_retry', status: 504 }); if (error?.code === 'action_lifecycle_unavailable') fail('action_lifecycle_unavailable', { stage: 'action_execution', retryClass: 'transient_same_identity', status: 503 }); fail('internal_unclassified', { stage: 'runtime', status: 500 }); }
          if (deadline.isExpired()) fail('deadline_exceeded', { stage: 'deadline', retryClass: 'ambiguous_no_blind_retry', status: 504 });
          if (!output || output.contract_version !== 'ticket-75c3-runtime-v1' || !['response_eligible', 'response_ineligible'].includes(output.status)) fail('internal_unclassified', { stage: 'runtime', status: 500 });
          if (output.status === 'response_ineligible') fail('response_ineligible', { stage: output.turn_result?.failure_stage || 'runtime', retryClass: 'none', status: 409 });
          const body = { contract_version: CONTRACT_VERSION, outcome: 'eligible', turn_id: turnId, canonical_inbound_message_id: request.canonical_inbound_message_id, processing_owner: request.processing_owner, turn_result: output.turn_result, delivery: output.delivery, retry_class: 'none' };
          if (!responseValid(body)) fail('internal_unclassified', { stage: 'runtime', status: 500 });
          emit('claimed_turn_eligible', { mode: request.mode, client_id: null });
          return res.status(200).json(body);
        }
        fail('runtime_not_configured', { stage: 'runtime', retryClass: 'operator_required', status: 503 });
      } finally { deadline.clear(); }
    } catch (cause) {
      const error = cause instanceof ClaimedTurnError ? cause : new ClaimedTurnError('internal_unclassified', { status: 500, cause });
      const body = errorResponse({ turnId, request, error });
      emit('claimed_turn_rejected', { mode: request?.mode || null, client_id: null, failure_stage: body.failure_stage, failure_code: body.failure_code, retry_class: body.retry_class, inbound_id: request ? pseudonym(request.canonical_inbound_message_id, pseudonymKey) : null, session: request ? pseudonym(request.session_id, pseudonymKey) : null });
      return res.status(error.status || 500).json(body);
    }
  };
}

module.exports = { AUDIENCE, CONTRACT_VERSION, ClaimedTurnError, ERROR_CODES, RETRY_CLASSES, assertClaimedTurnRequest, createClaimedTurnRuntime, createDeadline, createReplayGuard, createRouteAuthorizer, invocationIdentity, responseValid };
