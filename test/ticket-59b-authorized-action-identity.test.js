'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveAuthorizedActionIdentity, canonicalTuple, launchActionIdentityValid } = require('../lib/sales-engine-v2/authorized-action-identity');
const { deriveCommercialAuthorizationSubject } = require('../lib/sales-engine-v2/commercial-authorization-subject');

const inbound = '11111111-1111-4111-8111-000000000059';
const policy = { id: 'commercial.checkout.standard', version: '1' };
const standard = deriveCommercialAuthorizationSubject({ campaign: 'standard', offerVersion: '28d-149-v1' });
const glp1 = deriveCommercialAuthorizationSubject({ campaign: 'glp1_validation', offerVersion: '28d-149-v1' });
const identity = ({ canonicalMessageId = inbound, authorizationSubject = standard, actionType = 'provide_checkout_destination', policy: source = policy } = {}) => deriveAuthorizedActionIdentity({ canonicalMessageId, authorizationSubject, actionType, policy: source });

test('Ticket 59B uses explicit ordered tuples and distinct durable action and execution identities', () => {
  const first = identity();
  assert.deepEqual(canonicalTuple({ canonicalMessageId: inbound, authorizationSubject: standard, actionType: 'provide_checkout_destination', policy }), ['action-identity-v1', inbound, 'commercial-authorization-subject-v1', standard.authorization_subject_id, 'provide_checkout_destination', 'commercial.checkout.standard', '1']);
  assert.match(first.action_id, /^act-[0-9a-f]{64}$/);
  assert.match(first.execution_key, /^aek-[0-9a-f]{64}$/);
  assert.notEqual(first.action_id.slice(4), first.execution_key.slice(4));
  assert.deepEqual(first, identity());
});

test('Ticket 59B identity changes only with canonical authorization inputs', () => {
  const first = identity();
  assert.notEqual(first.action_id, identity({ canonicalMessageId: '11111111-1111-4111-8111-000000000060' }).action_id);
  assert.notEqual(first.action_id, identity({ authorizationSubject: glp1, actionType: 'provide_holding_page_destination', policy: { id: 'commercial.checkout.glp1_canary', version: '1' } }).action_id);
  assert.notEqual(first.action_id, identity({ policy: { ...policy, version: '2' } }).action_id);
  assert.throws(() => identity({ authorizationSubject: { authorization_subject_version: 'commercial-authorization-subject-v2', authorization_subject_id: standard.authorization_subject_id } }), /AUTHORIZED_ACTION_IDENTITY_INPUT_INVALID/);
});

test('Ticket 59B rejects malformed final launch identity fields', () => {
  const value = identity();
  const action = { action_identity_version: value.action_identity_version, action_id: value.action_id, idempotency: { required: true, key_scope: 'inbound_message', execution_key_version: value.execution_key_version, execution_key: value.execution_key } };
  assert.equal(launchActionIdentityValid(action), true);
  assert.equal(launchActionIdentityValid({ ...action, action_id: 'act-short' }), false);
  assert.equal(launchActionIdentityValid({ ...action, idempotency: { ...action.idempotency, execution_key: 'aek-short' } }), false);
});
