'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json'), 'utf8'));
const nodes = new Map(workflow.nodes.map(node => [node.name, node]));
const gate = nodes.get('Authorize Production WhatsApp Recipient');
const outputs = name => (workflow.connections[name]?.main || []).flat().map(connection => connection.node);
const expected = '+15550000002';

function event(to, extra = {}) { return { data: { to, from: 'whatsapp:+15550000001', messageSid: `SM${'a'.repeat(32)}`, ...extra } }; }
function run(input, environment = { DIETAVITY_PRODUCTION_WHATSAPP_RECIPIENT: expected }) {
  const items = (Array.isArray(input) ? input : [input]).map(json => ({ json }));
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(function () { ${gate.parameters.jsCode}\n})()`, {
    $env: environment,
    $input: { all: () => items },
  })));
}

test('Ticket 96I recipient authorization precedes all 96B canonical work', () => {
  assert.equal(gate.type, 'n8n-nodes-base.code');
  assert.equal(gate.typeVersion, 2);
  assert.deepEqual(outputs('Incoming Message'), ['Authorize Production WhatsApp Recipient']);
  assert.deepEqual(outputs('Authorize Production WhatsApp Recipient'), ['Canonicalize Inbound WhatsApp']);
  assert.deepEqual(outputs('Canonicalize Inbound WhatsApp'), ['Reserve Canonical Inbound Message']);
});

test('Ticket 96I accepts only exact prefixed production recipients and rejects every mixed batch', () => {
  const authorized = event(`whatsapp:${expected}`, { body: 'foto', numMedia: 1 });
  assert.deepEqual(run(authorized), [{ json: authorized }]);
  for (const rejected of [
    event(expected), event('whatsapp:+15550000003'), event('WhatsApp:+15550000002'),
    event('whatsapp: +15550000002'), { data: {} }, {},
  ]) assert.deepEqual(run(rejected), []);
  assert.deepEqual(run([authorized, event('whatsapp:+15550000003')]), []);
  assert.deepEqual(run(authorized, { DIETAVITY_PRODUCTION_WHATSAPP_RECIPIENT: 'invalid' }), []);
});
