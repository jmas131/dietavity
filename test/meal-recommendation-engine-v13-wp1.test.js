'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const engine = require('../lib/meal-recommendation-engine');

function recommend(available_foods, extra = {}) {
  return engine.recommend({
    available_foods,
    appetite: 'normal',
    decision_horizon: 'immediate',
    locale: 'es-MX',
    recently_consumed: [],
    confirmed_constraints: [],
    contextual_rejections: [],
    ...extra,
  });
}

test('WP1 recognizes unseen limited but sufficient savory meals in normal context', () => {
  const dairySandwich = recommend(['bread', 'oaxaca_cheese', 'cucumber']);
  assert.equal(dairySandwich.status, 'recommendation');
  assert.equal(dairySandwich.candidate.archetype, 'sandwich');
  assert.ok(dairySandwich.candidate.ingredients.includes('oaxaca_cheese'));

  const cottageTaco = recommend(['corn_tortilla', 'cottage_cheese', 'nopal']);
  assert.equal(cottageTaco.status, 'recommendation');
  assert.equal(cottageTaco.candidate.archetype, 'taco');
  assert.ok(cottageTaco.candidate.ingredients.includes('cottage_cheese'));
});

test('WP1 permits coherent yogurt-and-fruit light meals when appetite is low', () => {
  const mango = recommend(['plain_yogurt', 'mango'], { appetite: 'low' });
  const berries = recommend(['plain_yogurt', 'berries', 'sesame'], { appetite: 'low' });
  const greek = recommend(['greek_yogurt', 'papaya'], { appetite: 'low' });
  for (const result of [mango, berries, greek]) {
    assert.equal(result.status, 'recommendation');
    assert.equal(result.candidate.archetype, 'yogurt_bowl');
    assert.equal(result.portion_strategy, 'start_small');
  }
});

test('WP1 makes normal yogurt bowls viable only with a visible energy accompaniment', () => {
  const tooLight = recommend(['plain_yogurt', 'pear']);
  assert.equal(tooLight.status, 'needs_clarification');

  const withBread = recommend(['plain_yogurt', 'pear', 'bread']);
  assert.equal(withBread.status, 'recommendation');
  assert.equal(withBread.candidate.archetype, 'yogurt_bowl');
  assert.match(withBread.candidate.name, /acompañado de pan$/);
  assert.ok(engine.renderedFoodIds(withBread.candidate).includes('bread'));
  assert.ok(withBread.candidate.rendering.parts.some(part => part.type === 'food' && part.food_id === 'bread'));

  const withWholeGrainBread = recommend(['plain_yogurt', 'pear', 'whole_grain_bread']);
  assert.equal(withWholeGrainBread.status, 'recommendation');
  assert.match(withWholeGrainBread.candidate.name, /acompañado de pan integral$/);
  assert.ok(engine.renderedFoodIds(withWholeGrainBread.candidate).includes('whole_grain_bread'));
  assert.ok(withWholeGrainBread.candidate.rendering.parts.some(part => part.type === 'food' && part.food_id === 'whole_grain_bread'));
});

test('WP1 does not let either yogurt type satisfy high hunger as a light bowl', () => {
  for (const foods of [['plain_yogurt', 'banana'], ['greek_yogurt', 'banana']]) {
    const result = recommend(foods, { appetite: 'high' });
    assert.equal(result.status, 'needs_clarification');
  }

  const substantial = recommend(['greek_yogurt', 'banana', 'walnuts', 'whole_grain_bread'], { appetite: 'high' });
  assert.equal(substantial.status, 'recommendation');
  assert.equal(substantial.candidate.archetype, 'yogurt_bowl');
  assert.ok(engine.renderedFoodIds(substantial.candidate).includes('whole_grain_bread'));
});

test('WP1 preserves clarification for genuinely insufficient inventories', () => {
  assert.equal(recommend(['flour_tortilla', 'green_salsa', 'avocado']).status, 'needs_clarification');
  assert.equal(recommend(['bread', 'mustard', 'ketchup']).status, 'needs_clarification');
  assert.equal(recommend(['cucumber', 'lime', 'red_salsa']).status, 'needs_clarification');
});

test('WP1 does not prefer a light meal over a stronger ordinary meal in rich inventory', () => {
  const plate = recommend([
    { food_id: 'chicken', state: { cooked: true } },
    { food_id: 'rice', state: { cooked: true } },
    'broccoli', 'plain_yogurt', 'mango', 'almonds',
  ]);
  assert.equal(plate.status, 'recommendation');
  assert.equal(plate.candidate.archetype, 'plato_casero');

  const tostada = recommend(['canned_tuna', 'tostada', 'avocado', 'plain_yogurt', 'banana', 'walnuts']);
  assert.equal(tostada.status, 'recommendation');
  assert.equal(tostada.candidate.archetype, 'tostada');
});

test('WP1 coverage preserves restrictions and contextual rejection', () => {
  const restricted = recommend(['bread', 'oaxaca_cheese', 'cucumber'], { confirmed_constraints: ['oaxaca_cheese'] });
  assert.equal(restricted.status, 'needs_clarification');

  const rejected = recommend(['corn_tortilla', 'cottage_cheese', 'nopal'], { contextual_rejections: [{ scope: 'food', food_id: 'cottage_cheese' }] });
  assert.equal(rejected.status, 'needs_clarification');
});
