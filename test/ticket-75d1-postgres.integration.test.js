'use strict';
// Disposable-loopback only: never infer or contact a Supabase/production URL.
const { spawnSync } = require('node:child_process'); const path = require('node:path'); const test = require('node:test'); const assert = require('node:assert/strict');
const { approvedResponseDigest, reservationBinding } = require('../lib/sales-engine-v2/approved-reply-reservation-binding');
const url = process.env.LOCAL_SUPABASE_DB_URL; const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/libpq/bin/psql'; const root = path.join(__dirname, '..');
const m17a = path.join(root, 'database/migrations/20260923_ticket_17a_typed_conversational_output_metadata.sql'); const m75d1 = path.join(root, 'database/migrations/20260926_ticket_75d1_atomic_v2_reply_reservation.sql');
const local = value => /^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1(?::\d+)?\//.test(value || '');
function run(sql) { const r = spawnSync(psql, [url, '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; }
function request(overrides = {}) { const text = 'Texto aprobado exacto\r\n🙂'; const value = { contract_version: 'ticket-75d1-v1', canonical_inbound_message_id: '11111111-1111-4111-8111-000000007501', session_id: 't75d1', processing_owner: 'owner', logical_reply_key: `lrk-${'a'.repeat(64)}`, eligible_response_binding: `pgrsp-${'b'.repeat(64)}`, approved_response_text: text, approved_response_digest: approvedResponseDigest(text), parts: [{ part_index: 1, part_count: 2, body: 'parte uno' }, { part_index: 2, part_count: 2, body: 'parte dos' }], artifact_projection: null, ...overrides }; value.reservation_binding = reservationBinding(value); return value; }
function literal(value) { return JSON.stringify(value).replaceAll("'", "''"); }
test('T75D.1 real PostgreSQL normal/idempotent/conflict/rollback/ACL/recovery matrix', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(local(url), true, 'refuses non-loopback database URL');
  const good = request(); const bad = request({ parts: [{ part_index: 1, part_count: 2, body: 'different' }, { part_index: 2, part_count: 2, body: 'parte dos' }] });
  run(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    DROP TABLE IF EXISTS public.conversation_artifact_lineage, public.conversation_artifacts, public.messages CASCADE;
    DROP FUNCTION IF EXISTS public.persist_conversation_artifact(jsonb), public.reserve_v2_approved_logical_reply(jsonb);
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
    CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, direction text NOT NULL, body text, assistant_response text, timestamp timestamptz DEFAULT now(), session_id text, message_kind text, provider text, provider_message_sid text, idempotency_key text, in_reply_to_id uuid, delivery_status text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, processing_order bigint, processing_owner text, processing_lease_until timestamptz, processing_completed_at timestamptz, processing_outcome text);
    CREATE UNIQUE INDEX messages_idempotency_key_uidx ON public.messages(idempotency_key) WHERE idempotency_key IS NOT NULL;
    \\i ${m17a}
    \\i ${m75d1}
    INSERT INTO public.messages(id,direction,session_id,provider,provider_message_sid,processing_order,processing_owner,processing_lease_until,metadata) VALUES ('11111111-1111-4111-8111-000000007501','inbound','t75d1','twilio','SM11111111111111111111111111111111',1,'owner',now()+interval '10 minutes','{}');
    SELECT public.reserve_v2_approved_logical_reply('${literal(good)}'::jsonb);
    DO $$ BEGIN
      IF (SELECT count(*) FROM public.messages WHERE in_reply_to_id='11111111-1111-4111-8111-000000007501') <> 2 THEN RAISE EXCEPTION 'normal multipart missing'; END IF;
      IF EXISTS (SELECT 1 FROM public.messages WHERE in_reply_to_id='11111111-1111-4111-8111-000000007501' AND assistant_response IS DISTINCT FROM ${"'" + good.approved_response_text.replaceAll("'", "''") + "'"}) THEN RAISE EXCEPTION 'source changed'; END IF;
      IF has_function_privilege('anon','public.reserve_v2_approved_logical_reply(jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.reserve_v2_approved_logical_reply(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'ACL leaked'; END IF;
    END $$;
    SELECT public.reserve_v2_approved_logical_reply('${literal(good)}'::jsonb);
    DO $$ BEGIN IF (SELECT count(*) FROM public.messages WHERE in_reply_to_id='11111111-1111-4111-8111-000000007501') <> 2 THEN RAISE EXCEPTION 'idempotency failed'; END IF; END $$;
    DO $$ BEGIN PERFORM public.reserve_v2_approved_logical_reply('${literal(bad)}'::jsonb); RAISE EXCEPTION 'conflict accepted'; EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM <> 'V2_REPLY_RESERVATION_CONFLICT' THEN RAISE; END IF; END $$;
    DO $$ BEGIN IF (SELECT count(*) FROM public.messages WHERE in_reply_to_id='11111111-1111-4111-8111-000000007501') <> 2 THEN RAISE EXCEPTION 'conflict mutated ledger'; END IF; END $$;
  `);
  assert.match(run('SHOW server_version;'), /18\./);
});
