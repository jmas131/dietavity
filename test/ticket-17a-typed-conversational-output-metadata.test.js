'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { artifactSetValid, conversationArtifactRecordValid, conversationArtifactValid } = require('../lib/conversation-artifact-validator');
const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'database/migrations/20260923_ticket_17a_typed_conversational_output_metadata.sql'), 'utf8');
const anchor = '11111111-1111-4111-8111-111111111111';
const draft = { contract_version: '1.0', artifact_id: 'ca-draft-1', artifact_type: 'draft', generation_operation: 'draft', generation_task_id: 'cgt-1', logical_reply_key: 'reply:inbound-1:sales', anchor_message_id: anchor };

test('Ticket 17A keeps ordinary and legacy messages untyped while validating closed prospective metadata', () => {
  assert.equal(conversationArtifactValid(draft), true);
  assert.equal(artifactSetValid(draft, []), true);
  assert.equal(conversationArtifactRecordValid({ artifact: draft, lineage: [] }), true);
  for (const bad of [{ ...draft, artifact_type: 'explanation' }, { ...draft, generation_operation: 'show' }, { ...draft, source: { type: 'canonical_fact' } }, { ...draft, artifact_id: 'random' }]) assert.equal(conversationArtifactValid(bad), false);
});
test('Ticket 17A models transform and summarize lineage without authority or delivery claims', () => {
  const transformed = { ...draft, artifact_id: 'ca-draft-2', generation_operation: 'transform', logical_reply_key: 'reply:inbound-2:sales' };
  const summary = { ...draft, artifact_id: 'ca-summary-1', artifact_type: 'summary', generation_operation: 'summarize', logical_reply_key: 'reply:inbound-3:sales' };
  assert.equal(artifactSetValid(transformed, [{ artifact_id: transformed.artifact_id, source_artifact_id: draft.artifact_id, position: 1 }]), true);
  assert.equal(artifactSetValid(summary, [{ artifact_id: summary.artifact_id, source_artifact_id: draft.artifact_id, position: 1 }, { artifact_id: summary.artifact_id, source_artifact_id: transformed.artifact_id, position: 2 }]), true);
  assert.equal(artifactSetValid(transformed, [{ artifact_id: transformed.artifact_id, source_artifact_id: transformed.artifact_id, position: 1 }]), false);
  assert.equal(artifactSetValid(summary, [{ artifact_id: summary.artifact_id, source_artifact_id: draft.artifact_id, position: 1 }, { artifact_id: summary.artifact_id, source_artifact_id: draft.artifact_id, position: 2 }]), false);
});
test('Ticket 17A migration preserves canonical ledger ownership, lineage FKs, and multipart logical identity', () => {
  assert.match(migration, /anchor_message_id uuid NOT NULL UNIQUE REFERENCES public\.messages/);
  assert.match(migration, /logical_reply_key text NOT NULL UNIQUE/);
  assert.match(migration, /source_artifact_id text NOT NULL REFERENCES public\.conversation_artifacts/);
  assert.match(migration, /artifact_id <> source_artifact_id/);
  assert.doesNotMatch(migration, /ALTER TABLE public\.messages\s+ADD COLUMN/i);
  assert.doesNotMatch(migration, /delivered\s*=\s*true/i);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.persist_conversation_artifact/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*search_path TO pg_catalog, public/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.conversation_artifacts[\s\S]*service_role/);
  assert.match(migration, /WITH RECURSIVE ancestors/);
  assert.match(migration, /anchor_message_id uuid NOT NULL UNIQUE REFERENCES public\.messages\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.delete_message_with_conversation_artifacts_for_privacy\(target_message_id uuid\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.delete_message_with_conversation_artifacts_for_privacy\(uuid\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.doesNotMatch(migration, /CREATE TRIGGER messages_purge_conversation_artifact_dependents/);
});
