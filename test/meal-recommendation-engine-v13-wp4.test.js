'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const engine = require('../lib/meal-recommendation-engine');

const cookedIds = new Set(['chicken', 'common_beans', 'rice', 'broccoli', 'turkey']);
function context(ids, extra = {}) {
  return { decision_horizon: 'immediate', available_foods: ids.map(food_id => ({ food_id, state: cookedIds.has(food_id) ? { cooked: true, readiness: 'ready_to_eat' } : {} })), ...extra };
}
function candidateFor(archetype, ids, extra = {}) {
  const row = engine.inspectCandidates(context(ids, extra)).find(item => item.candidate.archetype === archetype && !item.failure);
  assert.ok(row, archetype);
  return row.candidate;
}
function generatedCandidateFor(archetype, ids, required, extra = {}) {
  const row = engine.inspectCandidates(context(ids, extra)).find(item => item.candidate.archetype === archetype && required.every(id => item.candidate.ingredients.includes(id)));
  assert.ok(row, `${archetype}: ${required.join(',')}`);
  return row.candidate;
}
function withRendering(candidate, parts) {
  const text = parts.map(part => part.text).join('');
  return { ...candidate, name: text, rendering: { template: candidate.archetype, parts, text } };
}

test('WP4 registers canned-tuna presentation only for its canonical food ID', () => {
  const tuna = candidateFor('tostada', ['canned_tuna', 'tostada', 'avocado']);
  assert.equal(tuna.name, 'tostada de atún con aguacate');
  assert.ok(tuna.ingredients.includes('canned_tuna'));
  assert.ok(tuna.rendering.parts.some(part => part.food_id === 'canned_tuna' && part.text === 'atún'));
  assert.equal(engine.validateRenderedCandidate(tuna).valid, true);

  const unauthorized = withRendering(tuna, tuna.rendering.parts.map(part => part.food_id === 'canned_tuna' ? { ...part, text: 'atún premium' } : part));
  assert.equal(engine.validateCandidate(unauthorized, context(['canned_tuna', 'tostada', 'avocado'])).failure, 'rendered_output_not_grounded');

  const egg = candidateFor('taco', ['egg', 'corn_tortilla']);
  const foreign = withRendering(egg, egg.rendering.parts.map(part => part.food_id === 'egg' ? { ...part, text: 'atún' } : part));
  assert.equal(engine.validateCandidate(foreign, context(['egg', 'corn_tortilla'])).failure, 'rendered_output_not_grounded');
});

test('WP4 uses concise archetype-native names and deterministic connector grammar', () => {
  assert.equal(candidateFor('mollete', ['bolillo', 'common_beans', 'fresh_cheese']).name, 'mollete de frijoles con queso fresco');
  assert.equal(candidateFor('chilaquiles', ['tostada', 'green_salsa', 'fresh_cheese']).name, 'chilaquiles con salsa verde y queso fresco');
  assert.equal(candidateFor('sandwich', ['whole_grain_bread', 'canned_tuna', 'cucumber']).name, 'sándwich de atún');
  assert.equal(candidateFor('tostada', ['canned_tuna', 'tostada', 'avocado']).name, 'tostada de atún con aguacate');

  assert.equal(generatedCandidateFor('scrambled_eggs', ['egg', 'broccoli'], ['broccoli']).name, 'huevos revueltos con brócoli');
  assert.equal(candidateFor('huevos_a_la_mexicana', ['egg', 'red_tomato', 'onion']).name, 'huevos a la mexicana con jitomate y cebolla');
  assert.equal(generatedCandidateFor('huevos_a_la_mexicana', ['egg', 'red_tomato', 'onion', 'serrano_chile'], ['serrano_chile']).name, 'huevos a la mexicana con jitomate, cebolla y chile serrano');
  assert.equal(candidateFor('soup_complement', ['vegetable_soup', 'turkey', 'corn_tortilla']).name, 'sopa de verduras con pavo y tortilla de maíz');
});

test('WP4 preserves grounding, opaque prepared dishes, and deterministic rendering', () => {
  const taco = candidateFor('taco', ['egg', 'corn_tortilla']);
  const addedAvocado = withRendering(taco, [...taco.rendering.parts, { type: 'food', food_id: 'avocado', text: 'aguacate', atomic: false }]);
  assert.equal(engine.validateCandidate(addedAvocado, context(['egg', 'corn_tortilla'])).failure, 'rendered_output_not_grounded');
  const substitutedChicken = withRendering(taco, taco.rendering.parts.map(part => part.food_id === 'egg' ? { ...part, food_id: 'chicken', text: 'pollo' } : part));
  assert.equal(engine.validateCandidate(substitutedChicken, context(['egg', 'corn_tortilla'])).failure, 'rendered_output_not_grounded');

  const chilaquiles = candidateFor('chilaquiles', ['tostada', 'green_salsa', 'fresh_cheese']);
  const removedCheese = withRendering(chilaquiles, chilaquiles.rendering.parts.filter(part => part.food_id !== 'fresh_cheese'));
  assert.equal(engine.validateCandidate(removedCheese, context(['tostada', 'green_salsa', 'fresh_cheese'])).failure, 'rendered_output_not_grounded');

  const prepared = candidateFor('prepared_dish_complement', ['pozole']);
  assert.deepEqual(prepared.rendering.parts, [{ type: 'food', food_id: 'pozole', text: 'pozole', atomic: true }]);
  const repeat = candidateFor('tostada', ['canned_tuna', 'tostada', 'avocado']);
  const first = candidateFor('tostada', ['canned_tuna', 'tostada', 'avocado']);
  assert.deepEqual(repeat.rendering.parts, first.rendering.parts);
  assert.equal(repeat.name, first.name); assert.equal(repeat.rendering.text, first.rendering.text);
});

test('WP4 retains hidden defining bases as exact structural bindings', () => {
  const molleteFoods = ['bolillo', 'common_beans', 'fresh_cheese'];
  const mollete = candidateFor('mollete', molleteFoods);
  assert.equal(mollete.name.includes('bolillo'), false);
  assert.deepEqual(mollete.rendering.bindings, [{ slot: 'base', food_id: 'bolillo' }, { slot: 'beans', food_id: 'common_beans' }, { slot: 'cheese', food_id: 'fresh_cheese' }]);
  assert.equal(engine.validateRenderedCandidate(mollete).valid, true);
  assert.equal(engine.validateCandidate(mollete, context(molleteFoods)).valid, true);
  const forgedMollete = { ...mollete, ingredients: mollete.ingredients.filter(id => id !== 'bolillo') };
  assert.equal(engine.validateRenderedCandidate(forgedMollete).valid, false);
  assert.equal(engine.validateCandidate(forgedMollete, context(molleteFoods)).valid, false);

  const chilaquilesFoods = ['tostada', 'green_salsa', 'fresh_cheese'];
  const chilaquiles = candidateFor('chilaquiles', chilaquilesFoods);
  assert.equal(chilaquiles.name.includes('tostada'), false);
  assert.deepEqual(chilaquiles.rendering.bindings, [{ slot: 'base', food_id: 'tostada' }, { slot: 'sauce', food_id: 'green_salsa' }, { slot: 'cheese', food_id: 'fresh_cheese' }]);
  assert.equal(engine.validateRenderedCandidate(chilaquiles).valid, true);
  assert.equal(engine.validateCandidate(chilaquiles, context(chilaquilesFoods)).valid, true);
  const forgedChilaquiles = { ...chilaquiles, ingredients: chilaquiles.ingredients.filter(id => id !== 'tostada') };
  assert.equal(engine.validateRenderedCandidate(forgedChilaquiles).valid, false);
  assert.equal(engine.validateCandidate(forgedChilaquiles, context(chilaquilesFoods)).valid, false);
});

test('WP4 rejects structural-binding deletion, replacement, and addition', () => {
  const mollete = candidateFor('mollete', ['bolillo', 'common_beans', 'fresh_cheese']);
  const validate = candidate => assert.equal(engine.validateRenderedCandidate(candidate).valid, false);
  validate({ ...mollete, rendering: { ...mollete.rendering, bindings: mollete.rendering.bindings.filter(binding => binding.slot !== 'base') } });
  validate({ ...mollete, rendering: { ...mollete.rendering, bindings: mollete.rendering.bindings.map(binding => binding.slot === 'base' ? { ...binding, food_id: 'bread' } : binding) } });
  validate({ ...mollete, rendering: { ...mollete.rendering, bindings: [...mollete.rendering.bindings, { slot: 'extra', food_id: 'avocado' }] } });

  const chilaquiles = candidateFor('chilaquiles', ['tostada', 'green_salsa', 'fresh_cheese']);
  validate({ ...chilaquiles, rendering: { ...chilaquiles.rendering, bindings: chilaquiles.rendering.bindings.map(binding => binding.slot === 'base' ? { ...binding, food_id: 'bread' } : binding) } });
});

test('WP4 leaves selection-relevant candidate structure unchanged across archetypes and appetites', () => {
  const cases = [
    [['egg', 'corn_tortilla', 'avocado'], {}, 'taco', ['corn_tortilla', 'egg', 'avocado'], 91],
    [['canned_tuna', 'tostada', 'avocado'], { appetite: 'high' }, 'tostada', ['tostada', 'canned_tuna', 'avocado'], 99],
    [['egg', 'red_tomato', 'onion'], { appetite: 'low' }, 'huevos_a_la_mexicana', ['egg', 'red_tomato', 'onion'], 91],
    [['egg', 'mushrooms', 'panela_cheese'], {}, 'omelette', ['egg', 'mushrooms', 'panela_cheese'], 83],
    [['whole_grain_bread', 'canned_tuna', 'cucumber'], { appetite: 'normal' }, 'sandwich', ['whole_grain_bread', 'canned_tuna', 'cucumber'], 93],
    [['whole_grain_bread', 'egg', 'avocado'], { appetite: 'variable' }, 'toast', ['whole_grain_bread', 'egg', 'avocado'], 91],
    [['bolillo', 'common_beans', 'fresh_cheese'], { appetite: 'unknown' }, 'mollete', ['bolillo', 'common_beans', 'fresh_cheese'], 91],
    [['chicken', 'rice', 'broccoli'], {}, 'plato_casero', ['chicken', 'rice', 'broccoli'], 94],
    [['greek_yogurt', 'strawberry', 'walnuts'], { appetite: 'low' }, 'yogurt_bowl', ['greek_yogurt', 'strawberry', 'walnuts'], 89],
    [['vegetable_soup', 'turkey', 'corn_tortilla'], {}, 'soup_complement', ['vegetable_soup', 'turkey', 'corn_tortilla'], 89],
    [['pozole'], {}, 'prepared_dish_complement', ['pozole'], 84],
  ];
  for (const [ids, extra, archetype, ingredients, score] of cases) {
    const output = engine.recommend(context(ids, extra));
    assert.equal(output.candidate.archetype, archetype);
    assert.deepEqual(output.candidate.ingredients, ingredients);
    assert.equal(output.score, score);
  }
});
