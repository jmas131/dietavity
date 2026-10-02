'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_HOST,
  DEFAULT_PORT,
  ListenerConfigError,
  parseListenerConfig
} = require('../lib/listener-config');

test('listener defaults to private loopback and accepts explicit numeric non-wildcard overrides', () => {
  assert.deepEqual(parseListenerConfig({}), {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT
  });
  assert.deepEqual(parseListenerConfig({
    DIETAVITY_LISTENER_HOST: '127.0.0.2',
    DIETAVITY_LISTENER_PORT: '3100'
  }), { host: '127.0.0.2', port: 3100 });
  assert.deepEqual(parseListenerConfig({
    DIETAVITY_LISTENER_HOST: '::1',
    DIETAVITY_LISTENER_PORT: 65535
  }), { host: '::1', port: 65535 });
});

test('listener rejects empty, wildcard, hostname, and invalid port configuration', () => {
  for (const env of [
    { DIETAVITY_LISTENER_HOST: '' },
    { DIETAVITY_LISTENER_HOST: 'dietavity.internal' },
    { DIETAVITY_LISTENER_HOST: '0.0.0.0' },
    { DIETAVITY_LISTENER_HOST: '::' },
    { DIETAVITY_LISTENER_PORT: '' },
    { DIETAVITY_LISTENER_PORT: '0' },
    { DIETAVITY_LISTENER_PORT: '65536' },
    { DIETAVITY_LISTENER_PORT: '3000.0' },
    { DIETAVITY_LISTENER_PORT: 'abc' }
  ]) {
    assert.throws(() => parseListenerConfig(env), ListenerConfigError);
  }
});

test('server binds using the validated listener instead of an implicit port-only bind', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /const \{ parseListenerConfig \} = require\('\.\/lib\/listener-config'\)/);
  assert.match(source, /app\.listen\(listener\.port, listener\.host,/);
  assert.doesNotMatch(source, /app\.listen\(3000/);
});
