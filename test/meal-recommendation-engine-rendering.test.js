'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const engine = require('../lib/meal-recommendation-engine');

function cooked(food_id) {
  return { food_id, state: { cooked: true } };
}

function candidateFor(archetype, available_foods, decision_horizon = 'immediate') {
  const row = engine.inspectCandidates({ available_foods, decision_horizon })
    .find(item => item.candidate.archetype === archetype && !item.failure);
  assert.ok(row, `expected a valid ${archetype} candidate`);
  return row.candidate;
}

function generatedCandidateFor(archetype, available_foods, decision_horizon = 'immediate', predicate = () => true) {
  const row = engine.inspectCandidates({ available_foods, decision_horizon })
    .find(item => item.candidate.archetype === archetype && predicate(item.candidate));
  assert.ok(row, `expected a generated ${archetype} candidate`);
  return row.candidate;
}

test('rendering references are structural, so bread and broccoli do not create substring false positives', () => {
  const toast = candidateFor('toast', ['whole_grain_bread', 'egg']);
  assert.equal(toast.name, 'pan integral tostado con huevo');
  assert.deepEqual(engine.renderedFoodIds(toast), ['whole_grain_bread', 'egg']);
  assert.equal(engine.validateRenderedCandidate(toast).valid, true);

  const eggs = generatedCandidateFor('scrambled_eggs', ['egg', 'broccoli'], 'immediate', candidate => candidate.ingredients.includes('broccoli'));
  assert.equal(eggs.name, 'huevos revueltos con brócoli');
  assert.equal(engine.renderedFoodIds(eggs).includes('cabbage'), false);
  assert.equal(engine.validateRenderedCandidate(eggs).valid, true);
});

test('opaque prepared dishes remain one atomic rendered reference', () => {
  const mole = candidateFor('prepared_dish_complement', ['chicken_with_mole']);
  assert.equal(mole.name, 'pollo con mole');
  assert.deepEqual(mole.rendering, { template: 'prepared_dish_complement', bindings: [], parts: [{ type: 'food', food_id: 'chicken_with_mole', text: 'pollo con mole', atomic: true }], text: 'pollo con mole' });
  assert.equal(engine.renderedFoodIds(mole).includes('chicken'), false);
  assert.equal(engine.validateRenderedCandidate(mole).valid, true);
});

function withRendering(candidate, parts, template = candidate.archetype) {
  const text = parts.map(part => part.text).join('');
  return { ...candidate, name: text, rendering: { template, parts, text } };
}

test('closed archetype grammars reject all nine rendering-integrity attacks through the production hard-validation path', () => {
  const taco = candidateFor('taco', ['corn_tortilla', 'egg']);
  const reject = candidate => assert.deepEqual(engine.validateCandidate(candidate, { available_foods: ['corn_tortilla', 'egg'] }), { valid: false, failure: 'rendered_output_not_grounded' });

  // 1. arbitrary literal food suffix
  reject(withRendering(taco, [...taco.rendering.parts, { type: 'literal', text: ' con aguacate' }]));
  // 2. grounded food replaced by arbitrary food-bearing literal
  reject(withRendering(taco, [{ type: 'literal', text: 'taco de pollo' }]));
  // Food identity remains independently checked even inside a valid shape.
  reject(withRendering(taco, taco.rendering.parts.map(part => part.type === 'food' ? { ...part, text: 'pollo' } : part)));
  // 5. ordinary food cannot gain caller-controlled atomicity
  reject(withRendering(taco, taco.rendering.parts.map(part => part.type === 'food' ? { ...part, atomic: true } : part)));
  // 6. selected archetype cannot use another archetype's template
  reject(withRendering(taco, taco.rendering.parts, 'oatmeal'));
  // 7. an undeclared extra binding cannot be appended
  reject(withRendering(taco, [...taco.rendering.parts, { type: 'food', food_id: 'avocado', text: 'aguacate', atomic: false }]));
  // 9. grammar part order is closed to the selected archetype
  reject(withRendering(taco, [...taco.rendering.parts].reverse()));

  const mole = candidateFor('prepared_dish_complement', ['chicken_with_mole']);
  const moleReject = candidate => assert.deepEqual(engine.validateCandidate(candidate, { available_foods: ['chicken_with_mole'] }), { valid: false, failure: 'rendered_output_not_grounded' });
  // 3. atomic opaque dish cannot acquire an arbitrary literal suffix
  const appendedToAtomicDish = withRendering(mole, [...mole.rendering.parts, { type: 'literal', text: ' con aguacate' }]);
  // 4. prepared dish atomicity is derived by the renderer, not trusted
  const nonAtomicMole = withRendering(mole, mole.rendering.parts.map(part => part.type === 'food' ? { ...part, atomic: false } : part));
  moleReject(appendedToAtomicDish);
  moleReject(nonAtomicMole);

  const chilaquiles = candidateFor('chilaquiles', ['tostada', 'green_salsa', 'fresh_cheese']);
  // 8. a named dish cannot omit a required defining rendering binding.
  assert.deepEqual(engine.validateCandidate(withRendering(chilaquiles, chilaquiles.rendering.parts.filter(part => part.food_id !== 'fresh_cheese')), { available_foods: ['tostada', 'green_salsa', 'fresh_cheese'] }), { valid: false, failure: 'rendered_output_not_grounded' });
});

test('direct mutation of either cached visible field cannot survive reconstruction validation', () => {
  const taco = candidateFor('taco', ['corn_tortilla', 'egg']);
  assert.equal(engine.validateCandidate({ ...taco, name: 'taco de huevo con aguacate' }, { available_foods: ['corn_tortilla', 'egg'] }).failure, 'rendered_output_not_grounded');
  assert.equal(engine.validateCandidate({ ...taco, rendering: { ...taco.rendering, text: 'taco de huevo con aguacate' } }, { available_foods: ['corn_tortilla', 'egg'] }).failure, 'rendered_output_not_grounded');
});

test('chilaquiles use their archetype-owned name while retaining visible defining components', () => {
  const chilaquiles = candidateFor('chilaquiles', ['tostada', 'green_salsa', 'fresh_cheese']);
  assert.equal(chilaquiles.name, 'chilaquiles con salsa verde y queso fresco');
  assert.deepEqual(engine.renderedFoodIds(chilaquiles), ['green_salsa', 'fresh_cheese']);
  assert.equal(engine.validateRenderedCandidate(chilaquiles).valid, true);
});

test('each active archetype produces a candidate whose renderer passes the production grounding invariant', () => {
  const examples = [
    ['taco', ['corn_tortilla', cooked('turkey')]],
    ['quesadilla', ['corn_tortilla', 'oaxaca_cheese', 'mushrooms']],
    ['tostada', ['tostada', 'canned_tuna']],
    ['flauta', ['flautas']],
    ['chilaquiles', ['tostada', 'green_salsa', 'fresh_cheese']],
    ['scrambled_eggs', ['egg']],
    ['huevos_a_la_mexicana', ['egg', 'red_tomato', 'onion']],
    ['omelette', ['egg', 'mushrooms', 'panela_cheese']],
    ['egg_plate', ['corn_tortilla', cooked('turkey')]],
    ['sandwich', ['bread', 'canned_tuna']],
    ['toast', ['whole_grain_bread', 'egg']],
    ['mollete', ['bolillo', { food_id: 'common_beans', state: { cooked: true } }, 'fresh_cheese']],
    ['plato_casero', [cooked('turkey'), { food_id: 'rice', state: { cooked: true } }, 'zucchini']],
    ['rice_bowl', [{ food_id: 'rice', state: { cooked: true } }, cooked('turkey'), 'zucchini']],
    ['complete_salad', ['lettuce', 'cucumber', 'canned_tuna']],
    ['warm_vegetable_plate', ['panela_cheese', 'zucchini']],
    ['beans_with_accompaniment', [{ food_id: 'common_beans', state: { cooked: true } }, 'corn_tortilla']],
    ['lentil_preparation', [{ food_id: 'lentils', state: { cooked: true } }, 'carrot']],
    ['yogurt_bowl', ['greek_yogurt', 'strawberry', 'walnuts']],
    ['oatmeal', ['oats', 'banana', 'milk'], 'upcoming_meal'],
    ['licuado', ['milk', 'banana']],
    ['soup_complement', ['vegetable_soup', cooked('turkey'), 'corn_tortilla']],
    ['prepared_dish_complement', ['pozole']],
  ];

  assert.equal(examples.length, engine.ARCHETYPES.length);
  for (const [archetype, available_foods, decision_horizon] of examples) {
    const candidate = generatedCandidateFor(archetype, available_foods, decision_horizon);
    assert.equal(candidate.name, candidate.rendering.parts.map(part => part.text).join(''), archetype);
    assert.equal(candidate.rendering.text, candidate.name, archetype);
    assert.equal(engine.validateRenderedCandidate(candidate).valid, true, archetype);
    assert.deepEqual(engine.validateCandidate(candidate, { available_foods, decision_horizon }).failure, null, archetype);
  }
});
