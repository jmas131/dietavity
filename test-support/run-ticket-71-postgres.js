'use strict';

// Isolated PostgreSQL engine: no production credentials or network connections.
// Run explicitly:
// DIETAVITY_PGLITE_PATH=/absolute/path/to/@electric-sql/pglite node --test test-support/run-ticket-71-postgres.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const pglitePath = process.env.DIETAVITY_PGLITE_PATH;
const PGlite = pglitePath ? require(pglitePath).PGlite : null;

const migrationPath = require.resolve('../database/migrations/20260925_ticket_71_product_fact_authority.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
let db;

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

before(async () => { if (PGlite) db = new PGlite(); });
after(async () => { if (db) await db.close(); });

test('Ticket71 migration rolls back before COMMIT and then installs the frozen contract', { skip: !PGlite ? 'DIETAVITY_PGLITE_PATH is required' : false }, async () => {
  assert.equal(crypto.createHash('sha256').update(migration).digest('hex'), 'f09d4b73eb22616f0346e88564a89120a9238d4f84f7ba93152303ea229398f9');
  await db.exec(reset);
  const forcedFailure = migration.replace(/\nCOMMIT;\s*$/, "\nSELECT no_such_ticket_71_precommit_symbol;\nCOMMIT;\n");
  await assert.rejects(db.exec(forcedFailure), /no_such_ticket_71_precommit_symbol/);
  await db.exec('ROLLBACK;');
  assert.equal((await db.query("SELECT to_regclass('public.product_fact_authority_sets') AS relation")).rows[0].relation, null);
  assert.equal((await db.query("SELECT to_regprocedure('public.product_fact_authority_value_is_valid(text,jsonb)') AS function")).rows[0].function, null);

  await db.exec(migration);
  const [{ sets_count, facts_count }] = (await db.query(`SELECT
    (SELECT count(*) FROM public.product_fact_authority_sets) AS sets_count,
    (SELECT count(*) FROM public.product_fact_authority_records) AS facts_count`)).rows;
  assert.equal(Number(sets_count), 2);
  assert.equal(Number(facts_count), 14);
  const { rows: relationRows } = await db.query(`SELECT relname, relkind, relrowsecurity, relforcerowsecurity
    FROM pg_class WHERE relname IN ('product_fact_authority_sets','product_fact_authority_records') ORDER BY relname`);
  assert.deepEqual(relationRows.map(row => ({ ...row, relkind: String(row.relkind) })), [
    { relname: 'product_fact_authority_records', relkind: 'r', relrowsecurity: true, relforcerowsecurity: true },
    { relname: 'product_fact_authority_sets', relkind: 'r', relrowsecurity: true, relforcerowsecurity: true },
  ]);
  const { rows: functionRows } = await db.query(`SELECT p.oid::regprocedure::text AS signature, p.provolatile, p.prosecdef,
    p.proparallel, COALESCE(array_to_string(p.proconfig, ','), '') AS configuration
    FROM pg_proc p WHERE p.oid IN
    ('public.product_fact_authority_value_is_valid(text,jsonb)'::regprocedure,
     'public.activate_product_fact_authority_set(text)'::regprocedure)
    ORDER BY signature`);
  assert.deepEqual(functionRows, [
    { signature: 'activate_product_fact_authority_set(text)', provolatile: 'v', prosecdef: true, proparallel: 'u', configuration: 'search_path=public' },
    { signature: 'product_fact_authority_value_is_valid(text,jsonb)', provolatile: 'i', prosecdef: false, proparallel: 'u', configuration: '' },
  ]);
  const [{ scope_generated, service_can_read_insert, service_can_update_delete, service_can_activate, anon_can_activate }] = (await db.query(`SELECT
    (SELECT attgenerated = 's' FROM pg_attribute WHERE attrelid='public.product_fact_authority_sets'::regclass AND attname='scope_key') AS scope_generated,
    has_table_privilege('service_role', 'public.product_fact_authority_sets', 'select,insert') AS service_can_read_insert,
    has_table_privilege('service_role', 'public.product_fact_authority_sets', 'update,delete') AS service_can_update_delete,
    has_function_privilege('service_role', 'public.activate_product_fact_authority_set(text)', 'execute') AS service_can_activate,
    has_function_privilege('anon', 'public.activate_product_fact_authority_set(text)', 'execute') AS anon_can_activate`)).rows;
  assert.equal(scope_generated, true);
  assert.equal(service_can_read_insert, true);
  assert.equal(service_can_update_delete, false);
  assert.equal(service_can_activate, true);
  assert.equal(anon_can_activate, false);
});

test('Ticket71 preserves closed scopes, fact-state validation, active uniqueness, and transactional activation', { skip: !PGlite ? 'DIETAVITY_PGLITE_PATH is required' : false }, async () => {
  await db.exec(`DO $$ BEGIN
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
  assert.equal((await db.query("SELECT status FROM public.product_fact_authority_sets WHERE authority_set_id='dietavity-provider-boundaries-v1'")) .rows[0].status, 'reviewed_active');
});
