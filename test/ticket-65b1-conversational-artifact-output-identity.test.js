'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createConversationContext } = require('../lib/sales-engine-v2/memory-adapter');
const { assertConversationalArtifactOutputIntent, conversationalArtifactOutputIntentValid, deriveConversationalArtifactOutputIntent, deriveArtifactOutputIntents } = require('../lib/sales-engine-v2/conversational-artifact-output-identity');

function context(id = '11111111-1111-4111-8111-000000006501') {
  return createConversationContext({ currentTurn: { id: `inbound-${id}`, canonical_message_id: id, text: 'Haz un borrador breve', received_at: '2026-09-25T12:00:00.000Z' }, memory: [], conversationArtifacts: [], runtimeMetadata: { conversation_id: 'conversation-65b1', session_id: 'session-65b1', channel: 'whatsapp', offer_version: '28d-149-v1', campaign: 'standard' } });
}
function task(operation = 'draft', changes = {}) {
  const artifacts = operation === 'draft' ? [] : operation === 'summarize' ? [{ artifact_id: 'ca-source-a', text: 'A' }, { artifact_id: 'ca-source-b', text: 'B' }] : [{ artifact_id: 'ca-source-a', text: 'A' }];
  return { obligation_id: 'o-65b1', operation, current_turn_inputs: operation === 'draft' ? [{ input_type: 'draft_specification', value: 'borrador breve', origin: 'current_turn' }] : [], current_turn_constraints: operation === 'transform' ? [{ value: 'más corto', origin: 'current_turn' }] : [], artifacts, ...changes };
}

test('Ticket 65B.1 derives immutable prospective identities without generated prose or runtime metadata', () => {
  const first = deriveConversationalArtifactOutputIntent({ context: context(), conversationalGeneration: task() });
  const retry = deriveConversationalArtifactOutputIntent({ context: context(), conversationalGeneration: task() });
  assert.deepEqual(first, retry); assert.equal(first.artifact_type, 'draft'); assert.deepEqual(first.ordered_lineage_artifact_ids, []);
  assert.match(first.artifact_id, /^ca-[0-9a-f]{64}$/); assert.match(first.generation_task_id, /^cgt-[0-9a-f]{64}$/); assert.match(first.identity_binding, /^caob-[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(first), true); assert.equal(Object.isFrozen(first.ordered_lineage_artifact_ids), true);
  assert.notDeepEqual(first, deriveConversationalArtifactOutputIntent({ context: context('11111111-1111-4111-8111-000000006502'), conversationalGeneration: task() }));
  assert.notDeepEqual(first, deriveConversationalArtifactOutputIntent({ context: context(), conversationalGeneration: task('draft', { current_turn_inputs: [{ input_type: 'draft_specification', value: 'otro borrador', origin: 'current_turn' }] }) }));
  assert.equal(JSON.stringify(first).includes('Haz un borrador breve'), false);
});

test('Ticket 65B.1 maps transform/summarize lineage, and show/non-producing tasks to null', () => {
  const transformed = deriveConversationalArtifactOutputIntent({ context: context(), conversationalGeneration: task('transform') });
  const summarized = deriveConversationalArtifactOutputIntent({ context: context(), conversationalGeneration: task('summarize') });
  assert.equal(transformed.artifact_type, 'draft'); assert.deepEqual(transformed.ordered_lineage_artifact_ids, ['ca-source-a']);
  assert.equal(summarized.artifact_type, 'summary'); assert.deepEqual(summarized.ordered_lineage_artifact_ids, ['ca-source-a', 'ca-source-b']);
  assert.notEqual(transformed.identity_binding, deriveConversationalArtifactOutputIntent({ context: context(), conversationalGeneration: task('transform', { artifacts: [{ artifact_id: 'ca-source-b', text: 'B' }] }) }).identity_binding);
  assert.equal(deriveConversationalArtifactOutputIntent({ context: context(), conversationalGeneration: task('show') }), null);
});

test('Ticket 65B.1 rejects substitutions, malformed lineage, and foreign/non-conversational output input', () => {
  const value = deriveConversationalArtifactOutputIntent({ context: context(), conversationalGeneration: task() });
  for (const forged of [{ ...value, artifact_id: 'ca-' + '0'.repeat(64) }, { ...value, generation_task_id: 'cgt-' + '0'.repeat(64) }, { ...value, identity_binding: 'caob-' + '0'.repeat(64) }, { ...value, extra: true }]) assert.equal(conversationalArtifactOutputIntentValid(forged, { context: context(), conversationalGeneration: task() }), false);
  assert.throws(() => deriveConversationalArtifactOutputIntent({ context: context(), conversationalGeneration: task('transform', { artifacts: [{ artifact_id: 'bad', text: 'A' }] }) }), /ARTIFACT_OUTPUT_IDENTITY_INPUT_INVALID/);
  assert.throws(() => assertConversationalArtifactOutputIntent({ ...value, ordered_lineage_artifact_ids: ['ca-source-a', 'ca-source-a'] }), /ARTIFACT_OUTPUT_IDENTITY_INVALID/);
});

test('Ticket 65B.1 central schema matches the closed runtime contract', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs/contracts/sales-engine-v2-contract.schema.json'), 'utf8'));
  const definition = schema.$defs.ConversationalArtifactOutputIntent;
  assert.equal(schema.properties.ConversationalArtifactOutputIntent.$ref, '#/$defs/ConversationalArtifactOutputIntent');
  assert.equal(definition.additionalProperties, false); assert.deepEqual(definition.required, ['contract_version', 'artifact_id', 'generation_task_id', 'artifact_type', 'generation_operation', 'ordered_lineage_artifact_ids', 'identity_binding']);
  assert.equal(definition.properties.contract_version.const, 'ticket-65b1-v1'); assert.equal(definition.properties.artifact_id.pattern, '^ca-[0-9a-f]{64}$');
  assert.throws(() => deriveArtifactOutputIntents({ context: context(), responsePlan: { bad: true } }), /ARTIFACT_OUTPUT_IDENTITIES_INPUT_INVALID/);
});
