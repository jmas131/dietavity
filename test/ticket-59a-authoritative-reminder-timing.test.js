'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPolicyResolver, PolicyResolverError } = require('../lib/sales-engine-v2/policy-resolver');
const { actionValid } = require('../lib/sales-engine-v2/resolution-orchestrator-validator');

const root = path.join(__dirname, '..');
const policies = JSON.parse(fs.readFileSync(path.join(root, 'config/sales-engine-v2/policies.json'), 'utf8')).policies;
const contract = JSON.parse(fs.readFileSync(path.join(root, 'docs/contracts/sales-engine-v2-contract.schema.json'), 'utf8'));
const resolver = createPolicyResolver({ policies });
const scheduledFor = '2026-09-23T18:00:00.123+05:30';

function request(context) {
  return {
    obligation: { id: 'o-reminder', category: 'reminder_request', subtype: 'explicit', ambiguous: false },
    context,
  };
}

function authorizedReminder(parameters = { offer_version: null, scheduled_for: scheduledFor }) {
  return {
    action_type: 'schedule_reminder',
    authorization_source: 'deterministic_policy',
    authorizing_rule: 'reminder.explicit_complete.v1',
    parameters,
    preconditions: ['structured_non_ambiguous_obligation', 'matching_authoritative_context'],
    constraints: { side_effect_execution: 'not_performed', offer_version: null },
    idempotency: { required: true, key_scope: 'inbound_message' },
    status: 'authorized',
  };
}

test('Ticket 59A preserves the exact authoritative reminder timestamp and leaves input immutable', () => {
  const input = request({ reminder: { requested: true, scheduled_for: scheduledFor, existing_schedule: false } });
  const before = structuredClone(input);
  const result = resolver.resolvePolicy(input);

  assert.equal(result.action_authorization.action_type, 'schedule_reminder');
  assert.equal(result.action_authorization.parameters.scheduled_for, scheduledFor);
  assert.equal(result.action_authorization.parameters.scheduled_for, input.context.reminder.scheduled_for);
  assert.deepEqual(input, before);
});

test('Ticket 59A accepts only a complete ISO-with-timezone reminder action while retaining other action behavior', () => {
  assert.equal(actionValid(authorizedReminder()), true);
  assert.equal(actionValid(authorizedReminder({ offer_version: null })), false);
  assert.equal(actionValid(authorizedReminder({ offer_version: null, scheduled_for: '2026-09-23 18:00:00' })), false);
  assert.equal(actionValid({ ...authorizedReminder({ offer_version: null }), action_type: 'provide_checkout_destination' }), true);
});

test('Ticket 59A schema makes scheduled_for required only for schedule_reminder', () => {
  const authorizedAction = contract.$defs.authorizedAction;
  const reminderCondition = authorizedAction.allOf.find(rule => rule.if?.properties?.action_type?.const === 'schedule_reminder');
  assert.ok(reminderCondition);
  assert.deepEqual(reminderCondition.then.properties.parameters.required, ['scheduled_for']);
  assert.deepEqual(reminderCondition.then.properties.parameters.properties.scheduled_for, { $ref: '#/$defs/timestamp' });
  assert.equal(authorizedAction.properties.parameters.required, undefined);
});

test('Ticket 59A cannot manufacture reminder timing from another artifact', () => {
  const missing = resolver.resolvePolicy(request({ reminder: { requested: true, existing_schedule: false } }));
  assert.equal(missing.resolution_status, 'clarification_required');
  assert.equal(missing.action_authorization, null);
  for (const scheduled_for of ['not-a-date', '2026-09-23T18:00:00', '2026-02-30T18:00:00Z']) {
    assert.throws(
      () => resolver.resolvePolicy(request({ reminder: { requested: true, scheduled_for, existing_schedule: false } })),
      error => error instanceof PolicyResolverError && error.code === 'POLICY_REQUEST_INVALID',
    );
  }
  assert.throws(
    () => resolver.resolvePolicy({ ...request({ reminder: { requested: true } }), parameters: { scheduled_for: scheduledFor } }),
    error => error instanceof PolicyResolverError && error.code === 'POLICY_REQUEST_INVALID',
  );
});
