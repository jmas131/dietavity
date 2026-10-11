'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rag = require('../lib/sales-engine-v2/direct-rag-v3');

const foodContext = (message, history = []) => rag.extractSemanticContext(message, history).food_context;
const compact = (message, history) => foodContext(message, history).structured_food_mentions.map(mention => [
  mention.surface, mention.relation, mention.polarity, mention.temporal_scope,
]);

test('C.6 completes only the closed predicate-less breakfast report grammar', () => {
  const target = '2 huevos con tocino, aguacate, y un café sin azúcar de desayuno';
  assert.deepEqual(compact(target), [
    ['huevos', 'consumed', 'affirmed', 'past'],
    ['tocino', 'consumed', 'affirmed', 'past'],
    ['aguacate', 'consumed', 'affirmed', 'past'],
    ['café', 'consumed', 'affirmed', 'past'],
  ]);
  const context = foodContext(target);
  assert.deepEqual(context.available_foods, []);
  assert.deepEqual(context.recently_consumed, ['huevos', 'tocino', 'aguacate', 'cafe']);
  assert.deepEqual(context.recent_food_events, [{ kind: 'consumed', foods: ['huevos', 'tocino', 'aguacate', 'cafe'], evidence: 'huevos' }]);
  for (const mention of context.structured_food_mentions) assert.equal(target.slice(mention.evidence.start, mention.evidence.end), mention.surface);

  for (const [message, food] of [['2 huevos de desayuno', 'huevos'], ['1 huevo de desayuno', 'huevo'], ['dos huevos de desayuno', 'huevos']]) {
    assert.deepEqual(compact(message), [[food, 'consumed', 'affirmed', 'past']], message);
  }
  assert.deepEqual(compact('2 huevos de desayuno!'), [['huevos', 'consumed', 'affirmed', 'past']]);
});

test('C.6 leaves explicit propositions, unsafe framing, contamination, and bare lists fail closed', () => {
  for (const message of [
    'Comí huevos de desayuno', 'No comí huevos de desayuno', 'Tal vez comí huevos de desayuno',
    'Ana dice que comí huevos de desayuno', '¿Comí huevos de desayuno?',
    'Tal vez 2 huevos de desayuno', 'Quizás 2 huevos de desayuno', 'Probablemente 2 huevos de desayuno',
    'Según Ana, 2 huevos de desayuno', 'Ana dice: 2 huevos de desayuno', '¿2 huevos de desayuno?',
    'Si 2 huevos de desayuno', 'Mañana 2 huevos de desayuno', '2 huevos de desayuno mañana',
    '“2 huevos de desayuno”', 'Mi mamá: 2 huevos de desayuno', '2 huevos de comida', '2 huevos de cena',
    '2 huevos de desayuno pero quiero pollo', '2 huevos de desayuno y tengo arroz',
    'Tengo pollo. 2 huevos de desayuno', '2 huevos de desayuno. Tengo pollo',
    '2 huevos de desayuno según Ana', '2 huevos de desayuno tal vez',
    'huevos tocino aguacate café', '2 huevos con tocino', 'huevos y café', 'aguacate',
    'huevos pero no tocino de desayuno', 'sin huevos de desayuno', 'no huevos de desayuno',
    '2 huevos de desayunoX', '2 huevos de desayuno2', '2 huevos de desayuno_', '2 huevos de desayuno\u0301',
    '2 huevos con tocino, aguacate, y un café sin azúcarX de desayuno',
  ]) {
    const context = foodContext(message);
    assert.deepEqual(context.recently_consumed, [], message);
    assert.deepEqual(context.recent_food_events, [], message);
  }
});

test('C.6 does not override the exact authorized inventory-list completion', () => {
  const prompt = '¿Qué alimentos tienes disponibles ahora?';
  const context = foodContext('huevos, arroz', [{ role: 'assistant', text: prompt }]);
  assert.deepEqual(context.available_foods, ['huevos', 'arroz']);
  assert.deepEqual(context.recently_consumed, []);
  assert.ok(context.structured_food_mentions.every(mention => mention.relation === 'available'));
});
