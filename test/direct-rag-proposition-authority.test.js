'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { __testOnly } = require('../lib/sales-engine-v2/direct-rag-v3');

const { classifyPropositionOwnership, evaluatePropositionAuthority } = __testOnly;
const base = (overrides = {}) => ({
  ownership: 'user_context',
  assertionMode: 'asserted',
  boundaryDisposition: 'terminal',
  modifier: null,
  ambiguous: false,
  relation: 'available',
  ...overrides
});
const withModifier = (modifier, overrides = {}) => base({ boundaryDisposition: 'backward_modifier', modifier, ...overrides });
const ambiguous = (overrides = {}) => base({ boundaryDisposition: 'ambiguous', modifier: null, ambiguous: true, ...overrides });

test('ownership classifier recognizes only bounded user and existential constructions', () => {
  for (const construction of ['tengo', 'cuento_con', 'dispongo_de', 'comi', 'prepare', 'voy_a_comer', 'desayune', 'cene', 'almorce', 'merende']) {
    assert.deepEqual(classifyPropositionOwnership({ construction }), { ownership: 'user_context' }, construction);
  }
  assert.deepEqual(classifyPropositionOwnership({ construction: 'hay' }), { ownership: 'existential_context' });
  for (const descriptor of [
    { construction: 'comi', explicitSubject: 'third_party' },
    { construction: 'prepare', explicitSubject: 'third_party' },
    { construction: 'voy_a_comer', explicitSubject: 'third_party' },
    { construction: 'tengo', explicitSubject: 'third_party' },
    { construction: 'unknown' }
  ]) assert.deepEqual(classifyPropositionOwnership(descriptor), { ownership: 'unknown' });
});

test('authority is relation-independent across all supported relations', () => {
  const cases = [
    [withModifier('attribution'), { authoritative: false, mode: 'attributed', reason: 'attribution' }],
    [withModifier('uncertainty'), { authoritative: false, mode: 'uncertain', reason: 'uncertainty' }],
    [withModifier('conditional'), { authoritative: false, mode: 'conditional', reason: 'conditional' }],
    [{ assertionMode: 'interrogative' }, { authoritative: false, mode: 'interrogative', reason: 'interrogative' }],
    [withModifier('confirmation_tag'), { authoritative: false, mode: 'interrogative', reason: 'confirmation_tag' }],
    [ambiguous(), { authoritative: false, mode: 'unsupported', reason: 'ambiguous_boundary' }],
    [{}, { authoritative: true, mode: 'asserted', reason: 'user_context' }]
  ];
  for (const relation of ['available', 'consumed', 'prepared', 'planned']) for (const [overrides, expected] of cases) {
    assert.deepEqual(evaluatePropositionAuthority({ ...base({ relation }), ...overrides, relation }), expected, `${relation}: ${JSON.stringify(overrides)}`);
  }
});

test('authority preserves ownership while attribution, questions, conditionality, and uncertainty override it', () => {
  assert.deepEqual(evaluatePropositionAuthority(base({ ownership: 'existential_context' })), { authoritative: true, mode: 'asserted', reason: 'existential_context' });
  assert.deepEqual(evaluatePropositionAuthority(withModifier('attribution')), { authoritative: false, mode: 'attributed', reason: 'attribution' });
  assert.deepEqual(evaluatePropositionAuthority(base({ ownership: 'unknown' })), { authoritative: false, mode: 'unsupported', reason: 'unknown_ownership' });
  assert.deepEqual(evaluatePropositionAuthority(withModifier('attribution', { assertionMode: 'interrogative' })), { authoritative: false, mode: 'attributed', reason: 'attribution' });
  assert.deepEqual(evaluatePropositionAuthority(withModifier('uncertainty', { assertionMode: 'interrogative' })), { authoritative: false, mode: 'interrogative', reason: 'interrogative' });
  assert.deepEqual(evaluatePropositionAuthority(withModifier('conditional', { assertionMode: 'interrogative' })), { authoritative: false, mode: 'interrogative', reason: 'interrogative' });
  assert.deepEqual(evaluatePropositionAuthority(withModifier('confirmation_tag', { assertionMode: 'interrogative' })), { authoritative: false, mode: 'interrogative', reason: 'interrogative' });
});

test('authority rejects every contradictory boundary, modifier, and ambiguous state before precedence', () => {
  for (const descriptor of [
    base({ boundaryDisposition: 'backward_modifier' }),
    base({ modifier: 'attribution' }),
    base({ modifier: 'future_qualifier' }),
    base({ modifier: 'conditional' }),
    base({ boundaryDisposition: 'independent_proposition', modifier: 'uncertainty' }),
    base({ boundaryDisposition: 'ambiguous', modifier: 'attribution', ambiguous: true }),
    base({ boundaryDisposition: 'ambiguous' }),
    base({ ambiguous: true }),
    base({ boundaryDisposition: 'independent_proposition', ambiguous: true })
  ]) assert.deepEqual(evaluatePropositionAuthority(descriptor), { authoritative: false, mode: 'unsupported', reason: 'unsupported' });
  for (const modifier of ['confirmation_tag', 'attribution', 'future_qualifier', 'conditional', 'uncertainty']) {
    const result = evaluatePropositionAuthority(withModifier(modifier));
    assert.equal(result.authoritative, modifier === 'future_qualifier', modifier);
  }
});

test('direct negative assertions and direct future plans remain factual authority fixtures', () => {
  for (const relation of ['available', 'consumed', 'prepared', 'planned']) {
    assert.deepEqual(evaluatePropositionAuthority(base({ relation })), { authoritative: true, mode: 'asserted', reason: 'user_context' }, relation);
  }
  // Object polarity and temporal scope are intentionally absent from the contract.
  assert.equal(Object.hasOwn(base(), 'polarity'), false);
  assert.equal(Object.hasOwn(base(), 'temporalScope'), false);
});

test('invalid descriptors fail closed without mutation and authority results are frozen', () => {
  for (const descriptor of [
    null,
    [],
    { ...base(), relation: 'other' },
    { ...base(), modifier: 'other' },
    { ...base(), ownership: 'other' },
    { ...base(), extra: true },
    { ownership: 'user_context' }
  ]) assert.deepEqual(evaluatePropositionAuthority(descriptor), { authoritative: false, mode: 'unsupported', reason: 'unsupported' });
  const hostile = Object.create({ ownership: 'user_context' });
  Object.assign(hostile, { assertionMode: 'asserted', boundaryDisposition: 'terminal', modifier: null, ambiguous: false, relation: 'available' });
  assert.deepEqual(evaluatePropositionAuthority(hostile), { authoritative: false, mode: 'unsupported', reason: 'unsupported' });
  const accessor = {};
  Object.defineProperty(accessor, 'ownership', { enumerable: true, get() { throw new Error('unexpected read'); } });
  Object.assign(accessor, { assertionMode: 'asserted', boundaryDisposition: 'terminal', modifier: null, ambiguous: false, relation: 'available' });
  assert.deepEqual(evaluatePropositionAuthority(accessor), { authoritative: false, mode: 'unsupported', reason: 'unsupported' });
  const input = Object.freeze(base());
  const one = evaluatePropositionAuthority(input);
  const two = evaluatePropositionAuthority(input);
  assert.deepEqual(one, two);
  assert.ok(Object.isFrozen(one));
  assert.throws(() => { one.authoritative = false; }, TypeError);
  assert.deepEqual(input, base());
});

test('ownership and authority snapshot data descriptors without invoking untrusted gets', () => {
  const ownershipTarget = { construction: 'tengo' };
  const ownershipGetTrap = new Proxy(ownershipTarget, { get() { throw new Error('PROXY_GET'); } });
  assert.deepEqual(classifyPropositionOwnership(ownershipGetTrap), { ownership: 'user_context' });
  const authorityTarget = base();
  const authorityGetTrap = new Proxy(authorityTarget, { get() { throw new Error('PROXY_GET'); } });
  assert.deepEqual(evaluatePropositionAuthority(authorityGetTrap), { authoritative: true, mode: 'asserted', reason: 'user_context' });

  for (const proxy of [
    new Proxy(base(), { ownKeys() { throw new Error('OWN_KEYS'); } }),
    new Proxy(base(), { getOwnPropertyDescriptor() { throw new Error('DESCRIPTOR'); } })
  ]) assert.deepEqual(evaluatePropositionAuthority(proxy), { authoritative: false, mode: 'unsupported', reason: 'unsupported' });

  for (const proxy of [
    new Proxy({ construction: 'tengo' }, { ownKeys() { throw new Error('OWN_KEYS'); } }),
    new Proxy({ construction: 'tengo' }, { getOwnPropertyDescriptor() { throw new Error('DESCRIPTOR'); } })
  ]) assert.deepEqual(classifyPropositionOwnership(proxy), { ownership: 'unknown' });

  let relationReads = 0;
  const changing = new Proxy(base(), {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'relation') return { value: relationReads++ ? 'invalid' : 'available', enumerable: true, configurable: true, writable: true };
      return Object.getOwnPropertyDescriptor(target, key);
    }
  });
  assert.deepEqual(evaluatePropositionAuthority(changing), { authoritative: true, mode: 'asserted', reason: 'user_context' });
  assert.deepEqual(evaluatePropositionAuthority(changing), { authoritative: false, mode: 'unsupported', reason: 'unsupported' });
});

test('ownership and authority accept only realm-safe plain descriptors', () => {
  const crossRealm = source => vm.runInNewContext(`(${source})`);
  const ownership = { construction: 'tengo' };
  const authority = base();
  const nullPrototypeAuthority = Object.assign(Object.create(null), base());
  const crossRealmOwnership = crossRealm("({ construction: 'tengo' })");
  const crossRealmAuthority = crossRealm("({ ownership: 'user_context', assertionMode: 'asserted', boundaryDisposition: 'terminal', modifier: null, ambiguous: false, relation: 'available' })");
  const crossRealmCustomAuthority = crossRealm("new (class Descriptor { constructor() { Object.assign(this, { ownership: 'user_context', assertionMode: 'asserted', boundaryDisposition: 'terminal', modifier: null, ambiguous: false, relation: 'available' }); } })()");

  assert.notEqual(Object.getPrototypeOf(crossRealmOwnership), Object.prototype);
  assert.notEqual(Object.getPrototypeOf(crossRealmAuthority), Object.prototype);
  assert.deepEqual(classifyPropositionOwnership(ownership), classifyPropositionOwnership(crossRealmOwnership));
  assert.deepEqual(evaluatePropositionAuthority(authority), evaluatePropositionAuthority(crossRealmAuthority));
  assert.deepEqual(evaluatePropositionAuthority(nullPrototypeAuthority), evaluatePropositionAuthority(authority));

  class CustomAuthorityDescriptor {
    constructor() { Object.assign(this, base()); }
  }
  const customPrototype = Object.create(null);
  Object.assign(customPrototype, base());
  const customPrototypeInstance = Object.create(customPrototype);
  Object.assign(customPrototypeInstance, base());
  for (const descriptor of [
    null,
    [],
    'descriptor',
    1,
    () => base(),
    new CustomAuthorityDescriptor(),
    crossRealmCustomAuthority,
    customPrototypeInstance,
    { ...base(), relation: 'unsupported' },
    { ownership: 'user_context' },
  ]) assert.deepEqual(evaluatePropositionAuthority(descriptor), { authoritative: false, mode: 'unsupported', reason: 'unsupported' });

  for (const descriptor of [
    null,
    [],
    'descriptor',
    () => ({ construction: 'tengo' }),
    Object.assign(Object.create({}), { construction: 'tengo' }),
    { construction: 'tengo', extra: true },
  ]) assert.deepEqual(classifyPropositionOwnership(descriptor), { ownership: 'unknown' });
});

test('ownership classifier rejects inherited, accessor, extra, symbol, and contradictory descriptors', () => {
  const inherited = Object.create({ construction: 'tengo' });
  const accessor = {};
  Object.defineProperty(accessor, 'construction', { enumerable: true, get() { throw new Error('GETTER'); } });
  const withSymbol = { construction: 'tengo', [Symbol('extra')]: true };
  for (const descriptor of [
    inherited,
    accessor,
    { construction: 'tengo', extra: true },
    withSymbol,
    { construction: 'hay', explicitSubject: 'third_party' },
    { construction: 'tengo', explicitSubject: 'contradictory' }
  ]) assert.deepEqual(classifyPropositionOwnership(descriptor), { ownership: 'unknown' });
});
