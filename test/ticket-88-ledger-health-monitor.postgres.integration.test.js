'use strict';

// Explicit disposable loopback PostgreSQL integration test. Never point this
// at production:
// LOCAL_SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres \
//   node --test test/ticket-88-ledger-health-monitor.postgres.integration.test.js
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const url = process.env.LOCAL_SUPABASE_DB_URL;
const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/libpq/bin/psql';
const migration = fs.readFileSync(path.join(__dirname, '..', 'database/migrations/20261102_ticket_88_ledger_health_monitor.sql'), 'utf8');
const loopback = value => /^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(value || '');

function run(sql) {
  const result = spawnSync(psql, [url, '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function runAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(psql, [url, '-X', '-tA', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    child.stdin.end(sql);
  });
}

test('Ticket 88 alert reservations are atomic, confirm-only deduplicated, and recover after abandonment', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, async () => {
  assert.equal(loopback(url), true, 'refuses a non-loopback database URL');
  const out = run(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    DROP FUNCTION IF EXISTS public.confirm_ledger_health_alert_delivery(jsonb) CASCADE;
    DROP FUNCTION IF EXISTS public.reserve_ledger_health_alert(jsonb) CASCADE;
    DROP TABLE IF EXISTS public.ledger_health_alerts CASCADE;
    DROP TABLE IF EXISTS public.messages CASCADE;
    CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    ${migration}
    INSERT INTO public.messages (id) VALUES
      ('88000000-0000-4000-8000-000000000001'),
      ('88000000-0000-4000-8000-000000000002'),
      ('88000000-0000-4000-8000-000000000003');

    -- The first reservation wins; a second monitor execution sees its active
    -- reservation and cannot create a duplicate email claim.
    CREATE TEMP TABLE first_claim AS
      SELECT * FROM public.reserve_ledger_health_alert(jsonb_build_object(
        'inbound_message_id', '88000000-0000-4000-8000-000000000001', 'category', 'expired_lease'));
    SELECT 'first_claim:' || count(*) FROM first_claim;

    -- Confirmation, not reservation, starts the 60-minute suppression clock.
    SELECT public.confirm_ledger_health_alert_delivery(jsonb_build_object(
      'alert_key', alert_key, 'reservation_token', reservation_token)) FROM first_claim;
    SELECT 'delivery:' || delivery_count || ':cleared:' || (reservation_token IS NULL)::text
      FROM public.ledger_health_alerts
      WHERE inbound_message_id = '88000000-0000-4000-8000-000000000001';
    SELECT 'suppressed_claim:' || count(*) FROM public.reserve_ledger_health_alert(jsonb_build_object(
      'inbound_message_id', '88000000-0000-4000-8000-000000000001', 'category', 'expired_lease'));

    -- A reservation without confirmation expires and becomes retryable.
    CREATE TEMP TABLE abandoned_claim AS
      SELECT * FROM public.reserve_ledger_health_alert(jsonb_build_object(
        'inbound_message_id', '88000000-0000-4000-8000-000000000002', 'category', 'missing_lease_expiration'));
    UPDATE public.ledger_health_alerts SET reservation_expires_at = now() - interval '1 second'
      WHERE inbound_message_id = '88000000-0000-4000-8000-000000000002';
    SELECT 'recovered_claim:' || count(*) FROM public.reserve_ledger_health_alert(jsonb_build_object(
      'inbound_message_id', '88000000-0000-4000-8000-000000000002', 'category', 'missing_lease_expiration'));
  `);
  assert.match(out, /first_claim:1/);
  assert.match(out, /delivery:1:cleared:true/);
  assert.match(out, /suppressed_claim:0/);
  assert.match(out, /recovered_claim:1/);

  // Two independent disposable psql clients race for the same key. Exactly
  // one gets a reservation; the other observes the row-level locked claim.
  const concurrentSql = `SELECT count(*) FROM public.reserve_ledger_health_alert(jsonb_build_object(
    'inbound_message_id', '88000000-0000-4000-8000-000000000003', 'category', 'expired_lease'))`;
  const results = await Promise.all([runAsync(concurrentSql), runAsync(concurrentSql)]);
  assert.deepEqual(results.map(value => value.trim()).sort(), ['0', '1']);
});
