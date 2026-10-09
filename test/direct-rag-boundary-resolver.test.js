'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { __testOnly } = require('../lib/sales-engine-v2/direct-rag-v3');

const PREFIX = 'Tengo pollo';
const resolve = (following, boundary = '.', options = {}) => {
  const rawMessage = `${PREFIX}${boundary}${following}`;
  const start = PREFIX.length + boundary.length;
  return {
    rawMessage,
    start,
    result: __testOnly.resolveCandidateBoundary({
      rawMessage,
      proposition: Object.freeze({ relation: 'available' }),
      boundary: { kind: boundary, start: start - boundary.length, end: start },
      followingStart: start,
      ...options
    })
  };
};

test('boundary resolver classifies backward modifiers across supported delimiters', () => {
  for (const boundary of [',', ';', '.', '\n', ':', ' — ', ' (']) {
    for (const [following, modifier] of [['¿verdad?', 'confirmation_tag'], ['dijo Ana', 'attribution'], ['mañana', 'future_qualifier'], ['si viene Ana', 'conditional'], ['tal vez', 'uncertainty']]) {
      const { rawMessage, result } = resolve(following, boundary);
      assert.deepEqual([result.disposition, result.modifier], ['backward_modifier', modifier], `${boundary} ${following}`);
      assert.equal(rawMessage.slice(result.followingRange.start, result.followingRange.end), following, `${boundary} ${following}`);
      assert.equal(result.consumedThrough, result.followingRange.end);
      assert.equal(result.independentStart, null);
    }
  }
});

test('boundary resolver distinguishes actual EOF from bounded lookahead exhaustion', () => {
  const terminal = resolve('   ');
  assert.equal(terminal.result.disposition, 'terminal');
  assert.equal(terminal.result.consumedThrough, terminal.rawMessage.length);

  for (const [following, maxLookahead] of [
    ['      ¿verdad?', 3], ['¿verdad?', 7], ['Quiero cocinarlo.', 9], ['¿Qué puedo cenar?', 4],
    ['según Ana', 3], ['mañana', 3], ['si viene Ana', 5], ['tal vez', 5]
  ]) {
    const { result } = resolve(following, '.', { maxLookahead });
    assert.equal(result.disposition, 'ambiguous', `${following} @ ${maxLookahead}`);
    assert.equal(result.consumedThrough, PREFIX.length + 1);
    assert.equal(result.followingRange, null);
  }
});

test('confirmation tags require question syntax and negative starts are independent', () => {
  for (const tag of ['¿no?', 'no?', '¿verdad?', 'verdad?', '¿cierto?', 'cierto?']) {
    assert.deepEqual([resolve(tag).result.disposition, resolve(tag).result.modifier], ['backward_modifier', 'confirmation_tag'], tag);
  }
  for (const continuation of ['No tengo arroz.', 'No hay huevo.', 'No quiero pollo.']) {
    const { rawMessage, start, result } = resolve(continuation);
    assert.equal(result.disposition, 'independent_proposition', continuation);
    assert.equal(result.independentStart, start);
    assert.equal(result.consumedThrough, start);
    assert.equal(result.followingRange, null);
    assert.equal(rawMessage.slice(result.independentStart), continuation);
  }
});

test('modifier grammar respects lexical boundaries and bounded attribution', () => {
  for (const continuation of ['ciertamente', 'notable', 'siguiente', 'mañanero', 'tal vezs']) {
    assert.equal(resolve(continuation).result.disposition, 'ambiguous', continuation);
  }
  for (const continuation of ['dijo Ana', 'me dijeron', 'según Ana']) {
    assert.deepEqual([resolve(continuation).result.disposition, resolve(continuation).result.modifier], ['backward_modifier', 'attribution'], continuation);
  }
  for (const continuation of ['dije que tengo arroz', 'según', 'según el menú hay arroz']) assert.equal(resolve(continuation).result.disposition, 'ambiguous', continuation);
});

test('variable-length modifier matches require a raw-message completion boundary', () => {
  for (const [continuation, maxLookahead] of [
    ['según Ana María dijo que sí', 'según Ana'.length],
    ['si viene Ana, cocino', 'si viene'.length],
    ['cuando llegue Ana, cocino', 'cuando llegue'.length],
    ['esta noche después', 'esta noche'.length],
    ['tal vez probablemente', 'tal vez'.length]
  ]) {
    assert.equal(resolve(continuation, '.', { maxLookahead }).result.disposition, 'ambiguous', continuation);
  }
  for (const [continuation, modifier] of [
    ['según Ana, dijo que sí', 'attribution'], ['mañana, cocino', 'future_qualifier'],
    ['si viene Ana, cocino', 'conditional'], ['tal vez, cocino', 'uncertainty']
  ]) assert.deepEqual([resolve(continuation).result.disposition, resolve(continuation).result.modifier], ['backward_modifier', modifier], continuation);
});

test('shared raw token boundary rejects Unicode marks, digits, and token continuations', () => {
  for (const continuation of [
    'cierto2', 'verdad\u0301', 'noX', 'dijo Ana2', 'según Ana\u0301',
    'mañana2', 'mañanaX', 'si viene2', 'cuando llegueX',
    'tal vez\u0301', 'quizás2', 'probablementeX',
    'Quiero cocinarlo2', 'ComíX pollo', 'TengoX arroz', 'HayX huevo', 'No tengo arroz2'
  ]) assert.equal(resolve(continuation).result.disposition, 'ambiguous', continuation);
});

test('lookahead edges are bounded and never manufacture terminal or completion', () => {
  for (const [continuation, maxLookahead] of [
    ['mañana, cocino', 0], ['mañana, cocino', 1], ['mañana, cocino', 'mañ'.length],
    ['mañana, cocino', 'mañana'.length], ['mañana, cocino', 'mañana,'.length],
    ['si viene Ana, cocino', 'si viene Ana'.length], ['si viene Ana, cocino', 'si viene Ana,'.length]
  ]) {
    const result = resolve(continuation, '.', { maxLookahead }).result;
    const accepted = maxLookahead === 'mañana'.length || maxLookahead === 'mañana,'.length || maxLookahead === 'si viene Ana'.length || maxLookahead === 'si viene Ana,'.length;
    assert.equal(result.disposition, accepted ? 'backward_modifier' : 'ambiguous', `${continuation} @ ${maxLookahead}`);
  }
});

test('completed backward modifiers do not consume later independent text', () => {
  const { rawMessage, result } = resolve('tal vez, quiero cocinar arroz.');
  assert.deepEqual([result.disposition, result.modifier], ['backward_modifier', 'uncertainty']);
  assert.equal(rawMessage.slice(result.followingRange.start, result.followingRange.end), 'tal vez');
  assert.equal(rawMessage.slice(result.consumedThrough), ', quiero cocinar arroz.');
});

test('independent continuations expose only a restart point, never a consumed semantic body', () => {
  for (const continuation of [
    'Quiero cocinarlo con arroz.', 'Comí huevo y arroz.', 'Tengo arroz en casa.',
    'No tengo arroz.', 'No hay huevo.', 'No quiero pollo.', '¿Qué puedo cenar?'
  ]) {
    const { rawMessage, start, result } = resolve(continuation);
    assert.equal(result.disposition, 'independent_proposition', continuation);
    assert.equal(result.independentStart, start);
    assert.equal(result.consumedThrough, start);
    assert.equal(result.followingRange, null);
    assert.equal(rawMessage.slice(result.independentStart), continuation);
  }
});

test('boundary resolver is pure, relation-independent, deeply frozen, bounded, and raw-offset based', () => {
  const proposition = Object.freeze({ relation: 'consumed', nested: Object.freeze({ value: 1 }) });
  const rawMessage = '😀 I\u0307 Tengo pollo\n¿verdad?';
  const start = rawMessage.indexOf('\n') + 1;
  const args = { rawMessage, proposition, boundary: { kind: 'newline', start: start - 1, end: start }, followingStart: start };
  const one = __testOnly.resolveCandidateBoundary(args);
  const two = __testOnly.resolveCandidateBoundary({ ...args, proposition: Object.freeze({ relation: 'planned' }) });
  assert.deepEqual(one, two);
  assert.deepEqual(proposition, { relation: 'consumed', nested: { value: 1 } });
  assert.equal(rawMessage.slice(one.followingRange.start, one.followingRange.end), '¿verdad?');
  assert.ok(Object.isFrozen(one));
  assert.ok(Object.isFrozen(one.followingRange));
  assert.throws(() => { one.followingRange.start = 0; }, TypeError);
});
