'use strict';

// Ticket 71's pure, injected-snapshot authority boundary.  It deliberately
// has no database, model, customer-text, policy, or action dependency.
const { validateValue, canonicalScope: canonicalScopeValue } = require('./fact-validator');
const { FactResolverError } = require('./fact-resolver');

const SET_STATUSES = new Set(['draft', 'reviewed_active', 'retired']);
const STATES = new Set(['known_true', 'known_false', 'unknown', 'not_applicable']);
const VALUE_TYPES = new Set(['boolean', 'integer', 'money', 'enum', 'enum_set', 'object', 'text']);
const PROVIDER_FACT_KEYS = new Set(['service.glp1_medication_sale', 'service.glp1_medication_delivery', 'service.glp1_medication_prescription']);
const OFFER_VERSION_FACT_KEYS = new Set(['offer.price', 'offer.duration_days', 'offer.billing_model', 'offer.subscription', 'offer.automatic_renewal', 'offer.meals', 'offer.personalization_after_verified_payment', 'offer.physical_shipping', 'service.portal_delivery', 'service.whatsapp_support', 'payment.supported_methods', 'offer.public_refund_policy']);
const FACT_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function ownOnly(value, keys) { return plain(value) && Object.keys(value).every(key => keys.has(key)); }
function canonicalScope(scope) { return canonicalScopeValue(scope); }
function scopeClassForFactKey(factKey) {
  if (PROVIDER_FACT_KEYS.has(factKey)) return 'provider';
  if (OFFER_VERSION_FACT_KEYS.has(factKey)) return 'offer_version';
  return null;
}
function validScope(scope) {
  return ownOnly(scope, new Set(['scope_type'])) && scope.scope_type === 'provider'
    || ownOnly(scope, new Set(['scope_type', 'offer_version'])) && scope.scope_type === 'offer_version' && typeof scope.offer_version === 'string' && !!scope.offer_version;
}

function validateAuthority(authority) {
  if (!ownOnly(authority, new Set(['authority_contract_version', 'authority_sets'])) || authority.authority_contract_version !== 'ticket-71-v1' || !Array.isArray(authority.authority_sets)) throw new FactResolverError('FACT_STORE_MALFORMED');
  const seenScopes = new Set();
  for (const set of authority.authority_sets) {
    if (!ownOnly(set, new Set(['authority_set_id', 'authority_version', 'status', 'scope', 'facts'])) || typeof set.authority_set_id !== 'string' || !set.authority_set_id || typeof set.authority_version !== 'string' || !set.authority_version || !SET_STATUSES.has(set.status) || !plain(set.scope) || !Array.isArray(set.facts)) throw new FactResolverError('FACT_STORE_MALFORMED');
    if (!validScope(set.scope)) throw new FactResolverError('FACT_STORE_MALFORMED');
    let scopeKey;
    try { scopeKey = canonicalScope(set.scope); } catch { throw new FactResolverError('FACT_STORE_MALFORMED'); }
    if (set.status === 'reviewed_active' && seenScopes.has(scopeKey)) throw new FactResolverError('FACT_STORE_AMBIGUOUS');
    if (set.status === 'reviewed_active') seenScopes.add(scopeKey);
    const ids = new Set(); const keys = new Set();
    for (const fact of set.facts) {
      if (!ownOnly(fact, new Set(['fact_id', 'fact_key', 'state', 'value_type', 'value'])) || typeof fact.fact_id !== 'string' || !fact.fact_id || !FACT_KEY.test(fact.fact_key) || scopeClassForFactKey(fact.fact_key) === null || (scopeClassForFactKey(fact.fact_key) !== set.scope.scope_type) || !STATES.has(fact.state) || !VALUE_TYPES.has(fact.value_type) || ids.has(fact.fact_id) || keys.has(fact.fact_key)) throw new FactResolverError('FACT_STORE_MALFORMED');
      ids.add(fact.fact_id); keys.add(fact.fact_key);
      if ((fact.state === 'unknown' || fact.state === 'not_applicable') ? fact.value !== null : validateValue(fact.value_type, fact.value)) throw new FactResolverError('FACT_STORE_MALFORMED');
    }
  }
  return authority;
}

function scopeFromConversationContext(context, factKey) {
  if (!plain(context) || !plain(context.offer_context) || !plain(context.metadata)) throw new FactResolverError('FACT_SCOPE_INVALID');
  const scopeClass = scopeClassForFactKey(factKey);
  if (!scopeClass) throw new FactResolverError('FACT_REQUEST_INVALID');
  const offerVersion = context.offer_context.offer_version;
  if (offerVersion !== undefined && (typeof offerVersion !== 'string' || !offerVersion)) throw new FactResolverError('FACT_SCOPE_INVALID');
  // Campaign is deliberately ignored: it can route an experience, never alter
  // product truth unless a future canonical offer-version mapping says so.
  if (scopeClass === 'provider') return { scope_type: 'provider' };
  return offerVersion ? { scope_type: 'offer_version', offer_version: offerVersion } : null;
}

function source(set, fact) { return { type: 'canonical_fact', id: fact.fact_id, version: set.authority_version }; }
function unknown(factKey) { return { status: 'unknown', fact_key: factKey, authority: 'bounded_unknown', source: null, factual_payload: null, reviewed: false, llm_reasoning_permitted: false, customer_uncertainty_required: true }; }
function createAuthorityFactResolver({ authority, membershipDefinitions = { version: 'none', definitions: [] } } = {}) {
  validateAuthority(authority);
  const snapshot = structuredClone(authority);
  const memberships = new Map(membershipDefinitions.definitions.map(definition => [definition.fact_key, definition]));
  return Object.freeze({
    resolveFact(request) {
      if (!ownOnly(request, new Set(['factKey', 'offerVersion', 'scope', 'asOf', 'query'])) || typeof request.factKey !== 'string' || !FACT_KEY.test(request.factKey) || !plain(request.scope) || (request.offerVersion !== undefined && request.offerVersion !== null && (typeof request.offerVersion !== 'string' || !request.offerVersion)) || (request.asOf !== undefined && Number.isNaN(Date.parse(request.asOf)))) throw new FactResolverError('FACT_REQUEST_INVALID');
      const scopeClass = scopeClassForFactKey(request.factKey);
      if (!scopeClass) return unknown(request.factKey);
      // `{}` is merely Ticket 62's legacy neutral transport field. It never
      // denotes authority scope. The closed fact-key classification selects the
      // sole permitted scope class; provider selection is not fallback.
      let requestScope;
      if (Object.keys(request.scope).length === 0) requestScope = scopeClass === 'provider' ? { scope_type: 'provider' } : request.offerVersion == null ? null : { scope_type: 'offer_version', offer_version: request.offerVersion };
      else requestScope = request.scope;
      if (requestScope === null) return unknown(request.factKey);
      if (!validScope(requestScope) || requestScope.scope_type !== scopeClass || (scopeClass === 'offer_version' && request.offerVersion !== undefined && request.offerVersion !== null && requestScope.offer_version !== request.offerVersion)) throw new FactResolverError('FACT_REQUEST_INVALID');
      let scope;
      try { scope = canonicalScope(requestScope); } catch { throw new FactResolverError('FACT_REQUEST_INVALID'); }
      const sets = snapshot.authority_sets.filter(set => set.status === 'reviewed_active' && canonicalScope(set.scope) === scope);
      if (!sets.length) return unknown(request.factKey);
      if (sets.length !== 1) throw new FactResolverError('FACT_STORE_AMBIGUOUS');
      const set = sets[0]; const facts = set.facts.filter(fact => fact.fact_key === request.factKey);
      if (!facts.length) return unknown(request.factKey);
      if (facts.length !== 1) throw new FactResolverError('FACT_STORE_AMBIGUOUS');
      const fact = facts[0]; const base = { fact_key: fact.fact_key, source: source(set, fact), reviewed: true, llm_reasoning_permitted: false };
      if (fact.state === 'unknown') return { ...base, status: 'unknown', authority: 'bounded_unknown', factual_payload: null, customer_uncertainty_required: true };
      if (fact.state === 'not_applicable') return { ...base, status: 'not_applicable', authority: 'canonical_fact', factual_payload: null, customer_uncertainty_required: false };
      const result = { ...base, status: 'resolved', authority: 'canonical_fact', factual_payload: structuredClone(fact.value), customer_uncertainty_required: false };
      if (!request.query) return result;
      const definition = memberships.get(fact.fact_key);
      if (!ownOnly(request.query, new Set(['operation', 'candidate'])) || request.query.operation !== 'contains' || typeof request.query.candidate !== 'string' || !request.query.candidate.trim() || !definition || definition.complete_set !== true || fact.value_type !== 'enum_set') throw new FactResolverError('FACT_QUERY_UNSUPPORTED');
      const candidate = request.query.candidate.trim().toLowerCase();
      return { ...result, factual_payload: { operation: 'contains', candidate, value: fact.value.includes(candidate) }, membership: { operation: 'contains', candidate, complete_set: true } };
    },
    resolveFromContext({ context, ...request }) {
      const scope = scopeFromConversationContext(context, request.factKey);
      return scope === null ? unknown(request.factKey) : this.resolveFact({ ...request, scope });
    },
  });
}
module.exports = { OFFER_VERSION_FACT_KEYS, PROVIDER_FACT_KEYS, createAuthorityFactResolver, scopeClassForFactKey, scopeFromConversationContext, validateAuthority };
