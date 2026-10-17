'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../lib/recommendation-candidate-policy');

function availability({ foods = [], groups = [], unavailable = [], scope = 'constrained' } = {}) {
  return { scope, confirmed_foods: foods.map(value => typeof value === 'string' ? { surface: value, concept: null } : value), underspecified_groups: groups.map(value => typeof value === 'string' ? { surface: value, concept: null } : value), currently_unavailable_foods: unavailable.map(value => typeof value === 'string' ? { surface: value, concept: null } : value) };
}
function context(options = {}) { return policy.buildTrustedRecommendationContext({ availability: availability(options), appetite: options.appetite || 'unknown', recently_consumed: options.recently_consumed || [], eligible: options.eligible ?? true, restrictions: options.restrictions || [] }); }
function constrained(required_refs, overrides = {}) { return { required_refs, pantry_ids: [], actions: [{ kind: 'cook', refs: [required_refs[0]] }], portion: 'normal', ...overrides }; }
function broad(selected_foods, overrides = {}) { return { selected_foods, pantry_ids: [], actions: [{ kind: 'cook', refs: [selected_foods[0].id] }], portion: 'normal', ...overrides }; }
function select(value, trusted) { return policy.selectRecommendation({ candidates: [value] }, trusted); }

test('acceptance A: grounded ground meat and generic vegetables serialize without fabricating a vegetable', () => {
  const trusted = context({ foods: [{ surface: 'carne molida', concept: 'ground_meat' }], groups: [{ surface: 'verduras', concept: 'vegetables' }] });
  const result = select(constrained(['food-1', 'group-1'], { pantry_ids: ['cooking_oil'], actions: [{ kind: 'cook', refs: ['food-1'] }, { kind: 'saute', refs: ['food-1', 'group-1', 'cooking_oil'] }] }), trusted);
  assert.equal(result.winner.valid, true);
  assert.equal(result.claim, 'Te recomiendo preparar carne molida y las verduras que tengas. Cocina carne molida. Saltea carne molida, las verduras que tengas y un poco de aceite.');
  assert.doesNotMatch(result.claim, /zanahoria|papa|chícharo/u);
});

test('acceptance B and M: unknown but authoritative food spans remain valid without nutrition bonuses', () => {
  const salmon = context({ foods: [{ surface: 'salmón', concept: null }, { surface: 'espárragos', concept: null }] });
  const yogurt = context({ foods: [{ surface: 'yogur', concept: null }, { surface: 'fresas', concept: null }, { surface: 'nueces', concept: null }] });
  const salmonResult = select(constrained(['food-1', 'food-2'], { actions: [{ kind: 'saute', refs: ['food-1', 'food-2'] }] }), salmon);
  const yogurtResult = select(constrained(['food-1', 'food-2', 'food-3'], { actions: [{ kind: 'mix', refs: ['food-1', 'food-2', 'food-3'] }] }), yogurt);
  assert.equal(salmonResult.claim, 'Te recomiendo preparar salmón y espárragos. Saltea salmón y espárragos.');
  assert.equal(yogurtResult.claim, 'Te recomiendo preparar yogur, fresas y nueces. Mezcla yogur, fresas y nueces.');
  assert.equal(salmonResult.winner.score, 18);
});

test('acceptance C through I serialize deterministic, grounded preparations', () => {
  const cases = [
    [{ foods: [{ surface: 'huevos', concept: 'egg' }] }, constrained(['food-1']), 'Te recomiendo preparar huevos. Cocina huevos.'],
    [{ foods: [{ surface: 'arroz', concept: 'rice' }], groups: [{ surface: 'verduras', concept: 'vegetables' }] }, constrained(['food-1', 'group-1'], { actions: [{ kind: 'combine', refs: ['food-1', 'group-1'] }] }), 'Te recomiendo preparar arroz y las verduras que tengas. Combina arroz y las verduras que tengas.'],
    [{ foods: [{ surface: 'atún', concept: 'tuna' }, { surface: 'jitomate', concept: 'red_tomato' }, { surface: 'tortillas', concept: 'corn_tortilla' }] }, constrained(['food-1', 'food-2', 'food-3'], { actions: [{ kind: 'mix', refs: ['food-1', 'food-2'] }, { kind: 'heat', refs: ['food-3'] }] }), 'Te recomiendo preparar atún, jitomate y tortillas. Mezcla atún y jitomate. Calienta tortillas.'],
    [{ foods: [{ surface: 'pollo', concept: 'chicken' }, { surface: 'aguacate', concept: 'avocado' }, { surface: 'tortillas', concept: 'corn_tortilla' }], appetite: 'low' }, constrained(['food-1', 'food-2', 'food-3'], { portion: 'small', actions: [{ kind: 'cook', refs: ['food-1'] }, { kind: 'serve', refs: ['food-1', 'food-2', 'food-3'] }] }), 'Te recomiendo preparar pollo, aguacate y tortillas. Cocina pollo. Sirve pollo, aguacate y tortillas. Empieza con una porción pequeña y come despacio.'],
    [{ foods: [{ surface: 'pollo', concept: 'chicken' }, { surface: 'frijoles', concept: 'common_beans' }, { surface: 'tortillas', concept: 'corn_tortilla' }], recently_consumed: ['chicken'] }, constrained(['food-2', 'food-3'], { actions: [{ kind: 'heat', refs: ['food-2', 'food-3'] }] }), 'Te recomiendo preparar frijoles y tortillas. Calienta frijoles y tortillas.'],
    [{ foods: [{ surface: 'pollo', concept: 'chicken' }, { surface: 'tortillas', concept: 'corn_tortilla' }], unavailable: [{ surface: 'aguacate', concept: 'avocado' }] }, constrained(['food-1', 'food-2'], { actions: [{ kind: 'cook', refs: ['food-1'] }, { kind: 'heat', refs: ['food-2'] }] }), 'Te recomiendo preparar pollo y tortillas. Cocina pollo. Calienta tortillas.'],
    [{ groups: [{ surface: 'verduras', concept: 'vegetables' }] }, constrained(['group-1'], { actions: [{ kind: 'saute', refs: ['group-1'] }] }), 'Te recomiendo preparar las verduras que tengas. Saltea las verduras que tengas.'],
  ];
  for (const [input, candidate, expected] of cases) assert.equal(select(candidate, context(input)).claim, expected);
});

test('acceptance J through L: broad is separately selected; none and unknown cannot recommend', () => {
  const broadContext = context({ scope: 'broad' });
  const broadCandidate = broad([{ id: 'selected-1', label: 'pollo' }, { id: 'selected-2', label: 'aguacate' }, { id: 'selected-3', label: 'tortillas' }], { actions: [{ kind: 'cook', refs: ['selected-1'] }, { kind: 'serve', refs: ['selected-1', 'selected-2', 'selected-3'] }] });
  assert.equal(select(broadCandidate, broadContext).claim, 'Te recomiendo preparar pollo, aguacate y tortillas. Cocina pollo. Sirve pollo, aguacate y tortillas.');
  for (const scope of ['none', 'unknown']) {
    const result = select(constrained(['food-1']), context({ scope, foods: [{ surface: 'huevos', concept: 'egg' }] }));
    assert.equal(result.claim, null);
    assert.equal(result.batch.candidates[0].reason, 'recommendation_ineligible');
  }
});

test('low appetite favors a small candidate and recent chicken is a ranking penalty rather than a prohibition', () => {
  const low = context({ foods: [{ surface: 'huevos', concept: 'egg' }], appetite: 'low' });
  const lowResult = policy.selectRecommendation({ candidates: [constrained(['food-1'], { portion: 'normal' }), constrained(['food-1'], { portion: 'small' })] }, low);
  assert.equal(lowResult.winner.ordinal, 1);
  const recent = context({ foods: [{ surface: 'pollo', concept: 'chicken' }, { surface: 'frijoles', concept: 'common_beans' }], recently_consumed: ['chicken'] });
  const chicken = constrained(['food-1']); const beans = constrained(['food-2']);
  const ranked = policy.selectRecommendation({ candidates: [chicken, beans] }, recent);
  assert.equal(ranked.winner.ordinal, 1);
  assert.equal(ranked.ranked.some(value => value.candidate.refs[0].concept === 'chicken'), true);
});

test('untrusted references, invented constrained foods, unavailable food, malformed candidates, and batch overflow fail closed', () => {
  const trusted = context({ foods: [{ surface: 'pollo', concept: 'chicken' }, { surface: 'tortillas', concept: 'corn_tortilla' }], unavailable: [{ surface: 'aguacate', concept: 'avocado' }] });
  const cases = [
    constrained(['food-9']),
    constrained(['food-1', 'avocado']),
    constrained(['unavailable-1']),
    { required_refs: ['food-1'], pantry_ids: [], actions: [], portion: 'normal' },
    { required_refs: ['food-1'], pantry_ids: [], actions: [{ kind: 'cook', refs: ['food-1'] }], portion: 'normal', customer_prose: 'haz cualquier cosa' },
  ];
  for (const candidate of cases) assert.equal(select(candidate, trusted).claim, null);
  const overflow = policy.selectRecommendation({ candidates: [constrained(['food-1']), constrained(['food-1']), constrained(['food-1'])] }, trusted);
  assert.equal(overflow.batch.valid, false);
});

test('accessors, symbols, sparse arrays, and custom prototypes cannot execute or enter the candidate contract', () => {
  const trusted = context({ foods: [{ surface: 'pollo', concept: 'chicken' }] });
  const accessor = constrained(['food-1']);
  Object.defineProperty(accessor, 'portion', { enumerable: true, get() { throw new Error('must not execute'); } });
  const sparse = constrained(['food-1']); sparse.actions = []; sparse.actions.length = 1;
  const symbol = constrained(['food-1']); symbol[Symbol('untrusted')] = true;
  const inherited = Object.create(constrained(['food-1']));
  for (const candidate of [accessor, sparse, symbol, inherited]) assert.equal(select(candidate, trusted).claim, null);
});

test('candidate has no name or prose channel for extra food, medical claims, calories, or arbitrary customer output', () => {
  const trusted = context({ foods: [{ surface: 'pollo', concept: 'chicken' }] });
  for (const key of ['name', 'instructions', 'reason', 'customer_prose']) {
    const candidate = constrained(['food-1']); candidate[key] = key === 'name' ? 'pollo con salmón ideal para Ozempic' : 'baja tu dosis y agrega queso';
    assert.equal(select(candidate, trusted).claim, null);
  }
  const valid = select(constrained(['food-1']), trusted);
  assert.equal(valid.claim, 'Te recomiendo preparar pollo. Cocina pollo.');
  assert.doesNotMatch(valid.claim, /salmón|calor|ozempic|dosis|queso/iu);
});

test('broad labels are bounded plain food labels and cannot smuggle instructions, medical content, URLs, controls, or quantities', () => {
  const trusted = context({ scope: 'broad' });
  const bad = ['agrega queso', 'ideal para Ozempic', '500 calorías', 'pollo https ejemplo com', 'pollo\nqueso', 'pollo\u0000'];
  for (const label of bad) assert.equal(select(broad([{ id: 'selected-1', label }]), trusted).claim, null, label);
  assert.equal(select(broad([{ id: 'selected-1', label: 'pechuga de pavo' }]), trusted).claim, 'Te recomiendo preparar pechuga de pavo. Cocina pechuga de pavo.');
  const unavailable = context({ scope: 'broad', unavailable: [{ surface: 'aguacate', concept: 'avocado' }] });
  assert.equal(select(broad([{ id: 'selected-1', label: 'aguacate' }]), unavailable).claim, null);
});

test('pantry and actions use only closed policy vocabularies and references', () => {
  const trusted = context({ foods: [{ surface: 'huevos', concept: 'egg' }] });
  const cases = [
    [constrained(['food-1'], { pantry_ids: ['onion'] }), 'pantry_invalid'],
    [constrained(['food-1'], { pantry_ids: ['water', 'salt', 'cooking_oil', 'garlic'] }), 'pantry_invalid'],
    [constrained(['food-1'], { actions: [{ kind: 'cook', refs: ['food-1'], extra: true }] }), 'action_unexpected_property'],
    [constrained(['food-1'], { actions: [{ kind: 'bake', refs: ['food-1'] }] }), 'action_kind_invalid'],
    [constrained(['food-1'], { actions: [{ kind: 'cook', refs: [] }] }), 'action_refs_shape_invalid'],
    [constrained(['food-1'], { actions: [{ kind: 'cook', refs: ['food-9'] }] }), 'action_ref_not_allowed'],
    [constrained(['food-1'], { actions: Array.from({ length: 4 }, () => ({ kind: 'cook', refs: ['food-1'] })) }), 'actions_invalid'],
    [constrained(['food-1'], { pantry_ids: ['cooking_oil'], actions: [{ kind: 'mix', refs: ['food-1', 'cooking_oil'] }] }), 'pantry_action_invalid'],
  ];
  for (const [candidate, reason] of cases) {
    const result = select(candidate, trusted);
    assert.equal(result.claim, null);
    assert.equal(result.batch.candidates[0].reason, reason);
  }
  const valid = select(constrained(['food-1'], { pantry_ids: ['cooking_oil'], actions: [{ kind: 'saute', refs: ['food-1', 'cooking_oil'] }] }), trusted);
  assert.equal(valid.claim, 'Te recomiendo preparar huevos. Saltea huevos y un poco de aceite.');
});

test('action structural diagnostics preserve closed-object rejection while accepting parsed JSON', () => {
  const trusted = context({ foods: [{ surface: 'salmón', concept: null }, { surface: 'espárragos', concept: null }] });
  const action = (value = {}) => ({ kind: 'saute', refs: ['food-1', 'food-2'], ...value });
  const accessor = action(); Object.defineProperty(accessor, 'kind', { enumerable: true, get() { return 'saute'; } });
  const nonEnumerable = action(); Object.defineProperty(nonEnumerable, 'kind', { enumerable: false, value: 'saute' });
  const symbol = action(); symbol[Symbol('untrusted')] = true;
  const inherited = Object.create({ inherited: true }); inherited.kind = 'saute'; inherited.refs = ['food-1', 'food-2'];
  const cases = [
    [action({ extra: true }), 'action_unexpected_property'],
    [accessor, 'action_accessor_property'],
    [nonEnumerable, 'action_non_enumerable_property'],
    [symbol, 'action_symbol_property'],
    [inherited, 'action_not_plain_object'],
  ];
  for (const [invalidAction, reason] of cases) {
    const result = select(constrained(['food-1', 'food-2'], { actions: [invalidAction] }), trusted);
    assert.equal(result.claim, null);
    assert.equal(result.batch.candidates[0].reason, reason);
  }
  const parsed = JSON.parse('{"candidates":[{"required_refs":["food-1","food-2"],"pantry_ids":[],"actions":[{"kind":"saute","refs":["food-1","food-2"]}],"portion":"normal"}]}');
  const selected = policy.selectRecommendation(parsed, trusted);
  assert.equal(selected.claim, 'Te recomiendo preparar salmón y espárragos. Saltea salmón y espárragos.');
});

test('trusted eligibility and supplied restrictions are respected without inventing current restriction support', () => {
  const blocked = context({ foods: [{ surface: 'huevos', concept: 'egg' }], eligible: false });
  assert.equal(select(constrained(['food-1']), blocked).claim, null);
  const restricted = context({ foods: [{ surface: 'huevos', concept: 'egg' }], restrictions: ['egg'] });
  const result = select(constrained(['food-1']), restricted);
  assert.equal(result.claim, null);
  assert.equal(result.batch.candidates[0].reason, 'trusted_restriction_violated');
});
