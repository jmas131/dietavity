'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFactResolver, FactResolverError } = require('../lib/sales-engine-v2/fact-resolver');
const { createPolicyResolver } = require('../lib/sales-engine-v2/policy-resolver');
const { deriveCommercialAuthorizationSubject } = require('../lib/sales-engine-v2/commercial-authorization-subject');

const root = path.join(__dirname, '..');
const facts = JSON.parse(fs.readFileSync(path.join(root, 'config/sales-engine-v2/product-facts.json'), 'utf8')).facts;
const membershipDefinitions = JSON.parse(fs.readFileSync(path.join(root, 'config/sales-engine-v2/fact-membership.json'), 'utf8'));
const policies = JSON.parse(fs.readFileSync(path.join(root, 'config/sales-engine-v2/policies.json'), 'utf8')).policies;
const factResolver = createFactResolver({ facts, membershipDefinitions });
const policyResolver = createPolicyResolver({ policies });
const atApproval = '2026-09-22T00:00:01.000Z';
const baseContext = { offer_version: '28d-149-v1', channel: 'whatsapp' };
const obligation = (id, category, subtype) => ({
  id,
  category,
  subtype,
  ambiguous: false,
  ...(category === 'commercial_purchase_intent'
    ? deriveCommercialAuthorizationSubject({ campaign: 'standard', offerVersion: baseContext.offer_version })
    : {})
});

function membership(factKey, candidate, offerVersion = '28d-149-v1') {
  return factResolver.resolveFact({ factKey, offerVersion, scope: {}, asOf: atApproval, query: { operation: 'contains', candidate } });
}

test('Ticket 61B canonical fact membership resolves reviewed complete payment methods without router inference', () => {
  for (const candidate of ['OXXO', 'credit_card', 'debit_card']) {
    const result = membership('payment.supported_methods', candidate);
    assert.equal(result.authority, 'canonical_fact');
    assert.deepEqual(result.source, { type: 'canonical_fact', id: 'payment.supported_methods', version: '1' });
    assert.equal(result.factual_payload.value, true);
  }
  const absent = membership('payment.supported_methods', 'paypal');
  assert.equal(absent.factual_payload.value, false);
  assert.equal(absent.membership.complete_set, true);
  assert.equal(membership('payment.supported_methods', 'oxxo').factual_payload.candidate, 'oxxo');
});

test('Ticket 61B membership preserves unknown semantics and rejects malformed, unsupported, and non-set queries', () => {
  const reviewedUnknown = factResolver.resolveFact({ factKey: 'offer.public_refund_policy', offerVersion: '28d-149-v1', scope: {}, asOf: atApproval, query: { operation: 'contains', candidate: 'x' } });
  assert.equal(reviewedUnknown.authority, 'bounded_unknown');
  assert.deepEqual(reviewedUnknown.source, { type: 'canonical_fact', id: 'offer.public_refund_policy', version: '1' });
  const absent = factResolver.resolveFact({ factKey: 'service.video_calls', offerVersion: '28d-149-v1', scope: {}, asOf: atApproval, query: { operation: 'contains', candidate: 'yes' } });
  assert.equal(absent.authority, 'bounded_unknown');
  assert.equal(absent.source, null);
  assert.throws(() => membership('payment.supported_methods', ' '), error => error instanceof FactResolverError && error.code === 'FACT_REQUEST_INVALID');
  assert.throws(() => factResolver.resolveFact({ factKey: 'payment.supported_methods', offerVersion: '28d-149-v1', scope: {}, asOf: atApproval, query: { operation: 'equals', candidate: 'oxxo' } }), error => error.code === 'FACT_REQUEST_INVALID');
  assert.throws(() => membership('offer.price', '149'), error => error instanceof FactResolverError && error.code === 'FACT_QUERY_UNSUPPORTED');
});

test('Ticket 61B commercial policy accepts only an explicit deterministic clear gate', () => {
  const request = gate => policyResolver.resolvePolicy({ obligation: obligation('o-buy', 'commercial_purchase_intent', 'explicit_current_request'), context: { ...baseContext, commercial_state: { current_purchase_request: true, safety_gate: gate } } });
  const clear = request('clear');
  assert.equal(clear.authority, 'commercial_authorization');
  assert.equal(clear.action_authorization.status, 'authorized');
  for (const [gate, code] of [['blocked', 'COMMERCIAL_SAFETY_GATE_BLOCKED'], ['indeterminate', 'COMMERCIAL_SAFETY_GATE_INDETERMINATE']]) {
    const result = request(gate);
    assert.equal(result.resolution_status, 'prohibited');
    assert.equal(result.reason_code, code);
    assert.equal(result.action_authorization, null);
  }
  assert.throws(() => policyResolver.resolvePolicy({ obligation: obligation('o-buy', 'commercial_purchase_intent', 'explicit_current_request'), context: { ...baseContext, commercial_state: { current_purchase_request: true, safety_clear: true } } }), error => error.code === 'POLICY_REQUEST_INVALID');
});

test('Ticket 61B canonical authorized actions retain policy evidence without contradictory rejected actions', () => {
  const purchase = policyResolver.resolvePolicy({ obligation: obligation('o-buy', 'commercial_purchase_intent', 'explicit_current_request'), context: { ...baseContext, commercial_state: { current_purchase_request: true, safety_gate: 'clear' } } });
  const action = purchase.action_authorization;
  assert.deepEqual(action, { action_type: 'provide_checkout_destination', authorization_source: 'deterministic_policy', authorizing_rule: 'commercial.checkout.standard.v1', parameters: { offer_version: '28d-149-v1' }, preconditions: ['structured_non_ambiguous_obligation', 'matching_authoritative_context'], constraints: { side_effect_execution: 'not_performed', offer_version: '28d-149-v1' }, idempotency: { required: true, key_scope: 'inbound_message' }, status: 'authorized' });
  assert.deepEqual(purchase.policy_decision, { outcome: 'authorized', policy_id: 'commercial.checkout.standard', policy_version: 1, reason_code: 'CHECKOUT_AUTHORIZED', required_handling: [], prohibited_handling: [] });
  const rejected = policyResolver.resolvePolicy({ obligation: obligation('o-buy', 'commercial_purchase_intent', 'explicit_current_request'), context: { ...baseContext, commercial_state: { current_purchase_request: true, safety_gate: 'clear' } }, requested_action_type: 'create_checkout' });
  assert.equal(rejected.action_authorization, null);
  assert.equal(rejected.policy_decision.outcome, 'prohibited');
});

test('Ticket 61B prerequisite modules are pure and have no model, network, provider, or execution dependency', () => {
  for (const file of ['fact-resolver.js', 'fact-validator.js', 'policy-resolver.js', 'policy-validator.js']) {
    const source = fs.readFileSync(path.join(root, 'lib', 'sales-engine-v2', file), 'utf8');
    assert.doesNotMatch(source, /require\(['"](?:openai|axios|stripe|twilio|node:(?:fs|net|http|https))['"]\)|fetch\(|supabase|scheduleReminder|createCheckout/i, file);
  }
});
