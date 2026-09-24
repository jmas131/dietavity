'use strict';

const crypto = require('node:crypto');

const ACTION_IDENTITY_VERSION = 'action-identity-v1';
const EXECUTION_IDEMPOTENCY_VERSION = 'action-execution-idempotency-v1';
const ACTION_ID_PATTERN = /^act-[0-9a-f]{64}$/;
const EXECUTION_KEY_PATTERN = /^aek-[0-9a-f]{64}$/;
const LAUNCH_ACTION_TYPES = new Set(['provide_checkout_destination', 'provide_holding_page_destination']);

function validPolicy(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof value.id === 'string' && !!value.id
    && typeof value.version === 'string' && !!value.version;
}

function validCanonicalMessageId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validCommercialSubject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.authorization_subject_version === 'commercial-authorization-subject-v1'
    && typeof value.authorization_subject_id === 'string' && /^cas-[0-9a-f]{64}$/.test(value.authorization_subject_id);
}

function canonicalTuple({ canonicalMessageId, authorizationSubject, actionType, policy }) {
  if (!validCanonicalMessageId(canonicalMessageId) || !validCommercialSubject(authorizationSubject) || !LAUNCH_ACTION_TYPES.has(actionType) || !validPolicy(policy)) throw new TypeError('AUTHORIZED_ACTION_IDENTITY_INPUT_INVALID');
  return [ACTION_IDENTITY_VERSION, canonicalMessageId.toLowerCase(), authorizationSubject.authorization_subject_version, authorizationSubject.authorization_subject_id, actionType, policy.id, policy.version];
}

function digest(tuple) { return crypto.createHash('sha256').update(JSON.stringify(tuple), 'utf8').digest('hex'); }

function deriveAuthorizedActionIdentity(input) {
  const action_id = `act-${digest(canonicalTuple(input))}`;
  const execution_key = `aek-${digest([EXECUTION_IDEMPOTENCY_VERSION, action_id])}`;
  return Object.freeze({ action_identity_version: ACTION_IDENTITY_VERSION, action_id, execution_key_version: EXECUTION_IDEMPOTENCY_VERSION, execution_key });
}

function launchActionIdentityValid(action) {
  return action !== null && typeof action === 'object' && !Array.isArray(action)
    && action.action_identity_version === ACTION_IDENTITY_VERSION
    && typeof action.action_id === 'string' && ACTION_ID_PATTERN.test(action.action_id)
    && action.idempotency !== null && typeof action.idempotency === 'object' && !Array.isArray(action.idempotency)
    && action.idempotency.execution_key_version === EXECUTION_IDEMPOTENCY_VERSION
    && typeof action.idempotency.execution_key === 'string' && EXECUTION_KEY_PATTERN.test(action.idempotency.execution_key);
}

module.exports = { ACTION_IDENTITY_VERSION, ACTION_ID_PATTERN, EXECUTION_IDEMPOTENCY_VERSION, EXECUTION_KEY_PATTERN, LAUNCH_ACTION_TYPES, canonicalTuple, deriveAuthorizedActionIdentity, launchActionIdentityValid };
