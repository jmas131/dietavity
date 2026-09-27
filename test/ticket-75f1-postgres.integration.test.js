'use strict';
// Disposable-loopback only: never infer or contact a Supabase/production URL.
const { spawnSync } = require('node:child_process'); const path = require('node:path'); const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('node:crypto');
const url = process.env.LOCAL_SUPABASE_DB_URL; const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/libpq/bin/psql'; const migration = path.join(__dirname, '..', 'database/migrations/20260926_ticket_75f1_v2_lifecycle_diagnostics.sql');
const local = value => /^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1(?::\d+)?\//.test(value || ''); const literal = value => JSON.stringify(value).replaceAll("'", "''");
function run(sql) { const result = spawnSync(psql, [url, '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout; }
const key = `v2d-${crypto.createHash('sha256').update('ticket75f1').digest('hex')}`; const base = { contract_version: 'ticket-75f1-v1', event_key: key, invocation_identity: `cti-${'a'.repeat(64)}`, lifecycle_stage: 'final_gate', lifecycle_status: 'completed', retry_class: 'none', stage_trace: [{ stage: 'context', status: 'completed' }], reservation_projection: { state: 'not_executed' } };
test('T75F.1 real PostgreSQL recorder validates privacy, idempotency, append-only ACLs and schema parity', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(local(url), true, 'refuses non-loopback database URL');
  run(`CREATE EXTENSION IF NOT EXISTS pgcrypto; DROP FUNCTION IF EXISTS public.record_v2_lifecycle_diagnostic(jsonb); DROP TABLE IF EXISTS public.v2_lifecycle_diagnostic_events; DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
    \\i ${migration}
    SELECT * FROM public.record_v2_lifecycle_diagnostic('${literal(base)}'::jsonb); SELECT * FROM public.record_v2_lifecycle_diagnostic('${literal(base)}'::jsonb); DO $$ BEGIN
    IF (SELECT count(*) FROM public.v2_lifecycle_diagnostic_events) <> 1 THEN RAISE EXCEPTION 'idempotency duplicated'; END IF;
    IF has_table_privilege('anon','public.v2_lifecycle_diagnostic_events','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated','public.v2_lifecycle_diagnostic_events','SELECT,INSERT,UPDATE,DELETE') OR has_function_privilege('anon','public.record_v2_lifecycle_diagnostic(jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.record_v2_lifecycle_diagnostic(jsonb)','EXECUTE') OR NOT has_function_privilege('service_role','public.record_v2_lifecycle_diagnostic(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'ACL invalid'; END IF;
    BEGIN PERFORM public.record_v2_lifecycle_diagnostic('${literal({ ...base, lifecycle_status: 'failed' })}'::jsonb); RAISE EXCEPTION 'conflict accepted'; EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM <> 'V2_DIAGNOSTIC_EVENT_CONFLICT' THEN RAISE; END IF; END;
    BEGIN PERFORM public.record_v2_lifecycle_diagnostic('${literal({ ...base, body: 'customer prose' })}'::jsonb); RAISE EXCEPTION 'body accepted'; EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM <> 'V2_DIAGNOSTIC_INPUT_INVALID' THEN RAISE; END IF; END;
    BEGIN PERFORM public.record_v2_lifecycle_diagnostic('${literal({ ...base, response_sha256: 'a'.repeat(64) })}'::jsonb); RAISE EXCEPTION 'hash accepted'; EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM <> 'V2_DIAGNOSTIC_INPUT_INVALID' THEN RAISE; END IF; END;
  END $$;`);
  assert.match(run('SHOW server_version;'), /18\./);
});
