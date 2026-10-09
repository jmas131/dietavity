'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rag = require('../lib/sales-engine-v2/direct-rag-v3');

function mentions(message) { return rag.extractSemanticContext(message).food_context.structured_food_mentions; }
function facts(message) { return mentions(message).map(({ surface, relation, polarity, temporal_scope, state }) => ({ surface, relation, polarity, temporal_scope, state })); }
function positive(message, relation) { return facts(message).filter(item => item.relation === relation && item.polarity === 'affirmed'); }

test('WP2.1 records current availability without promoting negated, interrogative, or planned foods', () => {
  assert.deepEqual(facts('Tengo pollo'), [{ surface: 'pollo', relation: 'available', polarity: 'affirmed', temporal_scope: 'current', state: { cooked: null, canned: null, readiness: null } }]);
  for (const message of ['No tengo pollo', '¿Tengo pollo?', 'Voy a comprar pollo']) assert.equal(positive(message, 'available').length, 0, message);
  assert.deepEqual(facts('Voy a comprar pollo')[0], { surface: 'pollo', relation: 'planned', polarity: 'affirmed', temporal_scope: 'future', state: { cooked: null, canned: null, readiness: null } });
});

test('WP2.1 records item-level consumed facts, negation, and mixed state without changing V3 projections', () => {
  assert.equal(positive('Comí pollo', 'consumed')[0].surface, 'pollo');
  assert.equal(positive('No comí pollo', 'consumed').length, 0);
  assert.deepEqual(facts('Comí huevo pero no frijoles').map(item => [item.surface, item.relation, item.polarity]), [['huevo', 'consumed', 'affirmed'], ['frijoles', 'consumed', 'negated']]);
  assert.equal(positive('Comí huevo, ¿qué puedo cenar?', 'consumed')[0].surface, 'huevo');
  assert.deepEqual(facts('Comí huevo pero tengo pollo').map(item => [item.surface, item.relation, item.polarity]), [['huevo', 'consumed', 'affirmed'], ['pollo', 'available', 'affirmed']]);
  assert.deepEqual(facts('Tengo pollo y comí huevo').map(item => [item.surface, item.relation, item.polarity]), [['pollo', 'available', 'affirmed'], ['huevo', 'consumed', 'affirmed']]);
  assert.deepEqual(facts('No tengo pollo pero sí tengo huevo').map(item => [item.surface, item.polarity]), [['pollo', 'negated'], ['huevo', 'affirmed']]);
  assert.equal(positive('No comí huevo ni frijoles', 'consumed').length, 0);
});

test('WP2.1 preserves prepared, future, non-assertive, broad, and unknown food facts without ontology decisions', () => {
  for (const [message, expected] of [
    ['Preparé pollo', ['prepared', 'affirmed', 'unknown']],
    ['Preparé pollo ayer', ['prepared', 'affirmed', 'past']],
    ['Mañana voy a comer huevo', ['planned', 'affirmed', 'future']],
    ['Quiero hacer tacos mañana', ['planned', 'affirmed', 'future']],
    ['¿El pollo tiene proteína?', ['mentioned', 'question', 'unknown']],
    ['Mi médico me dijo que coma pollo', ['mentioned', 'affirmed', 'unknown']],
  ]) assert.deepEqual(facts(message)[0] && [facts(message)[0].relation, facts(message)[0].polarity, facts(message)[0].temporal_scope], expected, message);
  assert.equal(positive('Preparé pollo', 'available').length, 0);
  assert.equal(positive('Preparé pollo ayer', 'available').length, 0);
  assert.equal(positive('Mañana voy a comer huevo', 'consumed').length, 0);
  assert.equal(positive('Quiero hacer tacos mañana', 'available').length, 0);
  assert.deepEqual(facts('Tengo huitlacoche')[0].surface, 'huitlacoche');
  assert.deepEqual(facts('Tengo galletas')[0].surface, 'galletas');
});

test('WP2.1 preserves useful food surfaces and bounded current-turn evidence', () => {
  for (const [message, surface] of [
    ['Tengo pechuga de pollo', 'pechuga de pollo'], ['Tengo atún en lata', 'atún en lata'],
    ['Tengo tortillas', 'tortillas'], ['Tengo verduras', 'verduras'], ['Tengo queso fresco', 'queso fresco'],
  ]) {
    const [mention] = mentions(message);
    assert.equal(mention.surface, surface, message);
    assert.equal(mention.relation, 'available', message);
    assert.equal(mention.evidence.start, message.indexOf(surface), message);
    assert.equal(mention.evidence.end, message.indexOf(surface) + surface.length, message);
    assert.equal(Object.hasOwn(mention, 'food_id'), false, message);
  }
  assert.equal(facts('Tengo atún en lata')[0].state.canned, true);
  assert.equal(facts('Preparé pollo')[0].state.cooked, true);
});

test('WP2.1 is additive: legacy V3 food fields still retain their existing semantics', () => {
  const context = rag.extractSemanticContext('No tengo pollo, pero comí pollo ayer');
  assert.deepEqual(context.food_context.available_foods, []);
  assert.deepEqual(context.food_context.recently_consumed, ['pollo']);
  assert.equal(context.food_context.contextual_rejection, false);
});

test('WP2.1 binds each relation only to its local direct-object region', () => {
  const available = message => positive(message, 'available').map(item => item.surface);
  assert.deepEqual(available('Tengo pollo pero quiero comer huevo'), ['pollo']);
  assert.deepEqual(facts('Preparé pollo pero quiero huevo').map(item => [item.surface, item.relation]), [['pollo', 'prepared'], ['huevo', 'mentioned']]);
  assert.equal(available('Si tengo pollo, preparo tacos').length, 0);
  assert.equal(available('Si tengo pollo y tengo huevo').length, 0);
  assert.equal(available('Mañana tengo pollo').length, 0);
  assert.deepEqual(available('Tengo pollo y quiero comprar huevo'), ['pollo']);
  assert.deepEqual(facts('Comí huevo y voy a preparar pollo').map(item => [item.surface, item.relation]), [['huevo', 'consumed'], ['pollo', 'planned']]);
  assert.deepEqual(facts('Preparé pollo y después comí arroz').map(item => [item.surface, item.relation]), [['pollo', 'prepared'], ['arroz', 'consumed']]);
  assert.deepEqual(facts('Tengo arroz; ayer comí pollo').map(item => [item.surface, item.relation]), [['arroz', 'available'], ['pollo', 'consumed']]);
});

test('WP2.1 accepts only direct explicit possession/access assertions', () => {
  for (const message of [
    'Me preguntó si tengo pollo', 'Tengo hambre de pollo', 'Creo que hay pollo',
    'Dijo que hay pollo', 'Tal vez tengo pollo', 'Si hay pollo, preparo tacos',
    'Creo que hay pollo y tengo huevo',
  ]) assert.equal(positive(message, 'available').length, 0, message);
  assert.equal(positive('Hay pollo', 'available')[0].surface, 'pollo');
  assert.equal(positive('Cuento con pollo', 'available')[0].surface, 'pollo');
});

test('WP2.1 keeps negation local to each explicit construction', () => {
  assert.deepEqual(facts('No tengo pollo y tengo huevo').map(item => [item.surface, item.relation, item.polarity]), [['pollo', 'available', 'negated'], ['huevo', 'available', 'affirmed']]);
  assert.deepEqual(facts('Tengo pollo y no tengo huevo').map(item => [item.surface, item.relation, item.polarity]), [['pollo', 'available', 'affirmed'], ['huevo', 'available', 'negated']]);
  assert.deepEqual(facts('No comí huevo y comí frijoles').map(item => [item.surface, item.relation, item.polarity]), [['huevo', 'consumed', 'negated'], ['frijoles', 'consumed', 'affirmed']]);
});

test('WP2.1 evidence always slices the original raw message exactly', () => {
  for (const message of [
    'İ Tengo pollo', 'Tengo atún en lata', '😀 Tengo ATUN en lata', 'TeNGo PeChUgA de PoLLo',
    'Comí huevo pero tengo pollo', 'Tengo pollo y tengo pollo',
  ]) for (const mention of mentions(message)) {
    assert.equal(message.slice(mention.evidence.start, mention.evidence.end), mention.surface, `${message}: ${mention.surface}`);
  }
});

test('WP2.1 prefers longest overlapping surfaces and retains distinct occurrences', () => {
  assert.deepEqual(facts('Tengo pechuga de pollo').map(item => item.surface), ['pechuga de pollo']);
  const repeated = mentions('Tengo pollo y tengo pollo');
  assert.deepEqual(repeated.map(item => item.surface), ['pollo', 'pollo']);
  assert.notEqual(repeated[0].evidence.start, repeated[1].evidence.start);
  assert.equal(positive('Tengo tortilla', 'available')[0].surface, 'tortilla');
  assert.equal(positive('Tengo atun en lata', 'available')[0].surface, 'atun en lata');
});

test('WP2.1 validates the whole availability proposition before asserting current inventory', () => {
  for (const message of [
    'Tengo pollo mañana', 'Tengo pollo el lunes', 'Tengo pollo si viene mi mamá', 'Tengo pollo cuando llegue',
    'Tengo huevo mañana', 'Hay pollo para mañana', 'Tengo arroz cuando regrese', 'Tengo huevo si voy al súper',
  ]) assert.equal(positive(message, 'available').length, 0, message);
  for (const message of ['Tengo pollo', 'Hay pollo', 'Cuento con pollo', 'Dispongo de pollo']) {
    assert.equal(positive(message, 'available')[0].surface, 'pollo', message);
  }
  assert.equal(positive('Tengo pollo y quiero cocinarlo', 'available')[0].surface, 'pollo');
  assert.equal(positive('Tengo pollo pero no sé qué cocinar', 'available')[0].surface, 'pollo');
});

test('WP2.1 treats confirmation tags and postposed attribution as non-authoritative', () => {
  for (const message of [
    'Tengo pollo, ¿verdad?', 'Tengo pollo, ¿no?', 'Tengo pollo, no?', 'Hay pollo, ¿verdad?',
    'Tengo huevo, cierto?', 'Tengo arroz, ¿cierto?', 'Tengo pollo, verdad?',
    'Tengo pollo, dijo Ana', 'Tengo pollo, dijo mi mamá', 'Hay arroz, me dijeron', 'Tengo huevo, según ella',
  ]) assert.equal(positive(message, 'available').length, 0, message);
});
