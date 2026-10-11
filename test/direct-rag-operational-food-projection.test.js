'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rag = require('../lib/sales-engine-v2/direct-rag-v3');

function context(message) { return rag.extractSemanticContext(message); }

test('WP2.1C projects current availability only from affirmed trusted mentions', () => {
  for (const message of ['Tal vez tengo pollo', 'Tengo pollo mañana', 'Si tengo pollo, preparo tacos', 'Ana dice que tengo pollo', '¿Tengo pollo?', 'Hay pollo en casa']) {
    const semantic = context(message);
    assert.deepEqual(semantic.food_context.available_foods, [], message);
    assert.doesNotMatch(rag.resolveFoodDecision(message, '', [], semantic, false).permitted_claims.join(' '), /prepara pollo/u, message);
  }
  for (const message of ['Tengo pollo', 'Hay pollo', 'Cuento con pollo', 'Dispongo de pollo']) assert.deepEqual(context(message).food_context.available_foods, ['pollo'], message);
});

test('WP2.1C projects consumption and compatibility events from affirmed trusted mentions', () => {
  for (const message of ['No comí arroz', 'Tal vez comí arroz', 'Ana dice que comí arroz', '¿Comí arroz?']) assert.deepEqual(context(message).food_context.recently_consumed, [], message);
  const consumed = context('Comí arroz');
  assert.deepEqual(consumed.food_context.recently_consumed, ['arroz']);
  assert.deepEqual(consumed.food_context.recent_food_events, [{ kind: 'consumed', foods: ['arroz'], evidence: 'arroz' }]);
  const mixed = context('Comí huevo pero no frijoles');
  assert.deepEqual(mixed.food_context.recently_consumed, ['huevos']);
  assert.deepEqual(mixed.food_context.recent_food_events, [{ kind: 'consumed', foods: ['huevos'], evidence: 'huevo' }]);
});

test('WP2.1C keeps negative provenance out of positive operational state', () => {
  const negative = context('No tengo pollo pero sí tengo huevo');
  assert.deepEqual(negative.food_context.available_foods, ['huevos']);
  assert.equal(negative.food_context.structured_food_mentions.find(mention => mention.surface === 'pollo').relation, 'available');
  assert.equal(negative.food_context.structured_food_mentions.find(mention => mention.surface === 'huevo').relation, 'available');
});
