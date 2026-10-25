'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const authority = require('../lib/conversation-engine-v4/product-authority');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'database/migrations/20261024_v4_authority_and_durable_memory.sql'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');

test('V4 authority is versioned commercial context, not a culinary capability whitelist', () => {
  assert.match(authority.VERSION, /^dietavity-v4-commercial-authority-/);
  assert.equal(authority.SNAPSHOT.version, authority.VERSION);
  assert.match(authority.SNAPSHOT.offer.trial, /one week free/i);
  assert.match(authority.SNAPSHOT.offer.paid_offer, /No paid price/i);
  assert.deepEqual(authority.SNAPSHOT.medication_boundary, { glp1_sale: false, glp1_delivery: false, glp1_prescription: false });
  assert.match(authority.promptText(), /Do not treat this commercial authority as a list of culinary capabilities/);
  assert.doesNotMatch(authority.promptText(), /\$149|28 days|portal delivery/i);
});

test('V4 durable memory has only the three approved kinds and explicit active or removed state', () => {
  for (const source of [migration, schema]) {
    assert.match(source, /CREATE TABLE public\.conversation_durable_memory/);
    assert.match(source, /'allergy'.*'dietary_restriction'.*'preference'/s);
    assert.match(source, /'active'.*'removed'/s);
    assert.match(source, /session_id text NOT NULL/);
    assert.match(source, /user_id uuid/);
    assert.match(source, /source_inbound_message_id uuid NOT NULL/);
    assert.doesNotMatch(source.match(/CREATE TABLE public\.conversation_durable_memory \([\s\S]*?\n\);/)?.[0] || '', /inventory|appetite|craving|restaurant|recommendation|intent|conversation_stage/i);
  }
});

test('V4 update log records source-inbound provenance and makes replay indexes idempotent', () => {
  for (const source of [migration, schema]) {
    assert.match(source, /CREATE TABLE public\.conversation_durable_memory_updates/);
    assert.match(source, /PRIMARY KEY \(source_inbound_message_id, update_index\)/);
    assert.match(source, /memory_id uuid/);
    assert.match(source, /outcome.*'applied'.*'no_change'/s);
  }
  assert.match(migration, /CONVERSATION_V4_RESERVATION_REPLAY_CHANGED/);
  assert.match(migration, /logged\.source_inbound_message_id = inbound\.id/);
});

test('V4 reads active session memory and supplements it with linked-user memory', () => {
  for (const source of [migration, schema]) {
    assert.match(source, /read_conversation_durable_memory\(target_session_id text, target_user_id uuid/);
    assert.match(source, /memory\.status = 'active'/);
    assert.match(source, /memory\.session_id = target_session_id OR \(target_user_id IS NOT NULL AND memory\.user_id = target_user_id\)/);
    assert.match(source, /link_conversation_durable_memory\(target_session_id text, target_user_id uuid\)/);
  }
});

test('V4 reservation validates memory structure but contains no natural-language parser', () => {
  const functionBody = migration.match(/CREATE FUNCTION public\.reserve_conversation_v4_reply_with_memory[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(functionBody, /'kind', 'action', 'value'/);
  assert.match(functionBody, /'allergy', 'dietary_restriction', 'preference'/);
  assert.match(functionBody, /'add', 'remove'/);
  assert.doesNotMatch(functionBody, /foodSpan|inventory|appetite|mealReport|recommendation_request|extractSemanticContext|contextualIngredientReply/);
});

test('V4 normalizes only case and whitespace for technical identity', () => {
  for (const source of [migration, schema]) {
    assert.match(source, /lower\(regexp_replace\(btrim\(value\), '\\s\+', ' ', 'g'\)\) COLLATE "C"/);
    assert.match(source, /update_normalized := lower\(regexp_replace\(update_text, '\\s\+', ' ', 'g'\)\) COLLATE "C"/);
  }
});

test('V4 binds memory mutation and outbound reservation in one owner-checked transaction', () => {
  const functionBody = migration.match(/CREATE FUNCTION public\.reserve_conversation_v4_reply_with_memory[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;/m);
  assert.match(functionBody, /pg_advisory_xact_lock/);
  assert.match(functionBody, /FOR UPDATE/);
  assert.match(functionBody, /CONVERSATION_V4_RESERVATION_NOT_OWNED/);
  assert.match(functionBody, /CONVERSATION_V4_RESERVATION_TURN_NOT_OWNED/);
  assert.match(functionBody, /INSERT INTO public\.messages/);
  assert.match(functionBody, /INSERT INTO public\.conversation_durable_memory_updates/);
  assert.ok(functionBody.indexOf('INSERT INTO public.messages') < functionBody.indexOf('INSERT INTO public.conversation_durable_memory_updates'));
  assert.match(functionBody, /existing_count\s*<>\s*jsonb_array_length\(p->'parts'\)/);
  assert.match(functionBody, /reserved\.body IS NOT DISTINCT FROM p->'parts'->>i/);
  assert.match(functionBody, /reserved\.metadata->'part_index' = to_jsonb\(i \+ 1\)/);
  assert.match(functionBody, /message_kind IS DISTINCT FROM p->>'message_kind'/);
  assert.match(functionBody, /user_id IS DISTINCT FROM expected_user_id/);
  assert.match(functionBody, /ON CONFLICT \(session_id, kind, normalized_value\)/);
});

test('V4 durable-memory tables and RPCs remain backend-only', () => {
  for (const source of [migration, schema]) {
    assert.match(source, /conversation_durable_memory ENABLE ROW LEVEL SECURITY/);
    assert.match(source, /conversation_durable_memory FORCE ROW LEVEL SECURITY/);
    assert.match(source, /conversation_durable_memory_updates ENABLE ROW LEVEL SECURITY/);
    assert.match(source, /REVOKE ALL ON TABLE public\.conversation_durable_memory(?:, public\.conversation_durable_memory_updates)? FROM PUBLIC, anon, authenticated, service_role/);
    assert.match(source, /GRANT EXECUTE ON FUNCTION public\.reserve_conversation_v4_reply_with_memory\(jsonb\) TO service_role/);
  }
});

test('V4 security-definer functions use a fixed pg_catalog-first search path in the migration and schema snapshot', () => {
  for (const source of [migration, schema]) {
    const v4Section = source.slice(source.indexOf('CREATE FUNCTION public.read_conversation_durable_memory'));
    assert.match(v4Section, /SET search_path (?:=|TO) pg_catalog, public|SET search_path TO 'pg_catalog', 'public'/);
    assert.doesNotMatch(v4Section, /SET search_path TO 'public'/);
  }
});
