'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, hmacRedactor } = require('../lib/twilio-ledger-reconciliation');
const { auditDatabaseConfig, createPostgresLedgerReader, createTwilioReader, retryGet, sanitizeTwilioResource, twilioCalendarBounds } = require('../lib/twilio-ledger-audit-clients');
const { privateReportDirectory, run, safeErrorCode } = require('../scripts/reconcile-twilio-ledger');

const sid = tail => `SM${tail.padStart(32, '0')}`;
const id = tail => `00000000-0000-4000-8000-${tail.padStart(12, '0')}`;
const window = { from: '2026-11-01T00:00:00.000Z', to: '2026-11-08T00:00:00.000Z' };
const sender = 'whatsapp:+15550000000';
const inbound = (n, time = '2026-11-02T10:00:00.000Z', extra = {}) => ({ sid: sid(n), direction: 'inbound', to: sender, from: 'whatsapp:+15551111111', date_sent: time, status: 'received', ...extra });
const outbound = (n, time = '2026-11-02T10:01:00.000Z', extra = {}) => ({ sid: sid(n), direction: 'outbound-api', from: sender, to: 'whatsapp:+15551111111', date_sent: time, status: 'delivered', ...extra });
const ledgerInbound = (n, time = '2026-11-02T10:00:00.000Z', extra = {}) => ({ ledger_id: id(n), direction: 'inbound', provider_message_sid: sid(n), recorded_at: time, turn_anchor_id: id(n), processing_completed_at: '2026-11-02T10:02:00.000Z', is_canonical: true, ...extra });
const ledgerOutbound = (n, anchor = id('1'), extra = {}) => ({ ledger_id: id(`9${n}`), direction: 'outbound', provider_message_sid: sid(n), recorded_at: '2026-11-02T10:01:00.000Z', in_reply_to_id: anchor, delivery_status: 'accepted', logical_reply_key: `reply:${sid('1')}:v4`, part_index: 1, part_count: 1, is_canonical: true, ...extra });
const audit = (twilioMessages, ledgerRows, extra = {}) => classify({ twilioMessages, ledgerRows, window, sender, now: '2026-11-08T12:00:00.000Z', hmacSecret: 'a sufficiently long local test secret', ...extra });

test('Ticket 90B exact SID matching is redacted, domain-separated, and does not assess response quality', () => {
  const report = audit([inbound('1'), outbound('2')], [ledgerInbound('1'), ledgerOutbound('2')]);
  assert.equal(report.summary.confirmed_count, 0); assert.equal(report.summary.conversational_response_quality_evaluated, false);
  const redact = hmacRedactor('a sufficiently long local test secret'); assert.notEqual(redact('ledger', id('1')), redact('twilio_sid', id('1')));
  assert.doesNotMatch(JSON.stringify(report), /\+1555|SM0{31}1|00000000-0000-4000-8000-000000000001/);
});

test('Ticket 90B detects unmatched, duplicate, terminal failures, and unresolved statuses without treating unknown as failure', () => {
  const report = audit([inbound('1'), inbound('3'), outbound('2', undefined, { status: 'failed', error_code: 63001 })], [ledgerInbound('1'), ledgerInbound('1', undefined, { ledger_id: id('4') }), ledgerOutbound('2'), ledgerOutbound('5', id('1'), { delivery_status: 'unknown', provider_message_sid: null })]);
  const categories = report.discrepancies.confirmed.map(x => x.category);
  assert.ok(categories.includes('duplicate_provider_sid')); assert.ok(categories.includes('inbound_unmatched_ledger')); assert.ok(categories.includes('delivery_failure'));
  assert.ok(report.discrepancies.inconclusive.some(x => x.category === 'outbound_acceptance_inconclusive'));
});

test('Ticket 90B handles logical batching, multipart replies, supersession, and crossing UTC boundaries', () => {
  const anchor = ledgerInbound('1', '2026-11-01T00:00:00.000Z');
  const member = ledgerInbound('2', '2026-10-31T23:59:59.000Z', { ledger_id: id('2'), turn_anchor_id: id('1'), turn_position: 2 });
  const one = ledgerOutbound('3', id('1'), { part_index: 1, part_count: 2, logical_reply_key: 'reply:logical' });
  const two = ledgerOutbound('4', id('1'), { part_index: 2, part_count: 2, logical_reply_key: 'reply:logical' });
  const superseded = ledgerInbound('5', '2026-11-02T00:00:00.000Z', { processing_outcome: 'superseded', processing_completed_at: '2026-11-02T00:01:00.000Z' });
  const report = audit([inbound('1', '2026-11-01T00:00:00.000Z'), inbound('2', '2026-10-31T23:59:59.000Z'), outbound('3'), outbound('4'), inbound('5', '2026-11-02T00:00:00.000Z')], [anchor, member, one, two, superseded]);
  assert.equal(report.discrepancies.confirmed.some(x => x.category === 'missing_logical_reply'), false);
  assert.equal(report.discrepancies.confirmed.some(x => x.category === 'inbound_unmatched_ledger'), false);
});

test('Ticket 90B marks failed source coverage incomplete rather than proving negative Twilio matches', () => {
  const report = audit([], [ledgerInbound('1')], { coverage: { twilioComplete: false, ledgerComplete: true } });
  assert.equal(report.coverage.status, 'coverage_incomplete');
  assert.ok(report.discrepancies.coverage_incomplete.some(x => x.category === 'inbound_unmatched_twilio'));
});

test('Ticket 90B treats reconciliation as a legitimate no-reply disposition and downgrades missing replies on incomplete ledger coverage', () => {
  const reconciled = ledgerInbound('1', undefined, { processing_outcome: 'reconciliation' });
  const clean = audit([inbound('1')], [reconciled]); assert.ok(clean.discrepancies.inconclusive.some(x => x.category === 'reconciliation_required')); assert.equal(clean.discrepancies.confirmed.some(x => x.category === 'missing_logical_reply'), false);
  const incomplete = audit([inbound('2')], [ledgerInbound('2')], { coverage: { twilioComplete: true, ledgerComplete: false } });
  assert.ok(incomplete.discrepancies.coverage_incomplete.some(x => x.category === 'missing_logical_reply'));
});

test('Ticket 90B reports terminal provider/ledger status disagreement separately', () => {
  const report = audit([inbound('1'), outbound('2', undefined, { status: 'failed' })], [ledgerInbound('1'), ledgerOutbound('2', id('1'), { delivery_status: 'delivered' })]);
  assert.ok(report.discrepancies.confirmed.some(x => x.category === 'ledger_status_divergence'));
  assert.ok(report.discrepancies.confirmed.some(x => x.category === 'delivery_failure'));
});

test('Ticket 90B excludes historical and synthetic rows without classifying unordered history as delivery failure', () => {
  const report = audit([], [ledgerInbound('1', undefined, { is_historical: true, processing_outcome: 'historical_completed' }), ledgerInbound('2', undefined, { is_synthetic: true })]);
  assert.equal(report.discrepancies.excluded.length, 2);
  assert.equal(report.discrepancies.confirmed.some(x => x.category === 'delivery_failure'), false);
});

test('Ticket 90B Twilio client permits only GET, follows server page URI, and bounds retries', async () => {
  const calls = []; const account = `AC${'a'.repeat(32)}`, key = `SK${'b'.repeat(32)}`;
  const fetchFn = async (url, options) => { calls.push({ url: String(url), method: options.method }); return { ok: true, json: async () => calls.length === 1 ? { messages: [inbound('1')], next_page_uri: `/2010-04-01/Accounts/${account}/Messages.json?PageToken=next` } : { messages: [outbound('2')] }, headers: { get: () => null } }; };
  const reader = createTwilioReader({ accountSid: account, apiKeySid: key, apiKeySecret: 'secret', fetchFn }); const result = await reader.list({ from: window.from, to: window.to });
  assert.equal(result.complete, true); assert.equal(result.messages.length, 2); assert.deepEqual(calls.map(x => x.method), ['GET', 'GET']);
  const first = new URL(calls[0].url); assert.equal(first.searchParams.get('DateSent>='), '2026-11-01'); assert.equal(first.searchParams.get('DateSent<='), '2026-11-07');
  let attempts = 0; await assert.rejects(() => retryGet(async () => { attempts++; return { ok: false, status: 401, headers: { get: () => null } }; }, { retries: 2, sleepFn: async () => {} }), /HTTP_401/); assert.equal(attempts, 1);
});

test('Ticket 90B rejects malformed credentials and raw reports cannot contain body fields', () => {
  assert.throws(() => createTwilioReader({ accountSid: 'no', apiKeySid: 'no', apiKeySecret: 'x' }), /CREDENTIALS/);
  const report = audit([inbound('1', undefined, { body: 'sensitive content' })], [ledgerInbound('1', undefined, { body: 'sensitive content' })]);
  assert.doesNotMatch(JSON.stringify(report), /sensitive content|body/);
});

test('Ticket 90D PostgreSQL reader uses one TLS-verified read-only snapshot and projection only', async () => {
  const calls = []; let ended = false; let released = false; let page = 0;
  const pages = [
    [{ ledger_id: id('1'), recorded_at: '2026-11-02T00:00:00.000Z' }, { ledger_id: id('2'), recorded_at: '2026-11-02T00:00:00.000Z' }],
    [{ ledger_id: id('3'), recorded_at: '2026-11-02T00:00:00.000Z' }],
  ];
  const client = { query: async (sql, values) => { calls.push([sql, values]); if (sql.startsWith('SELECT count')) return { rows: [{ count: '3' }] }; if (sql.startsWith('SELECT ledger_id')) return { rows: pages[page++] || [] }; return { rows: [] }; }, release: () => { released = true; } };
  let config; const reader = createPostgresLedgerReader({ connectionString: 'postgresql://twilio_ledger_auditor:local-secret@db.example.test:5432/postgres?sslmode=verify-full', sslRootCertPath: __filename, poolFactory: value => { config = value; return { connect: async () => client, end: async () => { ended = true; } }; } });
  const result = await reader.list({ ...window, pageSize: 2 });
  assert.equal(result.complete, true); assert.deepEqual(result.rows.map(row => row.ledger_id), [id('1'), id('2'), id('3')]); assert.equal(config.max, 1); assert.equal(config.ssl.rejectUnauthorized, true); assert.equal(released, true); assert.equal(ended, true);
  assert.equal(calls[0][0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); assert.match(calls[1][0], /has_function_privilege\(current_user/); assert.match(calls[3][0], /ORDER BY recorded_at ASC, ledger_id ASC/); assert.match(calls[4][0], /ledger_id > \$4/); assert.equal(calls.at(-1)[0], 'ROLLBACK');
  assert.ok(calls.every(([sql]) => /^(BEGIN|SELECT|ROLLBACK)/.test(sql)), 'the reader issues no database mutation or DDL');
  assert.deepEqual(Object.keys(sanitizeTwilioResource({ body: 'private', sid: sid('1') })), ['sid', 'direction', 'from', 'to', 'date_sent', 'date_created', 'status', 'error_code']);
});

test('Ticket 90D rejects unsafe database identities and incomplete PostgreSQL coverage', async () => {
  assert.throws(() => auditDatabaseConfig({ connectionString: 'postgresql://postgres:secret@db.example.test/postgres?sslmode=verify-full', sslRootCertPath: __filename }), /DATABASE_ROLE_INVALID/);
  assert.throws(() => auditDatabaseConfig({ connectionString: 'postgresql://twilio_ledger_auditor:secret@db.example.test/postgres?sslmode=verify-full', sslRootCertPath: '/missing-ca.pem' }), /TLS_CERT_REQUIRED/);
  const client = { query: async sql => sql.startsWith('SELECT count') ? { rows: [{ count: '2' }] } : sql.startsWith('SELECT ledger_id') ? { rows: [{ ledger_id: id('1'), recorded_at: '2026-11-02T00:00:00.000Z' }] } : { rows: [] }, release() {} };
  const reader = createPostgresLedgerReader({ connectionString: 'postgresql://twilio_ledger_auditor:local-secret@db.example.test/postgres?sslmode=verify-full', sslRootCertPath: __filename, poolFactory: () => ({ connect: async () => client, end: async () => {} }) });
  const result = await reader.list({ ...window, pageSize: 2 }); assert.equal(result.complete, false); assert.equal(result.errorCode, 'POSTGRES_SNAPSHOT_INTEGRITY_FAILED');
  const report = audit([], [ledgerInbound('1')], { coverage: { twilioComplete: true, ledgerComplete: result.complete } }); assert.ok(report.discrepancies.coverage_incomplete.every(item => item.confidence !== 'confirmed'));
  const unsafeClient = { query: async sql => sql.startsWith('SELECT EXISTS') ? { rows: [{ unsafe: true }] } : { rows: [] }, release() {} };
  const unsafeReader = createPostgresLedgerReader({ connectionString: 'postgresql://twilio_ledger_auditor:local-secret@db.example.test/postgres?sslmode=verify-full', sslRootCertPath: __filename, poolFactory: () => ({ connect: async () => unsafeClient, end: async () => {} }) });
  const unsafe = await unsafeReader.list(window); assert.deepEqual(unsafe, { rows: [], complete: false, errorCode: 'POSTGRES_EFFECTIVE_FUNCTION_PRIVILEGE' });
});

test('Ticket 90D migration confines the audit role to the content-free view and preserves service role grants', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/20261111_ticket_90d_direct_postgres_audit_access.sql'), 'utf8');
  assert.match(migration, /CREATE ROLE twilio_ledger_auditor LOGIN NOINHERIT .*NOBYPASSRLS/);
  assert.match(migration, /FOR SELECT TO twilio_ledger_audit_view_owner USING \(true\)/);
  assert.match(migration, /GRANT CREATE ON SCHEMA twilio_audit TO twilio_ledger_audit_view_owner[\s\S]*REVOKE CREATE ON SCHEMA twilio_audit FROM twilio_ledger_audit_view_owner/);
  assert.match(migration, /GRANT SELECT ON TABLE twilio_audit\.twilio_ledger_audit_rows TO twilio_ledger_auditor/);
  assert.match(migration, /has_function_privilege\('twilio_ledger_auditor', procedure\.oid, 'EXECUTE'\)/);
  assert.doesNotMatch(migration, /GRANT\s+(?:ALL|SELECT)\s+ON TABLE public\.messages TO twilio_ledger_auditor/);
  assert.doesNotMatch(migration, /message\.(?:body|user_message|assistant_response|transcript|audio_url|user_id)\b/);
  assert.doesNotMatch(migration, /REVOKE .*service_role.*ON TABLE public\.messages/);
});

test('Ticket 90B detects repeated Twilio pagination as incomplete coverage', async () => {
  const account = `AC${'a'.repeat(32)}`, key = `SK${'b'.repeat(32)}`; let calls = 0;
  const reader = createTwilioReader({ accountSid: account, apiKeySid: key, apiKeySecret: 'secret', fetchFn: async () => ({ ok: true, headers: { get: () => null }, json: async () => ({ messages: [], next_page_uri: `/2010-04-01/Accounts/${account}/Messages.json?PageToken=repeat` }) }) });
  const listed = await reader.list(window); assert.equal(listed.complete, false);
  assert.deepEqual(twilioCalendarBounds({ from: window.from, to: window.to }), { lower: '2026-11-01', upper: '2026-11-07' });
});

test('Ticket 90B CLI fetches bounded unmatched outbound SIDs and sanitizes end-to-end errors/reports', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const tmp = fs.mkdtempSync(require('node:path').join(os.tmpdir(), 'ticket90b-'));
  const keys = { TWILIO_AUDIT_WHATSAPP_SENDER: sender, TWILIO_LEDGER_AUDIT_HMAC_SECRET: 'a sufficiently long local test secret', TWILIO_AUDIT_ACCOUNT_SID: `AC${'a'.repeat(32)}`, TWILIO_AUDIT_API_KEY_SID: `SK${'b'.repeat(32)}`, TWILIO_AUDIT_API_KEY_SECRET: 'secret', SUPABASE_AUDIT_DATABASE_URL: 'postgresql://twilio_ledger_auditor:local-secret@db.example.test/postgres?sslmode=verify-full', SUPABASE_AUDIT_SSL_ROOT_CERT: __filename }; const old = Object.fromEntries(Object.keys(keys).map(key => [key, process.env[key]])); Object.assign(process.env, keys);
  try {
    let fetched = 0;
    const result = await run({ from: window.from, to: window.to, 'report-dir': tmp, 'retention-days': '2' }, { now: '2026-11-08T12:00:00.000Z', createTwilioReader: () => ({ list: async () => ({ messages: [inbound('1')], complete: true }), fetchMessage: async value => { fetched++; return outbound(value.slice(-1)); } }), createPostgresLedgerReader: () => ({ list: async () => ({ rows: [ledgerInbound('1'), ledgerOutbound('2')], complete: true }) }) });
    assert.equal(fetched, 1); assert.equal(result.report.candidate_sid_lookups.attempted, 1); const saved = fs.readFileSync(result.output, 'utf8'); assert.doesNotMatch(saved, /\+1555|SM0{31}2/); assert.equal(fs.statSync(result.output).mode & 0o777, 0o600);
  } finally { for (const [key, value] of Object.entries(old)) value === undefined ? delete process.env[key] : process.env[key] = value; fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.equal(safeErrorCode(new Error('https://key:secret@example.test/SM123 body +1555')), 'UNSAFE_ERROR');
});

test('Ticket 90B rejects symbolic-link report directories and retention only targets own filenames', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket90b-link-')); const target = path.join(root, 'target'); const link = path.join(root, 'link'); fs.mkdirSync(target); fs.symlinkSync(target, link);
  try { assert.throws(() => privateReportDirectory(link), /REPORT_DIR_UNSAFE/); fs.writeFileSync(path.join(target, 'unrelated.json'), '{}'); assert.equal(fs.existsSync(path.join(target, 'unrelated.json')), true); } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Ticket 90B contains no Twilio send, n8n, Recovery Poller, or replay path', () => {
  const fs = require('node:fs'); const files = ['../lib/twilio-ledger-audit-clients', '../scripts/reconcile-twilio-ledger'];
  for (const file of files) {
    const source = fs.readFileSync(require.resolve(file), 'utf8');
    assert.doesNotMatch(source, /sendMessage|messages\.create|executeWorkflow|Recovery Poller|n8n|replay|method:\s*['"]POST/i, file);
  }
});
