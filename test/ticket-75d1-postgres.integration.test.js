'use strict';
// Disposable-loopback only: never infer or contact a Supabase/production URL.
const { spawnSync } = require('node:child_process'); const path = require('node:path'); const test = require('node:test'); const assert = require('node:assert/strict');
const { approvedResponseDigest, reservationBinding } = require('../lib/sales-engine-v2/approved-reply-reservation-binding');
const { COMPLETE_INBOUND_SQL } = require('../lib/session-ordering');
const url = process.env.LOCAL_SUPABASE_DB_URL; const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/libpq/bin/psql'; const root = path.join(__dirname, '..');
const m17a = path.join(root, 'database/migrations/20260923_ticket_17a_typed_conversational_output_metadata.sql'); const m75d1 = path.join(root, 'database/migrations/20260926_ticket_75d1_atomic_v2_reply_reservation.sql');
const m37a = path.join(root, 'database/migrations/20260904_ticket_37a_historical_reopen.sql');
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
    \\i ${m37a}
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

test('T75D.1 PostgreSQL enforces claims, atomic artifacts, recovery, completion, and malformed inputs', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(local(url), true, 'refuses non-loopback database URL');
  const artifact = { artifact_id: `ca-${'c'.repeat(64)}`, artifact_type: 'draft', generation_operation: 'draft', generation_task_id: `cgt-${'d'.repeat(64)}`, ordered_lineage_artifact_ids: [] };
  const artifactRequest = request({ canonical_inbound_message_id: '11111111-1111-4111-8111-000000007502', session_id: 't75d1-artifact', artifact_projection: artifact }); artifactRequest.reservation_binding = reservationBinding(artifactRequest);
  const recoveryRequest = request({ canonical_inbound_message_id: '11111111-1111-4111-8111-000000007503', session_id: 't75d1-recovery', parts: [{ part_index: 1, part_count: 1, body: 'recovery original' }] }); recoveryRequest.reservation_binding = reservationBinding(recoveryRequest);
  const expiredRequest = request({ canonical_inbound_message_id: '11111111-1111-4111-8111-000000007504', session_id: 't75d1-expired' }); expiredRequest.reservation_binding = reservationBinding(expiredRequest);
  const fifoRequest = request({ canonical_inbound_message_id: '11111111-1111-4111-8111-000000007506', session_id: 't75d1-fifo' }); fifoRequest.reservation_binding = reservationBinding(fifoRequest);
  run(`
    INSERT INTO public.messages(id,direction,session_id,provider,provider_message_sid,processing_order,processing_owner,processing_lease_until,metadata) VALUES
      ('11111111-1111-4111-8111-000000007502','inbound','t75d1-artifact','twilio','SM22222222222222222222222222222222',2,'owner',now()+interval '10 minutes','{}'),
      ('11111111-1111-4111-8111-000000007503','inbound','t75d1-recovery','twilio','SM33333333333333333333333333333333',3,'owner',now()+interval '10 minutes','{}'),
      ('11111111-1111-4111-8111-000000007504','inbound','t75d1-expired','twilio','SM44444444444444444444444444444444',4,'owner',now()-interval '1 minute','{}'),
      ('11111111-1111-4111-8111-000000007505','inbound','t75d1-fifo','twilio','SM55555555555555555555555555555555',6,'owner',now()+interval '10 minutes','{}'),
      ('11111111-1111-4111-8111-000000007506','inbound','t75d1-fifo','twilio','SM66666666666666666666666666666666',7,'owner',now()+interval '10 minutes','{}');
    SELECT public.reserve_v2_approved_logical_reply('${literal(artifactRequest)}'::jsonb);
    SELECT public.reserve_v2_approved_logical_reply('${literal(recoveryRequest)}'::jsonb);
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.conversation_artifacts WHERE artifact_id='${artifact.artifact_id}') THEN RAISE EXCEPTION 'artifact missing'; END IF;
      IF EXISTS (SELECT 1 FROM public.messages WHERE in_reply_to_id='11111111-1111-4111-8111-000000007502' AND (provider_message_sid IS NOT NULL OR metadata ? 'provider_acceptance_evidence')) THEN RAISE EXCEPTION 'transport evidence prewritten'; END IF;
      IF EXISTS (SELECT 1 FROM public.messages WHERE id IN ('11111111-1111-4111-8111-000000007502','11111111-1111-4111-8111-000000007503') AND processing_completed_at IS NOT NULL) THEN RAISE EXCEPTION 'reservation completed inbound'; END IF;
    END $$;
    DO $$ BEGIN PERFORM public.reserve_v2_approved_logical_reply('${literal(expiredRequest)}'::jsonb); RAISE EXCEPTION 'expired lease accepted'; EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM <> 'V2_REPLY_RESERVATION_CLAIM_INVALID' THEN RAISE; END IF; END $$;
    DO $$ BEGIN PERFORM public.reserve_v2_approved_logical_reply('${literal(fifoRequest)}'::jsonb); RAISE EXCEPTION 'FIFO accepted'; EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM <> 'V2_REPLY_RESERVATION_CLAIM_INVALID' THEN RAISE; END IF; END $$;
    UPDATE public.messages SET delivery_status='failed', metadata=metadata || '{"provider_error_code":"21617"}'::jsonb WHERE in_reply_to_id='11111111-1111-4111-8111-000000007503';
    UPDATE public.messages SET processing_owner=NULL, processing_lease_until=NULL WHERE id='11111111-1111-4111-8111-000000007503';
    SELECT public.prepare_whatsapp_reply_recovery(jsonb_build_object('inbound_id','11111111-1111-4111-8111-000000007503','outbound_id',(SELECT id FROM public.messages WHERE in_reply_to_id='11111111-1111-4111-8111-000000007503'),'expected_session_id','t75d1-recovery','expected_key','reply:SM33333333333333333333333333333333:paid','expected_hash','${recoveryRequest.approved_response_digest}','confirmed_error_code','21617','evidence_reference','local-test','parts',jsonb_build_array('recovered one','recovered two'),'length_metadata','{}'::jsonb));
    SELECT public.claim_whatsapp_reply_recovery_part(jsonb_build_object('inbound_id','11111111-1111-4111-8111-000000007503','outbound_id',(SELECT id FROM public.messages WHERE idempotency_key='reply:SM33333333333333333333333333333333:paid'),'expected_session_id','t75d1-recovery','expected_key','reply:SM33333333333333333333333333333333:paid','expected_hash','${recoveryRequest.approved_response_digest}','send_token','11111111-1111-4111-8111-000000000001','window_inbound_sid','SM33333333333333333333333333333333','window_verified_at',now()));
  `);
  const complete = COMPLETE_INBOUND_SQL.replace('$1::jsonb', `'${literal({ inbound_message_id: '11111111-1111-4111-8111-000000007502', processing_owner: 'owner' })}'::jsonb`);
  run(`UPDATE public.messages SET delivery_status='accepted', provider_message_sid='SM77777777777777777777777777777777', metadata=metadata || '{"provider_acceptance_evidence":"message_sid"}'::jsonb WHERE in_reply_to_id='11111111-1111-4111-8111-000000007502'; ${complete};`);
});
