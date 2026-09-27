'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const logical = require('../lib/logical-reply');
const recovery = require('../lib/reply-recovery');
const ordering = require('../lib/session-ordering');
const { ERROR_HANDLER_SQL } = require('../lib/global-error-handler');
const { RECOVERY_FUNCTIONS_SQL } = require('../lib/reply-recovery-sql');
const { FUNCTION_NAMES, recoveryFunctionsSynchronized } = require('../lib/recovery-function-schema-sync');
const delivery = require('../lib/twilio-delivery');
const fixture = require('../test-support/ticket-37a-fixture');
const root = path.resolve(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json')));
const sid = `SM${'a'.repeat(32)}`;
function parts(count = 2) {
  return Array.from({ length: count }, (_, i) => ({ ...fixture.base,
    idempotency_key: i ? `${fixture.input.expected_key}:part:${String(i + 1).padStart(3, '0')}` : fixture.input.expected_key,
    delivery_status: 'accepted', provider_message_sid: sid,
    metadata: { logical_reply_key: fixture.input.expected_key, part_index: i + 1, part_count: count },
  }));
}

test('single and multipart accepted replies satisfy the same predicate', () => {
  assert.equal(logical.isLogicalReplyFullyAccepted(parts(1)), true);
  assert.equal(logical.isLogicalReplyFullyAccepted(parts(2)), true);
  assert.equal(logical.isLogicalReplyFullyAccepted([]), false);
});
for (const state of ['pending', 'unknown', 'failed', 'undelivered']) {
  test(`one accepted plus ${state} never completes`, () => {
    const rows = parts(); rows[1].delivery_status = state;
    assert.equal(logical.isLogicalReplyFullyAccepted(rows), false);
  });
}
for (const [label, mutate] of [
  ['missing part', (rows) => rows.pop()],
  ['duplicate index', (rows) => { rows[1].metadata.part_index = 1; }],
  ['inconsistent count', (rows) => { rows[1].metadata.part_count = 3; }],
  ['conflicting key', (rows) => { rows[1].metadata.logical_reply_key = 'other'; }],
  ['different inbound', (rows) => { rows[1].in_reply_to_id = 'other'; }],
  ['different session', (rows) => { rows[1].session_id = 'other'; }],
  ['malformed index', (rows) => { rows[1].metadata.part_index = '2'; }],
  ['missing evidence', (rows) => { rows[1].provider_message_sid = null; }],
]) test(`${label} fails closed`, () => {
  const rows = parts(); mutate(rows); assert.equal(logical.isLogicalReplyFullyAccepted(rows), false);
});

test('legacy singleton and durable Ticket 36 acceptance evidence remain supported', () => {
  const row = parts(1)[0]; row.metadata = {};
  assert.equal(logical.isLogicalReplyFullyAccepted([row]), true);
  row.provider_message_sid = null;
  assert.equal(logical.isLogicalReplyFullyAccepted([row]), false);
  row.metadata.provider_acceptance_evidence = 'message_sid';
  assert.equal(logical.isLogicalReplyFullyAccepted([row]), true);
});

test('every current transport completion path embeds the exact canonical predicate', () => {
  assert.ok(ordering.COMPLETE_INBOUND_SQL.includes(logical.fullyAcceptedSql('message.id')));
  assert.ok(ordering.CLAIM_NEXT_INBOUND_SQL.includes(logical.fullyAcceptedSql('message.id')));
  assert.ok(ERROR_HANDLER_SQL.includes(logical.fullyAcceptedSql('inbound.id')));
  assert.ok(recovery.completionSql(fixture.input).includes(logical.fullyAcceptedSql('inbound.id')));
  const error = JSON.parse(fs.readFileSync(path.join(root, 'n8n/Global Error Handler.json')));
  assert.equal(error.nodes.find((n) => n.name === 'Insert Error Log (Error Handler)').parameters.query, ERROR_HANDLER_SQL);
  const found = [];
  for (const file of fs.readdirSync(path.join(root, 'n8n')).filter((f) => f.endsWith('.json'))) {
    const w = JSON.parse(fs.readFileSync(path.join(root, 'n8n', file)));
    for (const n of w.nodes || []) {
      const sql = n.parameters?.query || '';
      if (/processing_completed_at\s*=\s*(?:NOW\(|CASE)/i.test(sql)) {
        found.push(n.name);
        assert.ok(sql.includes(logical.fullyAcceptedSql(n.name === 'Insert Error Log (Error Handler)' ? 'inbound.id' : 'message.id')), `${file}: ${n.name}`);
        const remainder = sql.replace(logical.fullyAcceptedSql(n.name === 'Insert Error Log (Error Handler)' ? 'inbound.id' : 'message.id'), 'CANONICAL_PREDICATE');
        assert.doesNotMatch(remainder, /EXISTS[\s\S]*delivery_status\s+IN/i, `${file}: independent acceptance shortcut`);
      }
    }
  }
  assert.deepEqual(found.sort(), ['Claim Next Session Inbound', 'Insert Error Log (Error Handler)', 'Mark Session Inbound Complete']);
});

test('generated migration and schema synchronize both backend recovery functions semantically', () => {
  assert.ok(fs.readFileSync(path.join(root, 'database/migrations/20260904_ticket_37a_historical_reopen.sql'), 'utf8').includes(RECOVERY_FUNCTIONS_SQL));
  const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
  assert.equal(recoveryFunctionsSynchronized({ canonicalSql: RECOVERY_FUNCTIONS_SQL, schemaSql: schema }), true);
  assert.deepEqual(FUNCTION_NAMES, ['prepare_whatsapp_reply_recovery', 'claim_whatsapp_reply_recovery_part']);
});

test('recovery schema synchronization ignores pg_dump declaration formatting but rejects meaningful function drift', () => {
  const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
  const formattingOnly = schema.replace(/CREATE FUNCTION public\.prepare_whatsapp_reply_recovery\(p jsonb\) RETURNS SETOF public\.messages\s+LANGUAGE plpgsql SECURITY DEFINER\s+SET search_path TO 'pg_catalog', 'public'/, 'CREATE OR REPLACE FUNCTION public.prepare_whatsapp_reply_recovery(p jsonb) RETURNS SETOF public.messages LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public');
  assert.equal(recoveryFunctionsSynchronized({ canonicalSql: RECOVERY_FUNCTIONS_SQL, schemaSql: formattingOnly }), true);
  const changedLock = schema.replace('PERFORM pg_advisory_xact_lock(hashtextextended(session_key, 17));', 'PERFORM pg_advisory_xact_lock(hashtextextended(session_key, 18));');
  assert.equal(recoveryFunctionsSynchronized({ canonicalSql: RECOVERY_FUNCTIONS_SQL, schemaSql: changedLock }), false);
  const changedFifo = schema.replace('earlier.processing_order < inbound.processing_order', 'earlier.processing_order <= inbound.processing_order');
  assert.equal(recoveryFunctionsSynchronized({ canonicalSql: RECOVERY_FUNCTIONS_SQL, schemaSql: changedFifo }), false);
});

test('normal new multipart reservation is atomic and refuses existing siblings', () => {
  assert.match(ordering.RESERVE_MULTIPART_OUTBOUND_SQL, /NOT EXISTS \(SELECT 1 FROM public.messages existing/);
  assert.match(ordering.RESERVE_MULTIPART_OUTBOUND_SQL, /jsonb_array_elements_text/);
  assert.match(ordering.RESERVE_MULTIPART_OUTBOUND_SQL, /ORDER BY \(metadata->>'part_index'\)::integer/);
});

test('paid transport loops one part through reconciliation before continuing', () => {
  const out = (name, branch = 0) => workflow.connections[name].main[branch].map((e) => e.node);
  assert.deepEqual(out('Reserve Paid Assistant Reply'), ['Loop Paid WhatsApp Parts']);
  assert.deepEqual(out('Loop Paid WhatsApp Parts', 1), ['Send All Intents Message']);
  assert.deepEqual(out('Assert Paid Assistant Reply Accepted'), ['Loop Paid WhatsApp Parts', 'Build V2 Provider Acceptance Diagnostic']);
  assert.deepEqual(out('Loop Paid WhatsApp Parts'), ['Update Last Assistant Message']);
  assert.equal(workflow.nodes.find((n) => n.name === 'Loop Paid WhatsApp Parts').parameters.batchSize, 1);
});

test('historical 1889-character fixture is reused and formatted without AI', () => {
  assert.equal(fixture.response.length, 1889);
  const p = recovery.preparationPayload(fixture.input, [fixture.inbound, fixture.base]);
  assert.ok(p.parts.length > 1); assert.ok(p.parts.every((part) => part.length <= 1500));
  assert.equal(p.expected_hash, recovery.sha256(fixture.response));
  assert.equal(p.outbound_id, fixture.base.id);
  assert.throws(() => recovery.preparationPayload({ ...fixture.input, expected_hash: 'a'.repeat(64) }, [fixture.inbound, fixture.base]), /hash changed/);
});

test('backend recovery functions preserve atomic lock/reuse and security boundaries', () => {
  assert.match(RECOVERY_FUNCTIONS_SQL, /pg_advisory_xact_lock/);
  assert.match(RECOVERY_FUNCTIONS_SQL, /FOR UPDATE/);
  assert.match(RECOVERY_FUNCTIONS_SQL, /UPDATE public.messages SET body =[\s\S]*WHERE id = base.id/);
  assert.match(RECOVERY_FUNCTIONS_SQL, /RECOVERY_PREPARED_STATE_CHANGED/);
  assert.match(RECOVERY_FUNCTIONS_SQL, /base.provider_message_sid IS NOT NULL/);
  assert.match(RECOVERY_FUNCTIONS_SQL, /SECURITY DEFINER SET search_path = pg_catalog, public/);
  assert.match(RECOVERY_FUNCTIONS_SQL, /FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(RECOVERY_FUNCTIONS_SQL, /349000f3|b97863b2/);
});

test('window verification rejects stale, wrong-recipient and future provider evidence', () => {
  const now = Date.now(); const config = { accountSid: `AC${'a'.repeat(32)}`, from: '+15550000001', sessionId: fixture.input.expected_session_id, now };
  const message = { sid, direction: 'inbound', account_sid: config.accountSid, from: `whatsapp:${config.sessionId}`, to: `whatsapp:${config.from}`, date_created: new Date(now - 60000).toISOString() };
  assert.doesNotThrow(() => recovery.verifyMessagingWindow(message, config));
  for (const change of [{ date_created: new Date(now - 86400000).toISOString() }, { from: 'wrong' }, { date_created: new Date(now + 1000).toISOString() }]) {
    assert.throws(() => recovery.verifyMessagingWindow({ ...message, ...change }, config), /window not verified/);
  }
});

test('Ticket 36/37 classification still distinguishes deterministic rejection from ambiguity', () => {
  assert.equal(delivery.classifyTwilioResult({ code: 21617 }), 'failed');
  assert.equal(delivery.classifyTwilioResult({ error: '21617 body too long' }), 'failed');
  assert.equal(delivery.classifyTwilioResult({ statusCode: 400 }), 'failed');
  assert.equal(delivery.classifyTwilioResult({ statusCode: 503 }), 'unknown');
});
