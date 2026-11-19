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

test('V4 acquired turns enter the claim-owned media boundary before V4', () => {
  assert.deepEqual(outputs('Route Session Claim State'), ['Route Media Enrichment']);
  // A recovered, completed enrichment skips external work; text still stays
  // on the unchanged V4 path; exactly one attachment is enriched.
  assert.deepEqual(outputs('Route Media Enrichment', 0), ['Get V4 Conversation Context']);
  assert.deepEqual(outputs('Route Media Enrichment', 1), ['Get V4 Conversation Context']);
  assert.deepEqual(outputs('Route Media Enrichment', 2), ['Call Media Enrichment']);
  assert.deepEqual(outputs('Route Media Enrichment', 3), ['Prepare Log Data Message Without Text']);
  assert.deepEqual(outputs('Call Media Enrichment'), ['Classify Media Enrichment Result']);
  assert.deepEqual(outputs('Classify Media Enrichment Result'), ['Route Media Enrichment Result']);
  assert.deepEqual(outputs('Route Media Enrichment Result', 0), ['Persist Media Enrichment']);
  assert.deepEqual(outputs('Route Media Enrichment Result', 1), ['Prepare Log Data Message Without Text']);
  assert.deepEqual(outputs('Persist Media Enrichment'), ['Get V4 Conversation Context']);
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

test('textual turns retain V4 and media reservations are duplicate-safe', () => {
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
  assert.match(reserve.parameters.options.queryReplacement, /No pude procesar el archivo en este momento/);
  assert.doesNotMatch(reserve.parameters.options.queryReplacement, /solo puedo leer texto/);
  assert.match(node('Assert Media Clarification Accepted').parameters.jsCode,
    /TICKET_9_TWILIO_SEND_REQUIRES_RECONCILIATION/);
  const mediaCall = node('Call Media Enrichment');
  assert.doesNotMatch(JSON.stringify(mediaCall.parameters), /base64|mediaUrl/i);
  assert.match(node('Classify Media Enrichment Result').parameters.jsCode, /TICKET_96B_TRANSIENT_MEDIA/);
  assert.match(node('Persist Media Enrichment').parameters.options.queryReplacement, /enrichment: \$json\.enrichment/);
});
