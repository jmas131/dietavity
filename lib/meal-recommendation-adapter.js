'use strict';

// Narrow parsed-JSON boundary between Direct RAG's deterministic permission
// and the frozen meal engine. This module deliberately performs no language
// normalization or semantic inference.
const frozenEngine = require('./meal-recommendation-engine');

const APPETITES = new Set(['low', 'normal', 'high', 'variable', 'unknown']);
const HORIZONS = new Set(['immediate', 'upcoming_meal', 'planning', 'unknown']);
const LOCALES = new Set(['es-MX']);
const CLARIFICATION_REASONS = new Set(['preparation_not_immediate', 'insufficient_meal_substance']);
const INPUT_KEYS = ['recommendation_authorized', 'available_foods', 'recently_consumed', 'appetite', 'meal_context', 'confirmed_constraints', 'contextual_rejections', 'locale', 'decision_horizon'];
const FOOD_KEYS = ['food_id', 'state'];
const STATE_KEYS = ['cooked', 'canned', 'readiness'];
const REJECTION_KEYS = ['scope', 'food_id'];

function integrationFailure(reason) { return Object.freeze({ status: 'integration_failure', reason }); }
function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

// Parsed JSON produces Object.prototype records. Reject null/custom prototypes,
// accessors, symbols, and non-enumerable keys rather than trying to sanitize
// hostile JavaScript objects at this trust boundary.
function safePlainObject(value, requireEnumerable = true) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
    return Reflect.ownKeys(value).every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === 'string' && (!requireEnumerable || descriptor?.enumerable === true) && Object.hasOwn(descriptor || {}, 'value');
    });
  } catch (_) { return false; }
}

function exactRecord(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!safePlainObject(value)) return false;
  const allowed = new Set(allowedKeys);
  try {
    const keys = Object.keys(value);
    return keys.every(key => allowed.has(key)) && requiredKeys.every(key => hasOwn(value, key));
  } catch (_) { return false; }
}

function isCanonicalFoodId(id) { return typeof id === 'string' && Object.hasOwn(frozenEngine.ONTOLOGY, id); }

function safeState(value) {
  if (!exactRecord(value, STATE_KEYS, [])) return false;
  return (!hasOwn(value, 'cooked') || typeof value.cooked === 'boolean')
    && (!hasOwn(value, 'canned') || typeof value.canned === 'boolean')
    && (!hasOwn(value, 'readiness') || value.readiness === 'ready_to_eat');
}

// One canonical availability representation prevents object/string duplicates.
function safeAvailableFood(value) {
  return exactRecord(value, FOOD_KEYS)
    && isCanonicalFoodId(value.food_id)
    && safeState(value.state);
}

// The adapter accepts only targeted food rejections. The engine has richer
// internal scopes, but they are not part of this independently enforced API.
function safeFoodRejection(value) {
  return exactRecord(value, REJECTION_KEYS)
    && value.scope === 'food'
    && isCanonicalFoodId(value.food_id);
}

function uniqueIds(values, getId = value => value) {
  try {
    const ids = values.map(getId);
    return new Set(ids).size === ids.length;
  } catch (_) { return false; }
}

function clone(value) { return structuredClone(value); }

// Arrays from parsed JSON have exactly numeric data entries plus `length` and
// Array.prototype. Inspect descriptors directly: never invoke an untrusted
// array's map/every/iterator or read an accessor-backed entry.
function safeArraySnapshot(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const length = value.length;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!Number.isSafeInteger(length) || !lengthDescriptor || lengthDescriptor.value !== length || lengthDescriptor.enumerable || lengthDescriptor.configurable || !Object.hasOwn(lengthDescriptor, 'value')) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1 || ownKeys.some(key => key !== 'length' && (!/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= length))) return null;
    const snapshot = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch (_) { return null; }
}

function snapshotAdapterInput(input) {
  try {
    if (!exactRecord(input, INPUT_KEYS)) return { valid: false, reason: 'adapter_input_invalid' };
    const arrays = {};
    for (const key of ['available_foods', 'recently_consumed', 'confirmed_constraints', 'contextual_rejections']) {
      arrays[key] = safeArraySnapshot(input[key]);
      if (!arrays[key]) return { valid: false, reason: `${key}_invalid` };
    }
    // All top-level fields are own data properties (enforced above); the array
    // values are fresh descriptor snapshots, never reread from the caller.
    return { valid: true, input: clone({
      recommendation_authorized: input.recommendation_authorized,
      available_foods: arrays.available_foods,
      recently_consumed: arrays.recently_consumed,
      appetite: input.appetite,
      meal_context: input.meal_context,
      confirmed_constraints: arrays.confirmed_constraints,
      contextual_rejections: arrays.contextual_rejections,
      locale: input.locale,
      decision_horizon: input.decision_horizon,
    }) };
  } catch (_) { return { valid: false, reason: 'adapter_input_invalid' }; }
}

function freezeDeep(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeDeep(child, seen);
  return Object.freeze(value);
}

function safeEngineValue(value, ancestors = new WeakSet()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  ancestors.add(value);
  if (Array.isArray(value)) {
    try { const valid = value.every(item => safeEngineValue(item, ancestors)); ancestors.delete(value); return valid; } catch (_) { return false; }
  }
  if (!safePlainObject(value, false)) return false;
  try { const valid = Object.values(value).every(item => safeEngineValue(item, ancestors)); ancestors.delete(value); return valid; } catch (_) { return false; }
}

function validateSnapshot(input) {
  try {
    if (input.recommendation_authorized !== true) return { valid: false, reason: 'recommendation_not_authorized' };
    if (!Array.isArray(input.available_foods) || !input.available_foods.every(safeAvailableFood) || !uniqueIds(input.available_foods, value => value.food_id)) return { valid: false, reason: 'available_foods_invalid' };
    if (!Array.isArray(input.recently_consumed) || !input.recently_consumed.every(isCanonicalFoodId) || !uniqueIds(input.recently_consumed)) return { valid: false, reason: 'recently_consumed_invalid' };
    if (!APPETITES.has(input.appetite)) return { valid: false, reason: 'appetite_invalid' };
    if (input.meal_context !== null) return { valid: false, reason: 'meal_context_unsupported' };
    if (!Array.isArray(input.confirmed_constraints) || !input.confirmed_constraints.every(isCanonicalFoodId) || !uniqueIds(input.confirmed_constraints)) return { valid: false, reason: 'confirmed_constraints_invalid' };
    if (!Array.isArray(input.contextual_rejections) || !input.contextual_rejections.every(safeFoodRejection) || !uniqueIds(input.contextual_rejections, value => value.food_id)) return { valid: false, reason: 'contextual_rejections_invalid' };
    if (!LOCALES.has(input.locale)) return { valid: false, reason: 'locale_invalid' };
    if (!HORIZONS.has(input.decision_horizon)) return { valid: false, reason: 'decision_horizon_invalid' };
    return { valid: true };
  } catch (_) { return { valid: false, reason: 'adapter_input_invalid' }; }
}

function validateMealEngineInput(input) {
  const snapshot = snapshotAdapterInput(input);
  return snapshot.valid ? validateSnapshot(snapshot.input) : snapshot;
}

function buildMealEngineInput(input) {
  try {
    const snapshot = snapshotAdapterInput(input);
    if (!snapshot.valid) return snapshot;
    const validation = validateSnapshot(snapshot.input);
    if (!validation.valid) return validation;
    const source = snapshot.input;
    if (!['immediate', 'upcoming_meal'].includes(source.decision_horizon)) return { valid: false, reason: 'decision_horizon_unsupported' };
    return freezeDeep({ valid: true, context: {
      available_foods: clone(source.available_foods), recently_consumed: clone(source.recently_consumed), appetite: source.appetite,
      confirmed_constraints: clone(source.confirmed_constraints), contextual_rejections: clone(source.contextual_rejections),
      locale: source.locale, decision_horizon: source.decision_horizon,
    }, source });
  } catch (_) { return { valid: false, reason: 'adapter_input_invalid' }; }
}

function buildRecommendationContract({ input, engineInput, engineOutput, engineApi = frozenEngine }) {
  try {
    if (!safeEngineValue(engineOutput) || !safePlainObject(engineOutput)) return integrationFailure('engine_output_malformed');
    if (engineOutput.status === 'needs_clarification') {
      if (!CLARIFICATION_REASONS.has(engineOutput.reason)) return integrationFailure('engine_output_malformed');
      return freezeDeep({ status: 'needs_clarification', clarification: { reason_code: engineOutput.reason }, source: 'meal_recommendation_engine_v1_3' });
    }
    if (engineOutput.status !== 'recommendation' || !safePlainObject(engineOutput.candidate, false)) return integrationFailure('engine_output_malformed');
    const candidate = clone(engineOutput.candidate);
    if (typeof candidate.archetype !== 'string' || typeof candidate.name !== 'string' || !candidate.name || !Array.isArray(candidate.ingredients) || !candidate.ingredients.every(isCanonicalFoodId) || typeof engineOutput.portion_strategy !== 'string') return integrationFailure('engine_output_malformed');
    const available = new Set(input.available_foods.map(value => value.food_id));
    if (!candidate.ingredients.every(id => available.has(id))) return integrationFailure('selected_food_not_grounded');
    const constraints = new Set(input.confirmed_constraints);
    const rejections = new Set(input.contextual_rejections.map(value => value.food_id));
    if (candidate.ingredients.some(id => [...constraints].some(blocked => engineApi.ancestors(id).has(blocked)))) return integrationFailure('confirmed_constraint_violated');
    if (candidate.ingredients.some(id => [...rejections].some(blocked => engineApi.ancestors(id).has(blocked)))) return integrationFailure('contextual_rejection_violated');
    if (!engineApi.validateCandidate(candidate, engineInput)?.valid || !engineApi.validateRenderedCandidate(candidate)?.valid) return integrationFailure('engine_validation_failed');
    return freezeDeep({
      status: 'recommendation',
      recommendation: { archetype: candidate.archetype, grounded_food_ids: clone(candidate.ingredients), visible_name: candidate.name, appetite_strategy: engineOutput.portion_strategy },
      grounding: { available_food_ids: input.available_foods.map(value => value.food_id), confirmed_constraints: clone(input.confirmed_constraints), contextual_rejections: clone(input.contextual_rejections) },
      source: 'meal_recommendation_engine_v1_3',
    });
  } catch (_) { return integrationFailure('engine_output_malformed'); }
}

function runMealRecommendation(input, engineApi = frozenEngine) {
  try {
    const built = buildMealEngineInput(input);
    if (!built.valid) return integrationFailure(built.reason);
    let engineOutput;
    try { engineOutput = engineApi.recommend(built.context); } catch (_) { return integrationFailure('engine_exception'); }
    return buildRecommendationContract({ input: built.source, engineInput: built.context, engineOutput, engineApi });
  } catch (_) { return integrationFailure('adapter_input_invalid'); }
}

module.exports = Object.freeze({ validateMealEngineInput, buildMealEngineInput, buildRecommendationContract, runMealRecommendation });
