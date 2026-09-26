'use strict';
const { createConversationContext } = require('./memory-adapter');
const { validateAuthority } = require('./product-fact-authority');
const { createReviewedKnowledgeStore } = require('./reviewed-knowledge-store');

class CanonicalInputError extends Error { constructor(code, cause) { super(code); this.code = code; this.cause = cause; } }
function aborted(signal) { if (signal?.aborted) throw new CanonicalInputError('deadline_exceeded'); }
function requireReader(reader, name) { if (!reader || typeof reader[name] !== 'function') throw new CanonicalInputError('authority_unavailable'); }
function claimCode(row, request, now) {
  if (!row || row.id !== request.canonical_inbound_message_id || row.direction !== 'inbound' || row.session_id !== request.session_id || row.processing_owner !== request.processing_owner) return 'claim_not_owned';
  if (!row.processing_lease_until || Date.parse(row.processing_lease_until) <= now) return 'claim_expired';
  if (row.processing_completed_at) return 'claim_not_owned';
  if (row.has_outbound_reply === true) return 'already_has_reply';
  return null;
}
function createCanonicalClaimVerifier({ reader, now = () => Date.now() } = {}) {
  requireReader(reader, 'readClaim');
  return async ({ request, signal }) => {
    try { aborted(signal); const row = await reader.readClaim({ canonicalInboundMessageId: request.canonical_inbound_message_id, signal }); aborted(signal); const code = claimCode(row, request, now()); return code ? { status: 'invalid', code } : { status: 'valid', claim: Object.freeze({ canonical_inbound_message_id: row.id, session_id: row.session_id, processing_owner: row.processing_owner, processing_lease_until: row.processing_lease_until }) }; }
    catch (error) { if (error instanceof CanonicalInputError) throw error; throw new CanonicalInputError('authority_unavailable', error); }
  };
}
function factSnapshot(rows) {
  const sets = new Map();
  for (const row of rows) {
    if (!sets.has(row.authority_set_id)) sets.set(row.authority_set_id, { authority_set_id: row.authority_set_id, authority_version: row.authority_version, status: row.status, scope: row.scope, facts: [] });
    if (row.fact_id !== null) sets.get(row.authority_set_id).facts.push({ fact_id: row.fact_id, fact_key: row.fact_key, state: row.state, value_type: row.value_type, value: row.value });
  }
  const snapshot = { authority_contract_version: 'ticket-71-v1', authority_sets: [...sets.values()] };
  try { return Object.freeze(structuredClone(validateAuthority(snapshot))); } catch (error) { throw new CanonicalInputError('authority_unavailable', error); }
}
function authorityScopeStatus(snapshot, offerVersion) {
  const active = snapshot.authority_sets.filter(set => set.status === 'reviewed_active');
  const provider = active.filter(set => set.scope.scope_type === 'provider');
  const offer = offerVersion === null || offerVersion === undefined
    ? { status: 'unresolved', reason: 'canonical_offer_binding_absent', offer_version: null }
    : active.some(set => set.scope.scope_type === 'offer_version' && set.scope.offer_version === offerVersion)
      ? { status: 'available', offer_version: offerVersion }
      : { status: 'unresolved', reason: 'reviewed_offer_authority_absent', offer_version: offerVersion };
  return Object.freeze({
    provider: Object.freeze({ status: provider.length === 1 ? 'available' : 'unresolved' }),
    offer: Object.freeze(offer),
  });
}
function knowledgeSnapshot(rows, locale) {
  const active = rows.filter(row => row.status === 'reviewed_active' && row.locale === locale);
  if (active.length !== 1) throw new CanonicalInputError(active.length ? 'authority_unavailable' : 'authority_unresolved');
  const set = active[0]; if (!Array.isArray(set.records)) throw new CanonicalInputError('authority_unavailable');
  const version = Number(set.knowledge_version); if (!Number.isInteger(version) || version < 1) throw new CanonicalInputError('authority_unavailable');
  const items = set.records.map(record => ({ id: record.knowledge_id, version, status: 'active', topic: record.topic, locale: set.locale, content: record.content, allowed_uses: record.task_kinds, valid_from: set.created_at, valid_to: null, provenance: { review_status: 'reviewed', ...record.provenance } }));
  try { return Object.freeze({ knowledge_set_id: set.knowledge_set_id, locale: set.locale, store: createReviewedKnowledgeStore({ items }) }); } catch (error) { throw new CanonicalInputError('authority_unavailable', error); }
}
function createCanonicalInputAdapter({ reader, now = () => new Date().toISOString() } = {}) {
  for (const name of ['readContext', 'readFactAuthority', 'readKnowledgeAuthority']) requireReader(reader, name);
  return Object.freeze({
    async build({ request, claim, signal }) {
      try {
        aborted(signal); const source = await reader.readContext({ canonicalInboundMessageId: request.canonical_inbound_message_id, sessionId: request.session_id, signal }); aborted(signal);
        if (!source || !source.currentTurn || !source.runtimeMetadata || source.currentTurn.canonical_message_id !== request.canonical_inbound_message_id || source.runtimeMetadata.session_id !== request.session_id) throw new CanonicalInputError('context_invalid');
        const runtimeMetadata = source.runtimeMetadata.offer_version === null
          ? Object.fromEntries(Object.entries(source.runtimeMetadata).filter(([key]) => key !== 'offer_version'))
          : source.runtimeMetadata;
        const context = createConversationContext({ currentTurn: source.currentTurn, memory: source.memory || [], conversationArtifacts: source.conversationArtifacts || [], runtimeMetadata, options: source.options });
        const [facts, knowledge] = await Promise.all([reader.readFactAuthority({ signal }), reader.readKnowledgeAuthority({ locale: context.locale, signal })]); aborted(signal);
        const productFactAuthority = factSnapshot(facts);
        return Object.freeze({ claim: Object.freeze({ ...claim }), conversation_context: context, product_fact_authority: productFactAuthority, product_fact_authority_scope: authorityScopeStatus(productFactAuthority, source.runtimeMetadata.offer_version), reviewed_knowledge_authority: knowledgeSnapshot(knowledge, context.locale), built_at: now() });
      } catch (error) { if (error instanceof CanonicalInputError) throw error; throw new CanonicalInputError('context_invalid', error); }
    }
  });
}
module.exports = { CanonicalInputError, authorityScopeStatus, createCanonicalClaimVerifier, createCanonicalInputAdapter, factSnapshot, knowledgeSnapshot };
