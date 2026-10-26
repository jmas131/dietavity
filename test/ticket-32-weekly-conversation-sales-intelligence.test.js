'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const name = 'Dietavity Weekly Conversation & Sales Intelligence';
const workflowPath = path.join(root, 'n8n', `${name}.json`);
const builderPath = path.join(root, 'n8n', 'source', `${name}.builder.js`);
const formatterPath = path.join(root, 'n8n', 'source', `${name}.formatter.js`);
const generator = require('../scripts/refactor-ticket-32-weekly-conversation-sales-intelligence');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const builder = nodes.get('Prepare Weekly Intelligence Input').parameters.jsCode;
const formatter = fs.readFileSync(formatterPath, 'utf8').trimEnd();

function runBuilder(items) {
  return vm.runInNewContext(`(function () { ${builder} })()`, { items: items.map((json) => ({ json })), require, $env: { DAILY_AUDITOR_HMAC_SECRET: 'a'.repeat(32) } })[0].json;
}
function audit(overrides = {}) {
  return {
    sample_quality: 'Muestra pequeña; hallazgos direccionales.', executive_summary: ['Hay uso real de decisiones de comida.'],
    usage_classification: { activated_conversations: 1, food_decision_interactions: 2, repeat_food_decision_conversations: 1, notes: ['La activación excluye saludos aislados.'], evidence: ['CONVERSATION-AAAAAAAA'] },
    what_users_need_help_with: [], recommendation_quality: [], glp1_appetite_patterns: [], medical_boundary_handling: [], product_friction_confusion: [], commercial_wtp_signals: [], technical_conversation_failures: [], representative_evidence: [], priorities_next_week: ['Revisar la calidad de las decisiones repetidas.'], ...overrides,
  };
}
function runFormatter(value, prepared) {
  return vm.runInNewContext(`(function () { ${formatter} })()`, { $json: { choices: [{ message: { content: JSON.stringify(value) } }] }, $: (node) => { assert.equal(node, 'Prepare Weekly Intelligence Input'); return { first: () => ({ json: prepared }) }; } })[0].json;
}
function row(overrides = {}) {
  return { id: 'row-' + Math.random(), session_id: '+5215511112222', timestamp: '2026-10-20T15:00:00.000Z', local_message_date: '2026-10-20', direction: 'inbound', body: 'Tengo huevos y frijoles, ¿qué como?', message_kind: 'user', first_observed_at: '2026-10-20T15:00:00.000Z', window_start: '2026-10-19T06:00:00.000Z', reporting_start_date: '2026-10-19', reporting_end_date: '2026-10-25', ...overrides };
}

test('generated workflow is synchronized, inactive, and preserves weekly Mexico City scheduling', () => {
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.timezone, 'America/Mexico_City');
  assert.deepEqual(nodes.get('Weekly Schedule Trigger').parameters.rule.interval, [{ field: 'weeks', triggerAtDay: [1], triggerAtHour: 8 }]);
  assert.equal(generator.generate(), fs.readFileSync(workflowPath, 'utf8'));
  assert.equal(nodes.get('AI Weekly Product Intelligence Auditor').parameters.url, 'https://api.openai.com/v1/chat/completions');
});

test('query supplies deterministic session facts without joining a new analytics system', () => {
  const query = generator.AUDIT_QUERY;
  for (const value of ['session_first_observed', 'first_observed_at', 'local_message_date', 'window_start', "America/Mexico_City"]) assert.match(query, new RegExp(value));
  assert.match(query, /message\.timestamp >= bounds\.window_start/);
  assert.match(query, /message\.timestamp < bounds\.window_end/);
  assert.doesNotMatch(query, /JOIN public\.(?:users|profiles|purchases|subscriptions)|onboarding_chat_memory/i);
  assert.doesNotMatch(query, /meta.*(?:click|spend|ctr|cac)|analytics|events/i);
});

test('current WhatsApp food-decision authority replaces obsolete product authority', () => {
  const source = generator.AUDITOR_CANONICAL_CONTEXT + builder + formatter;
  assert.match(source, /asistente de decisiones de comida por WhatsApp/i);
  assert.match(source, /GLP-1/);
  assert.match(source, /restaurante, menú o contexto de entrega/i);
  assert.match(source, /tres meses prepagados/i);
  assert.doesNotMatch(source, /\$149|28 días|desayuno, comida, cena y snack|longevity|checkout|portal/i);
});

test('builder derives deterministic new and returning session activity while leaving activation semantic', () => {
  const prepared = runBuilder([
    row({ session_id: 'new', first_observed_at: '2026-10-20T15:00:00.000Z' }),
    row({ id: 'new-2', session_id: 'new', local_message_date: '2026-10-21', body: 'Hoy tengo poco apetito, ¿qué me conviene?', first_observed_at: '2026-10-20T15:00:00.000Z' }),
    row({ id: 'return-1', session_id: 'returning', first_observed_at: '2026-10-01T15:00:00.000Z' }),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.deterministic_snapshot)), { conversations_observed: 2, messages_observed: 3, new_conversations: 1, returning_conversations: 1, conversations_with_multiple_inbound_messages: 1, conversations_active_on_multiple_local_days: 1 });
  assert.match(prepared.system_message, /Un saludo solo no activa/);
  assert.match(prepared.system_message, /No inventes retención Day-1\/3\/7/);
  assert.doesNotMatch(prepared.user_message, /session_id|\+5215511112222/i);
});

test('activation, recommendation quality, medical separability, and commercial boundaries are explicit', () => {
  const prompt = builder;
  for (const value of [/solicita ayuda real de decisión de comida/i, /útil, práctica, culinariamente razonable/i, /ayuda de comida práctica sin diagnóstico/i, /no supongas precio, pago, suscripción/i]) assert.match(prompt, value);
  const html = runFormatter(audit(), { total_conversations: 2, reporting_start_date: '2026-10-19', reporting_end_date: '2026-10-25', deterministic_snapshot: { conversations_observed: 2, messages_observed: 3, new_conversations: 1, returning_conversations: 1, conversations_with_multiple_inbound_messages: 1, conversations_active_on_multiple_local_days: 1 } }).report_html;
  for (const heading of ['USAGE SNAPSHOT', 'WHAT USERS NEED HELP WITH', 'RECOMMENDATION QUALITY', 'GLP-1 / APPETITE PATTERNS', 'MEDICAL / SAFETY BOUNDARY HANDLING', 'COMMERCIAL / WILLINGNESS-TO-PAY SIGNALS', 'TOP 3 RECOMMENDED ACTIONS']) assert.match(html, new RegExp(heading));
  assert.match(html, /Informational only; no current price or payment offer is assumed/);
});

test('privacy redaction and graph/error handling remain intact', () => {
  const prepared = runBuilder([row({ body: 'Escríbeme a ana@example.com o al +52 55 1234 5678: https://example.com/setup/token?token=secret' })]);
  assert.doesNotMatch(prepared.user_message, /ana@example\.com|1234 5678|token=secret/i);
  assert.match(prepared.user_message, /CONVERSATION-[A-F0-9]{8}/);
  assert.equal(workflow.settings.errorWorkflow, 'sa10JQEAbxNYvCGG');
  assert.deepEqual(workflow.connections['Format Weekly Intelligence Email'].main[0].map((edge) => edge.node), ['Email Weekly Intelligence']);
});
