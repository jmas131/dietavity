'use strict';

// Exact, local authority selection.  This intentionally has no prose, model,
// policy, fact, provider, or action input.
class ReviewedKnowledgeAuthorityError extends Error {
  constructor(code, cause) { super(code); this.name = 'ReviewedKnowledgeAuthorityError'; this.code = code; this.cause = cause; }
}
const TOPICS = new Set(['food_storage', 'meal_preparation']);
const TASK_KINDS = new Set(['knowledge_question', 'transformation', 'organization']);
const INPUT_TYPES = new Set(['meal_name', 'ingredient', 'preparation_step', 'meal_component', 'schedule_constraint', 'time_constraint', 'user_preference']);
const STATUSES = new Set(['draft', 'reviewed_active', 'retired']);
const KNOWLEDGE_DOMAINS = new Set(['nutrition_practical']);
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function only(value, keys) { return plain(value) && Object.keys(value).every(key => keys.has(key)); }
function validRecord(record) {
  return only(record, new Set(['knowledge_id', 'knowledge_domain', 'topic', 'task_kinds', 'applicable_input_types', 'content', 'provenance'])) &&
    typeof record.knowledge_id === 'string' && /^[a-z][a-z0-9-]*$/.test(record.knowledge_id) &&
    typeof record.knowledge_domain === 'string' && KNOWLEDGE_DOMAINS.has(record.knowledge_domain) &&
    typeof record.topic === 'string' && TOPICS.has(record.topic) &&
    Array.isArray(record.task_kinds) && record.task_kinds.length && new Set(record.task_kinds).size === record.task_kinds.length && record.task_kinds.every(value => TASK_KINDS.has(value)) &&
    Array.isArray(record.applicable_input_types) && new Set(record.applicable_input_types).size === record.applicable_input_types.length && record.applicable_input_types.every(value => INPUT_TYPES.has(value)) &&
    typeof record.content === 'string' && !!record.content &&
    only(record.provenance, new Set(['source_class', 'reference'])) && record.provenance.source_class === 'architectural_seed' && typeof record.provenance.reference === 'string' && !!record.provenance.reference;
}
function validateAuthority(authority) {
  if (!only(authority, new Set(['authority_contract_version', 'knowledge_sets'])) || authority.authority_contract_version !== 'ticket-72-v1' || !Array.isArray(authority.knowledge_sets)) throw new ReviewedKnowledgeAuthorityError('KNOWLEDGE_AUTHORITY_MALFORMED');
  const activeScopes = new Set(); const ids = new Set();
  for (const set of authority.knowledge_sets) {
    if (!only(set, new Set(['knowledge_set_id', 'knowledge_version', 'status', 'locale', 'records'])) || typeof set.knowledge_set_id !== 'string' || !set.knowledge_set_id || typeof set.knowledge_version !== 'string' || !set.knowledge_version || !STATUSES.has(set.status) || typeof set.locale !== 'string' || !set.locale || !Array.isArray(set.records)) throw new ReviewedKnowledgeAuthorityError('KNOWLEDGE_AUTHORITY_MALFORMED');
    const scope = set.locale;
    if (set.status === 'reviewed_active' && activeScopes.has(scope)) throw new ReviewedKnowledgeAuthorityError('KNOWLEDGE_AUTHORITY_AMBIGUOUS');
    if (set.status === 'reviewed_active') activeScopes.add(scope);
    for (const record of set.records) {
      if (!validRecord(record) || ids.has(`${set.knowledge_version}\u0000${record.knowledge_id}`)) throw new ReviewedKnowledgeAuthorityError('KNOWLEDGE_AUTHORITY_MALFORMED');
      ids.add(`${set.knowledge_version}\u0000${record.knowledge_id}`);
    }
  }
  return authority;
}
function validInputs(value) { return Array.isArray(value) && value.every(input => only(input, new Set(['id', 'input_type', 'value', 'origin'])) && typeof input.id === 'string' && /^bi-[1-9][0-9]*$/.test(input.id) && INPUT_TYPES.has(input.input_type) && typeof input.value === 'string' && !!input.value && input.origin === 'current_turn'); }
function assertRequest(request) {
  if (!only(request, new Set(['topic', 'task_kind', 'bounded_inputs', 'locale', 'knowledge_version'])) || typeof request.topic !== 'string' || !TOPICS.has(request.topic) || typeof request.task_kind !== 'string' || !TASK_KINDS.has(request.task_kind) || !validInputs(request.bounded_inputs) || typeof request.locale !== 'string' || !request.locale || (request.knowledge_version !== undefined && (typeof request.knowledge_version !== 'string' || !request.knowledge_version))) throw new ReviewedKnowledgeAuthorityError('KNOWLEDGE_REQUEST_INVALID');
}
function unknown() { return { status: 'unknown', authority: 'bounded_unknown', source: null, record: null }; }
function resolveReviewedKnowledge(authority, request) {
  validateAuthority(authority); assertRequest(request);
  const sets = authority.knowledge_sets.filter(set => set.status === 'reviewed_active' && set.locale === request.locale && (request.knowledge_version === undefined || set.knowledge_version === request.knowledge_version));
  if (!sets.length) return unknown(); if (sets.length !== 1) throw new ReviewedKnowledgeAuthorityError('KNOWLEDGE_AUTHORITY_AMBIGUOUS');
  const records = sets[0].records.filter(record => record.topic === request.topic && record.task_kinds.includes(request.task_kind) && record.applicable_input_types.every(type => request.bounded_inputs.some(input => input.input_type === type)));
  if (!records.length) return unknown(); if (records.length !== 1) throw new ReviewedKnowledgeAuthorityError('KNOWLEDGE_AUTHORITY_AMBIGUOUS');
  const record = structuredClone(records[0]);
  return Object.freeze({ status: 'resolved', authority: 'reviewed_knowledge', source: Object.freeze({ type: 'reviewed_knowledge', id: record.knowledge_id, version: sets[0].knowledge_version }), record: Object.freeze(record) });
}
function createReviewedKnowledgeAuthority({ authority } = {}) {
  validateAuthority(authority); const snapshot = structuredClone(authority);
  return Object.freeze({ resolve(request) { try { return resolveReviewedKnowledge(snapshot, request); } catch (error) { if (error instanceof ReviewedKnowledgeAuthorityError) throw error; throw new ReviewedKnowledgeAuthorityError('KNOWLEDGE_STORE_UNAVAILABLE', error); } } });
}
module.exports = { ReviewedKnowledgeAuthorityError, TOPICS, TASK_KINDS, INPUT_TYPES, STATUSES, KNOWLEDGE_DOMAINS, assertRequest, createReviewedKnowledgeAuthority, resolveReviewedKnowledge, validateAuthority, validRecord };
