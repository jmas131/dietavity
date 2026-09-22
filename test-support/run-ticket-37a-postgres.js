'use strict';

// Optional explicit integration command, not a skipped default-suite test.
// Supply a temporary PGlite installation via DIETAVITY_PGLITE_PATH. This uses
// an in-memory PostgreSQL engine and never reads production connection config.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.DIETAVITY_PGLITE_PATH);
const fixture = require('./ticket-37a-fixture');
const recovery = require('../lib/reply-recovery');
const { fullyAcceptedSql } = require('../lib/logical-reply');
const { RECOVERY_FUNCTIONS_SQL } = require('../lib/reply-recovery-sql');
const { ERROR_HANDLER_SQL } = require('../lib/global-error-handler');
const ordering = require('../lib/session-ordering');
let db;
const queryJson = async (sql) => Object.values((await db.query(sql)).rows[0])[0];
async function insert(row) {
  const keys = Object.keys(row);
  await db.query(`INSERT INTO public.messages (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(row));
}
async function seed() {
  await db.exec('TRUNCATE public.messages, public.logs;');
  await insert(fixture.inbound); await insert(fixture.base);
}
const prepare = async (change = {}) => queryJson(recovery.rpcSql('prepare_whatsapp_reply_recovery', {
  ...recovery.preparationPayload(fixture.input, [fixture.inbound, fixture.base]), ...change,
}));
const accepted = async (all = true) => db.exec(`UPDATE public.messages SET delivery_status='accepted', provider_message_sid='SM' || replace(id::text, '-', '')
  WHERE direction='outbound' ${all ? '' : "AND metadata->>'part_index'='1'"};`);
const historicalTime = '2026-09-03 02:08:18.094223+00';
const reopenInput = { reopen_historical_reconciliation: true, expected_processing_completed_at: historicalTime };
async function seedHistorical() {
  await seed();
  await db.query(`UPDATE messages SET processing_completed_at=$1, processing_outcome='reconciliation',
    metadata='{"error_execution_id":"historical","session_ordering_state":"reconciliation"}'::jsonb
    WHERE id=$2`, [historicalTime, fixture.inbound.id]);
}
const complete = async () => (await db.query(`SELECT (${fullyAcceptedSql('inbound.id')}) AS okay FROM public.messages inbound WHERE id=$1`, [fixture.input.inbound_id])).rows[0].okay;
const claim = async (change = {}) => queryJson(recovery.rpcSql('claim_whatsapp_reply_recovery_part', {
  ...fixture.input, window_verified_at: new Date().toISOString(), send_token: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', ...change,
}));

before(async () => {
  db = new PGlite();
  const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ${schema.match(/CREATE TABLE public.messages \([\s\S]*?\n\);/)[0]}
    ALTER TABLE public.messages ADD PRIMARY KEY(id);
    CREATE UNIQUE INDEX messages_idempotency_key_uidx ON public.messages(idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX messages_provider_sid_uidx ON public.messages(provider,provider_message_sid) WHERE provider_message_sid IS NOT NULL;
    CREATE TABLE public.users(id uuid PRIMARY KEY, last_assistant_message text);
    CREATE TABLE public.onboarding_sessions(session_id text, last_question_type text,last_question_at timestamptz,commercial_context_expires_at timestamptz,checkout_authorization_type text,checkout_authorized_at timestamptz,updated_at timestamptz);
    CREATE TABLE public.logs(event text,severity text,error_message text,error_context jsonb);
    ${RECOVERY_FUNCTIONS_SQL}`).catch((error) => {
      const at = Number(error.position || 0);
      throw new Error(`${error.message}: ${error.query?.slice(at - 160, at + 100)}`);
    });
});
after(async () => { if (db) await db.close(); });

test('actual RPC reuses incident UUID/key, creates parts, and is idempotent', async () => {
  await seed(); const rows = await prepare();
  assert.equal(rows.length, 2); assert.equal(rows[0].id, fixture.base.id);
  assert.equal(rows[0].idempotency_key, fixture.base.idempotency_key);
  assert.equal(rows[1].idempotency_key, fixture.base.idempotency_key + ':part:002');
  assert.ok(rows.every((row) => row.body.length <= 1500 && row.assistant_response.length === 1889));
  assert.equal(await complete(), false);
  assert.deepEqual(await prepare(), rows);
  await accepted(false);
  const again = await prepare();
  assert.equal(again[0].delivery_status, 'accepted'); assert.ok(again[0].provider_message_sid);
});

test('historical reconciliation reopens atomically, preserves evidence and blocks FIFO until all accepted', async () => {
  await seedHistorical();
  const rows = await prepare(reopenInput);
  assert.equal(rows[0].id, fixture.base.id);
  assert.equal(rows[0].idempotency_key, fixture.input.expected_key);
  assert.equal(rows.length, 2);
  const state = (await db.query('SELECT * FROM messages WHERE id=$1', [fixture.inbound.id])).rows[0];
  assert.equal(state.processing_completed_at, null);
  assert.equal(state.processing_outcome, 'reconciliation');
  assert.equal(state.metadata.error_execution_id, 'historical');
  assert.equal((await db.query(`SELECT (metadata->'recovery_historical_reopen'->>'previous_processing_completed_at')::timestamptz=$1::timestamptz AS matches FROM messages WHERE id=$2`, [historicalTime, fixture.inbound.id])).rows[0].matches, true);
  assert.deepEqual(await prepare(reopenInput), rows);
  await accepted(false);
  assert.equal((await db.query(ordering.CLAIM_NEXT_INBOUND_SQL, [JSON.stringify({session_id: fixture.inbound.session_id, processing_owner:'next'})])).rows[0].claim_state, 'reconciliation');
  assert.equal(await complete(), false);
  await accepted();
  await queryJson(recovery.completionSql(fixture.input));
  const completedBefore = (await db.query('SELECT * FROM messages WHERE id=$1', [fixture.inbound.id])).rows[0];
  await prepare(reopenInput);
  assert.deepEqual((await db.query('SELECT * FROM messages WHERE id=$1', [fixture.inbound.id])).rows[0], completedBefore);
});

for (const [label, setup, change] of [
  ['missing opt-in', '', {reopen_historical_reconciliation: false}],
  ['missing expected timestamp', '', {expected_processing_completed_at: null}],
  ['changed timestamp', '', {expected_processing_completed_at:'2026-09-03T02:08:19Z'}],
  ['successful completion', "UPDATE messages SET processing_outcome='completed' WHERE direction='inbound'", {}],
  ['accepted outbound', "UPDATE messages SET delivery_status='accepted' WHERE direction='outbound'", {}],
  ['provider SID', "UPDATE messages SET provider_message_sid='SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE direction='outbound'", {}],
  ['live owner and lease', "UPDATE messages SET processing_owner='worker', processing_lease_until=NOW()+INTERVAL '1 hour' WHERE direction='inbound'", {}],
  ['uncleared expired owner and lease', "UPDATE messages SET processing_owner='worker', processing_lease_until=NOW()-INTERVAL '1 hour' WHERE direction='inbound'", {}],
  ['wrong hash', '', {expected_hash:'a'.repeat(64)}],
  ['wrong inbound ID', '', {inbound_id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'}],
  ['wrong outbound ID', '', {outbound_id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'}],
  ['missing 21617 evidence', '', {confirmed_error_code:null}],
  ['missing evidence reference', '', {evidence_reference:null}],
  ['existing multipart metadata', "UPDATE messages SET metadata='{" + '"part_index":1' + "}' WHERE direction='outbound'", {}],
]) test(`historical reopen rejects ${label} without writes`, async () => {
  await seedHistorical(); if (setup) await db.exec(setup);
  const before = (await db.query('SELECT * FROM messages ORDER BY id')).rows;
  await assert.rejects(prepare({...reopenInput, ...change}));
  assert.deepEqual((await db.query('SELECT * FROM messages ORDER BY id')).rows, before);
});

test('historical reopen rejects siblings, concurrent session worker, and rolls back late insert failure', async () => {
  for (const kind of ['sibling', 'worker', 'late-conflict']) {
    await seedHistorical();
    if (kind === 'worker') await insert({...fixture.inbound, id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      provider_message_sid:'SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', processing_order:2, processing_owner:'live',
      processing_lease_until:new Date(Date.now()+60000).toISOString()});
    else await insert({...fixture.base, id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      in_reply_to_id:kind === 'sibling' ? fixture.inbound.id : null,
      idempotency_key:fixture.input.expected_key+':part:002'});
    const before = (await db.query('SELECT * FROM messages ORDER BY id')).rows;
    await assert.rejects(prepare(reopenInput));
    assert.deepEqual((await db.query('SELECT * FROM messages ORDER BY id')).rows, before);
  }
});

test('historical failed rejection is eligible but stale reopen input cannot reopen an uncompleted row', async () => {
  await seedHistorical(); await db.exec("UPDATE messages SET delivery_status='failed' WHERE direction='outbound'");
  assert.equal((await prepare(reopenInput)).length, 2);
  await seed(); await assert.rejects(prepare(reopenInput));
});

for (const [label, setup, change] of [
  ['wrong hash', null, { expected_hash: 'a'.repeat(64) }],
  ['accepted base', "UPDATE messages SET delivery_status='accepted' WHERE direction='outbound'", {}],
  ['provider SID', "UPDATE messages SET provider_message_sid='SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE direction='outbound'", {}],
  ['live owner', "UPDATE messages SET processing_owner='live',processing_lease_until=NOW()+INTERVAL '1 hour' WHERE direction='inbound'", {}],
]) test(`actual preparation rejects ${label} without partial mutation`, async () => {
  await seed(); if (setup) await db.exec(setup);
  const beforeRows = await db.query('SELECT * FROM messages ORDER BY id');
  await assert.rejects(prepare(change));
  assert.deepEqual((await db.query('SELECT * FROM messages ORDER BY id')).rows, beforeRows.rows);
});

test('conflicting sibling blocks preparation and changed body blocks repeat', async () => {
  await seed(); await insert({ ...fixture.base, id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', idempotency_key: fixture.base.idempotency_key + ':other' });
  await assert.rejects(prepare());
  await seed(); await prepare(); await db.exec("UPDATE messages SET body='changed' WHERE direction='outbound'");
  await assert.rejects(prepare());
});

test('late unique-index failure rolls back the already-updated base row', async () => {
  await seed();
  await insert({ ...fixture.base, id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc', in_reply_to_id: null,
    idempotency_key: fixture.base.idempotency_key + ':part:002' });
  await assert.rejects(prepare());
  const base = (await db.query('SELECT * FROM messages WHERE id=$1', [fixture.base.id])).rows[0];
  assert.equal(base.delivery_status, 'unknown'); assert.equal(base.body, fixture.response);
  assert.deepEqual(base.metadata, {});
});

test('normal new reservations are all-or-none and never append to existing rejected base', async () => {
  await seed();
  await db.exec("UPDATE messages SET processing_owner='normal',processing_lease_until=NOW()+INTERVAL '1 minute' WHERE direction='inbound'");
  const formatted = recovery.preparationPayload(fixture.input, [fixture.inbound, fixture.base]);
  const input = { session_id: fixture.input.expected_session_id, parts: formatted.parts,
    base_idempotency_key: fixture.base.idempotency_key, logical_body: fixture.response,
    message_kind: 'paid_ai', in_reply_to_id: fixture.inbound.id, processing_owner: 'normal', metadata: formatted.length_metadata };
  assert.equal((await db.query(ordering.RESERVE_MULTIPART_OUTBOUND_SQL, [JSON.stringify(input)])).rows.length, 0);
  await db.exec("DELETE FROM messages WHERE direction='outbound'");
  assert.equal((await db.query(ordering.RESERVE_MULTIPART_OUTBOUND_SQL, [JSON.stringify(input)])).rows.length, 2);
  assert.equal((await db.query(ordering.RESERVE_MULTIPART_OUTBOUND_SQL, [JSON.stringify(input)])).rows.length, 0);
});

test('stale and normal completion accept a fully resolved multipart set', async () => {
  await seed(); await prepare(); await accepted();
  await db.exec("UPDATE messages SET processing_owner='normal',processing_lease_until=NOW()+INTERVAL '1 minute' WHERE direction='inbound'");
  assert.equal((await db.query(ordering.COMPLETE_INBOUND_SQL, [JSON.stringify({ inbound_message_id: fixture.inbound.id, processing_owner: 'normal' })])).rows.length, 1);
  await seed(); await prepare(); await accepted();
  await db.exec("UPDATE messages SET processing_owner='expired',processing_lease_until=NOW()-INTERVAL '1 minute' WHERE direction='inbound'");
  assert.equal((await db.query(ordering.CLAIM_NEXT_INBOUND_SQL, [JSON.stringify({ session_id: fixture.inbound.session_id, processing_owner: 'next' })])).rows[0].claim_state, 'empty');
});

test('RPC privileges deny anon/authenticated access', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query("SELECT * FROM public.prepare_whatsapp_reply_recovery('{}'::jsonb)"), /permission denied/);
    await db.exec('RESET ROLE');
  }
});

for (const state of ['pending', 'unknown', 'failed']) test(`SQL predicate and FIFO remain incomplete with second part ${state}`, async () => {
  await seed(); await prepare(); await accepted(false);
  await db.exec(`UPDATE messages SET delivery_status='${state}' WHERE metadata->>'part_index'='2';
    UPDATE messages SET processing_owner='expired', processing_lease_until=NOW()-INTERVAL '1 minute' WHERE direction='inbound';`);
  assert.equal(await complete(), false);
  const claims = await db.query(ordering.CLAIM_NEXT_INBOUND_SQL, [JSON.stringify({ session_id: fixture.input.expected_session_id, processing_owner: 'new' })]);
  assert.equal(claims.rows[0].claim_state, 'reconciliation');
  assert.equal(claims.rows[0].processing_completed_at, null);
});

test('missing, duplicate, malformed and inconsistent parts fail SQL completion', async () => {
  for (const change of [
    "DELETE FROM messages WHERE metadata->>'part_index'='2'",
    "UPDATE messages SET metadata=jsonb_set(metadata,'{part_index}','1') WHERE metadata->>'part_index'='2'",
    "UPDATE messages SET metadata=jsonb_set(metadata,'{part_count}','3') WHERE metadata->>'part_index'='2'",
    "UPDATE messages SET metadata=jsonb_set(metadata,'{part_index}','\"bad\"') WHERE metadata->>'part_index'='2'",
    "UPDATE messages SET provider_message_sid=NULL WHERE direction='outbound'",
  ]) {
    await seed(); await prepare(); await accepted(); await db.exec(change);
    assert.equal(await complete(), false, change);
  }
});

test('Global Error Handler only completes when every expected part is accepted', async () => {
  await seed(); await prepare(); await accepted(false);
  await db.exec("UPDATE messages SET processing_owner='error-test', processing_lease_until=NOW()+INTERVAL '1 minute' WHERE direction='inbound'");
  await db.query(ERROR_HANDLER_SQL, [JSON.stringify({ execution_id: 'error-test' })]);
  assert.equal((await db.query("SELECT processing_completed_at FROM messages WHERE direction='inbound'")).rows[0].processing_completed_at, null);
  await accepted();
  await db.exec("UPDATE messages SET processing_owner='error-test', processing_lease_until=NOW()+INTERVAL '1 minute' WHERE direction='inbound'");
  await db.query(ERROR_HANDLER_SQL, [JSON.stringify({ execution_id: 'error-test' })]);
  assert.ok((await db.query("SELECT processing_completed_at FROM messages WHERE direction='inbound'")).rows[0].processing_completed_at);
});

test('claim is one-part-only and cannot be repeated after a send claim', async () => {
  await seed(); await prepare();
  const first = await claim(); assert.equal(first.length, 1); assert.equal(first[0].id, fixture.base.id);
  await assert.rejects(claim());
  await accepted(false);
  const second = await claim({ send_token: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' });
  assert.equal(second[0].metadata.part_index, 2);
  await db.exec("UPDATE messages SET delivery_status='failed' WHERE metadata->>'part_index'='2'");
  await assert.rejects(claim()); assert.equal(await complete(), false);
});

test('window and unexpected pending sibling state cannot bypass send guards', async () => {
  await seed(); await prepare();
  await assert.rejects(claim({ window_verified_at: null }));
  await assert.rejects(claim({ window_inbound_sid: 'SM00000000000000000000000000000000' }));
  await db.exec("DELETE FROM messages WHERE metadata->>'part_index'='2'");
  await assert.rejects(claim());
});

test('CLI send orchestration persists each result and never resends accepted part 1 after failure', async () => {
  await seed(); await prepare(); const sent = [];
  const accountSid = 'AC' + 'a'.repeat(32); const from = '+15550000001';
  const services = { db: queryJson, accountSid, from, provider: {
    getMessage: async () => ({ account_sid: accountSid, sid: fixture.input.window_inbound_sid,
      direction: 'inbound', from: 'whatsapp:' + fixture.input.expected_session_id, to: 'whatsapp:' + from, date_created: new Date().toISOString() }),
    sendMessage: async (payload) => { sent.push(payload); return sent.length === 1 ? { sid: 'SM' + 'c'.repeat(32), status: 'queued' } : { code: 21617 }; },
  } };
  await recovery.sendNext(fixture.input, services);
  await assert.rejects(recovery.sendNext(fixture.input, services), /failed/);
  await assert.rejects(recovery.sendNext(fixture.input, services));
  assert.equal(sent.length, 2); assert.notEqual(sent[0].body, sent[1].body);
  assert.equal(await complete(), false);
});

test('all accepted parts allow operator completion and unknown response never completes', async () => {
  for (const status of ['queued', 'unknown']) {
    await seed(); await prepare();
    const accountSid = 'AC' + 'a'.repeat(32); const from = '+15550000001'; let calls = 0;
    const services = { db: queryJson, accountSid, from, provider: {
      getMessage: async () => ({ account_sid: accountSid, sid: fixture.input.window_inbound_sid, direction: 'inbound', from: 'whatsapp:' + fixture.input.expected_session_id, to: 'whatsapp:' + from, date_created: new Date().toISOString() }),
      sendMessage: async () => { calls++; return status === 'unknown' ? {} : { sid: 'SM' + String(calls).repeat(32), status }; },
    } };
    if (status === 'unknown') { await assert.rejects(recovery.sendNext(fixture.input, services), /unknown/); assert.equal(await complete(), false); }
    else {
      await recovery.sendNext(fixture.input, services); await recovery.sendNext(fixture.input, services);
      assert.equal(await complete(), true);
      assert.ok((await db.query("SELECT processing_completed_at FROM messages WHERE direction='inbound'")).rows[0].processing_completed_at);
    }
  }
});

test('lost persistence after provider acceptance cannot cause a second POST', async () => {
  await seed(); await prepare(); let sends = 0;
  const accountSid = 'AC' + 'a'.repeat(32); const from = '+15550000001';
  const services = { accountSid, from,
    db: async (sql) => { if (sql.includes('classified AS')) throw new Error('simulated persistence loss'); return queryJson(sql); },
    provider: {
      getMessage: async () => ({ account_sid: accountSid, sid: fixture.input.window_inbound_sid, direction: 'inbound', from: 'whatsapp:' + fixture.input.expected_session_id, to: 'whatsapp:' + from, date_created: new Date().toISOString() }),
      sendMessage: async () => { sends++; return { sid: 'SM' + 'd'.repeat(32), status: 'queued' }; },
    },
  };
  await assert.rejects(recovery.sendNext(fixture.input, services), /persistence loss/);
  services.db = queryJson;
  await assert.rejects(recovery.sendNext(fixture.input, services));
  assert.equal(sends, 1); assert.equal(await complete(), false);
});
