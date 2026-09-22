'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, 'n8n', 'Dietavity Weekly Report.json');
const builderPath = path.join(
  root, 'n8n', 'source', 'Dietavity Weekly Report.builder.js'
);
const workflowText = fs.readFileSync(workflowPath, 'utf8');
const workflow = JSON.parse(workflowText);
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const builderSource = fs.readFileSync(builderPath, 'utf8').trimEnd();
const { applyTicket15, serialize } = require('../scripts/refactor-ticket-15-weekly-report');

function runBuilder(items) {
  return vm.runInNewContext(`(function () { ${builderSource} })()`, { items })[0].json;
}

const fixture = runBuilder([
  {
    json: {
      session_id: '+5215511112222',
      role: 'inbound',
      content: 'Mi correo es Ana.Example+lead@example.com y mi WhatsApp: 55 1234 5678. Como 1800 kcal y el precio de 499 me preocupa.',
    },
  },
  {
    json: {
      session_id: '+5215511112222',
      role: 'outbound',
      content: 'Completa tu perfil en https://dietavity.com/setup/private-token-123 o recupera en https://dietavity.com/recuperar-acceso/recovery-token-456',
    },
  },
  {
    json: {
      session_id: 'canonical-session-secret-B',
      role: 'inbound',
      content: 'Llámame al 5512345678. ¿Puedo comprar hoy?',
    },
  },
]);

test('builder groups by real session keys but sends only anonymous ordinal labels', () => {
  assert.equal(fixture.total_conversations, 2);
  assert.equal(fixture.total_messages, 3);
  assert.match(fixture.user_message, /CONVERSATION 1/);
  assert.match(fixture.user_message, /CONVERSATION 2/);
  assert.doesNotMatch(fixture.user_message, /Session:/i);
  assert.doesNotMatch(fixture.user_message, /\+5215511112222/);
  assert.doesNotMatch(fixture.user_message, /canonical-session-secret-B/);
});

test('builder removes obvious email, phone, and portal-link identifiers conservatively', () => {
  assert.doesNotMatch(fixture.user_message, /Ana\.Example\+lead@example\.com/i);
  assert.doesNotMatch(fixture.user_message, /55 1234 5678|5512345678/);
  assert.doesNotMatch(fixture.user_message, /private-token-123/);
  assert.doesNotMatch(fixture.user_message, /recovery-token-456/);
  assert.match(fixture.user_message, /\[email removed\]/);
  assert.match(fixture.user_message, /\[phone removed\]/);
  assert.match(fixture.user_message, /\[link removed\]/);
  assert.match(fixture.user_message, /1800 kcal/);
  assert.match(fixture.user_message, /precio de 499/);
});

test('analysis contract uses accurate metrics and paraphrased aggregate patterns', () => {
  const prompt = fixture.system_message;
  assert.match(prompt, /Conversations observed during the last 7 days/i);
  assert.doesNotMatch(prompt, /active onboarding conversations/i);
  assert.doesNotMatch(prompt, /Important direct quotes from users/i);
  assert.match(prompt, /Representative user patterns, paraphrased and aggregated/i);
  assert.match(prompt, /Do not reproduce verbatim customer messages/i);
  assert.match(prompt, /do not invent quotes/i);
  assert.match(prompt, /Do not include personal identifiers or infer identities/i);
  assert.match(prompt, /Aggregate and generalize health-related information/i);
});

test('analysis contract preserves the required commercial and product intelligence', () => {
  const prompt = fixture.system_message;
  for (const signal of [
    /user goals/i,
    /objections/i,
    /drop-off or abandonment/i,
    /Assistant failure cases/i,
    /Purchase-intent signals/i,
    /FAQ candidates/i,
    /Onboarding improvement/i,
    /Marketing and positioning insights/i,
  ]) assert.match(prompt, signal);
});

test('analysis output remains an email-compatible HTML fragment', () => {
  const prompt = fixture.system_message;
  assert.match(prompt, /clean HTML suitable for an email body/i);
  assert.match(prompt, /headings, paragraphs, and lists/i);
  assert.match(prompt, /<strong>/);
  assert.match(prompt, /Do not include markdown/i);
  assert.match(prompt, /Do not include html, head, or body tags/i);

  const email = nodes.get('Send an Email');
  assert.equal(email.type, 'n8n-nodes-base.emailSend');
  assert.equal(email.parameters.html, '={{ $json.choices[0].message.content }}');
  assert.ok(email.credentials.smtp);
});

test('SQL retains seven-day canonical grouping without additional sensitive joins', () => {
  const query = nodes.get('SQL query').parameters.query;
  assert.match(query, /FROM public\.messages AS message/);
  assert.match(query, /message\.timestamp >= NOW\(\) - INTERVAL '7 days'/);
  assert.match(query, /COALESCE\(message\.session_id/);
  assert.match(query, /ORDER BY session_id, message\.timestamp, message\.id/);
  assert.doesNotMatch(query, /JOIN public\.users|whatsapp_id|email|portal_token|stripe_(?:customer|checkout_session)_id/i);
  assert.doesNotMatch(query, /profile|health|medication/i);
});

test('generated workflow is synchronized with the Ticket 15 source and generator', () => {
  assert.equal(
    nodes.get('Build Onboarding Analysis Input').parameters.jsCode,
    builderSource
  );
  assert.equal(
    serialize(applyTicket15(workflow, `${builderSource}\n`)),
    workflowText
  );
});
