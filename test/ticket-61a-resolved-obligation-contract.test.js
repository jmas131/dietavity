'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFactResolver, resolveFactFromFacts } = require('../lib/sales-engine-v2/fact-resolver');
const { createPolicyResolver } = require('../lib/sales-engine-v2/policy-resolver');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'contracts', 'sales-engine-v2-contract.schema.json'), 'utf8'));
const facts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'sales-engine-v2', 'product-facts.json'), 'utf8')).facts;
const policies = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'sales-engine-v2', 'policies.json'), 'utf8')).policies;
const factResolver = createFactResolver({ facts });
const policyResolver = createPolicyResolver({ policies });

const SOURCE_TYPES = new Set(['canonical_fact', 'deterministic_policy', 'reviewed_knowledge', 'generated_guidance', 'conversational_generation', 'system']);
const AUTHORITIES = new Set(['canonical_fact', 'deterministic_policy', 'commercial_authorization', 'reviewed_knowledge', 'generated_guidance', 'conversational_generation', 'bounded_unknown', 'clarification_required', 'prohibited', 'resolver_failure']);

function sourceIsValid(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const keys = Object.keys(source);
  if (keys.some(key => !['type', 'id', 'version', 'model_run_id', 'generation_stage'].includes(key)) || !SOURCE_TYPES.has(source.type) || typeof source.id !== 'string' || !source.id || typeof source.version !== 'string' || !source.version) return false;
  if (source.type === 'generated_guidance') return typeof source.model_run_id === 'string' && !!source.model_run_id && source.generation_stage === 'bounded_reasoning';
  if (source.type === 'conversational_generation') return typeof source.model_run_id === 'string' && !!source.model_run_id && source.generation_stage === 'composer';
  return !('model_run_id' in source) && !('generation_stage' in source);
}

// A focused executable mirror of the ResolvedObligation source conditions.
// Node has no JSON Schema validator dependency in this repository; this uses
// the normative schema's enumerations and makes every authority/source pair
// explicit without adding a validation framework.
function resolvedContractValid(value) {
  if (!value || typeof value !== 'object' || !AUTHORITIES.has(value.authority) || typeof value.obligation_id !== 'string' || !/^o-[A-Za-z0-9._-]+$/.test(value.obligation_id) || !['resolved', 'unknown', 'clarification_required', 'prohibited', 'failed'].includes(value.resolution_status) || !Array.isArray(value.allowed_claims) || !Array.isArray(value.prohibited_claims) || typeof value.customer_uncertainty_required !== 'boolean' || !('source' in value)) return false;
  const source = value.source;
  if (value.authority === 'bounded_unknown') return value.customer_uncertainty_required && (source === null || (sourceIsValid(source) && source.type === 'canonical_fact'));
  if (value.authority === 'clarification_required' || value.authority === 'resolver_failure') return source === null;
  const expected = {
    canonical_fact: 'canonical_fact', deterministic_policy: 'deterministic_policy', commercial_authorization: 'deterministic_policy',
    reviewed_knowledge: 'reviewed_knowledge', generated_guidance: 'generated_guidance', conversational_generation: 'conversational_generation', prohibited: 'deterministic_policy',
  }[value.authority];
  return sourceIsValid(source) && source.type === expected;
}

function resolved(authority, source, resolution_status = 'resolved') {
  return { obligation_id: 'o-1', resolution_status, authority, source, allowed_claims: [], prohibited_claims: [], customer_uncertainty_required: authority === 'bounded_unknown' };
}

function asResolved(result, obligationId = 'o-1') {
  const status = result.status === 'unknown' ? 'unknown'
    : result.resolution_status === 'no_applicable_policy' ? 'unknown'
      : result.resolution_status === 'clarification_required' ? 'clarification_required'
        : result.resolution_status === 'prohibited' ? 'prohibited' : 'resolved';
  return { obligation_id: obligationId, resolution_status: status, authority: result.authority, source: result.source, allowed_claims: [], prohibited_claims: [], customer_uncertainty_required: result.authority === 'bounded_unknown' };
}

test('Ticket 61A schema replaces global source non-nullability with authority-specific conditions', () => {
  const definition = schema.$defs.resolvedObligation;
  assert.deepEqual(definition.required.includes('source'), true);
  assert.deepEqual(definition.properties.source, {});
  assert.match(JSON.stringify(definition.allOf), /resolver_failure/);
  assert.match(JSON.stringify(definition.allOf), /"type":"null"/);
  assert.match(JSON.stringify(definition.allOf), /generated_guidance/);
});

test('Ticket 61A accepts every legitimate authority/source provenance pairing', () => {
  const canonical = { type: 'canonical_fact', id: 'offer.price', version: '1' };
  const policy = { type: 'deterministic_policy', id: 'safety.medication_management', version: '1' };
  const knowledge = { type: 'reviewed_knowledge', id: 'knowledge-1', version: '1' };
  const guidance = { type: 'generated_guidance', id: 'guidance-1', version: '1', model_run_id: 'run-1', generation_stage: 'bounded_reasoning' };
  const composition = { type: 'conversational_generation', id: 'composer-1', version: '1', model_run_id: 'run-2', generation_stage: 'composer' };
  for (const value of [
    resolved('canonical_fact', canonical), resolved('deterministic_policy', policy), resolved('commercial_authorization', policy),
    resolved('reviewed_knowledge', knowledge), resolved('generated_guidance', guidance), resolved('conversational_generation', composition),
    resolved('bounded_unknown', null, 'unknown'), resolved('bounded_unknown', canonical, 'unknown'),
    resolved('clarification_required', null, 'clarification_required'), resolved('prohibited', policy, 'prohibited'),
    resolved('resolver_failure', null, 'failed'),
  ]) assert.equal(resolvedContractValid(value), true, value.authority);
});

test('Ticket 61A rejects null and mismatched provenance, including missing model metadata', () => {
  const canonical = { type: 'canonical_fact', id: 'fact', version: '1' };
  const policy = { type: 'deterministic_policy', id: 'policy', version: '1' };
  for (const value of [
    resolved('canonical_fact', null), resolved('deterministic_policy', null), resolved('commercial_authorization', null),
    resolved('reviewed_knowledge', null), resolved('generated_guidance', null), resolved('conversational_generation', null),
    resolved('canonical_fact', policy), resolved('deterministic_policy', canonical), resolved('commercial_authorization', canonical),
    resolved('prohibited', null, 'prohibited'), resolved('prohibited', canonical, 'prohibited'),
    resolved('generated_guidance', { type: 'generated_guidance', id: 'g', version: '1' }),
    resolved('conversational_generation', { type: 'conversational_generation', id: 'c', version: '1' }),
    resolved('resolver_failure', policy, 'failed'),
  ]) assert.equal(resolvedContractValid(value), false, JSON.stringify(value));
});

test('Ticket 61A maps representative Ticket 58 resolver outputs into the normative contract without changing their source semantics', () => {
  const request = (factKey, offerVersion = '28d-149-v1') => ({ factKey, offerVersion, scope: {}, asOf: '2026-09-22T00:00:01.000Z' });
  const known = factResolver.resolveFact(request('offer.price'));
  const reviewedUnknown = factResolver.resolveFact(request('offer.public_refund_policy'));
  const absent = factResolver.resolveFact(request('payment.method.paypal'));
  const notApplicableOutput = resolveFactFromFacts([{
    fact_key: 'offer.special_feature', offer_version: '28d-149-v1', scope: {}, state: 'not_applicable', value_type: 'text', value: null,
    valid_from: '2026-09-22T00:00:00.000Z', valid_to: null, version: 1, provenance: 'review: fixture', status: 'active',
  }], request('offer.special_feature'));
  for (const output of [known, reviewedUnknown, absent, notApplicableOutput]) {
    const projected = asResolved(output);
    assert.equal(resolvedContractValid(projected), true, output.status);
  }
  assert.deepEqual(reviewedUnknown.source, { type: 'canonical_fact', id: 'offer.public_refund_policy', version: '1' });
  assert.equal(absent.source, null);
  assert.equal(absent.reviewed, false);
  assert.equal(notApplicableOutput.authority, 'canonical_fact');
  assert.notEqual(reviewedUnknown.source, absent.source);
});

test('Ticket 61A maps representative Ticket 59 outputs into the normative contract and retains policy provenance', () => {
  const resolve = request => policyResolver.resolvePolicy(request);
  const base = { offer_version: '28d-149-v1', channel: 'whatsapp' };
  const obligation = (category, subtype) => ({ id: 'o-1', category, subtype, ambiguous: false });
  const deterministic = resolve({ obligation: obligation('medication_management', 'dose_change'), context: base });
  const commercial = resolve({ obligation: obligation('commercial_purchase_intent', 'explicit_current_request'), context: { ...base, commercial_state: { current_purchase_request: true, safety_clear: true } } });
  const prohibited = resolve({ obligation: obligation('commercial_purchase_intent', 'explicit_current_request'), context: { ...base, commercial_state: { current_purchase_request: true, safety_clear: true } }, requested_action_type: 'create_checkout' });
  const noPolicy = resolve({ obligation: obligation('product_fact', 'price'), context: base });
  const policyClarification = resolve({ obligation: obligation('reminder_request', 'explicit'), context: base });
  const sourceLessClarification = resolve({ obligation: { ...obligation('reminder_request', 'explicit'), ambiguous: true }, context: base });
  for (const output of [deterministic, commercial, prohibited, noPolicy, policyClarification, sourceLessClarification]) assert.equal(resolvedContractValid(asResolved(output)), true, output.reason_code);
  assert.equal(prohibited.source.type, 'deterministic_policy');
  assert.equal(noPolicy.source, null);
  assert.equal(policyClarification.authority, 'deterministic_policy');
  assert.equal(policyClarification.source.type, 'deterministic_policy');
  assert.equal(sourceLessClarification.authority, 'clarification_required');
  assert.equal(sourceLessClarification.source, null);
});
