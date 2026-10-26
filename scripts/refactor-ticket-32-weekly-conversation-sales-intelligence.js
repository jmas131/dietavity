'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const workflowName = 'Dietavity Weekly Conversation & Sales Intelligence';
const workflowPath = path.join(root, 'n8n', `${workflowName}.json`);
const builderPath = path.join(root, 'n8n', 'source', `${workflowName}.builder.js`);
const formatterPath = path.join(root, 'n8n', 'source', `${workflowName}.formatter.js`);

const AUDITOR_CANONICAL_CONTEXT = `# Producto actual verificado
- Dietavity es un asistente de decisiones de comida por WhatsApp, inicialmente para personas que usan GLP-1.
- Puede ayudar con qué comer después de reportar una comida, apetito bajo, alimentos disponibles, antojos, restaurante, menú o contexto de entrega.
- La ayuda debe ser breve, práctica y sensible al contexto de la conversación.
- La adquisición actual ocurre mediante Meta Click-to-WhatsApp; Meta, no este flujo, es la fuente de impresiones, clics, gasto, CTR, CAC y atribución de anuncios.
- La validación actual usa una prueba gratuita aproximada de una semana, inicialmente manual.
- Una hipótesis futura de pago de tres meses prepagados sin suscripción ni renovación automática no está implementada ni validada.
- Dietavity no vende, prescribe, suministra ni modifica medicamentos o tratamientos GLP-1.

# Límites de seguridad
- Dietavity da apoyo general para decisiones de comida; no diagnostica, trata enfermedades, prescribe terapia nutricional clínica ni modifica medicamentos.
- Una pregunta médica debe redirigirse a atención profesional apropiada. Evalúa por separado si la respuesta también ofreció ayuda de comida segura y separable, en vez de rechazarla innecesariamente.
- No inventes funciones, políticas, precios, profesionales humanos, resultados de salud, ni datos de producto no confirmados.`;

const AUDIT_QUERY = `WITH local_clock AS (
  SELECT (NOW() AT TIME ZONE 'America/Mexico_City')::date AS current_local_date
), bounds AS (
  SELECT ((current_local_date - 7)::timestamp AT TIME ZONE 'America/Mexico_City') AS window_start,
    (current_local_date::timestamp AT TIME ZONE 'America/Mexico_City') AS window_end,
    (current_local_date - 7)::text AS reporting_start_date, (current_local_date - 1)::text AS reporting_end_date
  FROM local_clock
), session_first_observed AS (
  SELECT session_id, MIN(timestamp) AS first_observed_at FROM public.messages WHERE session_id IS NOT NULL GROUP BY session_id
)
SELECT message.id, message.session_id, message.timestamp,
  (message.timestamp AT TIME ZONE 'America/Mexico_City')::date AS local_message_date,
  message.direction, message.body, message.message_kind, message.in_reply_to_id, message.delivery_status,
  first_seen.first_observed_at, bounds.window_start, bounds.reporting_start_date, bounds.reporting_end_date
FROM bounds LEFT JOIN public.messages AS message
  ON message.timestamp >= bounds.window_start AND message.timestamp < bounds.window_end
 AND message.session_id IS NOT NULL AND message.direction IN ('inbound', 'outbound') AND message.body IS NOT NULL
LEFT JOIN session_first_observed AS first_seen ON first_seen.session_id = message.session_id
ORDER BY message.session_id, message.timestamp, message.id;`;

const evidenceStrength = { type: 'string', enum: ['weak', 'moderate', 'strong'] };
const evidence = { type: 'array', items: { type: 'string', pattern: '^CONVERSATION-[A-F0-9]{8}$' }, maxItems: 10 };
const finding = { type: 'object', additionalProperties: false, required: ['theme', 'observed', 'interpretation', 'recommended_action', 'evidence_strength', 'evidence'], properties: { theme: { type: 'string' }, observed: { type: 'string' }, interpretation: { type: 'string' }, recommended_action: { type: 'string' }, evidence_strength: evidenceStrength, evidence } };
const RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['sample_quality', 'executive_summary', 'usage_classification', 'what_users_need_help_with', 'recommendation_quality', 'glp1_appetite_patterns', 'medical_boundary_handling', 'product_friction_confusion', 'commercial_wtp_signals', 'technical_conversation_failures', 'representative_evidence', 'priorities_next_week'],
  properties: {
    sample_quality: { type: 'string' }, executive_summary: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    usage_classification: { type: 'object', additionalProperties: false, required: ['activated_conversations', 'food_decision_interactions', 'repeat_food_decision_conversations', 'notes', 'evidence'], properties: { activated_conversations: { type: 'integer', minimum: 0 }, food_decision_interactions: { type: 'integer', minimum: 0 }, repeat_food_decision_conversations: { type: 'integer', minimum: 0 }, notes: { type: 'array', items: { type: 'string' }, maxItems: 5 }, evidence } },
    what_users_need_help_with: { type: 'array', items: finding, maxItems: 8 }, recommendation_quality: { type: 'array', items: finding, maxItems: 8 }, glp1_appetite_patterns: { type: 'array', items: finding, maxItems: 6 }, medical_boundary_handling: { type: 'array', items: finding, maxItems: 6 }, product_friction_confusion: { type: 'array', items: finding, maxItems: 6 }, commercial_wtp_signals: { type: 'array', items: finding, maxItems: 6 }, technical_conversation_failures: { type: 'array', items: finding, maxItems: 5 }, representative_evidence: { type: 'array', items: finding, maxItems: 6 }, priorities_next_week: { type: 'array', items: { type: 'string' }, maxItems: 3 },
  },
};
function hydrateBuilderSource(source) { const marker = '__CANONICAL_PRODUCT_CONTEXT__'; if (!source.includes(marker)) throw new Error(`Missing builder marker: ${marker}`); return source.replace(marker, JSON.stringify(AUDITOR_CANONICAL_CONTEXT)); }
function buildOpenAiRequestBody() {
  const request = { model: 'gpt-5-mini', response_format: { type: 'json_schema', json_schema: { name: 'weekly_product_conversation_intelligence', strict: true, schema: RESPONSE_SCHEMA } }, messages: [{ role: 'system', content: '__N8N_SYSTEM_MESSAGE_EXPRESSION__' }, { role: 'user', content: '__N8N_USER_MESSAGE_EXPRESSION__' }] };
  return `=${JSON.stringify(request, null, 2)}`.replace('"__N8N_SYSTEM_MESSAGE_EXPRESSION__"', '{{ JSON.stringify($json.system_message) }}').replace('"__N8N_USER_MESSAGE_EXPRESSION__"', '{{ JSON.stringify($json.user_message) }}');
}
const OPENAI_REQUEST_BODY = buildOpenAiRequestBody();
function buildWorkflow(builderSource, formatterSource) {
  const node = (name, type, typeVersion, parameters, extra) => ({ name, type, typeVersion, parameters, ...extra });
  return { name: workflowName, nodes: [
    node('Weekly Schedule Trigger', 'n8n-nodes-base.scheduleTrigger', 1.3, { rule: { interval: [{ field: 'weeks', triggerAtDay: [1], triggerAtHour: 8 }] } }, { position: [0, 0], id: '6e35d5b6-48f1-45de-9f8e-f0dbf14072a1' }),
    node('Fetch Canonical Messages - Previous 7 Complete Days', 'n8n-nodes-base.postgres', 2.6, { operation: 'executeQuery', query: AUDIT_QUERY, options: {} }, { position: [224, 0], id: 'c02ac4ea-aac8-41de-a5db-a65c04eb1df0', alwaysOutputData: true, credentials: { postgres: { id: 'gXJ1myheSM6x1XB8', name: 'Postgres account' } } }),
    node('Prepare Weekly Intelligence Input', 'n8n-nodes-base.code', 2, { jsCode: hydrateBuilderSource(builderSource).trimEnd() }, { position: [448, 0], id: '74780fbf-2955-4b61-b0ab-ec908855fc1b' }),
    node('Has Conversations to Analyze?', 'n8n-nodes-base.if', 2.3, { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 }, conditions: [{ id: '5d36edfd-aaf9-4b19-af27-bb81797f5f9d', leftValue: '={{ $json.analysis_required }}', rightValue: 0, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} }, { position: [672, 0], id: 'da46d0e0-918c-4b72-a574-9a04461bbd15' }),
    node('AI Weekly Product Intelligence Auditor', 'n8n-nodes-base.httpRequest', 4.3, { method: 'POST', url: 'https://api.openai.com/v1/chat/completions', sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.OPENAI_API_KEY }}' }, { name: 'Content-Type', value: 'application/json' }] }, sendBody: true, specifyBody: 'json', jsonBody: OPENAI_REQUEST_BODY, options: {} }, { position: [896, -96], id: '88b5f766-1d2f-4f1e-983f-f0512993642a' }),
    node('Format Weekly Intelligence Email', 'n8n-nodes-base.code', 2, { jsCode: formatterSource.trimEnd() }, { position: [1120, -96], id: '8e279748-e174-4aca-9721-02c046ace731' }),
    node('Email Weekly Intelligence', 'n8n-nodes-base.emailSend', 2.1, { fromEmail: 'workflow@dietavity.com', toEmail: 'juan@autorintelectual.com', subject: '=Dietavity Weekly Product & Conversation Intelligence - {{ $json.reporting_start_date }} to {{ $json.reporting_end_date }}', html: '={{ $json.report_html }}', options: {} }, { position: [1344, 0], id: '3fd36e60-14a7-4a5d-af13-83dab9b905f9', credentials: { smtp: { id: 'xPyJTRqsHIMJBFhs', name: 'Workflow' } } }),
  ], pinData: {}, connections: {
    'Weekly Schedule Trigger': { main: [[{ node: 'Fetch Canonical Messages - Previous 7 Complete Days', type: 'main', index: 0 }]] }, 'Fetch Canonical Messages - Previous 7 Complete Days': { main: [[{ node: 'Prepare Weekly Intelligence Input', type: 'main', index: 0 }]] }, 'Prepare Weekly Intelligence Input': { main: [[{ node: 'Has Conversations to Analyze?', type: 'main', index: 0 }]] }, 'Has Conversations to Analyze?': { main: [[{ node: 'AI Weekly Product Intelligence Auditor', type: 'main', index: 0 }], [{ node: 'Email Weekly Intelligence', type: 'main', index: 0 }]] }, 'AI Weekly Product Intelligence Auditor': { main: [[{ node: 'Format Weekly Intelligence Email', type: 'main', index: 0 }]] }, 'Format Weekly Intelligence Email': { main: [[{ node: 'Email Weekly Intelligence', type: 'main', index: 0 }]] },
  }, active: false, settings: { executionOrder: 'v1', binaryMode: 'separate', timezone: 'America/Mexico_City', errorWorkflow: 'sa10JQEAbxNYvCGG', availableInMCP: false }, versionId: '5ce49612-d3e6-4c04-bfc4-d41dfba4f69e', meta: { templateCredsSetupCompleted: true, instanceId: '2edd72e6d5781df09a60b65fd523f4841afca081863c21ef852a5bbcd21fdca1' }, id: 'ticket19DailyAuditor', tags: [] };
}
function serialize(workflow) { return `${JSON.stringify(workflow, null, 2)}\n`; }
function generate() { return serialize(buildWorkflow(fs.readFileSync(builderPath, 'utf8'), fs.readFileSync(formatterPath, 'utf8'))); }
function main() { const generated = generate(); if (process.argv.includes('--check')) { if ((fs.existsSync(workflowPath) ? fs.readFileSync(workflowPath, 'utf8') : '') !== generated) { console.error(`${workflowName}.json is not synchronized with source.`); process.exitCode = 1; } return; } fs.writeFileSync(workflowPath, generated); }
if (require.main === module) main();
module.exports = { AUDITOR_CANONICAL_CONTEXT, AUDIT_QUERY, RESPONSE_SCHEMA, OPENAI_REQUEST_BODY, hydrateBuilderSource, buildOpenAiRequestBody, buildWorkflow, generate, serialize };
