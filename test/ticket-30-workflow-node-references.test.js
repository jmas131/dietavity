'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  '..',
  'n8n',
  'Dietavity Sales Engine (Ticket 10).json',
), 'utf8'));
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));

const referencePatterns = [
  { syntax: '$()', regex: /\$\(\s*(['"])(.*?)\1\s*\)/g, nameIndex: 2 },
  { syntax: '$node[]', regex: /\$node\s*\[\s*(['"])(.*?)\1\s*\]/g, nameIndex: 2 },
  { syntax: '$items()', regex: /\$items\s*\(\s*(['"])(.*?)\1/g, nameIndex: 2 },
  { syntax: '$item()', regex: /\$item\s*\(\s*\d+\s*,\s*(['"])(.*?)\1/g, nameIndex: 2 },
];

function stringsIn(value, location = 'parameters') {
  if (typeof value === 'string') return [{ location, value }];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => stringsIn(entry, `${location}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    stringsIn(entry, `${location}.${key}`));
}

function outputs(name, index = 0) {
  return (workflow.connections[name]?.main?.[index] || [])
    .map((connection) => connection.node);
}

test('every explicit workflow expression node reference resolves', () => {
  const dangling = [];

  for (const node of workflow.nodes) {
    for (const entry of stringsIn(node.parameters)) {
      for (const pattern of referencePatterns) {
        for (const match of entry.value.matchAll(pattern.regex)) {
          const referencedName = match[pattern.nameIndex];
          if (!nodes.has(referencedName)) {
            dangling.push({
              containingNode: node.name,
              location: entry.location,
              syntax: pattern.syntax,
              referencedName,
            });
          }
        }
      }
    }
  }

  assert.deepEqual(dangling, []);
});

test('Ticket 28A resumed paid replies use the canonical outbound before completing the claim', () => {
  assert.deepEqual(outputs('Receive Verified WhatsApp Sessions'), ['Claim Next Session Inbound']);
  assert.deepEqual(outputs('Parse Assistant Response'), ['Prepare Paid WhatsApp Message Parts']);
  assert.deepEqual(outputs('Build Deterministic Customer Response'), ['Prepare Paid WhatsApp Message Parts']);
  assert.deepEqual(outputs('Prepare Paid WhatsApp Message Parts'), ['Reserve Paid Assistant Reply']);
  assert.deepEqual(outputs('Reserve Paid Assistant Reply'), ['Loop Paid WhatsApp Parts']);
  assert.deepEqual(outputs('Loop Paid WhatsApp Parts', 1), ['Send All Intents Message']);
  assert.deepEqual(outputs('Send All Intents Message'), ['Update Paid Assistant Reply Delivery']);
  assert.deepEqual(outputs('Update Paid Assistant Reply Delivery'), ['Assert Paid Assistant Reply Accepted']);
  assert.deepEqual(outputs('Assert Paid Assistant Reply Accepted'), ['Loop Paid WhatsApp Parts', 'Build V2 Provider Acceptance Diagnostic']);
  assert.deepEqual(outputs('Loop Paid WhatsApp Parts'), ['Update Last Assistant Message']);
  assert.deepEqual(outputs('Update Last Assistant Message'), ['Mark Session Inbound Complete']);

  const reservation = nodes.get('Reserve Paid Assistant Reply');
  assert.match(reservation.parameters.query, /ON CONFLICT \(idempotency_key\)[\s\S]*DO NOTHING/);
  assert.match(reservation.parameters.options.queryReplacement,
    /base_idempotency_key: 'reply:' \+ \$\('Claim Next Session Inbound'\)\.item\.json\.provider_message_sid \+ ':paid'/);

  const updateMemory = nodes.get('Update Last Assistant Message');
  const field = updateMemory.parameters.fieldsUi.fieldValues
    .find((candidate) => candidate.fieldId === 'last_assistant_message');
  assert.equal(field.fieldValue,
    "={{ $('Reserve Paid Assistant Reply').item.json.assistant_response || '' }}");
});
