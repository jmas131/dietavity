'use strict';

// This module deliberately accepts untrusted candidate data but only emits text
// assembled from a trusted request-local context and closed policy vocabularies.
const SCOPES = new Set(['constrained', 'broad', 'none', 'unknown']);
const ACTIONS = new Set(['cook', 'saute', 'mix', 'heat', 'serve', 'combine']);
const PORTIONS = new Set(['small', 'normal']);
const PANTRY = Object.freeze({ water: 'agua', salt: 'sal', cooking_oil: 'un poco de aceite' });
const PANTRY_ACTIONS = Object.freeze({
  water: new Set(['cook']), salt: new Set(['cook', 'saute', 'mix', 'combine']), cooking_oil: new Set(['cook', 'saute']),
});
const PROTEINS = new Set(['ground_meat', 'chicken', 'turkey', 'tuna', 'fish', 'salmon', 'egg', 'common_beans', 'yogurt', 'cheese']);
const PLANTS = new Set(['vegetables', 'broccoli', 'zucchini', 'carrot', 'asparagus', 'fruit', 'strawberry', 'nopal']);
const ENERGY = new Set(['rice', 'corn_tortilla', 'bread', 'potato']);
const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function plain(value) {
  return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
function array(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length || Object.keys(value).length !== value.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !OWN(descriptor, 'value') || !descriptor.enumerable) return false;
  }
  return true;
}
function closed(value, keys) {
  if (!plain(value) || Object.getOwnPropertySymbols(value).length) return false;
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value));
  return entries.every(([key, descriptor]) => keys.has(key) && OWN(descriptor, 'value') && descriptor.enumerable);
}
function normalized(value) { return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es-MX').trim(); }
function refId(prefix, index) { return `${prefix}-${index + 1}`; }

function buildTrustedRecommendationContext({ availability, appetite = 'unknown', recently_consumed = [], eligible = true, restrictions = [] } = {}) {
  if (!plain(availability) || !SCOPES.has(availability.scope) || !array(availability.confirmed_foods || []) || !array(availability.underspecified_groups || []) || !array(availability.currently_unavailable_foods || [])) throw new TypeError('TRUSTED_AVAILABILITY_INVALID');
  if (!array(recently_consumed) || !array(restrictions) || !['low', 'unknown', 'normal'].includes(appetite) || typeof eligible !== 'boolean') throw new TypeError('TRUSTED_RECOMMENDATION_CONTEXT_INVALID');
  const make = (value, id, kind) => {
    if (!plain(value) || typeof value.surface !== 'string' || !value.surface.trim() || value.surface.length > 80 || (value.concept != null && (typeof value.concept !== 'string' || value.concept.length > 60))) throw new TypeError('TRUSTED_FOOD_REFERENCE_INVALID');
    return Object.freeze({ id, kind, surface: value.surface.trim(), concept: value.concept || null });
  };
  const foods = availability.confirmed_foods.map((value, index) => make(value, refId('food', index), 'food'));
  const groups = availability.underspecified_groups.map((value, index) => make(value, refId('group', index), 'group'));
  const unavailable = availability.currently_unavailable_foods.map((value, index) => make(value, refId('unavailable', index), 'unavailable'));
  return Object.freeze({
    scope: availability.scope,
    eligible,
    appetite,
    recently_consumed: Object.freeze(recently_consumed.map(normalized).filter(Boolean)),
    restrictions: Object.freeze(restrictions.map(normalized).filter(Boolean)),
    references: Object.freeze([...foods, ...groups]),
    unavailable: Object.freeze(unavailable),
  });
}

function validSelectedFood(value, index) {
  if (!closed(value, new Set(['id', 'label'])) || typeof value.id !== 'string' || value.id !== refId('selected', index) || typeof value.label !== 'string') return null;
  const label = value.label.trim();
  // Food labels are deliberately much narrower than customer prose.
  if (!/^[\p{L}][\p{L} -]{0,39}$/u.test(label)) return null;
  if (/^(agrega|anade|añade|cocina|saltea|mezcla|calienta|sirve|combina)\b/iu.test(label)) return null;
  if (/(calori|kcal|gramo|\bmg\b|dosis|medic|ozempic|mounjaro|insulina|cura|trat|baja de peso|proteina|saludable|ideal|https?|\bwww\b|\bcom\b)/iu.test(label)) return null;
  return Object.freeze({ id: value.id, kind: 'selected', surface: label, concept: null });
}

function validateCandidateContract(candidate, context) {
  if (!plain(context) || !SCOPES.has(context.scope) || context.eligible !== true || context.scope === 'none' || context.scope === 'unknown') return { valid: false, reason: 'recommendation_ineligible' };
  if (!closed(candidate, new Set(['required_refs', 'selected_foods', 'pantry_ids', 'actions', 'portion']))) return { valid: false, reason: 'candidate_shape_invalid' };
  if (!PORTIONS.has(candidate.portion) || !array(candidate.pantry_ids) || candidate.pantry_ids.length > 3 || !candidate.pantry_ids.every(id => typeof id === 'string' && OWN(PANTRY, id)) || new Set(candidate.pantry_ids).size !== candidate.pantry_ids.length) return { valid: false, reason: 'pantry_invalid' };
  if (!array(candidate.actions) || candidate.actions.length < 1 || candidate.actions.length > 3) return { valid: false, reason: 'actions_invalid' };
  let refs;
  if (context.scope === 'constrained') {
    if (!array(candidate.required_refs) || candidate.required_refs.length < 1 || candidate.required_refs.length > 4 || new Set(candidate.required_refs).size !== candidate.required_refs.length || !candidate.required_refs.every(value => typeof value === 'string') || candidate.selected_foods !== undefined) return { valid: false, reason: 'required_refs_invalid' };
    const index = new Map(context.references.map(value => [value.id, value]));
    refs = candidate.required_refs.map(id => index.get(id));
    if (refs.some(value => !value)) return { valid: false, reason: 'required_ref_untrusted' };
  } else {
    if (candidate.required_refs !== undefined || !array(candidate.selected_foods) || candidate.selected_foods.length < 1 || candidate.selected_foods.length > 4) return { valid: false, reason: 'broad_foods_invalid' };
    refs = candidate.selected_foods.map(validSelectedFood);
    if (refs.some(value => !value) || new Set(refs.map(value => normalized(value.surface))).size !== refs.length) return { valid: false, reason: 'broad_foods_invalid' };
  }
  const allowedValues = [...refs, ...candidate.pantry_ids.map(id => Object.freeze({ id, kind: 'pantry', surface: PANTRY[id], concept: id }))];
  const allowedRefs = new Map(allowedValues.map(value => [value.id, value]));
  const actions = [];
  for (const action of candidate.actions) {
    if (!closed(action, new Set(['kind', 'refs'])) || !ACTIONS.has(action.kind) || !array(action.refs) || action.refs.length < 1 || action.refs.length > 4 || new Set(action.refs).size !== action.refs.length || !action.refs.every(id => typeof id === 'string' && allowedRefs.has(id))) return { valid: false, reason: 'action_invalid' };
    if (action.refs.some(id => OWN(PANTRY, id) && !PANTRY_ACTIONS[id].has(action.kind))) return { valid: false, reason: 'pantry_action_invalid' };
    actions.push(Object.freeze({ kind: action.kind, refs: Object.freeze([...action.refs]) }));
  }
  const restricted = new Set(context.restrictions);
  if (refs.some(value => restricted.has(normalized(value.concept)) || restricted.has(normalized(value.surface)))) return { valid: false, reason: 'trusted_restriction_violated' };
  const unavailable = new Set(context.unavailable.flatMap(value => [normalized(value.concept), normalized(value.surface)]));
  if (refs.some(value => unavailable.has(normalized(value.concept)) || unavailable.has(normalized(value.surface)))) return { valid: false, reason: 'currently_unavailable_food' };
  return Object.freeze({ valid: true, candidate: Object.freeze({ refs: Object.freeze(refs), pantry_ids: Object.freeze([...candidate.pantry_ids]), actions: Object.freeze(actions), portion: candidate.portion }) });
}

function validateCandidateBatch(payload, context) {
  if (!closed(payload, new Set(['candidates'])) || !array(payload.candidates) || payload.candidates.length > 2) return Object.freeze({ valid: false, reason: 'batch_invalid', candidates: Object.freeze([]) });
  const candidates = payload.candidates.map(value => validateCandidateContract(value, context));
  return Object.freeze({ valid: true, candidates: Object.freeze(candidates) });
}

function candidateScore(validated, context) {
  const candidate = validated.candidate;
  let score = candidate.refs.length * 10 - candidate.actions.length * 2 - candidate.pantry_ids.length * 2;
  const concepts = candidate.refs.map(ref => normalized(ref.concept));
  if (concepts.some(value => PROTEINS.has(value))) score += 6;
  if (concepts.some(value => PLANTS.has(value))) score += 3;
  if (concepts.some(value => ENERGY.has(value))) score += 2;
  if (context.appetite === 'low' && candidate.portion === 'small') score += 6;
  if (context.appetite === 'low' && candidate.portion === 'normal') score -= 2;
  const primaryProtein = concepts.find(value => PROTEINS.has(value));
  if (primaryProtein && context.recently_consumed.includes(primaryProtein)) score -= 8;
  return score;
}

function rankCandidates(batch, context) {
  if (!batch?.valid || !plain(context)) return Object.freeze([]);
  return Object.freeze(batch.candidates.filter(item => item.valid).map((item, index) => Object.freeze({ ...item, score: candidateScore(item, context), ordinal: index })).sort((a, b) => b.score - a.score || a.ordinal - b.ordinal));
}

function joinSpanish(values) {
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} y ${values[1]}`;
  return `${values.slice(0, -1).join(', ')} y ${values.at(-1)}`;
}
function renderRef(ref) { return ref.kind === 'group' ? `las ${ref.surface} que tengas` : ref.surface; }
const VERBS = Object.freeze({ cook: 'Cocina', saute: 'Saltea', mix: 'Mezcla', heat: 'Calienta', serve: 'Sirve', combine: 'Combina' });

function serializeCandidate(ranked, context) {
  if (!ranked?.valid || !plain(context)) return null;
  const candidate = ranked.candidate;
  const lookup = new Map([...candidate.refs, ...candidate.pantry_ids.map(id => ({ id, kind: 'pantry', surface: PANTRY[id] }))].map(value => [value.id, value]));
  const recommendation = `Te recomiendo preparar ${joinSpanish(candidate.refs.map(renderRef))}.`;
  const preparation = candidate.actions.map(action => `${VERBS[action.kind]} ${joinSpanish(action.refs.map(id => renderRef(lookup.get(id))) )}.`).join(' ');
  const appetite = context.appetite === 'low' ? ' Empieza con una porción pequeña y come despacio.' : '';
  return `${recommendation} ${preparation}${appetite}`.trim();
}

function selectRecommendation(payload, context) {
  const batch = validateCandidateBatch(payload, context);
  const ranked = rankCandidates(batch, context);
  const winner = ranked[0] || null;
  return Object.freeze({ batch, ranked, winner, claim: winner ? serializeCandidate(winner, context) : null });
}

module.exports = Object.freeze({ buildTrustedRecommendationContext, validateCandidateContract, validateCandidateBatch, rankCandidates, serializeCandidate, selectRecommendation, PANTRY: Object.freeze({ ...PANTRY }) });
