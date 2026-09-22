const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(
  root,
  'database/migrations/20260807_ticket_2_backend_only_access.sql'
), 'utf8');
const consentMigration = fs.readFileSync(path.join(
  root,
  'database/migrations/20260810_ticket_7b_sensitive_data_consent.sql'
), 'utf8');

const backendTables = [
  'users',
  'profiles',
  'programs',
  'weeks',
  'meal_plans',
  'purchases',
  'messages',
  'onboarding_chat_memory',
  'onboarding_sessions',
  'logs',
  'unsubscribed_metrics',
  'shopping_lists',
  'shopping_items',
  'subscriptions'
];

test('Express uses only the service-role Supabase key', () => {
  const client = fs.readFileSync(path.join(root, 'lib/supabase.js'), 'utf8');
  assert.match(client, /process\.env\.SUPABASE_URL/);
  assert.match(client, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(client, /SUPABASE_ANONYMOUS_KEY/);
});

test('Global Error Handler uses trusted Postgres without database API keys', () => {
  const workflow = JSON.parse(fs.readFileSync(
    path.join(root, 'n8n/Global Error Handler.json'),
    'utf8'
  ));
  const node = workflow.nodes.find(candidate =>
    candidate.name === 'Insert Error Log (Error Handler)'
  );
  assert.ok(node);

  assert.equal(node.type, 'n8n-nodes-base.postgres');
  assert.equal(node.credentials.postgres.name, 'Postgres account');
  assert.match(node.parameters.query, /INSERT INTO public\.logs/);
  assert.doesNotMatch(JSON.stringify(node), /SUPABASE_(?:ANONYMOUS|SERVICE_ROLE)_KEY/);
  assert.doesNotMatch(JSON.stringify(node), /SUPABASE_ANONYMOUS_KEY/);
});

test('hardening migration covers every backend-only table and preserves service role', () => {
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;/m);
  assert.match(migration, /FROM anon, authenticated;/);
  assert.match(migration, /TO service_role;/);

  for (const table of backendTables) {
    assert.match(migration, new RegExp(`public\\.${table}\\b`), table);
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`),
      `${table} must keep RLS enabled`
    );
  }
});

test('hardening migration removes permissive policies and public RPC execution', () => {
  for (const [policy, table] of [
    ['error_logs', 'logs'],
    ['messages', 'messages'],
    ['metrics', 'unsubscribed_metrics'],
    ['onboarding', 'onboarding_chat_memory'],
    ['policy_meal_plans', 'meal_plans'],
    ['policy_users', 'users'],
    ['subscriptions', 'subscriptions']
  ]) {
    assert.match(
      migration,
      new RegExp(`DROP POLICY IF EXISTS ${policy} ON public\\.${table};`)
    );
  }

  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.start_program_week_one\(uuid, uuid, date, date\)[\s\S]*FROM PUBLIC, anon, authenticated;/
  );
});

test('Ticket 7B adds profile consent evidence without changing access controls', () => {
  assert.match(consentMigration, /ALTER TABLE public\.profiles/);
  assert.match(consentMigration, /ADD COLUMN IF NOT EXISTS sensitive_data_consent_at timestamptz/);
  assert.match(consentMigration, /ADD COLUMN IF NOT EXISTS privacy_notice_version text/);
  assert.doesNotMatch(consentMigration, /\bGRANT\b/i);
  assert.doesNotMatch(consentMigration, /\bPOLICY\b/i);
  assert.doesNotMatch(consentMigration, /DISABLE ROW LEVEL SECURITY/i);
});
