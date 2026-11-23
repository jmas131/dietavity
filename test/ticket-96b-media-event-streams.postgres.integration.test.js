'use strict';

// Explicit disposable loopback PostgreSQL coverage:
// LOCAL_SUPABASE_DB_URL=postgresql://... node --test test/ticket-96b-media-event-streams.postgres.integration.test.js
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const url = process.env.LOCAL_SUPABASE_DB_URL;
const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/libpq/bin/psql';
const root = path.join(__dirname, '..');
const migrations = [
  path.join(root, 'database/migrations/20261118_ticket_96b_media_enrichment.sql'),
  path.join(root, 'database/migrations/20261123_ticket_96b_event_streams_media_metadata.sql'),
];
const local = value => /^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(value || '');

function run(sql) {
  const result = spawnSync(psql, [url, '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('Ticket 96B persists Event Streams descriptors and retains legacy recovery compatibility', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(local(url), true, 'refuses non-loopback database URL');
  for (const migration of migrations) assert.equal(fs.existsSync(migration), true);
  run(`
    DROP FUNCTION IF EXISTS public.persist_media_enrichment(jsonb) CASCADE;
    DROP TABLE IF EXISTS public.messages CASCADE;
    CREATE TABLE public.messages (
      id uuid PRIMARY KEY,
      direction text NOT NULL,
      provider_message_sid text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      processing_owner text,
      processing_completed_at timestamptz,
      processing_lease_until timestamptz
    );
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    \\i ${migrations[0]}
    \\i ${migrations[1]}
    INSERT INTO public.messages (id, direction, provider_message_sid, metadata, processing_owner, processing_lease_until) VALUES
      ('10000000-0000-4000-8000-000000000001', 'inbound', 'SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
       '{"attachments":[{"account_sid":"ACbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","provider_message_sid":"SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","ordinal":0}]}'::jsonb, 'owner', now() + interval '1 hour'),
      ('10000000-0000-4000-8000-000000000002', 'inbound', 'SMcccccccccccccccccccccccccccccccc',
       '{"attachments":[{"media_path":"/2010-04-01/Accounts/ACbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/Messages/SMcccccccccccccccccccccccccccccccc/Media/MEdddddddddddddddddddddddddddddddd","content_type":"audio/ogg","provider_message_sid":"SMcccccccccccccccccccccccccccccccc","ordinal":0}]}'::jsonb, 'owner', now() + interval '1 hour');
    SELECT public.persist_media_enrichment('{"inbound_message_id":"10000000-0000-4000-8000-000000000001","processing_owner":"owner","enrichment":{"kind":"image","text":"observación"}}'::jsonb);
    SELECT public.persist_media_enrichment('{"inbound_message_id":"10000000-0000-4000-8000-000000000002","processing_owner":"owner","enrichment":{"kind":"audio","text":"transcripción"}}'::jsonb);
    DO $$ BEGIN
      IF (SELECT metadata->'media_enrichment'->>'kind' FROM public.messages WHERE id='10000000-0000-4000-8000-000000000001') <> 'image' THEN RAISE EXCEPTION 'Event Streams descriptor was not persisted'; END IF;
      IF (SELECT metadata->'media_enrichment'->>'kind' FROM public.messages WHERE id='10000000-0000-4000-8000-000000000002') <> 'audio' THEN RAISE EXCEPTION 'legacy descriptor recovery regressed'; END IF;
    END $$;
  `);
});
