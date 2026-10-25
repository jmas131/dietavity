'use strict';

// Run explicitly against a disposable loopback PostgreSQL database:
// LOCAL_SUPABASE_DB_URL=postgresql://... node --test test/conversation-engine-v4-postgres.integration.test.js
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const url = process.env.LOCAL_SUPABASE_DB_URL;
const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/libpq/bin/psql';
const root = path.join(__dirname, '..');
const migration = path.join(root, 'database/migrations/20261024_v4_authority_and_durable_memory.sql');
const workflow = require(path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json'));
const local = value => /^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(value || '');

function v4CanonicalHistoryQuery() {
  const node = workflow.nodes.find(candidate => candidate.name === 'Get V4 Conversation Context');
  assert.ok(node, 'Get V4 Conversation Context workflow node is required');
  return node.parameters.query;
}

function run(sql) {
  const result = spawnSync(psql, [url, '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function payload(value) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

function reservation(inbound, key, updates, options = {}) {
  return {
    in_reply_to_id: inbound,
    session_id: options.session || 'session-v4-a',
    processing_owner: 'owner-v4',
    base_idempotency_key: key,
    logical_body: options.body || 'Respuesta V4',
    message_kind: 'sales_ai',
    parts: [options.body || 'Respuesta V4'],
    memory_updates: updates,
    ...(options.userId ? { user_id: options.userId } : {}),
  };
}

test('V4 durable memory and outbound reservation integration', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(local(url), true, 'refuses non-loopback database URL');
  assert.equal(fs.existsSync(migration), true);

  run(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    DROP FUNCTION IF EXISTS public.reserve_conversation_v4_reply_with_memory(jsonb) CASCADE;
    DROP FUNCTION IF EXISTS public.read_conversation_durable_memory(text, uuid) CASCADE;
    DROP FUNCTION IF EXISTS public.link_conversation_durable_memory(text, uuid) CASCADE;
    DROP TABLE IF EXISTS public.conversation_durable_memory_updates CASCADE;
    DROP TABLE IF EXISTS public.conversation_durable_memory CASCADE;
    DROP TABLE IF EXISTS public.messages CASCADE;
    DROP TABLE IF EXISTS public.users CASCADE;
    CREATE TABLE public.users (id uuid PRIMARY KEY);
    CREATE TABLE public.messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NULL REFERENCES public.users(id),
      session_id text NOT NULL,
      direction text NOT NULL,
      body text,
      message_kind text,
      provider text,
      idempotency_key text,
      in_reply_to_id uuid NULL REFERENCES public.messages(id),
      delivery_status text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      assistant_response text,
      provider_message_sid text,
      timestamp timestamptz NOT NULL DEFAULT now(),
      processing_order bigint,
      processing_outcome text,
      processing_completed_at timestamptz,
      processing_owner text,
      processing_lease_until timestamptz
    );
    CREATE UNIQUE INDEX messages_idempotency_key_uidx ON public.messages (idempotency_key) WHERE idempotency_key IS NOT NULL;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    \\i ${migration}
    INSERT INTO public.messages (id, session_id, direction, body, provider, delivery_status, processing_owner, processing_lease_until)
    VALUES
      ('00000000-0000-4000-8000-000000000001', 'session-v4-a', 'inbound', 'soy alérgica al cacahuate', 'twilio', 'received', 'owner-v4', now() + interval '1 hour'),
      ('00000000-0000-4000-8000-000000000002', 'session-v4-a', 'inbound', 'ya no soy alérgica al cacahuate', 'twilio', 'received', 'owner-v4', now() + interval '1 hour'),
      ('00000000-0000-4000-8000-000000000003', 'session-v4-b', 'inbound', 'prefiero comida suave', 'twilio', 'received', 'owner-v4', now() + interval '1 hour'),
      ('00000000-0000-4000-8000-000000000004', 'session-v4-fail', 'inbound', 'fallo', 'twilio', 'received', 'owner-v4', now() + interval '1 hour'),
      ('00000000-0000-4000-8000-000000000005', 'session-v4-a', 'inbound', 'vuelvo a declarar alergia', 'twilio', 'received', 'owner-v4', now() + interval '1 hour'),
      ('00000000-0000-4000-8000-000000000006', 'session-v4-parts', 'inbound', 'dos partes', 'twilio', 'received', 'owner-v4', now() + interval '1 hour'),
      ('00000000-0000-4000-8000-000000000007', 'session-v4-parts', 'inbound', 'miembro', 'twilio', 'received', 'owner-v4', now() + interval '1 hour'),
      ('00000000-0000-4000-8000-000000000008', 'session-v4-owner', 'inbound', 'otro dueño', 'twilio', 'received', 'other-owner', now() + interval '1 hour'),
      ('00000000-0000-4000-8000-000000000009', 'session-v4-expired', 'inbound', 'lease vencido', 'twilio', 'received', 'owner-v4', now() - interval '1 second'),
      ('00000000-0000-4000-8000-000000000010', 'session-v4-superseded', 'inbound', 'superseded', 'twilio', 'received', NULL, NULL);
    UPDATE public.messages
    SET metadata = '{"turn_anchor_id":"00000000-0000-4000-8000-000000000006"}'::jsonb
    WHERE id = '00000000-0000-4000-8000-000000000007';
    UPDATE public.messages
    SET metadata = '{"turn_anchor_id":"00000000-0000-4000-8000-000000000010"}'::jsonb,
        processing_completed_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000010';
    INSERT INTO public.users (id) VALUES ('00000000-0000-4000-8000-000000000099');
  `);

  const canonicalHistoryQuery = v4CanonicalHistoryQuery()
    .replace('$1', "'session-v4-a'")
    .replace('$2::uuid', "'00000000-0000-4000-8000-000000000001'::uuid");
  run(canonicalHistoryQuery);

  const add = reservation('00000000-0000-4000-8000-000000000001', 'v4:add', [{ kind: 'allergy', action: 'add', value: 'cacahuate' }]);
  const changedPart = { ...add, parts: ['Una respuesta distinta'] };
  run(`
    SELECT * FROM public.reserve_conversation_v4_reply_with_memory(${payload(add)});
    DO $$ BEGIN
      IF (SELECT count(*) FROM public.messages WHERE in_reply_to_id='00000000-0000-4000-8000-000000000001') <> 1 THEN RAISE EXCEPTION 'outbound was not reserved'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.conversation_durable_memory WHERE session_id='session-v4-a' AND kind='allergy' AND value='cacahuate' AND status='active' AND source_inbound_message_id='00000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'add or source provenance missing'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.conversation_durable_memory_updates WHERE source_inbound_message_id='00000000-0000-4000-8000-000000000001' AND update_index=1 AND outcome='applied') THEN RAISE EXCEPTION 'update receipt missing'; END IF;
    END $$;
    SELECT * FROM public.reserve_conversation_v4_reply_with_memory(${payload(add)});
    DO $$ BEGIN
      IF (SELECT count(*) FROM public.messages WHERE in_reply_to_id='00000000-0000-4000-8000-000000000001') <> 1 OR (SELECT count(*) FROM public.conversation_durable_memory_updates WHERE source_inbound_message_id='00000000-0000-4000-8000-000000000001') <> 1 THEN RAISE EXCEPTION 'replay created duplicate state'; END IF;
      BEGIN PERFORM public.reserve_conversation_v4_reply_with_memory(${payload(reservation('00000000-0000-4000-8000-000000000001', 'v4:add', [{ kind: 'allergy', action: 'add', value: 'nuez' }]))}); RAISE EXCEPTION 'changed replay accepted'; EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
      BEGIN PERFORM public.reserve_conversation_v4_reply_with_memory(${payload(changedPart)}); RAISE EXCEPTION 'changed replay part accepted'; EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
      IF EXISTS (SELECT 1 FROM public.conversation_durable_memory WHERE normalized_value='nuez') THEN RAISE EXCEPTION 'changed replay mutated memory'; END IF;
    END $$;
  `);

  const remove = reservation('00000000-0000-4000-8000-000000000002', 'v4:remove', [{ kind: 'allergy', action: 'remove', value: 'cacahuate' }]);
  const reAdd = reservation('00000000-0000-4000-8000-000000000005', 'v4:re-add', [{ kind: 'allergy', action: 'add', value: 'cacahuate' }]);
  const linked = reservation('00000000-0000-4000-8000-000000000003', 'v4:linked', [{ kind: 'preference', action: 'add', value: 'comida suave' }], { session: 'session-v4-b', userId: '00000000-0000-4000-8000-000000000099' });
  const invalidUser = reservation('00000000-0000-4000-8000-000000000004', 'v4:failure', [{ kind: 'dietary_restriction', action: 'add', value: 'sin gluten' }], { session: 'session-v4-fail', userId: '00000000-0000-4000-8000-000000000098' });
  const multipart = { ...reservation('00000000-0000-4000-8000-000000000006', 'v4:parts', [{ kind: 'preference', action: 'add', value: 'comida tibia' }], { session: 'session-v4-parts', body: 'Respuesta multipart' }), parts: ['Parte 1', 'Parte 2'] };
  const wrongOwner = reservation('00000000-0000-4000-8000-000000000008', 'v4:wrong-owner', [], { session: 'session-v4-owner' });
  const expiredLease = reservation('00000000-0000-4000-8000-000000000009', 'v4:expired', [], { session: 'session-v4-expired' });
  const superseded = reservation('00000000-0000-4000-8000-000000000010', 'v4:superseded', [], { session: 'session-v4-superseded' });
  run(`
    SELECT * FROM public.reserve_conversation_v4_reply_with_memory(${payload(remove)});
    SELECT * FROM public.reserve_conversation_v4_reply_with_memory(${payload(reAdd)});
    SELECT * FROM public.reserve_conversation_v4_reply_with_memory(${payload(linked)});
    SELECT * FROM public.reserve_conversation_v4_reply_with_memory(${payload(multipart)});
    DO $$ BEGIN
      IF (SELECT count(*) FROM public.conversation_durable_memory WHERE session_id='session-v4-a' AND kind='allergy' AND normalized_value='cacahuate') <> 1 THEN RAISE EXCEPTION 'add-remove-add created duplicate memory'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.conversation_durable_memory_updates WHERE source_inbound_message_id='00000000-0000-4000-8000-000000000002' AND action='remove' AND outcome='applied') THEN RAISE EXCEPTION 'remove receipt missing'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.conversation_durable_memory WHERE session_id='session-v4-a' AND kind='allergy' AND status='active' AND source_inbound_message_id='00000000-0000-4000-8000-000000000005') THEN RAISE EXCEPTION 'add-remove-add lifecycle missing'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.read_conversation_durable_memory('session-v4-b', '00000000-0000-4000-8000-000000000099') WHERE kind='preference' AND source='session') THEN RAISE EXCEPTION 'linked session read missing'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.read_conversation_durable_memory('session-v4-other', '00000000-0000-4000-8000-000000000099') WHERE kind='preference' AND source='user') THEN RAISE EXCEPTION 'linked user read missing'; END IF;
      IF (SELECT count(*) FROM public.messages WHERE in_reply_to_id='00000000-0000-4000-8000-000000000006') <> 2 THEN RAISE EXCEPTION 'multipart reservation missing parts'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.conversation_durable_memory_updates WHERE source_inbound_message_id='00000000-0000-4000-8000-000000000006' AND outcome='applied') THEN RAISE EXCEPTION 'multipart receipt missing'; END IF;
      BEGIN PERFORM public.reserve_conversation_v4_reply_with_memory(${payload(invalidUser)}); RAISE EXCEPTION 'unknown user accepted'; EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
      BEGIN PERFORM public.reserve_conversation_v4_reply_with_memory(${payload(wrongOwner)}); RAISE EXCEPTION 'wrong owner accepted'; EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
      BEGIN PERFORM public.reserve_conversation_v4_reply_with_memory(${payload(expiredLease)}); RAISE EXCEPTION 'expired lease accepted'; EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
      BEGIN PERFORM public.reserve_conversation_v4_reply_with_memory(${payload(superseded)}); RAISE EXCEPTION 'completed or superseded turn accepted'; EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
      IF EXISTS (SELECT 1 FROM public.conversation_durable_memory WHERE session_id='session-v4-fail') OR EXISTS (SELECT 1 FROM public.messages WHERE in_reply_to_id='00000000-0000-4000-8000-000000000004') THEN RAISE EXCEPTION 'failed reservation committed state'; END IF;
      IF has_table_privilege('service_role', 'public.conversation_durable_memory', 'select') OR has_table_privilege('service_role', 'public.conversation_durable_memory_updates', 'insert') OR NOT has_function_privilege('service_role', 'public.reserve_conversation_v4_reply_with_memory(jsonb)', 'execute') THEN RAISE EXCEPTION 'durable-memory privilege boundary incorrect'; END IF;
    END $$;
  `);
});
