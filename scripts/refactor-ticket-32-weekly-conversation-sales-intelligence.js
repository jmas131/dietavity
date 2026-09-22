'use strict';

const fs = require('fs');
const path = require('path');
const {
  SALES_POSITIONING,
  PRODUCT_FACTS,
  MEDICAL_AND_SCOPE_BOUNDARIES,
} = require('../lib/dietavity-knowledge');

const root = path.resolve(__dirname, '..');
const workflowName = 'Dietavity Weekly Conversation & Sales Intelligence';
const workflowPath = path.join(root, 'n8n', `${workflowName}.json`);
const builderPath = path.join(root, 'n8n', 'source', `${workflowName}.builder.js`);
const formatterPath = path.join(root, 'n8n', 'source', `${workflowName}.formatter.js`);

const AUDITOR_CANONICAL_CONTEXT = [
  SALES_POSITIONING,
  PRODUCT_FACTS,
  MEDICAL_AND_SCOPE_BOUNDARIES,
  `# Additional verified product boundary
- Dietavity is not a prepared-food delivery service.
- WhatsApp is available for assistance.
- Any capability not stated in this canonical context requires verification.`,
].join('\n\n');

const AUDIT_QUERY = `WITH local_clock AS (
  SELECT (NOW() AT TIME ZONE 'America/Mexico_City')::date AS current_local_date
), bounds AS (
  SELECT
    ((current_local_date - 7)::timestamp AT TIME ZONE 'America/Mexico_City') AS window_start,
    (current_local_date::timestamp AT TIME ZONE 'America/Mexico_City') AS window_end,
    (current_local_date - 7)::text AS reporting_start_date,
    (current_local_date - 1)::text AS reporting_end_date
  FROM local_clock
)
SELECT
  message.id,
  message.session_id,
  message.timestamp,
  message.direction,
  message.body,
  message.message_kind,
  message.in_reply_to_id,
  message.delivery_status,
  bounds.reporting_start_date,
  bounds.reporting_end_date
FROM bounds
LEFT JOIN public.messages AS message
  ON message.timestamp >= bounds.window_start
 AND message.timestamp < bounds.window_end
 AND message.session_id IS NOT NULL
 AND message.direction IN ('inbound', 'outbound')
 AND message.body IS NOT NULL
ORDER BY message.session_id, message.timestamp, message.id;`;

const evidenceStrength = { type: 'string', enum: ['weak', 'moderate', 'strong'] };
const conversationEvidence = {
  type: 'array',
  items: { type: 'string', pattern: '^CONVERSATION-[A-F0-9]{8}$' },
  maxItems: 10,
};
const finding = {
  type: 'object',
  additionalProperties: false,
  required: ['theme', 'count', 'observed', 'interpretation', 'recommended_action', 'evidence_strength', 'evidence'],
  properties: {
    theme: { type: 'string' },
    count: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
    observed: { type: 'string' },
    interpretation: { type: 'string' },
    recommended_action: { type: 'string' },
    evidence_strength: evidenceStrength,
    evidence: conversationEvidence,
  },
};

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'prospect_conversations', 'customer_support_conversations', 'sample_quality',
    'executive_summary', 'sales_funnel_signals', 'prospect_wants',
    'questions_and_objections', 'what_helped_sales', 'what_hurt_sales',
    'marketing_positioning_insights', 'product_customer_experience_insights',
    'technical_findings', 'test_traffic_handling', 'priorities_next_week',
    'ticket_recommended', 'proposed_ticket',
  ],
  properties: {
    prospect_conversations: { type: 'integer', minimum: 0 },
    customer_support_conversations: { type: 'integer', minimum: 0 },
    sample_quality: { type: 'string' },
    executive_summary: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    sales_funnel_signals: {
      type: 'object',
      additionalProperties: false,
      required: ['initial_contacts', 'meaningful_interest', 'explicit_purchase_intent', 'checkout_reached', 'purchase_confirmed', 'drop_off_points'],
      properties: {
        initial_contacts: { type: 'integer', minimum: 0 },
        meaningful_interest: { type: 'integer', minimum: 0 },
        explicit_purchase_intent: { type: 'integer', minimum: 0 },
        checkout_reached: { type: 'integer', minimum: 0 },
        purchase_confirmed: { type: 'null' },
        drop_off_points: { type: 'array', items: { type: 'string' }, maxItems: 5 },
      },
    },
    prospect_wants: { type: 'array', items: finding, maxItems: 8 },
    questions_and_objections: { type: 'array', items: finding, maxItems: 8 },
    what_helped_sales: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    what_hurt_sales: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    marketing_positioning_insights: {
      type: 'object',
      additionalProperties: false,
      required: ['customer_language', 'ad_landing_page_insights', 'signals_supporting_positioning', 'signals_challenging_positioning'],
      properties: {
        customer_language: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        ad_landing_page_insights: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        signals_supporting_positioning: { type: 'array', items: { type: 'string' }, maxItems: 5 },
        signals_challenging_positioning: { type: 'array', items: { type: 'string' }, maxItems: 5 },
      },
    },
    product_customer_experience_insights: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['classification', 'insight', 'evidence_strength'],
        properties: {
          classification: { type: 'string', enum: ['MARKETING', 'SALES CONVERSATION', 'PRODUCT / OFFER', 'CUSTOMER EXPERIENCE', 'NO ACTION'] },
          insight: { type: 'string' },
          evidence_strength: evidenceStrength,
        },
      },
    },
    technical_findings: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'observed', 'impact', 'severity', 'reproducibility', 'evidence_strength', 'evidence'],
        properties: {
          title: { type: 'string' },
          observed: { type: 'string' },
          impact: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          reproducibility: { type: 'string', enum: ['unclear', 'supported', 'confirmed'] },
          evidence_strength: evidenceStrength,
          evidence: conversationEvidence,
        },
      },
    },
    test_traffic_handling: { type: 'string' },
    priorities_next_week: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    ticket_recommended: { type: 'boolean' },
    proposed_ticket: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['classification', 'title', 'objective', 'observed_evidence', 'required_behavior', 'regression_cases', 'acceptance_criteria', 'non_goals'],
          properties: {
            classification: { type: 'string', enum: ['TECHNICAL DEFECT'] },
            title: { type: 'string' },
            objective: { type: 'string' },
            observed_evidence: { type: 'string' },
            required_behavior: { type: 'string' },
            regression_cases: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            acceptance_criteria: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            non_goals: { type: 'array', items: { type: 'string' }, maxItems: 8 },
          },
        },
      ],
    },
  },
};

function hydrateBuilderSource(source) {
  const marker = '__CANONICAL_PRODUCT_CONTEXT__';
  if (!source.includes(marker)) throw new Error(`Missing builder marker: ${marker}`);
  return source.replace(marker, JSON.stringify(AUDITOR_CANONICAL_CONTEXT));
}

function buildOpenAiRequestBody() {
  const request = {
    model: 'gpt-5-mini',
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'weekly_conversation_sales_intelligence', strict: true, schema: RESPONSE_SCHEMA },
    },
    messages: [
      { role: 'system', content: '__N8N_SYSTEM_MESSAGE_EXPRESSION__' },
      { role: 'user', content: '__N8N_USER_MESSAGE_EXPRESSION__' },
    ],
  };

  return `=${JSON.stringify(request, null, 2)}`
    .replace('"__N8N_SYSTEM_MESSAGE_EXPRESSION__"', '{{ JSON.stringify($json.system_message) }}')
    .replace('"__N8N_USER_MESSAGE_EXPRESSION__"', '{{ JSON.stringify($json.user_message) }}');
}

const OPENAI_REQUEST_BODY = buildOpenAiRequestBody();

function buildWorkflow(builderSource, formatterSource) {
  return {
    name: workflowName,
    nodes: [
      {
        parameters: { rule: { interval: [{ field: 'weeks', triggerAtDay: [1], triggerAtHour: 8 }] } },
        type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.3, position: [0, 0],
        id: '6e35d5b6-48f1-45de-9f8e-f0dbf14072a1', name: 'Weekly Schedule Trigger',
      },
      {
        parameters: { operation: 'executeQuery', query: AUDIT_QUERY, options: {} },
        type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [224, 0],
        id: 'c02ac4ea-aac8-41de-a5db-a65c04eb1df0', name: 'Fetch Canonical Messages - Previous 7 Complete Days',
        alwaysOutputData: true,
        credentials: { postgres: { id: 'gXJ1myheSM6x1XB8', name: 'Postgres account' } },
      },
      {
        parameters: { jsCode: hydrateBuilderSource(builderSource).trimEnd() },
        type: 'n8n-nodes-base.code', typeVersion: 2, position: [448, 0],
        id: '74780fbf-2955-4b61-b0ab-ec908855fc1b', name: 'Prepare Weekly Intelligence Input',
      },
      {
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
            conditions: [{
              id: '5d36edfd-aaf9-4b19-af27-bb81797f5f9d', leftValue: '={{ $json.analysis_required }}', rightValue: 0,
              operator: { type: 'boolean', operation: 'true', singleValue: true },
            }],
            combinator: 'and',
          },
          options: {},
        },
        type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [672, 0],
        id: 'da46d0e0-918c-4b72-a574-9a04461bbd15', name: 'Has Conversations to Analyze?',
      },
      {
        parameters: {
          method: 'POST', url: 'https://api.openai.com/v1/chat/completions', sendHeaders: true,
          headerParameters: { parameters: [
            { name: 'Authorization', value: '=Bearer {{ $env.OPENAI_API_KEY }}' },
            { name: 'Content-Type', value: 'application/json' },
          ] },
          sendBody: true, specifyBody: 'json', jsonBody: OPENAI_REQUEST_BODY, options: {},
        },
        type: 'n8n-nodes-base.httpRequest', typeVersion: 4.3, position: [896, -96],
        id: '88b5f766-1d2f-4f1e-983f-f0512993642a', name: 'AI Weekly Sales Intelligence Auditor',
      },
      {
        parameters: { jsCode: formatterSource.trimEnd() },
        type: 'n8n-nodes-base.code', typeVersion: 2, position: [1120, -96],
        id: '8e279748-e174-4aca-9721-02c046ace731', name: 'Format Weekly Intelligence Email',
      },
      {
        parameters: {
          fromEmail: 'workflow@dietavity.com', toEmail: 'juan@autorintelectual.com',
          subject: '=Weekly Conversation & Sales Intelligence - {{ $json.reporting_start_date }} to {{ $json.reporting_end_date }}',
          html: '={{ $json.report_html }}', options: {},
        },
        type: 'n8n-nodes-base.emailSend', typeVersion: 2.1, position: [1344, 0],
        id: '3fd36e60-14a7-4a5d-af13-83dab9b905f9', name: 'Email Weekly Intelligence',
        credentials: { smtp: { id: 'xPyJTRqsHIMJBFhs', name: 'Workflow' } },
      },
    ],
    pinData: {},
    connections: {
      'Weekly Schedule Trigger': { main: [[{ node: 'Fetch Canonical Messages - Previous 7 Complete Days', type: 'main', index: 0 }]] },
      'Fetch Canonical Messages - Previous 7 Complete Days': { main: [[{ node: 'Prepare Weekly Intelligence Input', type: 'main', index: 0 }]] },
      'Prepare Weekly Intelligence Input': { main: [[{ node: 'Has Conversations to Analyze?', type: 'main', index: 0 }]] },
      'Has Conversations to Analyze?': { main: [
        [{ node: 'AI Weekly Sales Intelligence Auditor', type: 'main', index: 0 }],
        [{ node: 'Email Weekly Intelligence', type: 'main', index: 0 }],
      ] },
      'AI Weekly Sales Intelligence Auditor': { main: [[{ node: 'Format Weekly Intelligence Email', type: 'main', index: 0 }]] },
      'Format Weekly Intelligence Email': { main: [[{ node: 'Email Weekly Intelligence', type: 'main', index: 0 }]] },
    },
    active: false,
    settings: {
      executionOrder: 'v1', binaryMode: 'separate', timezone: 'America/Mexico_City',
      errorWorkflow: 'sa10JQEAbxNYvCGG', availableInMCP: false,
    },
    versionId: '5ce49612-d3e6-4c04-bfc4-d41dfba4f69e',
    meta: {
      templateCredsSetupCompleted: true,
      instanceId: '2edd72e6d5781df09a60b65fd523f4841afca081863c21ef852a5bbcd21fdca1',
    },
    id: 'ticket19DailyAuditor',
    tags: [],
  };
}

function serialize(workflow) { return `${JSON.stringify(workflow, null, 2)}\n`; }

function generate() {
  return serialize(buildWorkflow(
    fs.readFileSync(builderPath, 'utf8'),
    fs.readFileSync(formatterPath, 'utf8'),
  ));
}

function main() {
  const generated = generate();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(workflowPath) ? fs.readFileSync(workflowPath, 'utf8') : '';
    if (current !== generated) {
      console.error(`${workflowName}.json is not synchronized with Ticket 32 sources.`);
      process.exitCode = 1;
    }
    return;
  }
  fs.writeFileSync(workflowPath, generated);
}

if (require.main === module) main();

module.exports = {
  AUDITOR_CANONICAL_CONTEXT,
  AUDIT_QUERY,
  RESPONSE_SCHEMA,
  OPENAI_REQUEST_BODY,
  hydrateBuilderSource,
  buildOpenAiRequestBody,
  buildWorkflow,
  generate,
  serialize,
};
