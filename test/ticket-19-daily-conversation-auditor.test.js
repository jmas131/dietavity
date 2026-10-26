'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const workflowName = 'Dietavity Weekly Conversation & Sales Intelligence';
const workflowPath = path.join(root, 'n8n', `${workflowName}.json`);
const builderPath = path.join(root, 'n8n', 'source', `${workflowName}.builder.js`);
const formatterPath = path.join(root, 'n8n', 'source', `${workflowName}.formatter.js`);
const workflowText = fs.readFileSync(workflowPath, 'utf8');
const workflow = JSON.parse(workflowText);
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const generator = require('../scripts/refactor-ticket-32-weekly-conversation-sales-intelligence');
const builderSource = generator.hydrateBuilderSource(fs.readFileSync(builderPath, 'utf8')).trimEnd();
const formatterSource = fs.readFileSync(formatterPath, 'utf8').trimEnd();
const hmacSecret = 'ticket-19-test-secret-with-at-least-32-characters';

function runBuilder(items, secret = hmacSecret) {
  const dated = items.map((item) => ({
    json: {
      reporting_start_date: '2026-08-17',
      reporting_end_date: '2026-08-23',
      window_start: '2026-08-17T06:00:00.000Z',
      ...(item.json || {}),
    },
  }));
  return vm.runInNewContext(`(function () { ${builderSource} })()`, {
    items: dated,
    require: (name) => {
      assert.equal(name, 'crypto');
      return crypto;
    },
    $env: { DAILY_AUDITOR_HMAC_SECRET: secret },
  })[0].json;
}

const fixture = runBuilder([
  { json: {
    id: '00000000-0000-0000-0000-000000000003', session_id: '+5215511112222',
    timestamp: '2026-08-18T10:03:00.000Z', direction: 'inbound',
    body: 'Tengo poco apetito y huevos; ¿qué me recomiendas? Mi correo es ana+lead@example.com.',
    message_kind: 'user', delivery_status: 'received',
  } },
  { json: {
    id: '00000000-0000-0000-0000-000000000001', session_id: '+5215511112222',
    timestamp: '2026-08-18T10:01:00.000Z', direction: 'outbound',
    body: 'Con poco apetito, prueba huevo con frijoles en una porción pequeña.', message_kind: 'assistant',
    delivery_status: 'delivered',
  } },
  { json: {
    id: '00000000-0000-0000-0000-000000000002', session_id: 'second-private-session',
    timestamp: '2026-08-18T10:02:00.000Z', direction: 'inbound',
    body: 'WhatsApp: 55 1234 5678; portal https://dietavity.com/setup/private-token-123',
    message_kind: 'user', delivery_status: 'received',
  } },
]);

test('preserves stable keyed HMAC labels without exposing raw sessions', () => {
  const expected = crypto.createHmac('sha256', hmacSecret)
    .update('+5215511112222', 'utf8').digest('hex').slice(0, 8).toUpperCase();
  assert.match(fixture.user_message, new RegExp(`CONVERSATION-${expected}`));
  assert.equal(fixture.total_conversations, 2);
  assert.doesNotMatch(fixture.user_message, /\+5215511112222|second-private-session/);
  assert.doesNotMatch(JSON.stringify(fixture), new RegExp(hmacSecret));
});

test('preserves PII/token redaction and useful food-decision evidence', () => {
  assert.doesNotMatch(fixture.user_message, /ana\+lead@example\.com|55 1234 5678|private-token-123/i);
  assert.match(fixture.user_message, /\[EMAIL REDACTED\]/);
  assert.match(fixture.user_message, /\[PHONE REDACTED\]/);
  assert.match(fixture.user_message, /\[SENSITIVE LINK REDACTED\]/);
  assert.match(fixture.user_message, /poco apetito/i);
  assert.match(fixture.user_message, /huevo con frijoles/i);
});

test('preserves chronological reconstruction and customer-visible metadata', () => {
  const question = fixture.user_message.indexOf('Con poco apetito, prueba huevo con frijoles');
  const answer = fixture.user_message.indexOf('Tengo poco apetito y huevos');
  assert.ok(question >= 0 && answer > question);
  assert.match(fixture.user_message, /DIETAVITY \[assistant\]/);
  assert.match(fixture.user_message, /CUSTOMER \[user\]/);
  assert.doesNotMatch(fixture.user_message, /00000000-0000|in_reply_to_id/);
});

test('zero conversations bypass AI and still produce a valid weekly report', () => {
  const empty = runBuilder([{ json: {} }]);
  assert.equal(empty.analysis_required, false);
  assert.equal(empty.total_conversations, 0);
  assert.match(empty.report_html, /WEEKLY PRODUCT &amp; CONVERSATION INTELLIGENCE/);
  assert.match(empty.report_html, /2026-08-17 to 2026-08-23/);
  assert.match(empty.report_html, /No customer-visible conversations were available for analysis\./);
  assert.equal(empty.system_message, undefined);

  const route = workflow.connections['Has Conversations to Analyze?'].main;
  assert.equal(route[0][0].node, 'AI Weekly Product Intelligence Auditor');
  assert.equal(route[1][0].node, 'Email Weekly Intelligence');
});

test('workflow preserves credentials, inactivity, error handling, and generated-source synchronization', () => {
  assert.equal(workflow.name, workflowName);
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.timezone, 'America/Mexico_City');
  assert.equal(workflow.settings.errorWorkflow, 'sa10JQEAbxNYvCGG');
  assert.ok(nodes.get('Email Weekly Intelligence').credentials.smtp);
  assert.equal(nodes.get('Prepare Weekly Intelligence Input').parameters.jsCode, builderSource);
  assert.equal(nodes.get('Format Weekly Intelligence Email').parameters.jsCode, formatterSource);
  assert.equal(generator.generate(), workflowText);
  assert.doesNotMatch(fixture.system_message + fixture.user_message, /juan@|workflow@/i);

  for (const [source, outputs] of Object.entries(workflow.connections)) {
    assert.ok(nodes.has(source), `missing source node: ${source}`);
    for (const groups of Object.values(outputs)) {
      for (const group of groups) for (const target of group) {
        assert.ok(nodes.has(target.node), `missing target node: ${target.node}`);
      }
    }
  }
});
