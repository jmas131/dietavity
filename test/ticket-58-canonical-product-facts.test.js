'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDictionary, seedJson } = require('../scripts/generate-sales-engine-v2-product-fact-seed');
const { validateDictionary } = require('../lib/sales-engine-v2/fact-validator');
const { FactResolverError, createFactResolver, resolveFactFromFacts } = require('../lib/sales-engine-v2/fact-resolver');

const dictionary = loadDictionary();
const resolver = createFactResolver({ facts: dictionary.facts });
const offer = '28d-149-v1';
const atApproval = '2026-09-22T00:00:01.000Z';

function resolve(factKey, offerVersion = offer, asOf = atApproval) {
  return resolver.resolveFact({ factKey, offerVersion, scope: {}, asOf });
}

test('Ticket 58 validates the reviewed fact dictionary and keeps effective identities unique', () => {
  assert.equal(validateDictionary(dictionary), dictionary);
  assert.throws(() => validateDictionary({ ...dictionary, facts: [...dictionary.facts, structuredClone(dictionary.facts[0])] }), /FACT_DUPLICATE_VERSION/);
  const overlapping = structuredClone(dictionary);
  overlapping.facts.push({ ...structuredClone(dictionary.facts[0]), version: 2, valid_from: '2026-09-22T00:00:01.000Z' });
  assert.throws(() => validateDictionary(overlapping), /FACT_ACTIVE_VALIDITY_OVERLAP/);
});

test('Ticket 58 generated migration seed exactly matches the reviewed dictionary', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '20260922_ticket_58_canonical_product_facts.sql'), 'utf8');
  const match = migration.match(/\$ticket_58_seed\$(.*?)\$ticket_58_seed\$/s);
  assert.ok(match, 'migration must contain generated seed payload');
  assert.equal(match[1], seedJson());
});

test('Ticket 58 migration and schema snapshot preserve backend-only, temporal fact-store constraints', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '20260922_ticket_58_canonical_product_facts.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.product_facts FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /product_facts_no_active_validity_overlap EXCLUDE USING gist/);
  assert.match(migration, /IF NOT EXISTS \(SELECT 1 FROM pg_constraint/);
  assert.match(migration, /IF NOT EXISTS \(SELECT 1 FROM pg_trigger/);
  assert.match(migration, /product_facts_unknown_value_check/);
  assert.match(schema, /CREATE TABLE public\.product_facts/);
  assert.match(schema, /CREATE TRIGGER set_product_facts_updated_at/);
  assert.match(schema, /GRANT ALL ON TABLE public\.product_facts TO service_role/);
});

test('Ticket 58 resolves price and duration as canonical facts compatible with the v2 source contract', () => {
  const price = resolve('offer.price');
  assert.deepEqual(price.factual_payload, { amount: 149, currency: 'MXN' });
  assert.equal(price.status, 'resolved');
  assert.equal(price.authority, 'canonical_fact');
  assert.deepEqual(price.source, { type: 'canonical_fact', id: 'offer.price', version: '1' });
  assert.equal(price.llm_reasoning_permitted, false);
  assert.deepEqual(resolve('offer.duration_days').factual_payload, 28);
});

test('Ticket 58 resolves confirmed false capability and confirmed payment methods without inference', () => {
  const preparedFood = resolve('service.prepared_food_delivery');
  assert.equal(preparedFood.state, 'known_false');
  assert.equal(preparedFood.factual_payload, false);
  assert.deepEqual(resolve('payment.supported_methods').factual_payload, ['credit_card', 'debit_card', 'oxxo', 'apple_pay']);
});

test('Ticket 58 distinguishes unreviewed PayPal from explicit reviewed public-refund unknown', () => {
  const paypal = resolve('payment.method.paypal');
  const refund = resolve('offer.public_refund_policy');
  for (const result of [paypal, refund]) {
    assert.equal(result.status, 'unknown');
    assert.equal(result.authority, 'bounded_unknown');
    assert.equal(result.customer_uncertainty_required, true);
    assert.equal(result.factual_payload, null);
  }
  assert.equal(paypal.source, null);
  assert.equal(paypal.reviewed, false);
  assert.equal(refund.reviewed, true);
  assert.deepEqual(refund.source, { type: 'canonical_fact', id: 'offer.public_refund_policy', version: '1' });
  assert.match(refund.provenance, /MULTI_TOPIC_ANSWERS\.refund/);
});

test('Ticket 58 does not apply offer facts to another offer and keeps only reviewed provider boundaries global', () => {
  assert.equal(resolve('offer.price', 'another-offer').authority, 'bounded_unknown');
  assert.equal(resolve('service.portal_delivery', 'another-offer').authority, 'bounded_unknown');
  assert.equal(resolve('service.portal_delivery').authority, 'canonical_fact');
  assert.equal(resolve('service.glp1_medication_sale', null).authority, 'canonical_fact');
  assert.equal(resolve('service.glp1_medication_sale', offer).authority, 'bounded_unknown');
});

test('Ticket 58 retains reviewed not-applicable separately from unknown', () => {
  const notApplicable = { fact_key: 'offer.special_feature', offer_version: offer, scope: {}, state: 'not_applicable', value_type: 'text', value: null, valid_from: '2026-09-22T00:00:00.000Z', valid_to: null, version: 1, provenance: 'review: scope fixture', status: 'active' };
  const result = resolveFactFromFacts([notApplicable], { factKey: 'offer.special_feature', offerVersion: offer, scope: {}, asOf: atApproval });
  assert.equal(result.status, 'not_applicable');
  assert.equal(result.authority, 'canonical_fact');
  assert.equal(result.reviewed, true);
  assert.equal(result.factual_payload, null);
});

test('Ticket 58 recursively canonicalizes equivalent nested object scopes', () => {
  const scoped = { fact_key: 'offer.scoped_feature', offer_version: offer, scope: { channel: { locale: 'es-MX', provider: 'whatsapp' }, tags: ['a', 'b'] }, state: 'known_true', value_type: 'boolean', value: true, valid_from: '2026-09-22T00:00:00.000Z', valid_to: null, version: 1, provenance: 'review: nested scope fixture', status: 'active' };
  const result = resolveFactFromFacts([scoped], { factKey: 'offer.scoped_feature', offerVersion: offer, scope: { tags: ['a', 'b'], channel: { provider: 'whatsapp', locale: 'es-MX' } }, asOf: atApproval });
  assert.equal(result.factual_payload, true);
});

test('Ticket 58 applies half-open effective dates and fails closed on duplicate authority', () => {
  const future = { fact_key: 'offer.future', offer_version: offer, scope: {}, state: 'known_true', value_type: 'text', value: 'future', valid_from: '2026-10-01T00:00:00.000Z', valid_to: null, version: 1, provenance: 'review: future fixture', status: 'active' };
  const expired = { fact_key: 'offer.expired', offer_version: offer, scope: {}, state: 'known_true', value_type: 'text', value: 'past', valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-02-01T00:00:00.000Z', version: 1, provenance: 'review: expired fixture', status: 'active' };
  assert.equal(resolveFactFromFacts([future], { factKey: 'offer.future', offerVersion: offer, scope: {}, asOf: atApproval }).authority, 'bounded_unknown');
  assert.equal(resolveFactFromFacts([expired], { factKey: 'offer.expired', offerVersion: offer, scope: {}, asOf: atApproval }).authority, 'bounded_unknown');
  const ambiguous = [structuredClone(dictionary.facts[0]), { ...structuredClone(dictionary.facts[0]), version: 2 }];
  assert.throws(() => resolveFactFromFacts(ambiguous, { factKey: 'offer.price', offerVersion: offer, scope: {}, asOf: atApproval }), error => error instanceof FactResolverError && error.code === 'FACT_STORE_AMBIGUOUS');
});

test('Ticket 58 separates invalid request and malformed/unavailable store from business unknown', () => {
  assert.throws(() => resolver.resolveFact({ factKey: '', scope: {} }), error => error.code === 'FACT_REQUEST_INVALID');
  assert.throws(() => resolveFactFromFacts(null, { factKey: 'offer.price', scope: {} }), error => error.code === 'FACT_STORE_UNAVAILABLE');
  const malformed = [{ ...structuredClone(dictionary.facts[0]), value: '149 MXN' }];
  assert.throws(() => resolveFactFromFacts(malformed, { factKey: 'offer.price', offerVersion: offer, scope: {}, asOf: atApproval }), error => error.code === 'FACT_STORE_MALFORMED');
});
