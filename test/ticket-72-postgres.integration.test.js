'use strict';

// Run explicitly against a disposable loopback PostgreSQL database:
// LOCAL_SUPABASE_DB_URL=postgresql://... node --test test/ticket-72-postgres.integration.test.js
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const url = process.env.LOCAL_SUPABASE_DB_URL;
const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/libpq/bin/psql';
const root = path.join(__dirname, '..');
const original = path.join(root, 'database/migrations/20260925_ticket_72_reviewed_nutrition_knowledge_authority.sql');
const corrective = path.join(root, 'database/migrations/20260926_ticket_74_ticket72_acl_corrective_forward.sql');
const local = value => /^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(value || '');

function run(sql) {
  const result = spawnSync(psql, [url, '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('Ticket 74 forward migration removes Ticket72 default service-role mutations', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(local(url), true, 'refuses non-loopback database URL');
  assert.equal(sha256(original), '949530622ff4a3898de1f3ad177fa6583d38672105934954cb2573dd763c4c8a');
  assert.equal(sha256(corrective), '709bba9653da6b9cbbf87e072a208e729a2c3e3dc4c9b608b57aa28534d091fd');
  run(`DROP TABLE IF EXISTS public.reviewed_nutrition_knowledge_records, public.reviewed_nutrition_knowledge_sets CASCADE;
    DROP FUNCTION IF EXISTS public.activate_reviewed_nutrition_knowledge_set(text);
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    \\i ${original}`);
  run(`DO $$ DECLARE table_name text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['reviewed_nutrition_knowledge_sets','reviewed_nutrition_knowledge_records'] LOOP
      IF NOT has_table_privilege('service_role', 'public.' || table_name, 'update')
         OR NOT has_table_privilege('service_role', 'public.' || table_name, 'delete')
         OR NOT has_table_privilege('service_role', 'public.' || table_name, 'truncate') THEN
        RAISE EXCEPTION 'expected pre-correction default privilege reproduction on %', table_name;
      END IF;
    END LOOP;
  END $$;
  \\i ${corrective}
  DO $$ DECLARE table_name text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['reviewed_nutrition_knowledge_sets','reviewed_nutrition_knowledge_records'] LOOP
      IF NOT has_table_privilege('service_role', 'public.' || table_name, 'select')
         OR NOT has_table_privilege('service_role', 'public.' || table_name, 'insert')
         OR has_table_privilege('service_role', 'public.' || table_name, 'update')
         OR has_table_privilege('service_role', 'public.' || table_name, 'delete')
         OR has_table_privilege('service_role', 'public.' || table_name, 'truncate')
         OR has_table_privilege('service_role', 'public.' || table_name, 'references')
         OR has_table_privilege('service_role', 'public.' || table_name, 'trigger')
         OR has_table_privilege('anon', 'public.' || table_name, 'select')
         OR has_table_privilege('anon', 'public.' || table_name, 'insert')
         OR has_table_privilege('anon', 'public.' || table_name, 'update')
         OR has_table_privilege('anon', 'public.' || table_name, 'delete')
         OR has_table_privilege('anon', 'public.' || table_name, 'truncate')
         OR has_table_privilege('anon', 'public.' || table_name, 'references')
         OR has_table_privilege('anon', 'public.' || table_name, 'trigger') THEN
        RAISE EXCEPTION 'Ticket72 corrective ACL mismatch on %', table_name;
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM public.reviewed_nutrition_knowledge_sets) <> 1
       OR (SELECT count(*) FROM public.reviewed_nutrition_knowledge_records) <> 2
       OR NOT EXISTS (SELECT 1 FROM public.reviewed_nutrition_knowledge_sets
                      WHERE knowledge_set_id = 'nutrition-practical-es-mx-v1'
                        AND knowledge_version = '1' AND locale = 'es-MX'
                        AND status = 'reviewed_active')
       OR (SELECT array_agg(knowledge_id ORDER BY knowledge_id)
           FROM public.reviewed_nutrition_knowledge_records) <>
          ARRAY['rk-food-storage-basics', 'rk-meal-preparation-basics']
       OR EXISTS (SELECT 1 FROM public.reviewed_nutrition_knowledge_records
                  WHERE knowledge_domain <> 'nutrition_practical'
                     OR task_kinds <> '["knowledge_question"]'::jsonb
                     OR applicable_input_types <> '[]'::jsonb
                     OR provenance <>
                        '{"source_class":"architectural_seed","reference":"ticket-63-test-only"}'::jsonb)
       OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.reviewed_nutrition_knowledge_sets'::regclass AND relrowsecurity AND relforcerowsecurity)
       OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.activate_reviewed_nutrition_knowledge_set(text)'::regprocedure AND prosecdef) THEN
      RAISE EXCEPTION 'Ticket72 non-ACL state changed';
    END IF;
  END $$;`);
});
