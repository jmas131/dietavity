'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAuthority, seedJson } = require('../scripts/generate-sales-engine-v2-product-fact-authority-seed');
const { createAuthorityFactResolver, scopeFromConversationContext, validateAuthority } = require('../lib/sales-engine-v2/product-fact-authority');
const { FactResolverError } = require('../lib/sales-engine-v2/fact-resolver');
const { resolveObligations } = require('../lib/sales-engine-v2/resolution-orchestrator');
const { createPolicyResolver } = require('../lib/sales-engine-v2/policy-resolver');
const { normativeResolvedValid } = require('../lib/sales-engine-v2/resolved-obligation-validator');
const authority = loadAuthority();
const membershipDefinitions = require('../config/sales-engine-v2/fact-membership.json');
const resolver = createAuthorityFactResolver({ authority, membershipDefinitions });
const standard = { offerVersion: '28d-149-v1', scope: {} };
const resolve = (factKey, extra = {}) => resolver.resolveFact({ factKey, ...standard, ...extra });

test('Ticket 71 standard reviewed authority resolves the approved offer facts and complete payment set', () => {
  assert.deepEqual(resolve('offer.price').factual_payload, { amount: 149, currency: 'MXN' });
  assert.equal(resolve('offer.duration_days').factual_payload, 28);
  assert.equal(resolve('offer.subscription').factual_payload, false);
  assert.deepEqual(resolve('offer.meals').factual_payload, ['breakfast', 'lunch', 'dinner', 'snack']);
  assert.deepEqual(resolve('payment.supported_methods').factual_payload, ['credit_card', 'debit_card', 'oxxo', 'apple_pay']);
  assert.equal(resolve('payment.supported_methods', { query: { operation: 'contains', candidate: 'OXXO' } }).factual_payload.value, true);
  assert.equal(resolve('payment.supported_methods', { query: { operation: 'contains', candidate: 'paypal' } }).factual_payload.value, false);
});

test('Ticket 71 only permits reviewed active sets and never defaults unknown offers', () => {
  const draft = structuredClone(authority); draft.authority_sets[0].status = 'draft';
  assert.equal(createAuthorityFactResolver({ authority: draft }).resolveFact({ factKey: 'offer.price', ...standard }).authority, 'bounded_unknown');
  const retired = structuredClone(authority); retired.authority_sets[0].status = 'retired';
  assert.equal(createAuthorityFactResolver({ authority: retired }).resolveFact({ factKey: 'offer.price', ...standard }).authority, 'bounded_unknown');
  assert.equal(resolve('offer.price', { offerVersion: 'unrecognized-v1' }).authority, 'bounded_unknown');
  assert.equal(resolve('service.portal_delivery', { offerVersion: 'unrecognized-v1' }).authority, 'bounded_unknown');
});

test('Ticket 71 detects conflicting active authority and preserves exact pinned version provenance', () => {
  const conflict = structuredClone(authority); conflict.authority_sets.push({ ...structuredClone(conflict.authority_sets[0]), authority_set_id: 'conflict', facts: [] });
  assert.throws(() => createAuthorityFactResolver({ authority: conflict }), error => error.code === 'FACT_STORE_AMBIGUOUS');
  const first = resolve('offer.price'); const second = resolve('offer.price');
  assert.deepEqual(first, second);
  assert.deepEqual(first.source, { type: 'canonical_fact', id: 'pf-standard-price', version: '1' });
  assert.equal(normativeResolvedValid({ obligation_id: 'o-price', resolution_status: 'resolved', authority: 'canonical_fact', source: first.source, factual_payload: first.factual_payload, allowed_claims: [], prohibited_claims: [], customer_uncertainty_required: false, llm_reasoning_permitted: false }), true);
});

test('Ticket 71 preserves unknown and not-applicable without turning either into a false fact', () => {
  assert.equal(resolve('offer.unseeded_meaningful_fact').status, 'unknown');
  const variant = structuredClone(authority); variant.authority_sets[0].facts.push({ fact_id: 'pf-na', fact_key: 'offer.physical_shipping', state: 'not_applicable', value_type: 'boolean', value: null });
  assert.equal(createAuthorityFactResolver({ authority: variant }).resolveFact({ factKey: 'offer.physical_shipping', ...standard }).status, 'not_applicable');
  const incomplete = structuredClone(authority); incomplete.authority_sets[0].facts.find(f => f.fact_key === 'payment.supported_methods').state = 'unknown'; incomplete.authority_sets[0].facts.find(f => f.fact_key === 'payment.supported_methods').value = null;
  assert.equal(createAuthorityFactResolver({ authority: incomplete, membershipDefinitions }).resolveFact({ factKey: 'payment.supported_methods', ...standard, query: { operation: 'contains', candidate: 'paypal' } }).authority, 'bounded_unknown');
});

test('Ticket 71 keeps products and campaigns isolated, and accepts Ticket 62 requests without actions', () => {
  const future = structuredClone(authority); future.authority_sets.push({ authority_set_id: 'future-pdf-v1', authority_version: '1', status: 'reviewed_active', scope: { scope_type: 'offer_version', offer_version: 'future-pdf-v1' }, facts: [{ fact_id: 'pf-future-price', fact_key: 'offer.price', state: 'known_true', value_type: 'money', value: { amount: 50, currency: 'MXN' } }] });
  const fixtureResolver = createAuthorityFactResolver({ authority: future, membershipDefinitions });
  assert.deepEqual(fixtureResolver.resolveFact({ factKey: 'offer.price', offerVersion: 'future-pdf-v1', scope: {} }).factual_payload, { amount: 50, currency: 'MXN' });
  assert.deepEqual(resolve('offer.price').factual_payload, { amount: 149, currency: 'MXN' });
  assert.deepEqual(scopeFromConversationContext({ offer_context: { offer_version: '28d-149-v1' }, metadata: { campaign: 'glp1_validation' } }, 'offer.price'), { scope_type: 'offer_version', offer_version: '28d-149-v1' });
  const policies = require('../config/sales-engine-v2/policies.json').policies;
  const output = resolveObligations({ context: { contract_version: '2.0', context_id: 'ticket-71', locale: 'es-MX', current_message: { role: 'customer', text: 'precio', occurred_at: '2026-09-25T00:00:00.000Z', source_id: 'inbound-71', canonical_message_id: '11111111-1111-4111-8111-111111111111' }, history: [], history_metadata: { ordering: 'occurred_at', history_truncated: false, retained_prior_turns: 0, retained_prior_characters: 0 }, conversation_artifacts: [], conversation_artifacts_metadata: { ordering: 'occurred_at', artifacts_truncated: false, retained_artifacts: 0, retained_artifact_characters: 0 }, session_state: { session_id: 's-71' }, offer_context: { offer_version: '28d-149-v1' }, customer_state: {}, commercial_state: { checkout_sent: false, valid_purchase_confirmation: false }, metadata: { channel: 'whatsapp', campaign: 'standard' }, authoritative_context: {}, informational_context: { knowledge: [] } }, obligations: [{ id: 'o-price', category: 'product_fact', subject: 'price', current_turn_evidence: 'precio', confidence: 'high', ambiguous: false }], factResolver: resolver, policyResolver: createPolicyResolver({ policies }), asOf: '2026-09-25T00:00:00.000Z' });
  assert.deepEqual(output.authorized_actions, []); assert.equal(output.resolved_obligations[0].factual_payload.amount, 149);
});

test('Ticket 71 generated database seed stays exactly synchronized with the only reviewed authority manifest', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'database/migrations/20260925_ticket_71_product_fact_authority.sql'), 'utf8');
  assert.equal(migration.match(/\$ticket_71_seed\$(.*?)\$ticket_71_seed\$/s)[1], seedJson());
  assert.match(migration, /FORCE ROW LEVEL SECURITY/); assert.match(migration, /product_fact_authority_one_active_scope/); assert.match(migration, /activate_product_fact_authority_set/);
  assert.equal(validateAuthority(authority), authority);
  assert.throws(() => resolver.resolveFact({ factKey: 'PRICE', ...standard }), error => error instanceof FactResolverError && error.code === 'FACT_REQUEST_INVALID');
});

test('Ticket 71 selects explicit provider authority by closed fact-key class, never by offer fallback', () => {
  const provider = resolve('service.glp1_medication_sale');
  assert.equal(provider.factual_payload, false);
  assert.deepEqual(provider.source, { type: 'canonical_fact', id: 'pf-provider-glp1-sale', version: '1' });
  assert.deepEqual(scopeFromConversationContext({ offer_context: { offer_version: '28d-149-v1' }, metadata: { campaign: 'standard' } }, 'service.glp1_medication_sale'), { scope_type: 'provider' });
  assert.deepEqual(scopeFromConversationContext({ offer_context: { offer_version: '28d-149-v1' }, metadata: { campaign: 'glp1_validation' } }, 'service.glp1_medication_sale'), { scope_type: 'provider' });
  assert.equal(resolve('offer.price', { offerVersion: undefined }).authority, 'bounded_unknown');
  assert.equal(resolve('offer.price', { offerVersion: 'unknown-offer-v1' }).authority, 'bounded_unknown');
  assert.throws(() => resolve('offer.price', { scope: { scope_type: 'provider' }, offerVersion: undefined }), error => error.code === 'FACT_REQUEST_INVALID');
});

test('Ticket 71 rejects scope laundering, provider shadowing, and ambiguous typed authority', () => {
  assert.equal(resolve('service.anything_else').authority, 'bounded_unknown');
  assert.throws(() => resolve('offer.price', { scope: { scope_type: 'global' } }), error => error.code === 'FACT_REQUEST_INVALID');
  assert.throws(() => resolve('offer.price', { scope: { scope_type: 'offer_version', offer_version: '28d-149-v1', extra: true } }), error => error.code === 'FACT_REQUEST_INVALID');
  const shadow = structuredClone(authority); shadow.authority_sets[0].facts.push({ fact_id: 'illegal-shadow', fact_key: 'service.glp1_medication_sale', state: 'known_true', value_type: 'boolean', value: true });
  assert.throws(() => createAuthorityFactResolver({ authority: shadow }), error => error.code === 'FACT_STORE_MALFORMED');
  const duplicateProvider = structuredClone(authority); duplicateProvider.authority_sets.push({ ...structuredClone(duplicateProvider.authority_sets[1]), authority_set_id: 'duplicate-provider', facts: [] });
  assert.throws(() => createAuthorityFactResolver({ authority: duplicateProvider }), error => error.code === 'FACT_STORE_AMBIGUOUS');
  const absentOffer = resolver.resolveFromContext({ context: { offer_context: {}, metadata: { campaign: 'standard' } }, factKey: 'offer.price' });
  assert.equal(absentOffer.authority, 'bounded_unknown');
  const providerFromAbsentOffer = resolver.resolveFromContext({ context: { offer_context: {}, metadata: { campaign: 'standard' } }, factKey: 'service.glp1_medication_delivery' });
  assert.equal(providerFromAbsentOffer.factual_payload, false);
});
