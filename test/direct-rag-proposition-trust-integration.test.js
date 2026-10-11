'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rag = require('../lib/sales-engine-v2/direct-rag-v3');

function mentions(message) {
  return rag.extractSemanticContext(message).food_context.structured_food_mentions;
}

function compact(message) {
  return mentions(message).map(item => [item.surface, item.relation, item.polarity, item.temporal_scope]);
}

test('B.3 promotes direct factual propositions through frozen trust primitives', () => {
  assert.deepEqual(compact('Tengo pollo'), [['pollo', 'available', 'affirmed', 'current']]);
  assert.deepEqual(compact('Comí arroz'), [['arroz', 'consumed', 'affirmed', 'past']]);
  assert.deepEqual(compact('Preparé pollo'), [['pollo', 'prepared', 'affirmed', 'unknown']]);
  assert.deepEqual(compact('Voy a comer pollo'), [['pollo', 'planned', 'affirmed', 'future']]);
});

test('B.3 routes boundary modifiers and questions through B.2 before emission', () => {
  for (const message of [
    '¿Tengo pollo?', 'Tengo pollo, ¿verdad?', 'Tengo pollo, según Ana',
    'Tengo pollo tal vez', 'Tengo pollo si viene Ana', 'Tengo pollo mañana',
    'Comí arroz; dijo Ana', 'Preparé pollo, tal vez', 'Voy a comer pollo si viene Ana',
  ]) assert.equal(mentions(message)[0].relation, 'mentioned', message);
});

test('B.3 cannot bypass B.2 through a relation-specific modifier path', () => {
  for (const message of [
    'Tengo pollo, ¿verdad?', 'Comí arroz, ¿verdad?', 'Preparé pollo, ¿verdad?', 'Voy a comer pollo, ¿verdad?',
    'Tengo pollo, según Ana', 'Comí arroz, según Ana', 'Preparé pollo, según Ana', 'Voy a comer pollo, según Ana',
  ]) assert.equal(mentions(message)[0].relation, 'mentioned', message);
});

test('B.3 evaluates each independently restarted proposition afresh', () => {
  assert.deepEqual(compact('Tengo pollo pero no sé qué cocinar'), [['pollo', 'available', 'affirmed', 'current']]);
  assert.deepEqual(compact('Tengo pollo y quiero cocinarlo'), [['pollo', 'available', 'affirmed', 'current']]);
  assert.deepEqual(compact('Tengo pollo pero quiero arroz'), [
    ['pollo', 'available', 'affirmed', 'current'],
    ['arroz', 'mentioned', 'affirmed', 'unknown'],
  ]);
  assert.deepEqual(compact('Tengo pollo. Comí arroz.'), [
    ['pollo', 'available', 'affirmed', 'current'],
    ['arroz', 'consumed', 'affirmed', 'past'],
  ]);
});

test('B.1 recommendation-question P2 starts preserve only the independently trusted P1', () => {
  assert.deepEqual(compact('Tengo pollo. ¿Qué me recomiendas?'), [['pollo', 'available', 'affirmed', 'current']]);
  assert.deepEqual(compact('Comí pollo. ¿Qué me recomiendas?'), [['pollo', 'consumed', 'affirmed', 'past']]);
  assert.deepEqual(compact('Preparé pollo. ¿Qué me recomiendas?'), [['pollo', 'prepared', 'affirmed', 'unknown']]);

  for (const message of [
    'Tal vez tengo pollo. ¿Qué me recomiendas?',
    'Ana dice que tengo pollo. ¿Qué me recomiendas?',
    'Si tengo pollo. ¿Qué me recomiendas?',
    '¿Tengo pollo? ¿Qué me recomiendas?',
  ]) assert.equal(mentions(message)[0].relation, 'mentioned', message);
});

test('B.3 fails closed for prefix trust attacks and preserves exact evidence', () => {
  for (const message of [
    'Tal vez tengo pollo', 'Ana dice que tengo pollo', 'Si viene Ana tengo pollo', 'Me preguntó si tengo pollo',
  ]) assert.equal(mentions(message)[0].relation, 'mentioned', message);
  const [mention] = mentions('😀 Hay pollo en casa');
  assert.deepEqual([mention.surface, mention.relation, mention.temporal_scope], ['pollo', 'mentioned', 'unknown']);
  assert.equal('😀 Hay pollo en casa'.slice(mention.evidence.start, mention.evidence.end), mention.surface);
});
