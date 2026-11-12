'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const testUrl = process.env.TICKET_90D_TEST_DATABASE_URL;
const auditorUrl = process.env.TICKET_90D_TEST_AUDITOR_DATABASE_URL;
const hostIsLocal = (() => {
  try {
    const local = host => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
    return local(new URL(testUrl || 'postgresql://invalid').hostname) && local(new URL(auditorUrl || 'postgresql://invalid').hostname);
  } catch { return false; }
})();

let savepoint = 0;
async function denied(client, sql) {
  const name = `ticket_90d_denied_${++savepoint}`;
  await client.query(`SAVEPOINT ${name}`);
  await assert.rejects(() => client.query(sql), /permission denied|must be owner|cannot execute|read-only/i);
  await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
}

test('Ticket 90D disposable PostgreSQL role can read only the content-free audit view', { skip: !testUrl || !auditorUrl || !hostIsLocal ? 'set loopback-only admin/auditor test URLs after applying the migration to a disposable database' : false }, async () => {
  const admin = new Pool({ connectionString: testUrl, max: 1 });
  let auditor;
  try {
    const schema = await admin.query("SELECT to_regclass('twilio_audit.twilio_ledger_audit_rows') AS view_name");
    assert.equal(schema.rows[0].view_name, 'twilio_audit.twilio_ledger_audit_rows', 'apply the Ticket 90D migration to the disposable database first');
    auditor = new Pool({ connectionString: auditorUrl, max: 1 });
    const client = await auditor.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const identity = await client.query('SELECT current_user, current_setting(\'transaction_read_only\') AS read_only');
      assert.deepEqual(identity.rows[0], { current_user: 'twilio_ledger_auditor', read_only: 'on' });
      const allowed = await client.query('SELECT ledger_id, recorded_at, direction, provider_message_sid FROM twilio_audit.twilio_ledger_audit_rows LIMIT 1');
      assert.ok(Array.isArray(allowed.rows));
      await denied(client, 'INSERT INTO twilio_audit.twilio_ledger_audit_rows (ledger_id) VALUES (gen_random_uuid())');
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await denied(client, 'SELECT body, session_id, metadata FROM public.messages LIMIT 1');
      await denied(client, 'INSERT INTO twilio_audit.twilio_ledger_audit_rows (ledger_id) VALUES (gen_random_uuid())');
      await denied(client, 'UPDATE twilio_audit.twilio_ledger_audit_rows SET direction = \'outbound\'');
      await denied(client, 'DELETE FROM twilio_audit.twilio_ledger_audit_rows');
      await denied(client, 'CREATE TABLE public.ticket_90d_must_not_exist (id integer)');
      const permissions = await client.query("SELECT has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage, has_table_privilege(current_user, 'public.messages', 'SELECT') AS messages_select, has_column_privilege(current_user, 'public.messages', 'body', 'SELECT') AS body_select, has_table_privilege(current_user, 'twilio_audit.twilio_ledger_audit_rows', 'SELECT') AS view_select");
      assert.deepEqual(permissions.rows[0], { public_usage: true, messages_select: false, body_select: false, view_select: true });
      const functions = await client.query("SELECT p.proname AS function_name, p.prosecdef AS security_definer, has_function_privilege(current_user, p.oid, 'EXECUTE') AS function_execute, has_schema_privilege(current_user, n.oid, 'USAGE') AS schema_usage FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef ORDER BY 1");
      const publicDefiner = functions.rows.find(row => row.function_name === 'ticket_90d_public_security_definer');
      const serviceDefiner = functions.rows.find(row => row.function_name === 'ticket_90d_service_security_definer');
      assert.deepEqual(publicDefiner, { function_name: 'ticket_90d_public_security_definer', security_definer: true, function_execute: false, schema_usage: true });
      assert.deepEqual(serviceDefiner, { function_name: 'ticket_90d_service_security_definer', security_definer: true, function_execute: false, schema_usage: true });
      await denied(client, 'SELECT public.ticket_90d_public_security_definer()');
      await denied(client, 'SELECT public.ticket_90d_service_security_definer()');
      await client.query('ROLLBACK');
    } finally { client.release(); }
    const owner = await admin.connect();
    try {
      await owner.query('BEGIN');
      await owner.query('SET LOCAL ROLE twilio_ledger_audit_view_owner');
      const source = await owner.query('SELECT id, "timestamp", direction, metadata FROM public.messages');
      assert.equal(source.rowCount, 1, 'the view owner must satisfy FORCE RLS through its dedicated policy');
      await denied(owner, 'SELECT body FROM public.messages');
      await owner.query('ROLLBACK');
    } finally { owner.release(); }
  } finally {
    if (auditor) await auditor.end();
    await admin.end();
  }
});
