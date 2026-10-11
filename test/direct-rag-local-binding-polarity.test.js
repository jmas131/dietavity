'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rag = require('../lib/sales-engine-v2/direct-rag-v3');

const context = message => rag.extractSemanticContext(message).food_context;
const compact = message => context(message).structured_food_mentions.map(mention => [
  mention.surface, mention.relation, mention.polarity, mention.temporal_scope,
]);

test('C.3B binds a bounded prepared-food description without creating a new authority path', () => {
  const message = 'Me preparé un arroz chino con pollo y verduras con salsa de soya';
  const food = context(message);
  assert.deepEqual(compact(message), [
    ['arroz', 'prepared', 'affirmed', 'unknown'],
    ['pollo', 'prepared', 'affirmed', 'unknown'],
    ['verduras', 'prepared', 'affirmed', 'unknown'],
  ]);
  assert.deepEqual(food.recent_food_events, [{ kind: 'prepared', foods: ['arroz', 'pollo', 'verduras'], evidence: 'arroz' }]);
  assert.deepEqual(food.available_foods, []);
  assert.deepEqual(food.recently_consumed, []);
  for (const mention of food.structured_food_mentions) assert.equal(message.slice(mention.evidence.start, mention.evidence.end), mention.surface);
});

test('C.3B accepts only bounded prepared-description connectors', () => {
  for (const message of [
    'Me preparé arroz con pollo y verduras',
    'Me preparé arroz chino con pollo, verduras con salsa de soya',
  ]) assert.deepEqual(compact(message).map(([surface, relation]) => [surface, relation]), [
    ['arroz', 'prepared'], ['pollo', 'prepared'], ['verduras', 'prepared'],
  ], message);
  for (const message of [
    'Me preparé arroz extraño con pollo',
    'Me preparé arroz chino con pollo y verduras con salsa de soyax',
    '¿Me preparé arroz chino con pollo y verduras con salsa de soya?',
  ]) assert.ok(compact(message).every(([, relation]) => relation === 'mentioned'), message);
});

test('C.3B applies immediate local negative ellipsis only after one trusted proposition', () => {
  for (const [message, expected, available, consumed] of [
    ['Tengo pollo y no verduras', [['pollo', 'available', 'affirmed', 'current'], ['verduras', 'available', 'negated', 'current']], ['pollo'], []],
    ['Tengo pollo pero no verduras', [['pollo', 'available', 'affirmed', 'current'], ['verduras', 'available', 'negated', 'current']], ['pollo'], []],
    ['Tengo pollo, pero no verduras', [['pollo', 'available', 'affirmed', 'current'], ['verduras', 'available', 'negated', 'current']], ['pollo'], []],
    ['Tengo pollo y no arroz', [['pollo', 'available', 'affirmed', 'current'], ['arroz', 'available', 'negated', 'current']], ['pollo'], []],
    ['Comí huevo pero no frijoles', [['huevo', 'consumed', 'affirmed', 'past'], ['frijoles', 'consumed', 'negated', 'past']], [], ['huevos']],
    ['Preparé pollo pero no arroz', [['pollo', 'prepared', 'affirmed', 'unknown'], ['arroz', 'prepared', 'negated', 'unknown']], [], []],
  ]) {
    assert.deepEqual(compact(message), expected, message);
    assert.deepEqual(context(message).available_foods, available, message);
    assert.deepEqual(context(message).recently_consumed, consumed, message);
  }
});

test('C.3B never lets local ellipsis bypass frozen proposition authority', () => {
  for (const message of [
    'Tal vez tengo pollo y no verduras',
    '¿Tengo pollo y no verduras?',
    'Ana dice que tengo pollo y no verduras',
    'Si tengo pollo y no verduras',
    'Tengo pollo. No verduras',
    'Tengo pollo, mañana no verduras',
    'Tengo pollo pero tal vez no verduras',
  ]) {
    const food = context(message);
    assert.ok(food.structured_food_mentions.every(mention => mention.relation === 'mentioned'), message);
    assert.deepEqual(food.available_foods, [], message);
    assert.deepEqual(food.recently_consumed, [], message);
  }
});

test('C.3B preserves C.3A restart and exact raw offsets', () => {
  const message = 'No tengo pollo, pero comí arroz y no frijoles';
  const food = context(message);
  assert.deepEqual(compact(message).map(([surface, relation, polarity]) => [surface, relation, polarity]), [
    ['pollo', 'available', 'negated'],
    ['arroz', 'consumed', 'affirmed'],
    ['frijoles', 'consumed', 'negated'],
  ]);
  assert.deepEqual(food.available_foods, []);
  assert.deepEqual(food.recently_consumed, ['arroz']);
  for (const mention of food.structured_food_mentions) assert.equal(message.slice(mention.evidence.start, mention.evidence.end), mention.surface);
});
