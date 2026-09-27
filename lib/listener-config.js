'use strict';

const net = require('node:net');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const HOST_NAME = 'DIETAVITY_LISTENER_HOST';
const PORT_NAME = 'DIETAVITY_LISTENER_PORT';

class ListenerConfigError extends Error {
  constructor() {
    super('DIETAVITY_LISTENER_CONFIGURATION_INVALID');
    this.name = 'ListenerConfigError';
    this.code = 'DIETAVITY_LISTENER_CONFIGURATION_INVALID';
  }
}

function own(env, name) {
  return Object.prototype.hasOwnProperty.call(env, name);
}

function parseListenerConfig(env = process.env) {
  const rawHost = own(env, HOST_NAME) ? String(env[HOST_NAME]).trim() : DEFAULT_HOST;
  // Bind addresses are intentionally numeric: a typo cannot resolve to an
  // unexpected interface, and wildcard listeners are never an implicit path.
  if (!rawHost || !net.isIP(rawHost) || rawHost === '0.0.0.0' || rawHost === '::') throw new ListenerConfigError();
  const rawPort = own(env, PORT_NAME) ? String(env[PORT_NAME]).trim() : String(DEFAULT_PORT);
  if (!/^[1-9][0-9]{0,4}$/.test(rawPort)) throw new ListenerConfigError();
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port > 65535) throw new ListenerConfigError();
  return Object.freeze({ host: rawHost, port });
}

module.exports = { DEFAULT_HOST, DEFAULT_PORT, HOST_NAME, PORT_NAME, ListenerConfigError, parseListenerConfig };
