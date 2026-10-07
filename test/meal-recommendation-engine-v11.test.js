'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../lib/meal-recommendation-engine');

const cookedIds = new Set(['chicken', 'chicken_breast', 'ground_beef', 'shredded_beef', 'white_fish', 'salmon', 'shrimp', 'rice', 'brown_rice', 'common_beans', 'black_beans', 'lentils', 'chickpeas', 'zucchini', 'broccoli', 'pork', 'pork_loin', 'beef_steak']);
function context(ids, extra = {}) {
  return {
    decision_horizon: 'immediate',
    available_foods: ids.map(food_id => ({ food_id, state: cookedIds.has(food_id) ? { cooked: true, readiness: 'ready_to_eat' } : {} })),
    ...extra,
  };
}
function run(ids, extra) { return engine.recommend(context(ids, extra)); }
function selectedIds(output) { return output.candidate?.ingredients || []; }

test('V1.1 composition is the single customer-visible grounding contract', () => {
  for (const [ids, absent] of [
    [['egg', 'corn_tortilla'], 'avocado'],
    [['egg', 'bread'], 'avocado'],
  ]) {
    const output = run(ids);
    assert.equal(output.status, 'recommendation');
    assert.equal(selectedIds(output).includes(absent), false);
    assert.equal(output.candidate.name.includes(engine.ONTOLOGY[absent].display_name), false);
  }
  const output = run(['chicken', 'corn_tortilla', 'avocado']);
  assert.deepEqual(output.candidate.named_ingredients, output.candidate.ingredients);
});

test('V1.1 readiness is transformation-specific, never a generic low-effort shortcut', () => {
  assert.equal(run(['egg', 'corn_tortilla']).status, 'recommendation');
  assert.equal(run(['rice', 'chicken', 'broccoli'], { available_foods: [{ food_id: 'rice', state: {} }, { food_id: 'chicken', state: { cooked: true } }, { food_id: 'broccoli', state: { cooked: true } }] }).status, 'needs_clarification');
  assert.equal(run(['common_beans', 'corn_tortilla'], { available_foods: [{ food_id: 'common_beans', state: {} }, { food_id: 'corn_tortilla', state: {} }] }).status, 'needs_clarification');
  const upcoming = run(['chicken', 'corn_tortilla'], { decision_horizon: 'upcoming_meal', available_foods: [{ food_id: 'chicken', state: {} }, { food_id: 'corn_tortilla', state: {} }] });
  assert.ok(upcoming.candidate.transformations.includes('cook_main'));
});

test('V1.1 expands safety constraints through ontology ancestry, not downwards', () => {
  assert.ok(engine.ancestors('chicken_breast').has('chicken'));
  assert.ok(engine.ancestors('canned_tuna').has('tuna'));
  assert.ok(engine.ancestors('salmon').has('fish'));
  assert.equal(run(['chicken_breast', 'corn_tortilla', 'avocado'], { confirmed_constraints: ['chicken'] }).status, 'needs_clarification');
  assert.equal(run(['canned_tuna', 'tostada', 'avocado'], { confirmed_constraints: ['tuna'] }).status, 'needs_clarification');
  assert.equal(run(['salmon', 'corn_tortilla', 'avocado'], { confirmed_constraints: ['fish'] }).status, 'needs_clarification');
  assert.equal(run(['chicken', 'corn_tortilla', 'avocado'], { confirmed_constraints: ['chicken_breast'] }).status, 'recommendation');
});

test('V1.1 applies controlled, transient food/archetype/previous-candidate rejection scopes', () => {
  assert.equal(run(['egg', 'corn_tortilla', 'avocado'], { contextual_rejections: ['egg'] }).status, 'needs_clarification');
  assert.equal(run(['chicken_breast', 'corn_tortilla', 'avocado'], { contextual_rejections: ['chicken'] }).status, 'needs_clarification');
  assert.equal(run(['egg', 'corn_tortilla', 'avocado'], { contextual_rejections: [{ scope: 'archetype', value: 'taco' }] }).status, 'recommendation');
  const first = run(['chicken', 'corn_tortilla']);
  const second = run(['chicken', 'corn_tortilla'], { previous_candidate: first.candidate });
  assert.equal(second.status, 'needs_clarification');
  const eggFirst = run(['egg', 'corn_tortilla', 'avocado']);
  const eggAlternative = run(['egg', 'corn_tortilla', 'avocado'], { previous_candidate: eggFirst.candidate });
  assert.notEqual(engine.candidateSignature(eggAlternative.candidate), engine.candidateSignature(eggFirst.candidate));
});

test('V1.1 deduplicates materially equivalent candidate assemblies', () => {
  const report = engine.inspectCandidates(context(['chicken', 'corn_tortilla']));
  const grounded = report.filter(item => !item.failure);
  assert.equal(grounded.length, 1);
  assert.equal(report.filter(item => item.failure === 'equivalent_candidate').length, 1);
});

test('V1.1 scoring dimensions are causal and reflected in reason codes', () => {
  const inventory = ['egg', 'corn_tortilla', 'avocado'];
  const low = run(inventory, { appetite: 'low' });
  const normal = run(inventory, { appetite: 'normal' });
  assert.equal(low.score_dimensions.appetite_context_fit, 15);
  assert.equal(normal.score_dimensions.appetite_context_fit, 12);
  assert.ok(low.reason_codes.includes('low_appetite_fit'));
  const repeated = run(['chicken', 'corn_tortilla', 'pozole'], { recently_consumed: ['pozole'] });
  assert.equal(repeated.score_dimensions.variety, 5);
  const prepared = engine.inspectCandidates(context(['pozole'])).find(item => item.candidate.ingredients[0] === 'pozole');
  assert.equal(engine.inspectCandidates(context(['pozole'], { recently_consumed: ['pozole'] })).find(item => item.candidate.ingredients[0] === 'pozole').dimensions.variety, 0);
  assert.equal(prepared.dimensions.variety, 5);
});

test('V1.1 executable archetypes generate from slot semantics', () => {
  const cases = [
    [['oats', 'banana', 'milk'], 'oatmeal', { decision_horizon: 'upcoming_meal' }],
    [['milk', 'mango'], 'licuado'],
    [['chicken', 'lettuce', 'cucumber'], 'complete_salad'],
    [['panela_cheese', 'zucchini'], 'warm_vegetable_plate'],
    [['lentils', 'carrot'], 'lentil_preparation'],
    [['tostada', 'green_salsa', 'fresh_cheese'], 'chilaquiles'],
  ];
  for (const [ids, archetype, extra] of cases) assert.equal(run(ids, extra).candidate.archetype, archetype, archetype);
  assert.equal(run(['apple', 'corn_tortilla']).status, 'needs_clarification');
  assert.equal(run(['greek_yogurt', 'green_salsa']).status, 'needs_clarification');
});
