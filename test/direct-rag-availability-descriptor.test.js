'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rag = require('../lib/sales-engine-v2/direct-rag-v3');

const foodContext = message => rag.extractSemanticContext(message).food_context;
const compact = message => foodContext(message).structured_food_mentions.map(mention => [
  mention.surface, mention.relation, mention.polarity, mention.temporal_scope,
]);

test('C.4B binds the required closed availability descriptor without changing authority', () => {
  const message = 'Tengo pechuga asada, verduras y huevo. ¿Qué me puedo hacer?';
  const food = foodContext(message);
  assert.deepEqual(compact(message), [
    ['pechuga', 'available', 'affirmed', 'current'],
    ['verduras', 'available', 'affirmed', 'current'],
    ['huevo', 'available', 'affirmed', 'current'],
  ]);
  assert.deepEqual(food.available_foods, ['pechuga', 'verduras', 'huevos']);
  assert.deepEqual(food.recently_consumed, []);
  assert.deepEqual(food.recent_food_events, []);
  for (const mention of food.structured_food_mentions) assert.equal(message.slice(mention.evidence.start, mention.evidence.end), mention.surface);

  const decision = rag.resolveFoodDecision(message, '', [], rag.extractSemanticContext(message));
  assert.equal(decision.clarification_question, null);
  assert.match(decision.permitted_claims[0], /^Con lo que tienes, prepara /u);
});

test('C.4B accepts only the closed asada descriptor in an explicit availability proposition', () => {
  for (const message of [
    'Tengo pechuga asada',
    'Tengo pechuga asada y huevo',
    'Tengo pechuga asada, verduras y huevo',
  ]) assert.ok(compact(message).every(([, relation]) => relation === 'available'), message);

  for (const message of [
    'Tengo pechuga extraña, verduras y huevo',
    'Tengo pechuga asadax, verduras y huevo',
    'Tengo pechuga asada2, verduras y huevo',
    'Tengo pechuga asada_x, verduras y huevo',
    'Tengo pechuga asada\u0301, verduras y huevo',
  ]) assert.ok(compact(message).every(([, relation]) => relation === 'mentioned'), message);
});

test('C.4B descriptors never rescue unsafe availability propositions', () => {
  for (const message of [
    'Tal vez tengo pechuga asada, verduras y huevo',
    '¿Tengo pechuga asada, verduras y huevo?',
    'Ana dice que tengo pechuga asada, verduras y huevo',
    'Si tengo pechuga asada, verduras y huevo',
    'Tengo pechuga asada, verduras y huevo mañana',
    'Tengo pechuga asada, verduras y huevo según Ana',
  ]) {
    const food = foodContext(message);
    assert.ok(food.structured_food_mentions.every(mention => mention.relation === 'mentioned'), message);
    assert.deepEqual(food.available_foods, [], message);
  }
});

test('C.4B question-start recognition never rescues an unsafe P1', () => {
  for (const message of [
    'Tal vez tengo pollo. ¿Qué me puedo hacer?',
    '¿Tengo pollo? ¿Qué me puedo hacer?',
    'Ana dice que tengo pollo. ¿Qué me puedo hacer?',
    'Si tengo pollo... ¿Qué me puedo hacer?',
  ]) {
    const food = foodContext(message);
    assert.deepEqual(food.available_foods, [], message);
    assert.ok(food.structured_food_mentions.every(mention => mention.relation === 'mentioned'), message);
  }
});

test('C.4B preserves proposition boundaries and local polarity', () => {
  for (const [message, available, consumed] of [
    ['Tengo pechuga asada, verduras y huevo, pero comí arroz', ['pechuga', 'verduras', 'huevos'], ['arroz']],
    ['Comí arroz, pero tengo pechuga asada, verduras y huevo', ['pechuga', 'verduras', 'huevos'], ['arroz']],
    ['Tengo pechuga asada, verduras y huevo, pero voy a preparar arroz', ['pechuga', 'verduras', 'huevos'], []],
    ['Tengo pechuga asada, verduras y huevo, pero tal vez comí arroz', ['pechuga', 'verduras', 'huevos'], []],
  ]) {
    const food = foodContext(message);
    assert.deepEqual(food.available_foods, available, message);
    assert.deepEqual(food.recently_consumed, consumed, message);
  }

  assert.deepEqual(compact('No tengo pechuga asada'), [['pechuga', 'available', 'negated', 'current']]);
  assert.deepEqual(compact('Tengo pechuga asada pero no verduras'), [
    ['pechuga', 'available', 'affirmed', 'current'],
    ['verduras', 'available', 'negated', 'current'],
  ]);
  assert.deepEqual(compact('Tengo pechuga asada, verduras y no huevo'), [
    ['pechuga', 'available', 'affirmed', 'current'],
    ['verduras', 'available', 'affirmed', 'current'],
    ['huevo', 'available', 'negated', 'current'],
  ]);
});
