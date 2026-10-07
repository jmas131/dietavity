'use strict';

// Frozen V1 adversarial corpus. Inputs are retained from the audit; V1.1
// asserts general invariants rather than re-tuning a winner per example.
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../lib/meal-recommendation-engine');

const cookedIds = new Set(['chicken', 'chicken_breast', 'rice', 'common_beans', 'lentils', 'broccoli']);
function input(ids, extra = {}) { return { decision_horizon: 'immediate', available_foods: ids.map(food_id => ({ food_id, state: cookedIds.has(food_id) ? { cooked: true, readiness: 'ready_to_eat' } : {} })), ...extra }; }
function output(ids, extra) { return engine.recommend(input(ids, extra)); }

const FROZEN_CASES = [
  ['A01', ['egg', 'corn_tortilla'], {}, 'recommendation'], ['A02', ['egg', 'bread'], {}, 'recommendation'],
  ['A03', ['chicken', 'canned_tuna', 'corn_tortilla', 'tostada', 'whole_grain_bread', 'avocado', 'cucumber'], {}, 'recommendation'],
  ['A04', ['greek_yogurt', 'banana', 'walnuts', 'green_salsa', 'serrano_chile'], {}, 'recommendation'],
  ['B05', ['lentils'], {}, 'recommendation'], ['B06', ['canned_tuna'], {}, 'needs_clarification'], ['B07', ['chicken'], {}, 'needs_clarification'], ['B08', ['plain_yogurt', 'banana'], {}, 'needs_clarification'],
  ['C09', ['chicken', 'canned_tuna', 'common_beans', 'rice', 'corn_tortilla', 'bolillo', 'fresh_cheese', 'avocado', 'red_tomato', 'onion', 'green_salsa', 'broccoli'], {}, 'recommendation'],
  ['D10', ['chicken', 'corn_tortilla'], { available_foods: [{ food_id: 'chicken', state: {} }, { food_id: 'corn_tortilla', state: {} }] }, 'needs_clarification'],
  ['D11', ['chicken', 'corn_tortilla'], { decision_horizon: 'upcoming_meal', available_foods: [{ food_id: 'chicken', state: {} }, { food_id: 'corn_tortilla', state: {} }] }, 'recommendation'],
  ['D12', ['common_beans', 'corn_tortilla'], { decision_horizon: 'planning', available_foods: [{ food_id: 'common_beans', state: {} }, { food_id: 'corn_tortilla', state: {} }] }, 'recommendation'],
  ['D13', ['rice', 'chicken', 'broccoli'], { available_foods: [{ food_id: 'rice', state: {} }, { food_id: 'chicken', state: { cooked: true } }, { food_id: 'broccoli', state: { cooked: true } }] }, 'needs_clarification'],
  ['E14', ['enchiladas', 'corn_tortilla', 'fresh_cheese', 'green_salsa'], {}, 'recommendation'], ['E15', ['tamales', 'pozole', 'corn_tortilla'], {}, 'recommendation'],
  ['F16', ['egg', 'corn_tortilla', 'avocado'], { appetite: 'low' }, 'recommendation'], ['F17', ['egg', 'corn_tortilla', 'avocado'], { appetite: 'normal' }, 'recommendation'], ['F18', ['egg', 'corn_tortilla', 'avocado'], { appetite: 'high' }, 'recommendation'], ['F19', ['egg', 'corn_tortilla', 'avocado'], { appetite: 'variable' }, 'recommendation'], ['F20', ['egg', 'corn_tortilla', 'avocado'], { appetite: 'unknown' }, 'recommendation'],
  ['G21', ['chicken', 'corn_tortilla', 'pozole'], { recently_consumed: ['pozole'] }, 'recommendation'],
  ['H22', ['egg', 'corn_tortilla', 'avocado'], { contextual_rejections: ['taco'] }, 'recommendation'],
  ['H23', ['egg', 'corn_tortilla', 'avocado'], { contextual_rejections: ['egg', 'corn_tortilla', 'avocado'] }, 'needs_clarification'],
  ['I24', ['nopal', 'mexican_cream', 'corn_tortilla'], {}, 'needs_clarification'],
  ['L25', ['chicken_breast', 'corn_tortilla', 'avocado'], { confirmed_constraints: ['chicken'] }, 'needs_clarification'],
];

test('frozen 25-case adversarial corpus preserves grounding and safety invariants', () => {
  assert.equal(FROZEN_CASES.length, 25);
  for (const [id, ids, extra, status] of FROZEN_CASES) {
    const result = output(ids, extra);
    assert.equal(result.status, status, id);
    if (result.status === 'recommendation') {
      for (const foodId of result.candidate.ingredients) assert.ok(ids.includes(foodId), `${id}: unavailable ${foodId}`);
      assert.deepEqual(result.candidate.named_ingredients, result.candidate.ingredients, `${id}: name/composition contract`);
    }
  }
});

test('frozen H22 rejects the taco family without persisting a food dislike', () => {
  const result = output(['egg', 'corn_tortilla', 'avocado'], { contextual_rejections: ['taco'] });
  assert.notEqual(result.candidate.archetype, 'taco');
});

test('frozen appetite/recent/prepared cases retain their causal properties', () => {
  assert.equal(output(['egg', 'corn_tortilla', 'avocado'], { appetite: 'low' }).portion_strategy, 'start_small');
  assert.equal(output(['egg', 'corn_tortilla', 'avocado'], { appetite: 'high' }).portion_strategy, 'normal_plate');
  assert.equal(output(['chicken', 'corn_tortilla', 'pozole'], { recently_consumed: ['pozole'] }).candidate.ingredients.includes('pozole'), false);
  const prepared = output(['tamales', 'pozole', 'corn_tortilla']);
  assert.ok(['tamales', 'pozole'].includes(prepared.candidate.ingredients[0]));
});
