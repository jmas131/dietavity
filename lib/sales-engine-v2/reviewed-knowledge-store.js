'use strict';

class ReviewedKnowledgeStoreError extends Error {
  constructor(code, cause) { super(code); this.name = 'ReviewedKnowledgeStoreError'; this.code = code; this.cause = cause; }
}

const STATUSES = new Set(['active', 'draft', 'deprecated']);
const REVIEW_STATUSES = new Set(['reviewed']);
const SOURCE_CLASSES = new Set(['architectural_seed']);
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function only(value, keys) { return Object.keys(value).every(key => keys.has(key)); }
function provenanceValid(provenance) {
  return plainObject(provenance) && only(provenance, new Set(['review_status', 'source_class', 'reference'])) && REVIEW_STATUSES.has(provenance.review_status) && SOURCE_CLASSES.has(provenance.source_class) && typeof provenance.reference === 'string' && !!provenance.reference;
}

function validateItem(item) {
  if (!plainObject(item) || !only(item, new Set(['id', 'version', 'status', 'topic', 'locale', 'content', 'allowed_uses', 'valid_from', 'valid_to', 'provenance']))) return 'KNOWLEDGE_ITEM_INVALID';
  if (typeof item.id !== 'string' || !item.id || !Number.isInteger(item.version) || item.version < 1 || !STATUSES.has(item.status) || typeof item.topic !== 'string' || !item.topic || typeof item.locale !== 'string' || !item.locale || typeof item.content !== 'string' || !item.content || !Array.isArray(item.allowed_uses) || !item.allowed_uses.length || item.allowed_uses.some(value => typeof value !== 'string' || !value) || new Set(item.allowed_uses).size !== item.allowed_uses.length || !provenanceValid(item.provenance)) return 'KNOWLEDGE_ITEM_INVALID';
  const from = Date.parse(item.valid_from); const to = item.valid_to === null ? null : Date.parse(item.valid_to);
  if (Number.isNaN(from) || (item.valid_to !== null && Number.isNaN(to)) || (to !== null && to <= from)) return 'KNOWLEDGE_ITEM_INVALID';
  return null;
}

function assertRequest(request) {
  if (!plainObject(request) || !only(request, new Set(['topic', 'locale', 'asOf', 'allowedUse'])) || typeof request.topic !== 'string' || !request.topic || typeof request.locale !== 'string' || !request.locale || typeof request.allowedUse !== 'string' || !request.allowedUse || typeof request.asOf !== 'string' || Number.isNaN(Date.parse(request.asOf))) throw new ReviewedKnowledgeStoreError('KNOWLEDGE_REQUEST_INVALID');
  return { ...request, asOfMillis: Date.parse(request.asOf) };
}

function retrieveReviewedKnowledge(items, request) {
  const normalized = assertRequest(request);
  if (!Array.isArray(items)) throw new ReviewedKnowledgeStoreError('KNOWLEDGE_STORE_UNAVAILABLE');
  const matches = items.filter(item => {
    const invalid = validateItem(item);
    if (invalid) throw new ReviewedKnowledgeStoreError(invalid);
    if (item.status !== 'active' || item.topic !== normalized.topic || item.locale !== normalized.locale || !item.allowed_uses.includes(normalized.allowedUse)) return false;
    const from = Date.parse(item.valid_from); const to = item.valid_to === null ? Infinity : Date.parse(item.valid_to);
    return from <= normalized.asOfMillis && normalized.asOfMillis < to;
  });
  if (matches.length > 1) throw new ReviewedKnowledgeStoreError('KNOWLEDGE_STORE_AMBIGUOUS');
  return matches.length === 0 ? null : structuredClone(matches[0]);
}

function createReviewedKnowledgeStore({ items } = {}) {
  if (!Array.isArray(items)) throw new ReviewedKnowledgeStoreError('KNOWLEDGE_STORE_UNAVAILABLE');
  const snapshot = structuredClone(items);
  return Object.freeze({ retrieve(request) { return retrieveReviewedKnowledge(snapshot, request); } });
}

module.exports = { ReviewedKnowledgeStoreError, REVIEW_STATUSES, SOURCE_CLASSES, createReviewedKnowledgeStore, provenanceValid, retrieveReviewedKnowledge, validateItem };
