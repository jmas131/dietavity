'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rag = require('../lib/sales-engine-v2/direct-rag-v3');
const prompt = '¿Qué alimentos tienes disponibles ahora?';
const authorized = message => rag.extractSemanticContext(message, [{ role: 'assistant', text: prompt }]);

test('WP2.1C.1A completes bounded current-product vocabulary only after inventory authorization', () => {
  const list = authorized('Huevos\nVegetales\nPollo\nPescado\nArroz');
  assert.deepEqual(list.food_context.available_foods, ['huevos', 'verduras', 'pollo', 'pescado', 'arroz']);
  assert.deepEqual(authorized('Pescado, verduras y arroz').food_context.available_foods, ['pescado', 'verduras', 'arroz']);
  for (const value of ['pescado', 'carne', 'leche', 'fruta', 'tocino']) assert.deepEqual(rag.extractSemanticContext(value).food_context.available_foods, [], value);
});

test('WP2.1C.1A vocabulary follows frozen trust and exact raw evidence rules', () => {
  for (const message of ['Tengo pescado', 'Tengo carne', 'Tengo leche', 'Tengo fruta', 'Tengo tocino']) assert.equal(rag.extractSemanticContext(message).food_context.structured_food_mentions[0].relation, 'available', message);
  for (const message of ['Tal vez tengo pescado', 'Tengo pescado mañana', '¿Tengo pescado?', 'Ana dice que tengo pescado', 'Si tengo pescado, preparo tacos']) assert.equal(rag.extractSemanticContext(message).food_context.structured_food_mentions[0].relation, 'mentioned', message);
  for (const message of ['😀 Tengo PESCADO', 'Tengo café y leche']) for (const mention of rag.extractSemanticContext(message).food_context.structured_food_mentions) assert.equal(message.slice(mention.evidence.start, mention.evidence.end), mention.surface);
  assert.equal(rag.extractSemanticContext('pescadoX').food_context.structured_food_mentions.length, 0);
});
