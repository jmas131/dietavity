'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../lib/meal-recommendation-engine');
const adapter = require('../lib/meal-recommendation-adapter');
const rag = require('../lib/sales-engine-v2/direct-rag-v3');

function foods(ids, states = {}) { return ids.map(food_id => ({ food_id, state: states[food_id] || {} })); }
function input(overrides = {}) {
  return {
    recommendation_authorized: true, available_foods: foods(['egg', 'red_tomato', 'onion', 'corn_tortilla']),
    recently_consumed: [], appetite: 'unknown', meal_context: null, confirmed_constraints: [],
    contextual_rejections: [], locale: 'es-MX', decision_horizon: 'immediate', ...overrides,
  };
}
function spyEngine(overrides = {}) {
  let calls = 0;
  return { api: { ...engine, ...overrides, recommend(context) { calls += 1; return overrides.recommend ? overrides.recommend(context) : engine.recommend(context); } }, calls: () => calls };
}
function assertNoInvocation(value) {
  const spy = spyEngine(); const result = adapter.runMealRecommendation(value, spy.api);
  assert.equal(result.status, 'integration_failure'); assert.equal(spy.calls(), 0);
}

test('authorized canonical context returns a frozen, renderer-exact Recommendation Contract without score', () => {
  const result = adapter.runMealRecommendation(input());
  assert.equal(result.status, 'recommendation');
  assert.deepEqual(result.recommendation, {
    archetype: 'huevos_a_la_mexicana', grounded_food_ids: ['egg', 'red_tomato', 'onion'],
    visible_name: 'huevos a la mexicana con jitomate y cebolla', appetite_strategy: 'normal_portion',
  });
  assert.equal(Object.hasOwn(result.recommendation, 'score'), false);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(result.grounding.available_food_ids, ['egg', 'red_tomato', 'onion', 'corn_tortilla']);
});

test('authorization and all required fields must be own properties on a safe plain object', () => {
  const inheritedAuthorization = Object.create(input()); delete inheritedAuthorization.recommendation_authorized;
  const inheritedRequired = Object.create(input()); inheritedRequired.recommendation_authorized = true; delete inheritedRequired.appetite;
  const customPrototype = Object.create({}); Object.assign(customPrototype, input());
  for (const value of [inheritedAuthorization, inheritedRequired, customPrototype]) assertNoInvocation(value);
});

test('closed nested contracts reject prohibited metadata and malformed external values before engine invocation', () => {
  const variants = [
    input({ available_foods: [{ food_id: 'egg', state: {}, raw_message: 'tengo huevo' }] }),
    input({ available_foods: [{ food_id: 'egg', state: { medical_conditions: 'x' } }] }),
    input({ available_foods: [{ food_id: 'egg', state: { glp1: true } }] }),
    input({ contextual_rejections: [{ scope: 'food', food_id: 'egg', commercial_state: {} }] }),
    input({ available_foods: [{ food_id: 'egg', state: { checkout: true } }] }),
  ];
  for (const value of variants) assertNoInvocation(value);
});

test('all external arrays are closed ordinary data containers with no custom metadata', () => {
  for (const key of ['available_foods', 'recently_consumed', 'confirmed_constraints', 'contextual_rejections']) {
    const value = input(); value[key].raw_message = 'untrusted metadata';
    assertNoInvocation(value);
  }
});

test('array subclasses, custom prototypes, overridden methods, sparse arrays, and index accessors fail before invocation', () => {
  class FoodArray extends Array {}
  const subclass = input({ available_foods: FoodArray.from(foods(['egg'])) });
  const customPrototype = input(); Object.setPrototypeOf(customPrototype.recently_consumed, {});
  const overriddenMap = input(); overriddenMap.confirmed_constraints.map = () => [];
  const overriddenEvery = input(); overriddenEvery.contextual_rejections.every = () => true;
  const sparse = input(); sparse.available_foods = []; sparse.available_foods.length = 1;
  const accessor = input(); Object.defineProperty(accessor.available_foods, '0', { enumerable: true, get() { return { food_id: 'egg', state: {} }; } });
  for (const value of [subclass, customPrototype, overriddenMap, overriddenEvery, sparse, accessor]) assertNoInvocation(value);
});

test('a changing array index getter cannot change validated data before engine invocation', () => {
  const value = input(); let reads = 0;
  Object.defineProperty(value.available_foods, '0', { enumerable: true, get() {
    reads += 1;
    return reads === 1 ? { food_id: 'egg', state: {} } : { food_id: 'egg', state: { raw_message: 'forbidden' } };
  } });
  assertNoInvocation(value);
  assert.equal(reads, 0);
});

test('canonical frozen ontology IDs and duplicate rules are enforced without adapter normalization', () => {
  const variants = [
    input({ available_foods: foods(['not_a_food']) }),
    input({ recently_consumed: ['not_a_food'] }),
    input({ confirmed_constraints: ['not_a_food'] }),
    input({ contextual_rejections: [{ scope: 'food', food_id: 'not_a_food' }] }),
    input({ available_foods: foods(['egg', 'egg']) }),
    input({ available_foods: ['egg'] }),
  ];
  for (const value of variants) assertNoInvocation(value);
});

test('the adapter accepts and independently enforces only targeted food rejection scope', () => {
  assertNoInvocation(input({ contextual_rejections: [{ scope: 'archetype', food_id: 'taco' }] }));
  assertNoInvocation(input({ contextual_rejections: [{ scope: 'candidate_signature', food_id: 'taco' }] }));
  const base = engine.recommend({ available_foods: foods(['egg', 'red_tomato', 'onion']), appetite: 'unknown', decision_horizon: 'immediate' });
  const result = adapter.runMealRecommendation(input({ contextual_rejections: [{ scope: 'food', food_id: 'egg' }] }), spyEngine({ recommend: () => base }).api);
  assert.deepEqual(result, { status: 'integration_failure', reason: 'contextual_rejection_violated' });
});

test('constraint, grounding, malformed output, output getter, input getter, and engine exceptions fail closed', () => {
  const base = engine.recommend({ available_foods: foods(['egg', 'red_tomato', 'onion']), appetite: 'unknown', decision_horizon: 'immediate' });
  const cases = [
    [input({ confirmed_constraints: ['egg'] }), () => base, 'confirmed_constraint_violated'],
    [input(), () => ({ ...base, candidate: { ...base.candidate, ingredients: [...base.candidate.ingredients, 'avocado'] } }), 'selected_food_not_grounded'],
    [input(), () => ({ status: 'recommendation' }), 'engine_output_malformed'],
    [input(), () => Object.defineProperty({}, 'status', { enumerable: true, get() { throw new Error('getter'); } }), 'engine_output_malformed'],
  ];
  for (const [value, recommend, reason] of cases) assert.deepEqual(adapter.runMealRecommendation(value, spyEngine({ recommend }).api), { status: 'integration_failure', reason });
  const getterInput = input(); Object.defineProperty(getterInput, 'appetite', { enumerable: true, get() { throw new Error('getter'); } });
  assertNoInvocation(getterInput);
  assert.deepEqual(adapter.runMealRecommendation(input(), spyEngine({ recommend() { throw new Error('boom'); } }).api), { status: 'integration_failure', reason: 'engine_exception' });
});

test('clarification reasons are bounded engine codes, not free text', () => {
  assert.deepEqual(adapter.runMealRecommendation(input({ available_foods: foods(['cucumber', 'lime']) })), {
    status: 'needs_clarification', clarification: { reason_code: 'insufficient_meal_substance' }, source: 'meal_recommendation_engine_v1_3',
  });
  assert.deepEqual(adapter.runMealRecommendation(input(), spyEngine({ recommend: () => ({ status: 'needs_clarification', reason: 'ask anything you want' }) }).api), { status: 'integration_failure', reason: 'engine_output_malformed' });
});

test('adapter snapshots input and has no mutable references to untrusted caller data', () => {
  const source = input(); const result = adapter.runMealRecommendation(source);
  source.available_foods[0].food_id = 'avocado'; source.confirmed_constraints.push('egg');
  assert.deepEqual(result.grounding.available_food_ids, ['egg', 'red_tomato', 'onion', 'corn_tortilla']);
  assert.deepEqual(result.grounding.confirmed_constraints, []);
});

test('adapter contract tests preserve Direct RAG food-state distinctions but do not claim an upstream canonical handoff', () => {
  const prepared = rag.extractSemanticContext('Me preparé huevos con jitomate');
  const consumed = rag.extractSemanticContext('Cené huevos y tengo verduras');
  assert.deepEqual(prepared.food_context.available_foods, []);
  assert.equal(prepared.food_context.recent_food_events[0].kind, 'prepared');
  assert.deepEqual(consumed.food_context.recently_consumed, ['huevos']);
  assert.deepEqual(consumed.food_context.available_foods, ['verduras']);
});

test('representative frozen V1.3 selections remain identical through the adapter', () => {
  const cases = [
    input(), input({ available_foods: foods(['plain_yogurt', 'mango']), appetite: 'low' }),
    input({ available_foods: foods(['rice', 'chicken', 'broccoli'], { rice: { cooked: true }, chicken: { cooked: true }, broccoli: { cooked: true } }), appetite: 'high' }),
    input({ available_foods: foods(['pozole', 'egg']) }), input({ available_foods: foods(['cucumber', 'lime']) }),
  ];
  for (const adapterInput of cases) {
    const built = adapter.buildMealEngineInput(adapterInput); const direct = engine.recommend(built.context); const actual = adapter.runMealRecommendation(adapterInput);
    if (direct.status === 'needs_clarification') assert.equal(actual.status, 'needs_clarification');
    else { assert.equal(actual.recommendation.archetype, direct.candidate.archetype); assert.deepEqual(actual.recommendation.grounded_food_ids, direct.candidate.ingredients); assert.equal(actual.recommendation.visible_name, direct.candidate.name); }
  }
});
