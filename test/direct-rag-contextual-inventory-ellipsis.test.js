'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rag = require('../lib/sales-engine-v2/direct-rag-v3');
const prompt = '¿Qué alimentos tienes disponibles ahora?';
const authorized = message => rag.extractSemanticContext(message, [{ role: 'assistant', text: prompt }]);

test('WP2.1C.1 completes only authorized bounded inventory lists into structured mentions', () => {
  for (const [message, foods] of [
    ['pollo', ['pollo']], ['pollo arroz', ['pollo', 'arroz']], ['pollo, arroz', ['pollo', 'arroz']], ['pollo y arroz', ['pollo', 'arroz']],
    ['Huevos pollo pechuga vegetales arroz', ['huevos', 'pollo', 'pechuga', 'verduras', 'arroz']],
  ]) {
    const context = authorized(message);
    assert.deepEqual(context.food_context.available_foods, foods, message);
    assert.ok(context.food_context.structured_food_mentions.every(item => item.relation === 'available' && item.temporal_scope === 'current'), message);
  }
});

test('WP2.1C.1 never authorizes standalone, qualified, or explicit rejected propositions', () => {
  for (const message of ['pollo', 'pollo arroz', 'Huevos pollo pechuga vegetales arroz']) assert.deepEqual(rag.extractSemanticContext(message).food_context.available_foods, [], message);
  for (const message of ['tal vez pollo', 'pollo mañana', 'según Ana pollo', 'si viene Ana pollo', '¿pollo?', 'quiero pollo', 'No tengo pollo', 'Tal vez tengo pollo', 'Tengo pollo mañana', '¿Tengo pollo?']) {
    assert.deepEqual(authorized(message).food_context.available_foods, [], message);
  }
});

test('WP2.1C.1 authorization is immediate, exact, and operationally usable', () => {
  assert.deepEqual(rag.extractSemanticContext('pollo', [{ role: 'assistant', text: prompt }, { role: 'customer', text: 'otra cosa' }]).food_context.available_foods, []);
  assert.deepEqual(rag.extractSemanticContext('pollo', [{ role: 'assistant', text: '¿Qué comida tienes?' }]).food_context.available_foods, []);
  const context = authorized('pollo, arroz');
  assert.match(rag.resolveFoodDecision('pollo, arroz', '', [], context, false).permitted_claims.join(' '), /pollo con arroz/u);
});
