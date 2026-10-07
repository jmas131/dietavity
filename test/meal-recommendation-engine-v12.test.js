'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../lib/meal-recommendation-engine');

const cooked = new Set(['chicken', 'chicken_breast', 'ground_beef', 'shredded_beef', 'white_fish', 'salmon', 'shrimp', 'turkey', 'rice', 'brown_rice', 'common_beans', 'black_beans', 'lentils', 'chickpeas', 'zucchini', 'broccoli', 'mushrooms']);
function context(ids, extra = {}) { return { decision_horizon: 'immediate', available_foods: ids.map(food_id => ({ food_id, state: cooked.has(food_id) ? { cooked: true, readiness: 'ready_to_eat' } : {} })), ...extra }; }
function run(ids, extra) { return engine.recommend(context(ids, extra)); }

test('V1.2 archetype schema is executable and declarative', () => {
  assert.equal(engine.ARCHETYPES.length, 23);
  for (const spec of engine.ARCHETYPES) {
    assert.ok(['construct', 'complement', 'fallback'].includes(spec.mode), spec.id);
    assert.ok(Array.isArray(spec.slots) && spec.slots.length, spec.id);
    assert.ok(spec.profile, spec.id);
  }
  const mollete = engine.ARCHETYPES.find(spec => spec.id === 'mollete');
  assert.deepEqual(mollete.slots.filter(slot => slot.required).map(slot => slot.name), ['base', 'beans', 'cheese']);
});

test('V1.2 generic resolver enforces required slots and bounds optional slots', () => {
  assert.equal(run(['corn_tortilla', 'avocado']).status, 'needs_clarification');
  const rich = run(['chicken', 'corn_tortilla', 'avocado', 'red_tomato', 'onion', 'green_salsa', 'mexican_cream', 'panela_cheese']);
  assert.ok(rich.candidate.ingredients.length <= 3, 'taco slots leave extra inventory unused');
  assert.ok(rich.candidate.ingredients.includes('green_salsa'));
});

test('V1.2 compatibility profiles reject role-valid culinary nonsense', () => {
  assert.equal(run(['apple', 'corn_tortilla']).status, 'needs_clarification');
  assert.equal(run(['greek_yogurt', 'green_salsa', 'walnuts']).status, 'needs_clarification');
  assert.equal(run(['oats', 'chicken'], { decision_horizon: 'upcoming_meal' }).status, 'needs_clarification');
  assert.equal(run(['mustard', 'ketchup', 'bread']).status, 'needs_clarification');
});

test('V1.2 generic slot resolution accepts unseen compatible fillings without special branches', () => {
  const turkeyTaco = run(['turkey', 'corn_tortilla', 'avocado']);
  assert.equal(turkeyTaco.candidate.archetype, 'taco');
  assert.ok(turkeyTaco.candidate.ingredients.includes('turkey'));
  const fishTostada = run(['white_fish', 'tostada', 'avocado']);
  assert.equal(fishTostada.candidate.archetype, 'tostada');
  assert.ok(fishTostada.candidate.ingredients.includes('white_fish'));
  const beefRice = run(['ground_beef', 'brown_rice', 'green_beans']);
  assert.equal(beefRice.candidate.archetype, 'plato_casero');
  assert.ok(beefRice.candidate.ingredients.includes('ground_beef'));
});

test('V1.2 retains explicit transformation and prepared-dish boundaries', () => {
  assert.equal(run(['rice', 'turkey', 'zucchini'], { available_foods: [{ food_id: 'rice', state: {} }, { food_id: 'turkey', state: { cooked: true } }, { food_id: 'zucchini', state: { cooked: true } }] }).status, 'needs_clarification');
  const upcoming = run(['turkey', 'corn_tortilla'], { decision_horizon: 'upcoming_meal', available_foods: [{ food_id: 'turkey', state: {} }, { food_id: 'corn_tortilla', state: {} }] });
  assert.ok(upcoming.candidate.transformations.includes('cook_main'));
  const prepared = run(['cochinita_pibil', 'corn_tortilla']);
  assert.ok(prepared.candidate.ingredients.includes('cochinita_pibil'));
  assert.equal(prepared.candidate.ingredients.includes('pork'), false);
});

test('V1.2 corrects the chile hierarchy explicitly', () => {
  assert.ok(engine.ancestors('serrano_chile').has('fresh_chile'));
  assert.ok(engine.ancestors('ancho_chile').has('dried_chile'));
  assert.equal(engine.ancestors('ancho_chile').has('fresh_chile'), false);
  assert.ok(engine.ancestors('pickled_chile').has('chile'));
  assert.equal(engine.ancestors('pickled_chile').has('fresh_chile'), false);
});

test('V1.2 validates rendered names independently from candidate construction', () => {
  const candidate = run(['chicken', 'corn_tortilla', 'green_salsa']).candidate;
  assert.equal(engine.validateRenderedCandidate(candidate).valid, true);
  assert.equal(engine.validateRenderedCandidate({ ...candidate, name: `${candidate.name} con aguacate` }).valid, false);
});

test('V1.2 is order independent across representative generalized grammars', () => {
  const inventories = [
    ['turkey', 'corn_tortilla', 'avocado'],
    ['egg', 'red_tomato', 'onion', 'serrano_chile', 'corn_tortilla'],
    ['chicken', 'canned_tuna', 'common_beans', 'rice', 'corn_tortilla', 'bolillo', 'fresh_cheese', 'avocado', 'broccoli'],
    ['cochinita_pibil', 'corn_tortilla', 'pickled_chile'],
    ['white_fish', 'tostada', 'avocado', 'cucumber'],
  ];
  for (const ids of inventories) {
    const forward = run(ids);
    const reverse = run([...ids].reverse());
    assert.deepEqual(reverse, forward, ids.join(','));
  }
});
