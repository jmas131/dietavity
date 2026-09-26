'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'database/migrations/20260926_ticket_75d1_atomic_v2_reply_reservation.sql'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
test('T75D.1 migration and schema synchronize the hardened reservation function', () => {
  const fn = migration.match(/CREATE OR REPLACE FUNCTION public\.reserve_v2_approved_logical_reply[\s\S]*?\$function\$;/)[0];
  assert.ok(schema.includes(fn));
  for (const needle of ['pg_advisory_xact_lock(hashtextextended(inbound.session_id, 17))', 'FOR UPDATE', 'processing_lease_until <= NOW()', 'processing_order < inbound.processing_order', 'persist_conversation_artifact', 'assistant_response', 'v2_approved_response_digest', 'V2_REPLY_RESERVATION_BINDING_INVALID', 'REVOKE ALL ON FUNCTION public.reserve_v2_approved_logical_reply(jsonb) FROM PUBLIC, anon, authenticated, service_role']) assert.ok(migration.includes(needle), needle);
});
