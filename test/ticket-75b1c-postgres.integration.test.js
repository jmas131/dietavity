'use strict';

// Explicit disposable-loopback PostgreSQL validation. It never guesses a URL.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const url = process.env.LOCAL_SUPABASE_DB_URL;
const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/libpq/bin/psql';
const root = path.join(__dirname, '..');
const ticket17a = path.join(root, 'database/migrations/20260923_ticket_17a_typed_conversational_output_metadata.sql');
const ticket71 = path.join(root, 'database/migrations/20260925_ticket_71_product_fact_authority.sql');
const ticket72 = path.join(root, 'database/migrations/20260925_ticket_72_reviewed_nutrition_knowledge_authority.sql');
const local = value => /^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1(?::\d+)?\//.test(value || '');

function run(sql) {
  const result = spawnSync(psql, [url, '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('T75B.1c real PostgreSQL validates canonical reader source representations', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(local(url), true, 'refuses non-loopback database URL');
  run(`
    DROP TABLE IF EXISTS public.conversation_artifact_lineage, public.conversation_artifacts, public.product_fact_authority_records, public.product_fact_authority_sets, public.reviewed_nutrition_knowledge_records, public.reviewed_nutrition_knowledge_sets, public.onboarding_chat_memory, public.onboarding_sessions, public.messages CASCADE;
    DROP FUNCTION IF EXISTS public.persist_conversation_artifact(jsonb), public.activate_product_fact_authority_set(text), public.activate_reviewed_nutrition_knowledge_set(text), public.product_fact_authority_value_is_valid(text,jsonb);
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE TABLE public.messages (
      id uuid PRIMARY KEY, direction text NOT NULL, session_id text, body text, timestamp timestamptz,
      provider_message_sid text, idempotency_key text, in_reply_to_id uuid, delivery_status text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, processing_order bigint, processing_owner text,
      processing_lease_until timestamptz, processing_completed_at timestamptz
    );
    CREATE TABLE public.onboarding_sessions (session_id text PRIMARY KEY, offer_version text NULL, offer_context text NULL);
    CREATE TABLE public.onboarding_chat_memory (id uuid PRIMARY KEY, session_id text NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, message jsonb NOT NULL);
    \\i ${ticket17a}
    \\i ${ticket71}
    \\i ${ticket72}
    INSERT INTO public.onboarding_sessions VALUES ('known','28d-149-v1','glp1_validation'), ('null-offer',NULL,'glp1_validation');
    INSERT INTO public.messages VALUES
      ('00000000-0000-4000-8000-000000000001','inbound','known','Precio','2026-09-26T12:00:00Z','SMcurrent','inbound-key',NULL,'received','{}',7,'worker','2026-09-26T12:05:00Z',NULL),
      ('00000000-0000-4000-8000-000000000101','outbound','known','Parte 1','2026-09-26T11:00:00Z','SMone','reply-1','00000000-0000-4000-8000-000000000001','delivered','{"logical_reply_key":"reply-1","part_index":1,"part_count":2}',NULL,NULL,NULL,NULL),
      ('00000000-0000-4000-8000-000000000102','outbound','known','Parte 2','2026-09-26T11:00:01Z','SMtwo','reply-1:part:002','00000000-0000-4000-8000-000000000001','sent','{"logical_reply_key":"reply-1","part_index":2,"part_count":2}',NULL,NULL,NULL,NULL),
      ('00000000-0000-4000-8000-000000000103','outbound','known','Fallida','2026-09-26T11:00:02Z',NULL,'failed','00000000-0000-4000-8000-000000000001','failed','{}',NULL,NULL,NULL,NULL),
      ('00000000-0000-4000-8000-000000000201','inbound','null-offer','Hola','2026-09-26T13:00:00Z','SMnull','null-key',NULL,'received','{}',8,'worker','2026-09-26T13:05:00Z',NULL);
    INSERT INTO public.onboarding_chat_memory VALUES ('00000000-0000-4000-8000-000000000301','known','2026-09-26T10:00:00Z','2026-09-26T10:00:00Z','{"type":"human","content":"Anterior","additional_kwargs":{}}');
    SELECT public.persist_conversation_artifact('{"contract_version":"1.0","artifact_id":"ca-draft-1","artifact_type":"draft","generation_operation":"draft","generation_task_id":"cgt-1","logical_reply_key":"reply-1","anchor_message_id":"00000000-0000-4000-8000-000000000101","lineage":[]}'::jsonb);
    DO $$ BEGIN
      IF (SELECT processing_order FROM public.messages WHERE id='00000000-0000-4000-8000-000000000001') <> 7
        OR (SELECT count(*) FROM public.messages WHERE in_reply_to_id='00000000-0000-4000-8000-000000000001' AND direction='outbound') <> 3
        OR (SELECT count(*) FROM public.messages WHERE session_id='known' AND direction='outbound' AND delivery_status IN ('accepted','scheduled','sent','delivered')) <> 2
        OR (SELECT offer_version FROM public.onboarding_sessions WHERE session_id='null-offer') IS NOT NULL
        OR NOT EXISTS (SELECT 1 FROM public.onboarding_chat_memory WHERE message->>'content'='Anterior' AND created_at < updated_at + interval '1 second')
        OR NOT EXISTS (SELECT 1 FROM public.conversation_artifacts WHERE logical_reply_key='reply-1' AND anchor_message_id='00000000-0000-4000-8000-000000000101')
        OR (SELECT count(*) FROM public.messages WHERE metadata->>'logical_reply_key'='reply-1' AND (metadata->>'part_index')::integer IN (1,2)) <> 2
        OR NOT EXISTS (SELECT 1 FROM public.product_fact_authority_sets WHERE status='reviewed_active' AND scope='{"scope_type":"provider"}'::jsonb)
        OR NOT EXISTS (SELECT 1 FROM public.product_fact_authority_sets WHERE status='reviewed_active' AND scope='{"scope_type":"offer_version","offer_version":"28d-149-v1"}'::jsonb)
        OR NOT EXISTS (SELECT 1 FROM public.product_fact_authority_records WHERE state='unknown' AND value IS NULL)
        OR NOT EXISTS (SELECT 1 FROM public.reviewed_nutrition_knowledge_records WHERE task_kinds='["knowledge_question"]'::jsonb AND applicable_input_types='[]'::jsonb)
      THEN RAISE EXCEPTION 'T75B.1c canonical source representation mismatch'; END IF;
    END $$;
  `);
  const version = run('SHOW server_version;').trim();
  assert.match(version, /\b18\./);
});
