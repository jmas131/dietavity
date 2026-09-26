'use strict';

// Run explicitly against a disposable loopback PostgreSQL database:
// LOCAL_SUPABASE_DB_URL=postgresql://... node --test test/ticket-71-postgres.integration.test.js
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const url = process.env.LOCAL_SUPABASE_DB_URL;
const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/libpq/bin/psql';
const root = path.join(__dirname, '..');
const migrationPath = path.join(root, 'database/migrations/20260925_ticket_71_product_fact_authority.sql');
const local = value => /^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(value || '');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run(sql, expected = 0) {
  const result = spawnSync(psql, [url, '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  assert.equal(result.status, expected, result.stderr);
  return result.stdout;
}

const reset = `
DROP TABLE IF EXISTS public.product_fact_authority_records, public.product_fact_authority_sets CASCADE;
DROP FUNCTION IF EXISTS public.activate_product_fact_authority_set(text);
DROP FUNCTION IF EXISTS public.product_fact_authority_value_is_valid(text, jsonb);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
`;

test('Ticket 71 PostgreSQL migration is compatible, closed-scope, atomic, and seeded', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(local(url), true, 'refuses non-loopback database URL');
  assert.equal(sha256(migrationPath), 'f09d4b73eb22616f0346e88564a89120a9238d4f84f7ba93152303ea229398f9');
  const migration = fs.readFileSync(migrationPath, 'utf8');

  run(reset);
  const forcedFailure = migration.replace(/\nCOMMIT;\s*$/, "\nSELECT no_such_ticket_71_precommit_symbol;\nCOMMIT;\n");
  run(forcedFailure, 3);
  run(`DO $$ BEGIN
    IF to_regclass('public.product_fact_authority_sets') IS NOT NULL
       OR to_regprocedure('public.product_fact_authority_value_is_valid(text,jsonb)') IS NOT NULL THEN
      RAISE EXCEPTION 'migration was not atomic';
    END IF;
  END $$;`);

  run(migration);
  run(`DO $$ DECLARE sets_count integer; facts_count integer; BEGIN
    SELECT count(*) INTO sets_count FROM public.product_fact_authority_sets;
    SELECT count(*) INTO facts_count FROM public.product_fact_authority_records;
    IF sets_count <> 2 OR facts_count <> 14 THEN RAISE EXCEPTION 'seed mismatch: %, %', sets_count, facts_count; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='product_fact_authority_sets' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity) THEN RAISE EXCEPTION 'sets RLS mismatch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='product_fact_authority_records' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity) THEN RAISE EXCEPTION 'records RLS mismatch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='product_fact_authority_one_active_scope' AND indexdef LIKE '%WHERE (status = ''reviewed_active''%') THEN RAISE EXCEPTION 'partial active index mismatch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.product_fact_authority_value_is_valid(text,jsonb)'::regprocedure AND provolatile='i' AND NOT prosecdef) THEN RAISE EXCEPTION 'validator security mismatch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.activate_product_fact_authority_set(text)'::regprocedure AND provolatile='v' AND prosecdef AND proconfig @> ARRAY['search_path=public']) THEN RAISE EXCEPTION 'activation security mismatch'; END IF;
  END $$;`);

  run(`DO $$ BEGIN
    INSERT INTO public.product_fact_authority_sets(authority_set_id, authority_version, status, scope) VALUES
      ('provider-draft-test','1','draft','{"scope_type":"provider"}'),
      ('offer-draft-test','1','draft','{"scope_type":"offer_version","offer_version":"local-test"}');
    BEGIN INSERT INTO public.product_fact_authority_sets(authority_set_id, authority_version, status, scope) VALUES ('bad-provider','1','draft','{"scope_type":"provider","extra":true}'); RAISE EXCEPTION 'extra provider accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN INSERT INTO public.product_fact_authority_sets(authority_set_id, authority_version, status, scope) VALUES ('bad-offer','1','draft','{"scope_type":"offer_version","offer_version":"local-test","extra":true}'); RAISE EXCEPTION 'extra offer accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN INSERT INTO public.product_fact_authority_sets(authority_set_id, authority_version, status, scope) VALUES ('dup-active','1','reviewed_active','{"scope_type":"provider"}'); RAISE EXCEPTION 'duplicate active accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
    BEGIN INSERT INTO public.product_fact_authority_records(fact_id,authority_set_id,fact_key,state,value_type,value) VALUES ('bad-unknown','provider-draft-test','service.bad','unknown','boolean','true'); RAISE EXCEPTION 'unknown value accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN INSERT INTO public.product_fact_authority_records(fact_id,authority_set_id,fact_key,state,value_type,value) VALUES ('bad-known','provider-draft-test','service.bad_known','known_true','boolean',NULL); RAISE EXCEPTION 'known null accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  END $$;
  BEGIN;
  SELECT public.activate_product_fact_authority_set('provider-draft-test');
  DO $$ BEGIN
    IF (SELECT status FROM public.product_fact_authority_sets WHERE authority_set_id='dietavity-provider-boundaries-v1') <> 'retired'
       OR (SELECT status FROM public.product_fact_authority_sets WHERE authority_set_id='provider-draft-test') <> 'reviewed_active' THEN RAISE EXCEPTION 'activation transition mismatch'; END IF;
  END $$;
  ROLLBACK;`);

  run(`DO $$ BEGIN
    IF NOT has_table_privilege('service_role','public.product_fact_authority_sets','select,insert')
       OR has_table_privilege('service_role','public.product_fact_authority_sets','update,delete')
       OR NOT has_function_privilege('service_role','public.product_fact_authority_value_is_valid(text,jsonb)','execute')
       OR NOT has_function_privilege('service_role','public.activate_product_fact_authority_set(text)','execute')
       OR has_function_privilege('anon','public.activate_product_fact_authority_set(text)','execute') THEN RAISE EXCEPTION 'ACL mismatch'; END IF;
  END $$;`);
});
