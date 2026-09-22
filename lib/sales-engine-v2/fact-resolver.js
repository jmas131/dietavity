'use strict';

const { canonicalScope, validateFact, validateMembershipDefinitions } = require('./fact-validator');

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
  if (request.query !== undefined && (!request.query || typeof request.query !== 'object' || Array.isArray(request.query) || Object.keys(request.query).length !== 2 || request.query.operation !== 'contains' || typeof request.query.candidate !== 'string' || !request.query.candidate.trim())) throw new FactResolverError('FACT_REQUEST_INVALID');
  return { factKey: request.factKey, offerVersion: request.offerVersion === undefined ? null : request.offerVersion, scope: request.scope === undefined ? {} : request.scope, asOf, query: request.query === undefined ? undefined : structuredClone(request.query) };
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

function normalizeCandidate(candidate, normalization) {
  if (normalization !== 'ascii_lowercase' || !/^[\x20-\x7E]+$/.test(candidate)) throw new FactResolverError('FACT_REQUEST_INVALID');
  return candidate.trim().toLowerCase();
}

function resolveMembership(fact, result, query, membershipDefinitions) {
  const definition = membershipDefinitions.get(fact.fact_key);
  if (!definition || definition.operation !== query.operation || definition.complete_set !== true || fact.value_type !== 'enum_set') throw new FactResolverError('FACT_QUERY_UNSUPPORTED');
  const candidate = normalizeCandidate(query.candidate, definition.normalization);
  return { ...result, factual_payload: { operation: 'contains', candidate, value: fact.value.includes(candidate) }, membership: { operation: 'contains', candidate, complete_set: true } };
}

function resolveFactFromFacts(facts, request, membershipDefinitions = new Map()) {
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
  const result = {
    status: 'resolved', fact_key: fact.fact_key, authority: 'canonical_fact',
    source: { type: 'canonical_fact', id: fact.fact_key, version: String(fact.version) },
    factual_payload: structuredClone(fact.value), state: fact.state, value_type: fact.value_type,
    llm_reasoning_permitted: false, customer_uncertainty_required: false,
  };
  return normalized.query === undefined ? result : resolveMembership(fact, result, normalized.query, membershipDefinitions);
}

function createFactResolver({ facts, membershipDefinitions } = {}) {
  if (!Array.isArray(facts)) throw new FactResolverError('FACT_STORE_UNAVAILABLE');
  if (membershipDefinitions === undefined) membershipDefinitions = { version: 'none', definitions: [] };
  try { validateMembershipDefinitions(membershipDefinitions); } catch (error) { throw new FactResolverError('FACT_MEMBERSHIP_DEFINITIONS_INVALID', error); }
  const snapshot = structuredClone(facts);
  const membership = new Map(membershipDefinitions.definitions.map(definition => [definition.fact_key, structuredClone(definition)]));
  return Object.freeze({
    resolveFact(request) { return resolveFactFromFacts(snapshot, request, membership); },
    resolveFacts(requests) {
      if (!Array.isArray(requests)) throw new FactResolverError('FACT_REQUEST_INVALID');
      return requests.map(request => resolveFactFromFacts(snapshot, request, membership));
    },
  });
}

module.exports = { FactResolverError, createFactResolver, resolveFactFromFacts };
