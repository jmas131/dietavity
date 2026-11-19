'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname, '..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const workflow = read('n8n/Dietavity Sales Engine (Ticket 10).json');
const nodes = new Map(workflow.nodes.map(node => [node.name, node]));
function outputs(name, index = 0) { return (workflow.connections[name]?.main?.[index] || []).map(edge => edge.node); }
function targets(value, result = []) { if (Array.isArray(value)) value.forEach(item => targets(item, result)); else if (value && typeof value === 'object') { if (typeof value.node === 'string') result.push(value.node); Object.values(value).forEach(item => targets(item, result)); } return result; }
function credential(node, type) { const value = node.credentials?.[type]; assert.ok(value?.id && value?.name, `${node.name} requires ${type} credential identity`); }

test('Ticket 93 canonical Sales Engine is structurally valid and explicitly inactive', () => {
  assert.equal(workflow.name, 'Dietavity Sales Engine (Ticket 10)');
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.length, 243);
  assert.equal(new Set(workflow.nodes.map(node => node.id)).size, workflow.nodes.length, 'node IDs must be unique');
  assert.equal(nodes.size, workflow.nodes.length, 'node names must be unique');
  for (const source of Object.keys(workflow.connections)) assert.ok(nodes.has(source), `unknown connection source: ${source}`);
  for (const target of targets(workflow.connections)) assert.ok(nodes.has(target), `unknown connection target: ${target}`);
  const webhooks = workflow.nodes.filter(node => node.type === 'n8n-nodes-base.webhook');
  const webhookKeys = webhooks.map(node => `${node.parameters.httpMethod}:${node.parameters.path}`);
  assert.equal(new Set(webhookKeys).size, webhookKeys.length, 'webhook method/path pairs must be unique');
  assert.equal(webhooks.filter(node => node.name === 'Generate 28-Day Program Webhook').length, 1);
  for (const node of workflow.nodes.filter(node => node.type === 'n8n-nodes-base.postgres')) credential(node, 'postgres');
  for (const node of workflow.nodes.filter(node => node.type === 'n8n-nodes-base.twilio')) credential(node, 'twilioApi');
  for (const node of workflow.nodes.filter(node => node.type === '@n8n/n8n-nodes-langchain.lmChatOpenAi')) credential(node, 'openAiApi');
  for (const name of ['Call V4 Conversation Engine', 'Call V4 Conversation Engine Recovery']) credential(nodes.get(name), 'httpHeaderAuth');
  assert.equal(nodes.get('Generate 28-Day Program Webhook').webhookId, '6849a922-11cc-406c-8ab4-555ddfa95d59');
  assert.equal(nodes.get('Release Additional V4 Acquired Claims').credentials.postgres.id, 'gXJ1myheSM6x1XB8');
});

test('Ticket 93 retains recovery routing and both V4 incident hotfixes', () => {
  assert.deepEqual(outputs('Route Session Claim State', 0), ['Route Media Enrichment']);
  assert.deepEqual(outputs('Route Media Enrichment', 0), ['Get V4 Conversation Context']);
  assert.deepEqual(outputs('Route Media Enrichment', 2), ['Call Media Enrichment']);
  assert.deepEqual(outputs('Route Media Enrichment', 3), ['Prepare Log Data Message Without Text']);
  assert.deepEqual(outputs('Route Media Enrichment Result', 1), ['Prepare Log Data Message Without Text']);
  assert.deepEqual(outputs('Route V4 Conversation Engine Recovery Authorization', 0), ['Wait Before V4 Conversation Engine Recovery']);
  assert.deepEqual(outputs('Route V4 Conversation Engine Recovery Authorization', 1), ['Fail Closed V4 Conversation Engine Result']);
  const media = nodes.get('Route Media Enrichment').parameters.rules.values[2].conditions.conditions[0].leftValue;
  assert.match(media, /metadata\.num_media/);
  const query = nodes.get('Get V4 Conversation Context').parameters.query;
  assert.match(query, /nonempty_history AS \(\s*SELECT \* FROM chronological_history\s*WHERE text !~ '\^\[\[:space:\]\]\*\$'/s);
  assert.match(query, /bounded_history AS \(\s*SELECT \* FROM nonempty_history/s);
});
