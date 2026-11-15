'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const compose = fs.readFileSync(path.join(__dirname, '..', 'deployment', 'docker-compose.production.template.yml'), 'utf8');
const nginx = fs.readFileSync(path.join(__dirname, '..', 'deployment', 'nginx', 'ticket76-conversation-engine-private.conf.template'), 'utf8');
const runbook = fs.readFileSync(path.join(__dirname, '..', 'deployment', 'TICKET-89-STATIC-IP-DEPLOYMENT.md'), 'utf8');

function block(source, heading) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `missing ${heading}`);
  const lines = source.slice(start).split('\n');
  const baseline = lines[0].match(/^\s*/)[0].length;
  const result = [];
  for (const line of lines.slice(1)) {
    if (line.trim() && line.match(/^\s*/)[0].length <= baseline) break;
    result.push(line);
  }
  return result.join('\n');
}

test('Ticket 89 pins the existing bridge and keeps static addresses outside the dynamic pool', () => {
  assert.match(compose, /^    name: root_default$/m);
  assert.match(compose, /^\s*- subnet: 172\.18\.0\.0\/16$/m);
  assert.match(compose, /^\s+gateway: 172\.18\.0\.1$/m);
  assert.match(compose, /^\s+ip_range: 172\.18\.128\.0\/25$/m);
  assert.match(block(compose, '  n8n:'), /^        ipv4_address: 172\.18\.0\.2$/m);
  assert.match(block(compose, '  gotenberg:'), /^        ipv4_address: 172\.18\.0\.3$/m);
  assert.equal('172.18.0.2'.startsWith('172.18.128.'), false);
  assert.equal('172.18.0.3'.startsWith('172.18.128.'), false);
});

test('Ticket 89 retains service connectivity, external n8n storage, and published ports', () => {
  assert.match(block(compose, '  n8n:'), /127\.0\.0\.1:5678:5678/);
  assert.match(block(compose, '  n8n:'), /n8n_data:\/home\/node\/\.n8n/);
  assert.match(block(compose, '  n8n:'), /\/local-files:\/files/);
  assert.match(block(compose, '  gotenberg:'), /3001:3000/);
  assert.match(compose, /^    external: true$/m);
  assert.match(compose, /^    name: n8n_data$/m);
});

test('private V4 access remains n8n-only and requires the forwarded secret header', () => {
  for (const version of ['v1', 'v4']) {
    const location = block(nginx, `    location = /internal/conversation-engine/${version}/resolve {`);
    assert.match(location, /limit_except POST/);
    assert.match(location, /allow 172\.18\.0\.2;/);
    assert.doesNotMatch(location, /allow 172\.18\.0\.0\/16/);
    assert.match(location, /deny all;/);
    assert.match(location, /proxy_set_header x-dietavity-conversation-engine-secret \$http_x_dietavity_conversation_engine_secret;/);
  }
});

test('deployment runbook prevents silent image, volume, listener, and recovery regressions', () => {
  for (const required of [
    'docker volume inspect n8n_data',
    "= 'volume:n8n_data'",
    'ACTUAL_ATTACHMENTS',
    '--pull never',
    'ticket89-n8n.image-id',
    'Disposable local IPAM check',
    "grep -F '172.18.0.1:12751'",
    'test "$ACTUAL_ATTACHMENTS" = "$EXPECTED_ATTACHMENTS"',
    'Gotenberg `403` check',
  ]) assert.match(runbook, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(runbook, /Dietavity WhatsApp Recovery\s+Poller/);
  assert.match(runbook, /Dietavity Ledger Health Monitor/);
  assert.doesNotMatch(runbook, /allow 172\.18\.0\.0\/16/);
});
