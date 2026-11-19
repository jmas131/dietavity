'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const workflow = read('n8n/Dietavity Sales Engine (Ticket 10).json');
const compose = read('deployment/docker-compose.ticket-96b-sandbox.template.yml');
const privateNginx = read('deployment/nginx/ticket96b-sandbox-private.conf.template');
const webhookNginx = read('deployment/nginx/ticket96b-sandbox-webhook.conf.template');
const runbook = read('deployment/TICKET-96B-SANDBOX-RUNBOOK.md');

test('sandbox environment allowlist exactly covers canonical Sales Engine $env references', () => {
  const values = new Set([...workflow.matchAll(/\$env\.([A-Z0-9_]+)/g)].map(match => match[1]));
  assert.deepEqual([...values].sort(), [
    'OPENAI_API_KEY', 'STRIPE_API_KEY', 'TWILIO_ACCOUNT_SID',
    'TWILIO_MESSAGING_SERVICE_SID', 'TWILIO_SALES_REMINDER_CANONICAL_BODY',
    'TWILIO_SALES_REMINDER_CONTENT_SID',
  ]);
  assert.match(compose, /N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"/);
  for (const name of values) assert.match(compose, new RegExp(`${name}: \\$\\{SANDBOX_`));
  assert.match(runbook, /exact allowlist/i);
});

test('sandbox network and Nginx templates remain private and public webhook routing fails closed', () => {
  assert.match(compose, /name: dietavity_ticket96b_n8n_data/);
  assert.match(compose, /subnet: 172\.19\.0\.0\/24/);
  assert.match(compose, /ipv4_address: 172\.19\.0\.2/);
  assert.match(privateNginx, /listen 172\.19\.0\.1:12751/);
  assert.equal((privateNginx.match(/allow 172\.19\.0\.2;/g) || []).length, 3);
  assert.match(privateNginx, /internal\/media-enrichment\/v1\/resolve/);
  assert.match(privateNginx, /127\.0\.0\.1:3101/);
  assert.match(webhookNginx, /location \^~ \/webhook\/ \{ return 404; \}/);
  assert.doesNotMatch(webhookNginx, /location \^~ \/webhook\/ \{\s*proxy_pass/s);
  assert.match(webhookNginx, /webhookId bce2dfd3-7d1c-4217-9a6c-a350858e4726/);
  assert.match(compose, /ACTIVATION BLOCKER: replace this mutable version tag/);
});
