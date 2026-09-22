'use strict';

const { canonicalScope, validateFact } = require('./fact-validator');

class FactResolverError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = 'FactResolverError';
    this.code = code;
    this.cause = cause;
  }
}

function assertRequest(request) {
  if (!request || typeof request !== 'object' || typeof request.factKey !== 'string' || !request.factKey) throw new FactResolverError('FACT_REQUEST_INVALID');
  if (request.offerVersion !== undefined && request.offerVersion !== null && (typeof request.offerVersion !== 'string' || !request.offerVersion)) throw new FactResolverError('FACT_REQUEST_INVALID');
  try { canonicalScope(request.scope === undefined ? {} : request.scope); } catch (error) { throw new FactResolverError('FACT_REQUEST_INVALID', error); }
  const asOf = request.asOf === undefined ? new Date() : new Date(request.asOf);
  if (Number.isNaN(asOf.getTime())) throw new FactResolverError('FACT_REQUEST_INVALID');
  return { factKey: request.factKey, offerVersion: request.offerVersion === undefined ? null : request.offerVersion, scope: request.scope === undefined ? {} : request.scope, asOf };
}

function absentUnknown(factKey) {
  return { status: 'unknown', fact_key: factKey, authority: 'bounded_unknown', source: null, factual_payload: null, reviewed: false, llm_reasoning_permitted: false, customer_uncertainty_required: true };
}

function reviewedUnknown(fact) {
  return {
    status: 'unknown', fact_key: fact.fact_key, authority: 'bounded_unknown',
    source: { type: 'canonical_fact', id: fact.fact_key, version: String(fact.version) },
    factual_payload: null, reviewed: true, state: 'unknown', provenance: fact.provenance,
    llm_reasoning_permitted: false, customer_uncertainty_required: true,
  };
}

function resolveFactFromFacts(facts, request) {
  const normalized = assertRequest(request);
  if (!Array.isArray(facts)) throw new FactResolverError('FACT_STORE_UNAVAILABLE');
  const targetScope = canonicalScope(normalized.scope);
  const matching = facts.filter(fact => {
    const validationError = validateFact(fact);
    if (validationError) throw new FactResolverError('FACT_STORE_MALFORMED');
    if (fact.status !== 'active' || fact.state === 'deprecated' || fact.fact_key !== normalized.factKey || canonicalScope(fact.scope) !== targetScope) return false;
    if (fact.offer_version !== normalized.offerVersion) return false;
    const from = Date.parse(fact.valid_from); const to = fact.valid_to === null ? Infinity : Date.parse(fact.valid_to);
    return from <= normalized.asOf.getTime() && normalized.asOf.getTime() < to;
  });
  if (matching.length === 0) return absentUnknown(normalized.factKey);
  if (matching.length !== 1) throw new FactResolverError('FACT_STORE_AMBIGUOUS');
  const fact = matching[0];
  if (fact.state === 'unknown') return reviewedUnknown(fact);
  if (fact.state === 'not_applicable') return {
    status: 'not_applicable', fact_key: fact.fact_key, authority: 'canonical_fact',
    source: { type: 'canonical_fact', id: fact.fact_key, version: String(fact.version) },
    factual_payload: null, reviewed: true, state: 'not_applicable', provenance: fact.provenance,
    llm_reasoning_permitted: false, customer_uncertainty_required: false,
  };
  return {
    status: 'resolved', fact_key: fact.fact_key, authority: 'canonical_fact',
    source: { type: 'canonical_fact', id: fact.fact_key, version: String(fact.version) },
    factual_payload: structuredClone(fact.value), state: fact.state, value_type: fact.value_type,
    llm_reasoning_permitted: false, customer_uncertainty_required: false,
  };
}

function createFactResolver({ facts }) {
  if (!Array.isArray(facts)) throw new FactResolverError('FACT_STORE_UNAVAILABLE');
  const snapshot = structuredClone(facts);
  return Object.freeze({
    resolveFact(request) { return resolveFactFromFacts(snapshot, request); },
    resolveFacts(requests) {
      if (!Array.isArray(requests)) throw new FactResolverError('FACT_REQUEST_INVALID');
      return requests.map(request => resolveFactFromFacts(snapshot, request));
    },
  });
}

module.exports = { FactResolverError, createFactResolver, resolveFactFromFacts };
