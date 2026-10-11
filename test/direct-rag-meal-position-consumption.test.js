'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rag = require('../lib/sales-engine-v2/direct-rag-v3');

const foodContext = message => rag.extractSemanticContext(message).food_context;
const compact = message => foodContext(message).structured_food_mentions.map(mention => [
  mention.surface, mention.relation, mention.polarity, mention.temporal_scope,
]);

test('C.4A accepts bounded meal-position prefixes and suffixes only with an explicit consumed predicate', () => {
  for (const [message, food] of [
    ['Para desayunar comí huevos', 'huevos'],
    ['Para comer comí pollo', 'pollo'],
    ['Para cenar comí pescado', 'pescado'],
    ['Comí pollo en la cena', 'pollo'],
    ['Comí huevos en el desayuno', 'huevos'],
    ['Comí arroz en la comida', 'arroz'],
  ]) {
    assert.deepEqual(compact(message), [[food, 'consumed', 'affirmed', 'past']], message);
    assert.deepEqual(foodContext(message).recently_consumed, [food === 'huevos' ? 'huevos' : food], message);
    assert.deepEqual(foodContext(message).available_foods, [], message);
    assert.deepEqual(foodContext(message).recent_food_events, [{ kind: 'consumed', foods: [food === 'huevos' ? 'huevos' : food], evidence: food }], message);
  }
});

test('C.4A keeps unsafe prefix and suffix contexts non-factual', () => {
  for (const message of [
    'Tal vez para desayunar comí huevos',
    '¿Para desayunar comí huevos?',
    'Ana dice que para desayunar comí huevos',
    'Si para desayunar comí huevos',
    'Tal vez comí pollo en la cena',
    '¿Comí pollo en la cena?',
    'Ana dice que comí pollo en la cena',
    'Si comí pollo en la cena',
    'Comí pollo en la cenax',
    'Comí pollo en la cena según Ana',
    'Comí pollo en la cena tal vez',
    'Comí pollo en la cena si viene Ana',
  ]) {
    const context = foodContext(message);
    assert.ok(context.structured_food_mentions.every(mention => mention.relation === 'mentioned'), message);
    assert.deepEqual(context.recently_consumed, [], message);
    assert.deepEqual(context.recent_food_events, [], message);
  }
});

test('C.4A evaluates coordinated meal-position propositions independently', () => {
  for (const [message, expectedAvailable, expectedConsumed] of [
    ['Para desayunar comí huevos, pero tengo pollo', ['pollo'], ['huevos']],
    ['Comí pollo en la cena, pero tengo arroz', ['arroz'], ['pollo']],
    ['Tengo pollo, pero para desayunar comí huevos', ['pollo'], ['huevos']],
    ['Tengo arroz, pero comí pollo en la cena', ['arroz'], ['pollo']],
  ]) {
    const context = foodContext(message);
    assert.deepEqual(context.available_foods, expectedAvailable, message);
    assert.deepEqual(context.recently_consumed, expectedConsumed, message);
  }
});

test('C.4A retains local negative-object polarity without bypassing authority', () => {
  for (const [message, consumed] of [
    ['Para desayunar no comí huevos', []],
    ['No comí pollo en la cena', []],
    ['Para desayunar comí huevos pero no tocino', ['huevos']],
    ['Comí pollo en la cena pero no arroz', ['pollo']],
  ]) {
    const context = foodContext(message);
    assert.deepEqual(context.recently_consumed, consumed, message);
    assert.ok(context.structured_food_mentions.every(mention => mention.relation === 'consumed'), message);
    assert.ok(context.structured_food_mentions.some(mention => mention.polarity === 'negated') || !consumed.length, message);
  }
});

test('C.4A preserves raw offsets and rejects malformed meal-position token continuations', () => {
  for (const message of [
    'Comí pollo en la cena2',
    'Comí pollo en la cena_x',
    'Comí pollo en la cena\u0301',
    'Para desayunarx comí huevos',
    'Para cenar2 comí pescado',
  ]) assert.ok(compact(message).every(([, relation]) => relation === 'mentioned'), message);

  const message = '😀 Para desayunar comí huevos';
  for (const mention of foodContext(message).structured_food_mentions) {
    assert.equal(message.slice(mention.evidence.start, mention.evidence.end), mention.surface);
  }
});
