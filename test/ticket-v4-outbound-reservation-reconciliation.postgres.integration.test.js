'use strict';

// Disposable loopback PostgreSQL only. This exercises the deployed SQL shape,
// including multipart evidence recovery, FIFO blocking, and a second worker.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const url = process.env.LOCAL_SUPABASE_DB_URL;
const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/libpq/bin/psql';
const migration = path.join(__dirname, '..', 'database/migrations/20261030_v4_outbound_reservation_reconciliation.sql');
const poller = require('../n8n/Dietavity WhatsApp Recovery Poller.json');
const finder = poller.nodes.find(node => node.name === 'Find Verified WhatsApp Sessions').parameters.query;
const loopback = value => /^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(value || '');
function run(sql) {
  const result = spawnSync(psql, [url, '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('V4 reconciliation promotes persisted provider acceptance without reordering successors', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(loopback(url), true, 'refuses a non-loopback database URL');
  const out = run(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    DROP FUNCTION IF EXISTS public.claim_v4_outbound_reconciliation(jsonb) CASCADE;
    DROP TABLE IF EXISTS public.messages CASCADE; DROP TABLE IF EXISTS public.logs CASCADE;
    CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), direction text NOT NULL, session_id text NOT NULL, body text, idempotency_key text, in_reply_to_id uuid, delivery_status text, provider_message_sid text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, processing_order bigint, processing_owner text, processing_lease_until timestamptz, processing_completed_at timestamptz, processing_outcome text);
    CREATE TABLE public.logs (event text, severity text, error_message text, error_context jsonb);
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF; END $$;
    \\i ${migration}
    INSERT INTO public.messages (id,direction,session_id,processing_order) VALUES ('00000000-0000-4000-8000-000000000001','inbound','s',1),('00000000-0000-4000-8000-000000000002','inbound','s',2);
    INSERT INTO public.messages (direction,session_id,processing_order,metadata) VALUES
      ('inbound','blocked',10,'{"reconciliation_state":"operator_required"}'),
      ('inbound','blocked',11,'{}'),
      ('inbound','independent',20,'{}');
    INSERT INTO public.messages (direction,session_id,in_reply_to_id,body,idempotency_key,delivery_status,provider_message_sid,metadata) VALUES
      ('outbound','s','00000000-0000-4000-8000-000000000001','a','reply:a','pending','SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{"logical_reply_key":"reply:a","part_index":1,"part_count":2}'),
      ('outbound','s','00000000-0000-4000-8000-000000000001','b','reply:a:part:002','pending','SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','{"logical_reply_key":"reply:a","part_index":2,"part_count":2}');
    SELECT reconciliation_state FROM public.claim_v4_outbound_reconciliation('{"inbound_message_id":"00000000-0000-4000-8000-000000000001","session_id":"s","processing_owner":"worker-a"}');
    SELECT count(*) AS accepted_parts FROM public.messages WHERE direction='outbound' AND delivery_status='accepted';
    SELECT processing_completed_at IS NULL AS successor_still_queued FROM public.messages WHERE id='00000000-0000-4000-8000-000000000002';
    DO $$ BEGIN
      PERFORM * FROM public.claim_v4_outbound_reconciliation('{"inbound_message_id":"00000000-0000-4000-8000-000000000001","session_id":"s","processing_owner":"worker-b"}');
      RAISE EXCEPTION 'second worker unexpectedly acquired reconciliation';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'V4_RECONCILIATION_OWNED' THEN RAISE; END IF;
    END $$;
    SELECT 'second_worker_rejected';
    ${finder}
    INSERT INTO public.messages (id,direction,session_id,processing_order) VALUES
      ('00000000-0000-4000-8000-000000000003','inbound','ambiguous',1),
      ('00000000-0000-4000-8000-000000000004','inbound','redispatch',1),
      ('00000000-0000-4000-8000-000000000005','inbound','mixed',1);
    INSERT INTO public.messages (direction,session_id,in_reply_to_id,body,idempotency_key,delivery_status,metadata,provider_message_sid) VALUES
      ('outbound','ambiguous','00000000-0000-4000-8000-000000000003','unknown','reply:unknown','pending','{}',NULL),
      ('outbound','redispatch','00000000-0000-4000-8000-000000000004','reusable','reply:retry','failed','{"provider_error_code":"21617"}',NULL),
      ('outbound','mixed','00000000-0000-4000-8000-000000000005','first','reply:mixed','accepted','{"logical_reply_key":"reply:mixed","part_index":1,"part_count":2,"provider_acceptance_evidence":"message_sid"}','SMcccccccccccccccccccccccccccccccc'),
      ('outbound','mixed','00000000-0000-4000-8000-000000000005','second','reply:mixed:part:002','pending','{"logical_reply_key":"reply:mixed","part_index":2,"part_count":2}',NULL);
    SELECT reconciliation_state FROM public.claim_v4_outbound_reconciliation('{"inbound_message_id":"00000000-0000-4000-8000-000000000003","session_id":"ambiguous","processing_owner":"worker-c"}');
    SELECT metadata->>'reconciliation_state' AS ambiguous_state FROM public.messages WHERE id='00000000-0000-4000-8000-000000000003';
    SELECT reconciliation_state FROM public.claim_v4_outbound_reconciliation('{"inbound_message_id":"00000000-0000-4000-8000-000000000004","session_id":"redispatch","processing_owner":"worker-d"}');
    SELECT count(*) AS redispatch_tokens FROM public.messages WHERE session_id='redispatch' AND metadata ? 'reconciliation_redispatch_token';
    SELECT reconciliation_state FROM public.claim_v4_outbound_reconciliation('{"inbound_message_id":"00000000-0000-4000-8000-000000000005","session_id":"mixed","processing_owner":"worker-e"}');
    SELECT metadata->>'reconciliation_state' AS mixed_state FROM public.messages WHERE id='00000000-0000-4000-8000-000000000005';
  `);
  assert.match(out, /accepted\s*\n/);
  assert.match(out, /2\s*\n/);
  assert.match(out, /t\s*\n/);
  assert.match(out, /second_worker_rejected/);
  assert.match(out, /independent/);
  assert.doesNotMatch(out, /blocked/);
  assert.match(out, /escalated/);
  assert.match(out, /operator_required/);
  assert.match(out, /redispatch/);
  assert.match(out, /redispatch_tokens\s*\n-+\n\s*1/);
});
