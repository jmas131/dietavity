'use strict';

// Run only against a disposable loopback PostgreSQL database:
// LOCAL_SUPABASE_DB_URL=postgresql://... node --test test/recovery-poller-v4-postgres.integration.test.js
// It extracts the generated n8n SQL/expressions, never contacts a provider,
// and refuses any non-loopback connection string.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const url = process.env.LOCAL_SUPABASE_DB_URL;
const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/libpq/bin/psql';
const root = path.join(__dirname, '..');
const sales = require(path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json'));
const poller = require(path.join(root, 'n8n/Dietavity WhatsApp Recovery Poller.json'));
const errorWorkflow = require(path.join(root, 'n8n/Global Error Handler.json'));
const v4Migration = path.join(root, 'database/migrations/20261024_v4_authority_and_durable_memory.sql');
const loopback = value => /^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(value || '');
const node = (workflow, name) => {
  const value = workflow.nodes.find(candidate => candidate.name === name);
  assert.ok(value, `missing ${name}`);
  return value;
};
const json = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const sqlText = value => `'${String(value).replaceAll("'", "''")}'`;
const subquery = sql => sql.trim().replace(/;$/u, '');
const withPayload = (sql, payload) => sql.replace('$1::jsonb', json(payload));

function run(sql) {
  const result = spawnSync(psql, [url, '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function v4Payload(claimed, body) {
  const expression = node(sales, 'Reserve V4 Reply With Memory').parameters.options.queryReplacement;
  assert.match(expression, /^=\{\{/);
  const serialized = vm.runInNewContext(expression.slice(3, -2), {
    JSON,
    $execution: { id: claimed.processing_owner },
    $json: { logical_assistant_response: body, whatsapp_parts: [body], memory_updates: [] },
    $: name => {
      assert.equal(name, 'Claim Next Session Inbound');
      return { item: { json: claimed } };
    },
  });
  return JSON.parse(serialized);
}

test('recovery poller qualification uses generated canonical claim, error-release, V4 reservation, and completion SQL', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(loopback(url), true, 'refuses a non-loopback database URL');
  assert.equal(fs.existsSync(v4Migration), true);

  const reserveInbound = node(sales, 'Reserve Canonical Inbound Message').parameters.query;
  const claim = node(sales, 'Claim Next Session Inbound').parameters.query;
  const complete = node(sales, 'Mark Session Inbound Complete').parameters.query;
  const findRecoverable = node(poller, 'Find Verified WhatsApp Sessions').parameters.query;
  const release = node(errorWorkflow, 'Insert Error Log (Error Handler)').parameters.query;
  assert.match(findRecoverable, /processing_lease_until <= NOW\(\)/);
  assert.match(claim, /'reconciliation'::text AS claim_state/);
  assert.match(release, /claim_released_by_error_handler_at/);

  const inbound = (session, sid, key) => withPayload(reserveInbound, {
    session_id: session, body: 'Necesito una receta sencilla', message_kind: 'text',
    provider_message_sid: sid, idempotency_key: key, num_media: 0,
    workflow_execution_id: 'qualification', provider_event_timestamp: null,
  });
  const claimSql = (session, owner) => subquery(withPayload(claim, {
    session_id: session,
    processing_owner: owner,
  }));
  const captureClaim = (label, session, owner) => `${claimSql(session, owner)}\n\\gset ${label}_\nSELECT 'claim:${label}:' || :'${label}_claim_state';`;
  const completeSql = (sid, owner) => complete.replace('$1::jsonb', `jsonb_build_object(
    'inbound_message_id', ${idFor(sid)}::text,
    'processing_owner', ${sqlText(owner)}
  )`);
  const releaseSql = owner => withPayload(release, { execution_id: owner, error_message: 'synthetic pre-reservation failure' });
  const pollerHas = session => `EXISTS (SELECT 1 FROM (${subquery(findRecoverable)}) AS selected WHERE selected.session_id = ${sqlText(session)})`;
  const idFor = sid => `(SELECT id FROM public.messages WHERE provider_message_sid = ${sqlText(sid)})`;
  const reserveV4 = (sid, session, owner, body) => json(v4Payload({
    id: `__ID_${sid}__`, session_id: session, provider_message_sid: sid, processing_owner: owner,
  }, body));
  // The generated reservation expression supplies the payload shape. Its
  // inbound id comes from the actual generated inbound-reservation SQL, so
  // replace that one JSON property through jsonb_set rather than inventing it.
  const v4 = (sid, session, owner, body) => `SELECT * FROM public.reserve_conversation_v4_reply_with_memory(
    jsonb_set(${reserveV4(sid, session, owner, body)}, '{in_reply_to_id}', to_jsonb(${idFor(sid)}::text))
  )`;
  const output = run(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    DROP FUNCTION IF EXISTS public.reserve_conversation_v4_reply_with_memory(jsonb) CASCADE;
    DROP FUNCTION IF EXISTS public.read_conversation_durable_memory(text, uuid) CASCADE;
    DROP FUNCTION IF EXISTS public.link_conversation_durable_memory(text, uuid) CASCADE;
    DROP TABLE IF EXISTS public.conversation_durable_memory_updates CASCADE;
    DROP TABLE IF EXISTS public.conversation_durable_memory CASCADE;
    DROP TABLE IF EXISTS public.messages CASCADE;
    DROP TABLE IF EXISTS public.users CASCADE;
    DROP TABLE IF EXISTS public.onboarding_sessions CASCADE;
    DROP TABLE IF EXISTS public.logs CASCADE;
    DROP SEQUENCE IF EXISTS public.messages_inbound_processing_order_seq CASCADE;
    CREATE TABLE public.users (id uuid PRIMARY KEY, whatsapp_id text);
    CREATE TABLE public.messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NULL REFERENCES public.users(id),
      direction text NOT NULL, user_message text, timestamp timestamptz NOT NULL DEFAULT now(),
      audio_url text, transcript text, intent text, assistant_response text, session_id text NOT NULL,
      body text, message_kind text, provider text, provider_message_sid text, idempotency_key text,
      in_reply_to_id uuid NULL REFERENCES public.messages(id), delivery_status text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, processing_order bigint, processing_owner text,
      processing_lease_until timestamptz, processing_completed_at timestamptz, processing_outcome text
    );
    CREATE UNIQUE INDEX messages_idempotency_key_uidx ON public.messages (idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE SEQUENCE public.messages_inbound_processing_order_seq;
    CREATE TABLE public.onboarding_sessions (session_id text, last_question_type text, last_question_at timestamptz, commercial_context_expires_at timestamptz, checkout_authorization_type text, checkout_authorized_at timestamptz, updated_at timestamptz);
    CREATE TABLE public.logs (event text, severity text, error_message text, error_context jsonb);
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    \\i ${v4Migration}

    -- Scenario 1: actual reservation, claim A, exact Global Error Handler release, poller, claim B, V4, completion.
    ${inbound('recovery-s1', 'SM11111111111111111111111111111111', 'inbound:s1')};
    UPDATE public.messages SET timestamp = now() - interval '20 seconds' WHERE provider_message_sid = 'SM11111111111111111111111111111111';
    ${captureClaim('s1a', 'recovery-s1', 'owner-a')}
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.messages WHERE provider_message_sid = 'SM11111111111111111111111111111111' AND processing_owner = 'owner-a' AND processing_lease_until > now()) THEN RAISE EXCEPTION 's1 live lease missing'; END IF;
    END $$;
    ${releaseSql('owner-a')};
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM public.messages WHERE provider_message_sid = 'SM11111111111111111111111111111111' AND (processing_completed_at IS NOT NULL OR processing_owner IS NOT NULL OR processing_lease_until IS NOT NULL)) THEN RAISE EXCEPTION 's1 release state wrong'; END IF;
      IF EXISTS (SELECT 1 FROM public.messages WHERE in_reply_to_id = ${idFor('SM11111111111111111111111111111111')} AND direction = 'outbound') THEN RAISE EXCEPTION 's1 unexpected outbound'; END IF;
      IF NOT ${pollerHas('recovery-s1')} THEN RAISE EXCEPTION 's1 poller did not wake'; END IF;
    END $$;
    ${captureClaim('s1b', 'recovery-s1', 'owner-b')}
    ${v4('SM11111111111111111111111111111111', 'recovery-s1', 'owner-b', 'Respuesta V4 uno')};
    UPDATE public.messages SET delivery_status = 'accepted', provider_message_sid = 'SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE in_reply_to_id = ${idFor('SM11111111111111111111111111111111')} AND direction = 'outbound';
    ${completeSql('SM11111111111111111111111111111111', 'owner-b')};
    DO $$ BEGIN
      IF (SELECT count(*) FROM public.messages WHERE in_reply_to_id = ${idFor('SM11111111111111111111111111111111')} AND direction = 'outbound') <> 1 THEN RAISE EXCEPTION 's1 outbound count'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.messages WHERE provider_message_sid = 'SM11111111111111111111111111111111' AND processing_completed_at IS NOT NULL) THEN RAISE EXCEPTION 's1 incomplete'; END IF;
      IF ${pollerHas('recovery-s1')} THEN RAISE EXCEPTION 's1 completed inbound woke'; END IF;
    END $$;

    -- Scenario 2: stale pre-reservation lease wakes and the canonical claim re-acquires it.
    ${inbound('recovery-s2', 'SM22222222222222222222222222222222', 'inbound:s2')};
    UPDATE public.messages SET timestamp = now() - interval '20 seconds' WHERE provider_message_sid = 'SM22222222222222222222222222222222';
    ${captureClaim('s2a', 'recovery-s2', 'owner-a')}
    UPDATE public.messages SET processing_lease_until = now() - interval '1 second' WHERE provider_message_sid = 'SM22222222222222222222222222222222';
    DO $$ BEGIN
      IF NOT ${pollerHas('recovery-s2')} THEN RAISE EXCEPTION 's2 poller did not wake'; END IF;
    END $$;
    ${captureClaim('s2b', 'recovery-s2', 'owner-b')}
    ${v4('SM22222222222222222222222222222222', 'recovery-s2', 'owner-b', 'Respuesta V4 dos')};
    DO $$ BEGIN
      IF (SELECT count(*) FROM public.messages WHERE in_reply_to_id = ${idFor('SM22222222222222222222222222222222')} AND direction = 'outbound') <> 1 THEN RAISE EXCEPTION 's2 outbound count'; END IF;
    END $$;

    -- Scenario 3: a stale claimed turn with a pending durable outbound wakes only to reconciliation.
    ${inbound('recovery-s3', 'SM33333333333333333333333333333333', 'inbound:s3')};
    UPDATE public.messages SET timestamp = now() - interval '20 seconds' WHERE provider_message_sid = 'SM33333333333333333333333333333333';
    ${captureClaim('s3a', 'recovery-s3', 'owner-a')}
    ${v4('SM33333333333333333333333333333333', 'recovery-s3', 'owner-a', 'Respuesta V4 tres')};
    UPDATE public.messages SET processing_lease_until = now() - interval '1 second' WHERE provider_message_sid = 'SM33333333333333333333333333333333';
    DO $$ BEGIN
      IF NOT ${pollerHas('recovery-s3')} THEN RAISE EXCEPTION 's3 poller did not wake'; END IF;
      IF (SELECT count(*) FROM public.messages WHERE in_reply_to_id = ${idFor('SM33333333333333333333333333333333')} AND direction = 'outbound') <> 1 THEN RAISE EXCEPTION 's3 duplicate outbound'; END IF;
    END $$;
    ${captureClaim('s3b', 'recovery-s3', 'owner-b')}
    DO $$ BEGIN
      BEGIN
        PERFORM * FROM public.reserve_conversation_v4_reply_with_memory(jsonb_set(
          ${reserveV4('SM33333333333333333333333333333333', 'recovery-s3', 'owner-b', 'must not reserve')},
          '{in_reply_to_id}', to_jsonb(${idFor('SM33333333333333333333333333333333')}::text)
        ));
        RAISE EXCEPTION 's3 V4 ran again' USING ERRCODE = 'P0002';
      EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
      END;
    END $$;

    -- Scenario 4: a live lease is not selected.
    ${inbound('recovery-s4', 'SM44444444444444444444444444444444', 'inbound:s4')};
    UPDATE public.messages SET timestamp = now() - interval '20 seconds' WHERE provider_message_sid = 'SM44444444444444444444444444444444';
    ${captureClaim('s4a', 'recovery-s4', 'owner-a')}
    DO $$ BEGIN
      IF ${pollerHas('recovery-s4')} THEN RAISE EXCEPTION 's4 live lease woke'; END IF;
    END $$;
  `);
  for (const [label, state] of [
    ['s1a', 'acquired'], ['s1b', 'acquired'], ['s2a', 'acquired'],
    ['s2b', 'acquired'], ['s3a', 'acquired'], ['s3b', 'reconciliation'],
    ['s4a', 'acquired'],
  ]) assert.match(output, new RegExp(`claim:${label}:${state}`));
});
