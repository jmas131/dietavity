'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rag = require('../lib/sales-engine-v2/direct-rag-v3');

function context(message) { return rag.extractSemanticContext(message).food_context; }
function compact(message) {
  return context(message).structured_food_mentions.map(mention => [
    mention.surface, mention.relation, mention.polarity, mention.temporal_scope, mention.evidence.start, mention.evidence.end,
  ]);
}

test('C.3A discovers a comma-coordinated explicit P2 after a locally bound P1', () => {
  const message = 'Desayuné huevos, pero tengo pollo, tortillas y aguacate.';
  assert.deepEqual(compact(message).map(([surface, relation, polarity, temporal]) => [surface, relation, polarity, temporal]), [
    ['huevos', 'consumed', 'affirmed', 'past'],
    ['pollo', 'available', 'affirmed', 'current'],
    ['tortillas', 'available', 'affirmed', 'current'],
    ['aguacate', 'available', 'affirmed', 'current'],
  ]);
  assert.deepEqual(context(message).recently_consumed, ['huevos']);
  assert.deepEqual(context(message).available_foods, ['pollo', 'tortillas', 'aguacate']);
});

test('C.3A restarts an explicit P2 independently after a negated P1', () => {
  const message = 'No tengo pollo, pero comí pollo ayer';
  const mentions = compact(message);
  assert.deepEqual(mentions.map(([surface, relation, polarity, temporal]) => [surface, relation, polarity, temporal]), [
    ['pollo', 'available', 'negated', 'current'],
    ['pollo', 'consumed', 'affirmed', 'past'],
  ]);
  assert.notEqual(mentions[0][4], mentions[1][4]);
  for (const mention of context(message).structured_food_mentions) assert.equal(message.slice(mention.evidence.start, mention.evidence.end), mention.surface);
  assert.deepEqual(context(message).available_foods, []);
  assert.deepEqual(context(message).recently_consumed, ['pollo']);
});

test('C.3A gates restart on P1 authority while preserving closed explicit P2 coverage', () => {
  for (const [message, expected] of [
    ['No tengo pollo pero sí tengo huevo', [['pollo', 'available', 'negated'], ['huevo', 'available', 'affirmed']]],
    ['Preparé pollo y después comí arroz', [['pollo', 'prepared', 'affirmed'], ['arroz', 'consumed', 'affirmed']]],
    ['No preparé pollo, pero preparé arroz', [['pollo', 'prepared', 'negated'], ['arroz', 'prepared', 'affirmed']]],
    ['No cené pollo, pero comí huevos y tengo verduras', [['pollo', 'consumed', 'negated'], ['huevos', 'consumed', 'affirmed'], ['verduras', 'available', 'affirmed']]],
  ]) assert.deepEqual(compact(message).map(([surface, relation, polarity]) => [surface, relation, polarity]), expected, message);
  assert.deepEqual(context('No tengo pollo pero sí tengo huevo').available_foods, ['huevos']);

  // A locally bound but B.2-rejected P1 cannot create a factual P2 route.
  assert.deepEqual(compact('Tengo pollo, pero comí arroz?').map(([, relation]) => relation), ['mentioned', 'mentioned']);
});

test('C.3A rejects every reachable B.2-rejected P1 before factual P2 restart', () => {
  // Interrogation reaches B.2 with an approved coordinator; modifier cases
  // reach B.2 but their own material prevents the bounded restart separator.
  for (const message of [
    'Tengo pollo, pero comí arroz?',
    'Tengo pollo, ¿verdad?, pero comí arroz',
    'Tengo pollo, según Ana, pero comí arroz',
    'Tengo pollo, tal vez, pero comí arroz',
    'Tengo pollo si viene Ana, pero comí arroz',
  ]) {
    assert.deepEqual(compact(message).map(([, relation]) => relation), ['mentioned', 'mentioned'], message);
    assert.deepEqual(context(message).recently_consumed, [], message);
  }
});

test('C.3A gives every restarted explicit P2 fresh relation, polarity, and trust evaluation', () => {
  for (const [message, expected, available, consumed] of [
    ['Tengo pollo, pero comí arroz', [['pollo', 'available', 'affirmed'], ['arroz', 'consumed', 'affirmed']], ['pollo'], ['arroz']],
    ['No tengo pollo, pero tengo arroz', [['pollo', 'available', 'negated'], ['arroz', 'available', 'affirmed']], ['arroz'], []],
    ['Comí arroz, pero tengo pollo', [['arroz', 'consumed', 'affirmed'], ['pollo', 'available', 'affirmed']], ['pollo'], ['arroz']],
    ['Tengo pollo, pero no comí arroz', [['pollo', 'available', 'affirmed'], ['arroz', 'consumed', 'negated']], ['pollo'], []],
    ['Preparé pollo, pero comí arroz', [['pollo', 'prepared', 'affirmed'], ['arroz', 'consumed', 'affirmed']], [], ['arroz']],
  ]) {
    assert.deepEqual(compact(message).map(([surface, relation, polarity]) => [surface, relation, polarity]), expected, message);
    assert.deepEqual(context(message).available_foods, available, message);
    assert.deepEqual(context(message).recently_consumed, consumed, message);
  }
});

test('C.3A restarts every existing scanner construction that B.1 now recognizes', () => {
  for (const [message, expected] of [
    ['Tengo pollo, pero cené arroz', [['pollo', 'available', 'affirmed'], ['arroz', 'consumed', 'affirmed']]],
    ['Tengo pollo, pero desayuné huevos', [['pollo', 'available', 'affirmed'], ['huevos', 'consumed', 'affirmed']]],
    ['Tengo pollo, pero almorcé arroz', [['pollo', 'available', 'affirmed'], ['arroz', 'consumed', 'affirmed']]],
    ['Tengo pollo, pero merendé fruta', [['pollo', 'available', 'affirmed'], ['fruta', 'consumed', 'affirmed']]],
    ['Tengo pollo, pero ya comí arroz', [['pollo', 'available', 'affirmed'], ['arroz', 'consumed', 'affirmed']]],
    ['Tengo pollo, pero me preparé arroz', [['pollo', 'available', 'affirmed'], ['arroz', 'prepared', 'affirmed']]],
    ['Tengo pollo, pero voy a comer arroz', [['pollo', 'available', 'affirmed'], ['arroz', 'planned', 'affirmed']]],
    ['Comí arroz, pero cuento con pollo', [['arroz', 'consumed', 'affirmed'], ['pollo', 'available', 'affirmed']]],
    ['Comí arroz, pero dispongo de pescado', [['arroz', 'consumed', 'affirmed'], ['pescado', 'available', 'affirmed']]],
  ]) {
    assert.deepEqual(compact(message).map(([surface, relation, polarity]) => [surface, relation, polarity]), expected, message);
    for (const mention of context(message).structured_food_mentions) assert.equal(message.slice(mention.evidence.start, mention.evidence.end), mention.surface, message);
  }
});

test('C.3A separates trusted P1 from unsupported explicit planned P2 without promoting P2', () => {
  for (const [message, expected] of [
    ['Tengo pollo, pero voy a preparar arroz', [['pollo', 'available'], ['arroz', 'mentioned']]],
    ['Tengo pollo, pero voy a comprar arroz', [['pollo', 'available'], ['arroz', 'mentioned']]],
    ['Tengo pollo, pero quiero preparar arroz', [['pollo', 'available'], ['arroz', 'mentioned']]],
    ['Tengo pollo, pero quiero comer arroz', [['pollo', 'available'], ['arroz', 'mentioned']]],
    ['Comí arroz, pero voy a preparar pollo', [['arroz', 'consumed'], ['pollo', 'mentioned']]],
    ['Tengo pollo, pero mañana hacer arroz', [['pollo', 'available'], ['arroz', 'mentioned']]],
  ]) {
    assert.deepEqual(compact(message).map(([surface, relation]) => [surface, relation]), expected, message);
  }
  const unsafe = context('¿Tengo pollo?, pero voy a preparar arroz');
  assert.deepEqual(unsafe.structured_food_mentions.map(mention => mention.relation), ['mentioned', 'mentioned']);
  // This is the existing frozen B.2-supported planned construction, not one
  // of the unsupported planned forms above; it remains independently factual.
  assert.deepEqual(compact('Tengo pollo, pero mañana voy a comer arroz').map(([surface, relation]) => [surface, relation]), [['pollo', 'available'], ['arroz', 'planned']]);
});

test('C.3A restart never promotes an unsafe P2 or lets an unsafe P1 license it', () => {
  for (const message of [
    'Tengo pollo, pero tal vez comí arroz',
    'Tengo pollo, pero Ana dice que comí arroz',
    'Tengo pollo, pero si viene Ana comí arroz',
  ]) {
    const [first, second] = compact(message);
    assert.equal(first[1], 'available', message);
    assert.equal(second[1], 'mentioned', message);
    assert.deepEqual(context(message).recently_consumed, [], message);
  }
  // The frozen B.1 direct-question grammar safely leaves the entire clause
  // non-authoritative; it cannot promote P2 through the successful restart.
  assert.deepEqual(compact('Tengo pollo, pero ¿comí arroz?').map(([, relation]) => relation), ['mentioned', 'mentioned']);
  // B.2/B.3 independently regard a future-qualified consumed assertion as
  // factual; this result is relation-native, not inherited from P1.
  assert.deepEqual(compact('Tengo pollo, pero comí arroz mañana').map(([, relation]) => relation), ['available', 'consumed']);
  const rejectedP1 = context('Tal vez tengo pollo, pero comí arroz');
  assert.deepEqual(rejectedP1.structured_food_mentions.map(mention => mention.relation), ['mentioned', 'mentioned']);
  assert.deepEqual(rejectedP1.available_foods, []);
  assert.deepEqual(rejectedP1.recently_consumed, []);
});

test('C.3A accepts only a bounded coordinator separator and preserves raw offsets', () => {
  for (const message of ['Tengo pollo pero comí arroz', 'Tengo pollo,   pero comí arroz']) {
    const mentions = context(message).structured_food_mentions;
    assert.deepEqual(mentions.map(mention => mention.relation), ['available', 'consumed'], message);
    for (const mention of mentions) assert.equal(message.slice(mention.evidence.start, mention.evidence.end), mention.surface, message);
  }
  const emoji = '😀 Tengo pollo, pero comí arroz';
  for (const mention of context(emoji).structured_food_mentions) assert.equal(emoji.slice(mention.evidence.start, mention.evidence.end), mention.surface);
  assert.deepEqual(context('Tengo pollo, entonces comí arroz').structured_food_mentions.map(mention => mention.relation), ['available', 'mentioned']);
});
