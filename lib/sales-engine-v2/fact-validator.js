'use strict';

const STATES = new Set(['known_true', 'known_false', 'unknown', 'not_applicable', 'deprecated']);
const STATUSES = new Set(['active', 'deprecated', 'draft']);
const VALUE_TYPES = new Set(['boolean', 'integer', 'money', 'enum', 'enum_set', 'object', 'text']);
const MEMBERSHIP_OPERATIONS = new Set(['contains']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalScope(scope) {
  if (!isPlainObject(scope)) throw new TypeError('FACT_SCOPE_MUST_BE_OBJECT');
  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (isPlainObject(value)) return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
    if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return value;
    throw new TypeError('FACT_SCOPE_VALUE_INVALID');
  }
  return JSON.stringify(canonicalize(scope));
}

function validateValue(valueType, value) {
  if (valueType === 'boolean' && typeof value !== 'boolean') return 'FACT_VALUE_BOOLEAN_REQUIRED';
  if (valueType === 'integer' && (!Number.isInteger(value))) return 'FACT_VALUE_INTEGER_REQUIRED';
  if (valueType === 'money' && (!isPlainObject(value) || typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount < 0 || typeof value.currency !== 'string' || value.currency.length !== 3 || value.currency !== value.currency.toUpperCase())) return 'FACT_VALUE_MONEY_REQUIRED';
  if (valueType === 'enum' && (typeof value !== 'string' || value.length === 0)) return 'FACT_VALUE_ENUM_REQUIRED';
  if (valueType === 'enum_set' && (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || item.length === 0) || new Set(value).size !== value.length)) return 'FACT_VALUE_ENUM_SET_REQUIRED';
  if (valueType === 'object' && !isPlainObject(value)) return 'FACT_VALUE_OBJECT_REQUIRED';
  if (valueType === 'text' && typeof value !== 'string') return 'FACT_VALUE_TEXT_REQUIRED';
  return null;
}

function validateFact(fact) {
  if (!isPlainObject(fact)) return 'FACT_MUST_BE_OBJECT';
  if (typeof fact.fact_key !== 'string' || !fact.fact_key.includes('.') || fact.fact_key.startsWith('.') || fact.fact_key.endsWith('.')) return 'FACT_KEY_INVALID';
  if (fact.offer_version !== null && (typeof fact.offer_version !== 'string' || !fact.offer_version)) return 'FACT_OFFER_VERSION_INVALID';
  try { canonicalScope(fact.scope); } catch (error) { return error.message; }
  if (!STATES.has(fact.state)) return 'FACT_STATE_INVALID';
  if (!VALUE_TYPES.has(fact.value_type)) return 'FACT_VALUE_TYPE_INVALID';
  if (!STATUSES.has(fact.status)) return 'FACT_STATUS_INVALID';
  if (!Number.isInteger(fact.version) || fact.version < 1) return 'FACT_VERSION_INVALID';
  if (typeof fact.provenance !== 'string' || !fact.provenance || fact.provenance.toLowerCase().includes('openai') || fact.provenance.toLowerCase().includes('llm')) return 'FACT_PROVENANCE_INVALID';
  const from = Date.parse(fact.valid_from);
  const to = fact.valid_to === null ? null : Date.parse(fact.valid_to);
  if (Number.isNaN(from) || (fact.valid_to !== null && Number.isNaN(to)) || (to !== null && to <= from)) return 'FACT_VALIDITY_INVALID';
  if (fact.state === 'unknown' || fact.state === 'not_applicable') {
    if (fact.value !== null) return 'FACT_UNKNOWN_OR_NA_MUST_NOT_ASSERT_VALUE';
  } else if (fact.state !== 'deprecated') {
    const error = validateValue(fact.value_type, fact.value);
    if (error) return error;
  }
  if (fact.state === 'deprecated' && fact.status === 'active') return 'FACT_DEPRECATED_CANNOT_BE_ACTIVE';
  return null;
}

function validateDictionary(dictionary) {
  if (!isPlainObject(dictionary) || typeof dictionary.dictionary_version !== 'string' || !Array.isArray(dictionary.facts)) throw new TypeError('FACT_DICTIONARY_INVALID');
  const seen = new Set();
  for (const fact of dictionary.facts) {
    const error = validateFact(fact);
    if (error) throw new TypeError(error);
    const key = [fact.fact_key, fact.offer_version || '', canonicalScope(fact.scope), fact.version].join('|');
    if (seen.has(key)) throw new TypeError('FACT_DUPLICATE_VERSION');
    seen.add(key);
  }
  for (let index = 0; index < dictionary.facts.length; index += 1) for (let other = index + 1; other < dictionary.facts.length; other += 1) {
    const a = dictionary.facts[index]; const b = dictionary.facts[other];
    if (a.status !== 'active' || b.status !== 'active' || a.fact_key !== b.fact_key || a.offer_version !== b.offer_version || canonicalScope(a.scope) !== canonicalScope(b.scope)) continue;
    const aFrom = Date.parse(a.valid_from); const bFrom = Date.parse(b.valid_from);
    const aTo = a.valid_to === null ? Infinity : Date.parse(a.valid_to); const bTo = b.valid_to === null ? Infinity : Date.parse(b.valid_to);
    if (aFrom < bTo && bFrom < aTo) throw new TypeError('FACT_ACTIVE_VALIDITY_OVERLAP');
  }
  return dictionary;
}

function validateMembershipDefinitions(definitions) {
  if (!isPlainObject(definitions) || typeof definitions.version !== 'string' || !definitions.version || !Array.isArray(definitions.definitions)) throw new TypeError('FACT_MEMBERSHIP_DEFINITIONS_INVALID');
  const keys = new Set();
  for (const definition of definitions.definitions) {
    if (!isPlainObject(definition) || Object.keys(definition).some(key => !new Set(['fact_key', 'operation', 'complete_set', 'normalization']).has(key))) throw new TypeError('FACT_MEMBERSHIP_DEFINITION_INVALID');
    if (typeof definition.fact_key !== 'string' || !definition.fact_key || !MEMBERSHIP_OPERATIONS.has(definition.operation) || definition.complete_set !== true || definition.normalization !== 'ascii_lowercase') throw new TypeError('FACT_MEMBERSHIP_DEFINITION_INVALID');
    if (keys.has(definition.fact_key)) throw new TypeError('FACT_MEMBERSHIP_DEFINITION_DUPLICATE');
    keys.add(definition.fact_key);
  }
  return definitions;
}

module.exports = { MEMBERSHIP_OPERATIONS, STATES, STATUSES, VALUE_TYPES, canonicalScope, validateFact, validateDictionary, validateMembershipDefinitions, validateValue };
