'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const engine = require('../lib/meal-recommendation-engine');

const cooked = new Set(['broccoli', 'chicken', 'common_beans', 'lentils']);
function context(ids, extra = {}) {
  return {
    appetite: 'high', decision_horizon: 'immediate',
    available_foods: ids.map(food_id => ({ food_id, state: cooked.has(food_id) ? { cooked: true, readiness: 'ready_to_eat' } : {} })),
    ...extra,
  };
}
function validRows(input) { return engine.inspectCandidates(input).filter(row => !row.failure); }
function row(rows, archetype, required) {
  const found = rows.find(item => item.candidate.archetype === archetype && required.every(id => item.candidate.ingredients.includes(id)));
  assert.ok(found, `${archetype} containing ${required.join(',')}`);
  return found;
}
function baseWinner(rows) {
  return [...rows].sort((left, right) => right.score - left.score || right.candidate.specificity - left.candidate.specificity || left.candidate.name.localeCompare(right.candidate.name, 'es-MX'))[0];
}

test('WP3 is neutral between legume and primary anchors in equivalent meal roles', () => {
  const cases = [
    { ids: ['egg', 'flour_tortilla', 'common_beans', 'onion'], archetype: 'taco', primary: 'egg', legume: 'common_beans' },
    { ids: ['egg', 'tostada', 'lentils', 'onion'], archetype: 'tostada', primary: 'egg', legume: 'lentils' },
  ];
  for (const scenario of cases) {
    const input = context(scenario.ids, { decision_horizon: 'upcoming_meal', available_foods: scenario.ids.map(food_id => ({ food_id, state: {} })) });
    const rows = validRows(input); const primary = row(rows, scenario.archetype, [scenario.primary]); const legume = row(rows, scenario.archetype, [scenario.legume]);
    assert.equal(primary.score, legume.score);
    assert.deepEqual(primary.substantiality, legume.substantiality);
    assert.equal(primary.substantiality_value, legume.substantiality_value);
    assert.equal(engine.recommend(input).candidate.name, baseWinner(rows).candidate.name);
  }
});

test('WP3 ignores topping, garnish, and condiment slots regardless of ontology group', () => {
  const cases = [
    { ids: ['egg', 'corn_tortilla', 'serrano_chile'], garnish: 'serrano_chile' },
    { ids: ['egg', 'corn_tortilla', 'cucumber'], garnish: 'cucumber' },
    { ids: ['egg', 'corn_tortilla', 'green_salsa'], garnish: 'green_salsa' },
  ];
  for (const scenario of cases) {
    const rows = engine.inspectCandidates(context(scenario.ids));
    const plain = row(rows, 'taco', ['egg']); const garnished = row(rows, 'taco', ['egg', scenario.garnish]);
    assert.equal(garnished.candidate.slot_assignments.topping[0], scenario.garnish);
    assert.equal(garnished.substantiality_value, plain.substantiality_value);
  }
});

test('WP3 favors a meaningful-component structure only within a high-appetite near tie', () => {
  const cases = [
    ['egg', 'oaxaca_cheese', 'greek_yogurt', 'banana', 'mushrooms', 'chicken_with_mole', 'plain_yogurt'],
    ['egg', 'common_beans', 'green_salsa', 'fresh_cheese', 'mushrooms', 'panela_cheese', 'chicken_with_mole'],
  ];
  for (const ids of cases) {
    const input = context(ids); const rows = validRows(input); const base = baseWinner(rows);
    const winner = engine.recommend(input); const selected = rows.find(item => item.candidate.name === winner.candidate.name && item.candidate.archetype === winner.candidate.archetype);
    assert.ok(base.score - selected.score > 0 && base.score - selected.score <= 2);
    assert.equal(base.candidate.slot_assignments.prepared?.length, 1);
    assert.equal(selected.candidate.slot_assignments.vegetable?.length, 1);
    assert.ok(selected.substantiality_value > base.substantiality_value);
  }
});

test('WP3 preserves a clear base-quality winner over a structurally fuller candidate', () => {
  const cases = [
    ['egg', 'broccoli', 'avocado', 'green_salsa', 'pozole'],
    ['egg', 'avocado', 'greek_yogurt', 'mushrooms', 'chicken_with_mole', 'plain_yogurt', 'mango'],
  ];
  for (const ids of cases) {
    const input = context(ids); const rows = validRows(input); const base = baseWinner(rows);
    const fuller = rows.find(item => base.score - item.score >= 3 && item.substantiality_value > base.substantiality_value);
    assert.ok(fuller);
    assert.equal(engine.recommend(input).candidate.name, base.candidate.name);
  }
});

test('WP3 is isolated from low, normal, variable, and unknown appetite ordering', () => {
  const ids = ['egg', 'corn_tortilla', 'common_beans'];
  for (const appetite of ['low', 'normal', 'variable', 'unknown']) {
    const input = context(ids, { appetite }); const rows = validRows(input);
    assert.equal(engine.recommend(input).candidate.name, baseWinner(rows).candidate.name, appetite);
  }
  assert.equal(engine.recommend(context(['plain_yogurt', 'mango'], { appetite: 'low' })).candidate.archetype, 'yogurt_bowl');
  assert.equal(engine.recommend(context(['egg', 'corn_tortilla', 'avocado'], { appetite: 'normal' })).candidate.archetype, 'taco');
});

test('WP3 retains WP1 yogurt and hard-rejection boundaries', () => {
  assert.equal(engine.recommend(context(['greek_yogurt', 'banana'])).status, 'needs_clarification');
  assert.equal(engine.recommend(context(['greek_yogurt', 'banana'], { appetite: 'low' })).status, 'recommendation');
  const restricted = engine.recommend(context(['egg', 'common_beans', 'corn_tortilla'], { confirmed_constraints: ['egg'] }));
  assert.equal(restricted.candidate.ingredients.includes('egg'), false);
  const rejected = engine.recommend(context(['egg', 'common_beans', 'corn_tortilla'], { contextual_rejections: ['common_beans'] }));
  assert.equal(rejected.candidate.ingredients.includes('common_beans'), false);
});
