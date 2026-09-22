const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'database/migrations/20260815_ticket_9b_setup_event_persistence.sql'),
  'utf8'
);
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('Ticket 9B RPC uses the partial unique index conflict predicate', () => {
  assert.match(
    migration,
    /INSERT INTO public\.sales_funnel_events[\s\S]*ON CONFLICT \(event_key\)\s+WHERE event_key IS NOT NULL\s+DO NOTHING/
  );
  assert.match(migration, /'setup_completed'/);
  assert.match(migration, /'\{\}'::jsonb/);
});

test('Ticket 9B RPC remains backend-only', () => {
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path TO 'public'/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.persist_setup_completed_event\(text, uuid, text\)\s+FROM PUBLIC, anon, authenticated/
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.persist_setup_completed_event\(text, uuid, text\)\s+TO service_role/
  );
});

test('Setup calls the RPC with the versioned per-user idempotency key', () => {
  assert.match(server, /supabase\.rpc\(\s*'persist_setup_completed_event'/);
  assert.match(
    server,
    /`setup_completed:\$\{user\.id\}:\$\{PRIVACY_NOTICE_VERSION\}`/
  );
  assert.doesNotMatch(
    server,
    /from\('sales_funnel_events'\)[\s\S]{0,300}\.upsert/
  );
});
