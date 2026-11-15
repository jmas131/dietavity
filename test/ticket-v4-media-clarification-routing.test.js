'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '..',
  'n8n/Dietavity Sales Engine (Ticket 10).json'), 'utf8'));
const node = name => workflow.nodes.find(candidate => candidate.name === name);
const outputs = (name, index = 0) => (workflow.connections[name]?.main?.[index] || [])
  .map(edge => edge.node);

function mediaOnly(claimed) {
  const expression = node('IF Media Without Text').parameters.conditions.conditions[0].leftValue;
  return vm.runInNewContext(`(${expression.slice(3, -2)})`, {
    $: name => {
      assert.equal(name, 'Claim Next Session Inbound');
      return { item: { json: claimed } };
    },
  });
}

test('V4 acquired media-only claims take the deterministic clarification route', () => {
  assert.deepEqual(outputs('Route Session Claim State'), ['IF Media Without Text']);
  assert.deepEqual(outputs('IF Media Without Text', 0), ['Prepare Log Data Message Without Text']);
  assert.deepEqual(outputs('IF Media Without Text', 1), ['Get V4 Conversation Context']);
  assert.deepEqual(outputs('Prepare Log Data Message Without Text'), ['Reserve Media Clarification']);
  assert.deepEqual(outputs('Reserve Media Clarification'), ['Send Message Asking for Text']);
  assert.deepEqual(outputs('Assert Media Clarification Accepted'), ['Update Log Message Without Text']);
  assert.deepEqual(outputs('Update Log Message Without Text'), ['Mark Session Inbound Complete']);
  for (const body of [null, '', '   ']) {
    assert.equal(mediaOnly({ metadata: { num_media: 1 }, body, combined_body: body }), true);
  }
});

test('textual turns, including media with text, retain V4 and media reservations are duplicate-safe', () => {
  assert.equal(mediaOnly({ metadata: { num_media: 0 }, body: 'Hola', combined_body: 'Hola' }), false);
  assert.equal(mediaOnly({ metadata: { num_media: 1 }, body: '¿Qué preparo?', combined_body: '¿Qué preparo?' }), false);
  assert.deepEqual(outputs('Get V4 Conversation Context'), ['Build V4 Conversation Engine Request']);
  assert.match(node('Build V4 Conversation Engine Request').parameters.jsCode, /!current_message\.trim\(\)/);

  const assignments = node('Prepare Log Data Message Without Text').parameters.assignments.assignments;
  assert.equal(assignments.find(value => value.name === 'user_id').value,
    "={{ $('Claim Next Session Inbound').item.json.user_id || null }}");
  const reserve = node('Reserve Media Clarification');
  assert.match(reserve.parameters.options.queryReplacement, /Claim Next Session Inbound'\)\.item\.json\.user_id/);
  assert.match(reserve.parameters.options.queryReplacement, /:media_clarification/);
  assert.match(reserve.parameters.options.queryReplacement, /processing_owner: \$execution\.id/);
  assert.match(reserve.parameters.query, /ON CONFLICT \(idempotency_key\)[\s\S]*DO NOTHING/);
  assert.match(node('Assert Media Clarification Accepted').parameters.jsCode,
    /TICKET_9_TWILIO_SEND_REQUIRES_RECONCILIATION/);
});
