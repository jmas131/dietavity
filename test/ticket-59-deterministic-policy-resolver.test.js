'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDictionary } = require('../lib/sales-engine-v2/policy-validator');
const { PolicyResolverError, createPolicyResolver, resolvePolicyFromPolicies } = require('../lib/sales-engine-v2/policy-resolver');

const dictionary = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'sales-engine-v2', 'policies.json'), 'utf8'));
const resolver = createPolicyResolver({ policies: dictionary.policies });
const baseContext = { offer_version: '28d-149-v1', channel: 'whatsapp' };
const obligation = (category, subtype, id = category + '-' + subtype) => ({ id, category, subtype, ambiguous: false });
const resolve = (category, subtype, context = {}, requested_action_type) => resolver.resolvePolicy({ obligation: obligation(category, subtype), context: { ...baseContext, ...context }, ...(requested_action_type ? { requested_action_type } : {}) });

test('Ticket 59 validates its small, versioned policy dictionary', () => {
  assert.equal(validateDictionary(dictionary), dictionary);
  assert.throws(() => validateDictionary({ ...dictionary, policies: [...dictionary.policies, structuredClone(dictionary.policies[0])] }), /POLICY_DUPLICATE_VERSION/);
  assert.throws(() => createPolicyResolver({ policies: [{ ...dictionary.policies[0], reason_code: 'not machine readable' }] }), error => error.code === 'POLICY_STORE_MALFORMED');
});

test('Ticket 59 medication-management safety requires clinician handling and never supplies advice or product truth', () => {
  for (const subtype of ['dose_change', 'stop', 'start', 'timing', 'prescription_decision', 'other_management']) {
    const result = resolve('medication_management', subtype);
    assert.equal(result.resolution_status, 'prohibited');
    assert.equal(result.reason_code, 'MEDICATION_MANAGEMENT_REQUIRES_CLINICIAN');
    assert.deepEqual(result.required_handling, ['refer_to_clinician']);
    assert.deepEqual(result.prohibited_handling, ['medication_management_advice']);
    assert.deepEqual(result.source, { type: 'deterministic_policy', id: 'safety.medication_management', version: '1' });
    assert.equal(result.llm_reasoning_permitted, false);
  }
  const productScope = resolve('provider_service_fact', 'glp1_medication_prescription');
  assert.equal(productScope.resolution_status, 'no_applicable_policy');
  assert.equal(productScope.authority, 'bounded_unknown');
});

test('Ticket 59 authorizes only a structured clear-gate standard checkout destination', () => {
  const context = { commercial_state: { current_purchase_request: true, safety_gate: 'clear' } };
  const result = resolve('commercial_purchase_intent', 'explicit_current_request', context);
  assert.equal(result.authority, 'commercial_authorization');
  assert.equal(result.action_authorization.action_type, 'provide_checkout_destination');
  assert.equal(result.action_authorization.constraints.side_effect_execution, 'not_performed');
  assert.deepEqual(result.source, { type: 'deterministic_policy', id: 'commercial.checkout.standard', version: '1' });
  assert.equal(resolve('commercial_purchase_intent', 'explicit_current_request').resolution_status, 'no_applicable_policy');
  const create = resolve('commercial_purchase_intent', 'explicit_current_request', context, 'create_checkout');
  assert.equal(create.resolution_status, 'prohibited');
  assert.equal(create.reason_code, 'ACTION_EXECUTION_NOT_AUTHORIZED');
});

test('Ticket 59 preserves the structured GLP-1 holding-page boundary without raw-language detection', () => {
  const context = { campaign: 'glp1_validation', commercial_state: { current_purchase_request: true, safety_gate: 'clear' } };
  const holding = resolve('commercial_purchase_intent', 'explicit_current_request', context);
  assert.equal(holding.action_authorization.action_type, 'provide_holding_page_destination');
  assert.equal(holding.reason_code, 'GLP1_HOLDING_PAGE_AUTHORIZED');
  const checkout = resolve('commercial_purchase_intent', 'explicit_current_request', context, 'provide_checkout_destination');
  assert.equal(checkout.resolution_status, 'prohibited');
  assert.equal(checkout.reason_code, 'ACTION_NOT_AUTHORIZED_FOR_CONTEXT');
  assert.throws(() => resolver.resolvePolicy({ obligation: obligation('commercial_purchase_intent', 'explicit_current_request'), context, customer_message: 'Quiero comprar' }), error => error.code === 'POLICY_REQUEST_INVALID');
});

test('Ticket 59 authorizes only complete explicit reminders and does not schedule them', () => {
  const complete = resolve('reminder_request', 'explicit', { reminder: { requested: true, scheduled_for: '2026-09-23T18:00:00.000Z', existing_schedule: false } });
  assert.equal(complete.action_authorization.action_type, 'schedule_reminder');
  assert.equal(complete.action_authorization.constraints.side_effect_execution, 'not_performed');
  for (const context of [
    { reminder: { requested: true, scheduled_for: null } },
    { reminder: { requested: true } },
    {},
  ]) {
    const incomplete = resolve('reminder_request', 'explicit', context);
    assert.equal(incomplete.resolution_status, 'clarification_required');
    assert.equal(incomplete.reason_code, 'REMINDER_CONTEXT_INCOMPLETE');
    assert.equal(incomplete.action_authorization, null);
  }
  const unsupported = resolve('reminder_request', 'unsupported');
  assert.equal(unsupported.resolution_status, 'unsupported');
  assert.equal(unsupported.reason_code, 'REMINDER_UNSUPPORTED');
});

test('Ticket 59 leaves facts and unrelated obligations to their own resolvers', () => {
  for (const subtype of ['price', 'payment_method', 'prepared_food_delivery', 'portal_delivery', 'glp1_medication_sale']) {
    const result = resolve('product_fact', subtype);
    assert.equal(result.resolution_status, 'no_applicable_policy');
    assert.equal(result.action_authorization, null);
  }
  assert.equal(resolve('safety_sensitive_nutrition', 'diagnosis').resolution_status, 'no_applicable_policy');
});

test('Ticket 59 distinguishes invalid input, clarification, no rule, malformed policy stores, and conflicts', () => {
  assert.throws(() => resolver.resolvePolicy({ obligation: obligation('reminder_request', 'explicit'), context: { ...baseContext, unknown_authorization: true } }), error => error instanceof PolicyResolverError && error.code === 'POLICY_REQUEST_INVALID');
  for (const reminder of [null, { requested: true, scheduled_for: 'not-a-date' }, { requested: true, scheduled_for: 1 }, { requested: true, existing_schedule: 'false' }]) {
    assert.throws(() => resolver.resolvePolicy({ obligation: obligation('reminder_request', 'explicit'), context: { ...baseContext, reminder } }), error => error instanceof PolicyResolverError && error.code === 'POLICY_REQUEST_INVALID');
  }
  const ambiguous = resolver.resolvePolicy({ obligation: { ...obligation('commercial_purchase_intent', 'explicit_current_request'), ambiguous: true }, context: baseContext });
  assert.equal(ambiguous.resolution_status, 'clarification_required');
  assert.equal(ambiguous.reason_code, 'OBLIGATION_AMBIGUOUS');
  assert.throws(() => resolvePolicyFromPolicies([{ id: 'bad', version: 1 }], { obligation: obligation('medication_management', 'dose_change'), context: baseContext }), error => error.code === 'POLICY_STORE_MALFORMED');
  const duplicate = structuredClone(dictionary.policies[0]);
  duplicate.id = 'safety.medication_management.duplicate';
  assert.throws(() => resolvePolicyFromPolicies([...dictionary.policies, duplicate], { obligation: obligation('medication_management', 'dose_change'), context: baseContext }), error => error.code === 'POLICY_AMBIGUOUS');
});

test('Ticket 59 policy files and modules contain no customer-facing prose or external side-effect clients', () => {
  const policyText = fs.readFileSync(path.join(__dirname, '..', 'config', 'sales-engine-v2', 'policies.json'), 'utf8');
  const resolverText = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sales-engine-v2', 'policy-resolver.js'), 'utf8');
  assert.doesNotMatch(policyText, /Dietavity|https?:|¿|\b(?:puedes|debes|consulta)\b/i);
  assert.doesNotMatch(resolverText, /require\(['"](?:axios|stripe|twilio|node:net|node:http|node:https|node:fs)['"]\)|fetch\(|supabase|scheduleJob|sendMessage/i);
});
