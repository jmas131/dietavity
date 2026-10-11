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

const resolveAfter = (prefix, following, boundary = '', options = {}) => {
  const rawMessage = `${prefix}${boundary}${following}`;
  const start = prefix.length + boundary.length;
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
    ['      ¿verdad?', 3], ['¿verdad?', 7], ['¿Qué puedo cenar?', 4],
    ['según Ana', 3], ['mañana', 3], ['si viene Ana', 5], ['tal vez', 5]
  ]) {
    const { result } = resolve(following, '.', { maxLookahead });
    assert.equal(result.disposition, 'ambiguous', `${following} @ ${maxLookahead}`);
    assert.equal(result.consumedThrough, PREFIX.length + 1);
    assert.equal(result.followingRange, null);
  }
  assert.equal(resolve('Quiero cocinarlo.', '.', { maxLookahead: 9 }).result.disposition, 'independent_proposition');
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
    'QuieroX cocinarlo', 'ComíX pollo', 'TengoX arroz', 'HayX huevo', 'No tengoX arroz'
  ]) assert.equal(resolve(continuation).result.disposition, 'ambiguous', continuation);
  for (const continuation of ['Quiero cocinarlo2', 'No tengo arroz2']) {
    assert.equal(resolve(continuation).result.disposition, 'independent_proposition', continuation);
  }
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

test('bounded interrogative predicate starts include the optional reflexive marker without certifying P2', () => {
  const questions = ['¿Qué puedo comer?', '¿Cómo puedo prepararlo?', '¿Qué me puedo hacer?', '¿Cómo me puedo preparar algo?'];
  for (const question of questions) {
    const { rawMessage, start, result } = resolve(question);
    assert.equal(result.disposition, 'independent_proposition', question);
    assert.equal(result.independentStart, start, question);
    assert.equal(result.consumedThrough, start, question);
    assert.equal(result.followingRange, null, question);
    assert.equal(rawMessage.slice(result.independentStart), question, question);
  }

  for (const coordinator of ['pero', 'aunque', 'y', 'e']) for (const question of questions) {
    const { rawMessage, result } = resolve(`${coordinator} ${question}`);
    const start = rawMessage.indexOf(question);
    assert.equal(result.disposition, 'independent_proposition', `${coordinator} ${question}`);
    assert.equal(result.independentStart, start, `${coordinator} ${question}`);
    assert.equal(result.consumedThrough, start, `${coordinator} ${question}`);
  }

  for (const question of ['¿Qué puedox comer?', '¿Qué me puedox hacer?', '¿Cómo puedo2 prepararlo?', '¿Cómo me puedo_ preparar algo?', '¿Qué puedo\u0301 comer?', '¿Cómo me puedo\u0301 preparar algo?']) {
    assert.equal(resolve(question).result.disposition, 'ambiguous', question);
  }
});

test('bounded recommendation questions separate P1 without certifying P2', () => {
  // This is exactly the recommendation-question vocabulary recognized by the
  // current Direct RAG food-decision path: recomienda/recomiendas, optionally
  // addressed with "me". Plural "recomiendan" is not a current bounded form.
  const questions = ['¿Qué recomiendas?', '¿Qué me recomiendas?', '¿Qué me recomienda?'];
  for (const question of questions) {
    const { rawMessage, start, result } = resolve(question);
    assert.equal(result.disposition, 'independent_proposition', question);
    assert.equal(result.independentStart, start, question);
    assert.equal(result.consumedThrough, start, question);
    assert.equal(result.followingRange, null, question);
    assert.equal(rawMessage.slice(result.independentStart), question, question);
  }

  for (const coordinator of ['pero', 'aunque', 'y', 'e']) for (const question of questions) {
    const { rawMessage, result } = resolve(`${coordinator} ${question}`);
    const start = rawMessage.indexOf(question);
    assert.equal(result.disposition, 'independent_proposition', `${coordinator} ${question}`);
    assert.equal(result.independentStart, start, `${coordinator} ${question}`);
    assert.equal(result.consumedThrough, start, `${coordinator} ${question}`);
  }

  for (const question of [
    '¿Qué me recomiendan?', '¿Qué me recomend?', '¿Qué me recomiendasX?',
    '¿Qué me recomiendas_?', '¿Qué me recomiendas2?', '¿Qué me recomiendas\u0301?'
  ]) assert.equal(resolve(question).result.disposition, 'ambiguous', question);
});

test('recommendation-question starts require a completed bounded predicate token', () => {
  const continuation = 'pero ¿Qué me recomiendas arroz';
  const minimum = 'pero ¿Qué me recomiendas'.length;
  for (let cut = 0; cut < minimum; cut += 1) {
    assert.equal(resolve(continuation, '.', { maxLookahead: cut }).result.disposition, 'ambiguous', `cut ${cut}`);
  }
  assert.equal(resolve(continuation, '.', { maxLookahead: minimum }).result.disposition, 'independent_proposition');
  assert.equal(resolve('pero ¿Qué me recomiendasX', '.', { maxLookahead: minimum }).result.disposition, 'ambiguous');
});

test('coordinated continuations prove a separate proposition without consuming it', () => {
  for (const [following, predicate] of [
    ['pero no sé qué cocinar', 'no sé qué cocinar'],
    ['y quiero cocinarlo', 'quiero cocinarlo'],
    ['aunque tal vez cocino arroz', 'tal vez cocino'],
    ['entonces si viene Ana, cocino', 'si viene Ana'],
    ['pero Ana dice que cocine arroz', 'Ana dice que']
  ]) {
    const { rawMessage, result } = resolve(following);
    assert.equal(result.disposition, 'independent_proposition', following);
    assert.equal(result.independentStart, rawMessage.indexOf(predicate));
    assert.equal(result.consumedThrough, result.independentStart);
    assert.equal(result.followingRange, null);
  }
  assert.equal(resolveAfter('Hay espacio', ' y quiero usarlo').result.disposition, 'independent_proposition');
});

test('coordinated continuation grammar keeps P1 modifiers and non-predicate P2 starts fail closed', () => {
  for (const following of ['pero quizá', 'y entonces', 'aunque arroz', 'aunque tal vez pollo', 'aunque Ana', 'aunque ¿qué pollo']) {
    assert.equal(resolve(following).result.disposition, 'ambiguous', following);
  }
  assert.equal(resolve('pero no sé qué cocinar', '.', { maxLookahead: 'pero no s'.length }).result.disposition, 'ambiguous');
  for (const following of ['si viene Ana', 'cuando llegue Ana', 'tal vez', 'creo']) {
    const result = resolve(following).result;
    assert.notEqual(result.disposition, 'independent_proposition', following);
  }
  assert.equal(resolve('pero no sé qué cocinar', ';').result.disposition, 'independent_proposition');
  assert.equal(resolve(', pero no sé qué cocinar').result.disposition, 'independent_proposition');
  assert.equal(resolveAfter('Hay pollo', ' en casa').result.disposition, 'ambiguous');
});

test('coordinated conditional continuations require a bounded predicate, not arbitrary words', () => {
  for (const continuation of [
    'pero si acaso', 'pero si mañana', 'pero cuando mañana', 'y si', 'pero cuando'
  ]) assert.equal(resolve(continuation).result.disposition, 'ambiguous', continuation);

  for (const continuation of [
    'entonces si viene Ana, cocino', 'pero cuando llegue Ana, cocino'
  ]) {
    const { rawMessage, result } = resolve(continuation);
    assert.equal(result.disposition, 'independent_proposition', continuation);
    assert.equal(rawMessage.slice(result.independentStart), continuation.replace(/^(?:entonces|pero)\s+/u, ''));
    assert.equal(result.consumedThrough, result.independentStart);
  }

  for (const continuation of ['pero si viene Ana, cocino', 'pero cuando llegue Ana, cocino']) {
    const { result } = resolve(continuation, '.', { maxLookahead: continuation.indexOf('Ana') + 2 });
    assert.equal(result.disposition, 'ambiguous', `${continuation} truncated`);
  }
});

test('independent predicate starts separate P1 without certifying P2 completion', () => {
  const starts = [
    'no sé', 'no sé qué', 'no sé qué cocinar', 'quiero', 'quiero el', 'quiero arroz',
    'quiero si', 'no quiero', 'no quiero eso', 'comí', 'comí arroz', 'tengo',
    'tengo hambre', 'hay', 'hay espacio', 'tal vez cocino', 'probablemente preparo',
    'Ana dice', 'Ana dice que', 'Ana dice que cocine', '¿qué puedo',
    '¿qué puedo cocinar', '¿cómo puedo', '¿cómo puedo prepararlo'
  ];
  const ambiguous = [
    '', 'arroz', 'el arroz', 'mañana arroz', 'tal vez', 'tal vez pollo',
    'probablemente', 'probablemente arroz', 'Ana', '¿qué pollo', '¿cómo arroz', '¿cuál pollo'
  ];
  for (const coordinator of ['y', 'e', 'pero', 'aunque', 'mientras', 'entonces']) {
    for (const predicate of starts) {
      const { rawMessage, result } = resolve(`${coordinator} ${predicate}`);
      assert.equal(result.disposition, 'independent_proposition', `${coordinator} ${predicate}`);
      const start = rawMessage.indexOf(predicate);
      assert.equal(result.independentStart, start);
      assert.equal(result.consumedThrough, start);
      assert.equal(result.followingRange, null);
    }
    for (const prefix of ambiguous) {
      assert.equal(resolve(`${coordinator} ${prefix}`).result.disposition, 'ambiguous', `${coordinator} ${prefix}`);
    }
  }
});

test('predicate starts require complete lexical tokens but later P2 truncation does not revoke P1 separation', () => {
  for (const [continuation, minimum] of [
    ['pero quiero arroz', 'pero quiero'],
    ['pero no sé qué cocinar', 'pero no sé'],
    ['pero tal vez cocino arroz', 'pero tal vez cocino'],
    ['pero probablemente preparo algo', 'pero probablemente preparo'],
    ['pero Ana dice que cocine arroz', 'pero Ana dice'],
    ['pero ¿qué puedo cocinar', 'pero ¿qué puedo']
  ]) {
    for (const cut of [0, minimum.length - 2, minimum.length - 1]) {
      assert.equal(resolve(continuation, '.', { maxLookahead: cut }).result.disposition, 'ambiguous', `${continuation} @ ${cut}`);
    }
    const atMinimum = resolve(continuation, '.', { maxLookahead: minimum.length }).result;
    assert.equal(atMinimum.disposition, 'independent_proposition', `${continuation} minimum body`);
    assert.equal(atMinimum.followingRange, null);
  }
  for (const continuation of ['pero quier', 'pero quieroX', 'pero teng', 'pero tengoX', 'pero dic', 'pero diceX', 'pero ¿qué pued', 'pero ¿qué puedoX', 'pero tal vez cocin', 'pero tal vez cocinoX']) {
    assert.equal(resolve(continuation).result.disposition, 'ambiguous', continuation);
  }
});

test('B.1.2 closes required explicit P2 starts without accepting ellipsis', () => {
  const required = [
    ['pero sí tengo huevo', 'sí tengo huevo'],
    ['pero sí hay espacio', 'sí hay espacio'],
    ['pero sí quiero arroz', 'sí quiero arroz'],
    ['pero sí comí arroz', 'sí comí arroz'],
    ['pero preparé arroz', 'preparé arroz'],
    ['y después comí arroz', 'comí arroz'],
  ];
  for (const [continuation, predicate] of required) {
    const { rawMessage, result } = resolve(continuation);
    assert.equal(result.disposition, 'independent_proposition', continuation);
    assert.equal(rawMessage.slice(result.independentStart), predicate, continuation);
    assert.equal(result.consumedThrough, result.independentStart, continuation);
    assert.equal(result.followingRange, null, continuation);
  }
  for (const continuation of [
    'pero si tengo huevo', 'pero sí huevo', 'pero sí verduras',
    'y después arroz', 'y después sí huevo',
    'pero sí teng', 'pero sí tengoX', 'pero sí_tengo', 'pero sí tengo2', 'pero sí tengo\u0301',
    'y después comíX', 'y después_comí', 'y después comí2',
  ]) assert.equal(resolve(continuation).result.disposition, 'ambiguous', continuation);
  for (const [continuation, completed] of [
    ['pero sí tengo huevo', 'pero sí tengo'.length],
    ['y después comí arroz', 'y después comí'.length],
  ]) {
    for (const cut of [0, completed - 2, completed - 1]) assert.equal(resolve(continuation, '.', { maxLookahead: cut }).result.disposition, 'ambiguous', `${continuation} @ ${cut}`);
    assert.equal(resolve(continuation, '.', { maxLookahead: completed }).result.disposition, 'independent_proposition', `${continuation} @ exact start`);
  }
});

test('B.1.2A covers every scanner-supported explicit coordinated P2 construction', () => {
  const constructions = [
    ['cuento con', 'pollo'],
    ['dispongo de', 'pescado'],
    ['ya comí', 'arroz'],
    ['me comí', 'arroz'],
    ['desayuné', 'huevos'],
    ['cené', 'arroz'],
    ['almorcé', 'arroz'],
    ['merendé', 'fruta'],
    ['me preparé', 'arroz'],
    ['voy a comer', 'arroz'],
  ];
  for (const [predicate, object] of constructions) {
    for (const prefix of ['pero ', 'pero sí ']) {
      const continuation = `${prefix}${predicate} ${object}`;
      const { rawMessage, result } = resolve(continuation);
      assert.equal(result.disposition, 'independent_proposition', continuation);
      const expectedStart = rawMessage.indexOf(prefix.includes('sí') ? `sí ${predicate}` : predicate);
      assert.equal(result.independentStart, expectedStart, continuation);
      assert.equal(result.consumedThrough, expectedStart, continuation);
      assert.equal(result.followingRange, null, continuation);
    }
  }
});

test('B.1.2A requires complete bounded tokens for aligned P2 constructions', () => {
  const predicates = ['cuento con', 'dispongo de', 'ya comí', 'me comí', 'desayuné', 'cené', 'almorcé', 'merendé', 'me preparé', 'voy a comer'];
  for (const predicate of predicates) {
    const prefix = `pero ${predicate}`;
    const exact = resolve(`${prefix} arroz`, '.', { maxLookahead: prefix.length }).result;
    assert.equal(exact.disposition, 'independent_proposition', `${predicate} exact start`);
    for (const suffix of ['X', '2', '_', '\u0301']) {
      assert.equal(resolve(`${prefix}${suffix} arroz`).result.disposition, 'ambiguous', `${predicate}${suffix}`);
    }
    for (let cut = Math.max(0, prefix.length - 3); cut < prefix.length; cut += 1) {
      assert.equal(resolve(`${prefix} arroz`, '.', { maxLookahead: cut }).result.disposition, 'ambiguous', `${predicate} @ ${cut}`);
    }
  }
  for (const continuation of ['pero si cuento con pollo', 'pero sí cuento pollo', 'pero sí dispongo pescado']) {
    assert.equal(resolve(continuation).result.disposition, 'ambiguous', continuation);
  }
});

test('B.1.2B separates scanner-supported unsupported planned P2 starts without granting authority', () => {
  for (const [continuation, start] of [
    ['pero voy a preparar arroz', 'voy a preparar arroz'],
    ['pero voy a comprar arroz', 'voy a comprar arroz'],
    ['pero quiero preparar arroz', 'quiero preparar arroz'],
    ['pero quiero comer arroz', 'quiero comer arroz'],
    ['pero mañana voy a comer arroz', 'mañana voy a comer arroz'],
    ['pero mañana voy a preparar arroz', 'mañana voy a preparar arroz'],
    ['pero mañana hacer arroz', 'mañana hacer arroz'],
  ]) {
    const { rawMessage, result } = resolve(continuation);
    assert.equal(result.disposition, 'independent_proposition', continuation);
    assert.equal(result.independentStart, rawMessage.indexOf(start), continuation);
    assert.equal(result.consumedThrough, result.independentStart, continuation);
    assert.equal(result.followingRange, null, continuation);
  }
  for (const continuation of [
    'pero mañana', 'pero mañana arroz', 'pero mañana voy',
    'pero voy a prepar', 'pero voy a prepararX', 'pero voy a comprar2',
    'pero voy a preparar_arroz', 'pero mañana voy a comer\u0301 arroz',
  ]) assert.equal(resolve(continuation).result.disposition, 'ambiguous', continuation);
  assert.deepEqual([resolve('mañana').result.disposition, resolve('mañana arroz').result.disposition], ['backward_modifier', 'ambiguous']);
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
