'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, 'n8n', 'Dietavity Weekly Conversation & Sales Intelligence.json');
const workflowText = fs.readFileSync(workflowPath, 'utf8');
const workflow = JSON.parse(workflowText);
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const generator = require('../scripts/refactor-ticket-32-weekly-conversation-sales-intelligence');
const requestTemplate = nodes.get('AI Weekly Sales Intelligence Auditor').parameters.jsonBody;

function renderRequestTemplate(systemMessage, userMessage) {
  assert.ok(requestTemplate.startsWith('={'), 'body must be an n8n JSON text template');
  const rendered = requestTemplate
    .slice(1)
    .replace(
      '{{ JSON.stringify($json.system_message) }}',
      JSON.stringify(systemMessage),
    )
    .replace(
      '{{ JSON.stringify($json.user_message) }}',
      JSON.stringify(userMessage),
    );
  assert.doesNotMatch(rendered, /\{\{[^}]+\}\}/, 'all dynamic slots must resolve');
  return JSON.parse(rendered);
}

test('OpenAI body is ordinary JSON rather than one monolithic JS expression', () => {
  assert.doesNotMatch(requestTemplate, /^=\s*\{\{\s*\{/);
  assert.doesNotMatch(requestTemplate, /^=\{\{/);
  assert.match(requestTemplate, /^=\{\s*\n\s*"model": "gpt-5-mini"/);
  assert.equal(
    (requestTemplate.match(/\{\{ JSON\.stringify\(\$json\.(?:system|user)_message\) \}\}/g) || []).length,
    2,
  );
  assert.doesNotMatch(requestTemplate, /content:\s*\$json\.(?:system|user)_message/);
});

test('dynamic Spanish prompts survive JSON rendering without syntax loss', () => {
  const systemMessage = 'Sistema:\n¿Listo? "Sí, gracias" \\ ruta 😊';
  const userMessage = '¿Cuánto cuesta?\nSegunda línea: "Sí, gracias"\nC:\\Dietavity\\auditor 😊';
  const request = renderRequestTemplate(systemMessage, userMessage);

  assert.equal(request.messages[0].role, 'system');
  assert.equal(request.messages[0].content, systemMessage);
  assert.equal(request.messages[1].role, 'user');
  assert.equal(request.messages[1].content, userMessage);
});

test('structured-output keeps the zero-or-one engineering-ticket contract', () => {
  const request = renderRequestTemplate('system', 'user');
  const format = request.response_format;
  assert.equal(format.type, 'json_schema');
  assert.equal(format.json_schema.name, 'weekly_conversation_sales_intelligence');
  assert.equal(format.json_schema.strict, true);
  assert.deepEqual(format.json_schema.schema, generator.RESPONSE_SCHEMA);

  const proposed = format.json_schema.schema.properties.proposed_ticket;
  assert.equal(proposed.anyOf.length, 2);
  assert.deepEqual(proposed.anyOf.map((option) => option.type), ['null', 'object']);
  assert.equal(proposed.type, undefined);
});

test('generated artifact stays synchronized with the corrected request source', () => {
  assert.equal(requestTemplate, generator.OPENAI_REQUEST_BODY);
  assert.equal(generator.buildOpenAiRequestBody(), generator.OPENAI_REQUEST_BODY);
  assert.equal(generator.generate(), workflowText);
});
