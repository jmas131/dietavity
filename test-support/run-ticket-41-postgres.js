'use strict';
// DIETAVITY_PGLITE_PATH=/temporary/path/to/@electric-sql/pglite node --test test-support/run-ticket-41-postgres.js
// Isolated PostgreSQL engine: no production credentials or network connections.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {PGlite} = require(process.env.DIETAVITY_PGLITE_PATH);
const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const policy = require('../lib/sales-engine-v3');
const node = name => workflow.nodes.find(n => n.name === name);
let db;
const execute = async (name, payload) => (await db.query(node(name).parameters.query, [JSON.stringify(payload)])).rows;
const input = (session_id, message) => ({session_id, offer_context: policy.detectOfferContext(message)});
const row = async id => (await db.query('SELECT * FROM onboarding_sessions WHERE session_id=$1', [id])).rows[0];
before(async () => {
  db = new PGlite();
  const schema = fs.readFileSync(require.resolve('../database/schema.sql'), 'utf8');
  for (const table of ['onboarding_sessions', 'sales_funnel_events']) {
    let sql = schema.match(new RegExp(`CREATE TABLE public.${table} \\([\\s\\S]*?\\n\\);`))[0];
    if (table === 'onboarding_sessions') sql = sql.replace(/    offer_context text,\n/, '').replace(/    CONSTRAINT onboarding_sessions_offer_context_check[^\n]+\n/, '');
    await db.exec(sql);
  }
  await db.exec(`ALTER TABLE onboarding_sessions ADD PRIMARY KEY(session_id);`);
  await db.exec(schema.match(/CREATE UNIQUE INDEX sales_funnel_events_event_key_uidx[^;]+;/)[0]);
  await db.exec("INSERT INTO onboarding_sessions(session_id) VALUES ('historical')");
  await db.exec(fs.readFileSync(require.resolve('../database/migrations/20260913_ticket_41_glp1_offer_context.sql'), 'utf8'));
});
after(async () => {if (db) await db.close();});
test('migration preserves existing NULLs and rejects unknown contexts', async () => {
  assert.equal((await row('historical')).offer_context, null);
  await assert.rejects(db.exec("UPDATE onboarding_sessions SET offer_context='other' WHERE session_id='historical'"), /offer_context_check/);
});
test('new campaign session, retry, later price and inclusion retain context with one lead event', async () => {
  const payload = input("new'quoted", '¡Hola! Quiero saber más.');
  assert.deepEqual(await execute('Get Onboarding Session', payload), []);
  const [created] = await execute('Initialize Sales Lead v3', payload);
  assert.equal(created.offer_context, 'glp1_validation');
  await execute('Initialize Sales Lead v3', payload);
  for (const message of ['¿Cuánto cuesta?', '¿Qué incluye?']) {
    const [loaded] = await execute('Get Onboarding Session', input(payload.session_id, message));
    assert.equal(loaded.offer_context, 'glp1_validation');
  }
  const events = (await db.query('SELECT metadata FROM sales_funnel_events WHERE session_id=$1', [payload.session_id])).rows;
  assert.deepEqual(events, [{metadata: {offer_context: 'glp1_validation'}}]);
});
test('context setting and initializer conflict preserve every unrelated session field', async () => {
  await db.exec(`INSERT INTO onboarding_sessions(session_id, conversation_stage, goal, last_question_type,
    last_question_at, offer_version, commercial_context_expires_at, checkout_authorization_type,
    checkout_authorized_at, checkout_session_id, checkout_sent_at, reminder_requested_at, reminder_scheduled_for)
    VALUES ('preserve','checkout_pending','organizar comidas','purchase_confirmation',NOW(),'28d-149-v1',
      NOW()+INTERVAL '30 minutes','explicit',NOW(),'cs_existing',NOW(),NOW(),NOW()+INTERVAL '1 day')`);
  const original = await row('preserve');
  const [tagged] = await execute('Get Onboarding Session', input('preserve', '¡Hola! Quiero saber más.'));
  assert.deepEqual(tagged, {...original, offer_context: 'glp1_validation'});
  const [conflict] = await execute('Initialize Sales Lead v3', input('preserve', 'generic'));
  assert.deepEqual(conflict, tagged);
  const [retry] = await execute('Get Onboarding Session', input('preserve', '¡Hola! Quiero saber más.'));
  assert.deepEqual(retry, tagged);
});
test('generic lead and events remain NULL/empty and failed queries do not manufacture success', async () => {
  const [generic] = await execute('Initialize Sales Lead v3', input('generic', '¡Hola! Quiero más información.'));
  assert.equal(generic.offer_context, null);
  assert.deepEqual((await db.query("SELECT metadata FROM sales_funnel_events WHERE session_id='generic'")).rows, [{metadata:{}}]);
  await assert.rejects(execute('Initialize Sales Lead v3', {session_id:'invalid',offer_context:'unknown'}), /offer_context_check/);
  assert.equal(await row('invalid'), undefined);
});
test('sales and holding-page purchase intent inherit canonical context and remain idempotent', async () => {
  const id = "new'quoted";
  const [session] = await execute('Get Onboarding Session', input(id, '¿Cuánto cuesta?'));
  const decision = {...policy.decideSalesTurn({message:'¿Cuánto cuesta?',session,
    interpretation:{interpretation_valid:true,buyer_signal:'question',topic:'price',material_question:true}}),
    session_id:id,inbound_message_sid:'SM'+'a'.repeat(32)};
  await execute('Persist Sales Response State and Events', decision);
  await execute('Persist Sales Response State and Events', decision);
  const purchase = {...policy.decideSalesTurn({message:'Quiero comprar',session:await row(id),interpretation:{}}),
    session_id:id,inbound_message_sid:'SM'+'b'.repeat(32)};
  assert.deepEqual(await execute('Persist Checkout Authorization v3', purchase), []);
  const [authorized] = await execute('Persist Sales Response State and Events', purchase);
  assert.equal(authorized.offer_version, '28d-149-v1');
  assert.equal(authorized.offer_context, 'glp1_validation');
  await execute('Persist Sales Response State and Events', purchase);
  await execute('Persist Sales Response State and Events', {...purchase, inbound_message_sid: 'SM'+'c'.repeat(32)});
  const milestones = (await db.query("SELECT event_type,offer_version FROM sales_funnel_events WHERE session_id=$1 AND event_type IN ('purchase_intent','checkout_sent','purchase_completed')", [id])).rows;
  assert.deepEqual(milestones, [{event_type:'purchase_intent',offer_version:'28d-149-v1'}]);
  assert.equal(authorized.checkout_sent_at, null);
  const events = (await db.query('SELECT event_key,metadata FROM sales_funnel_events WHERE session_id=$1', [id])).rows;
  assert.equal(new Set(events.map(e=>e.event_key)).size, events.length);
  for (const event of events) assert.equal(event.metadata.offer_context,'glp1_validation');
});
