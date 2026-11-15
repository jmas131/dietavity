#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { classify } = require('../lib/twilio-ledger-reconciliation');
const { createPostgresLedgerReader, createTwilioReader } = require('../lib/twilio-ledger-audit-clients');

const REPORT_PREFIX = 'twilio-ledger-audit-';
function fail(message) { throw new Error(message); }
function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]; if (!key.startsWith('--')) fail(`UNKNOWN_ARGUMENT:${key}`);
    const name = key.slice(2); if (['help'].includes(name)) { values[name] = true; continue; }
    const value = argv[++i]; if (!value || value.startsWith('--')) fail(`ARGUMENT_VALUE_REQUIRED:${key}`); values[name] = value;
  }
  return values;
}
function help() { return `Usage: node scripts/reconcile-twilio-ledger.js [--from ISO --to ISO] [--lookback-days N] --report-dir DIR --retention-days N\n\nRead-only audit only. Credentials are read from dedicated TWILIO_AUDIT_* and SUPABASE_AUDIT_DATABASE_* environment variables; it never reads production application credentials.`; }
function utcWindow(args, now = new Date()) {
  if (args.from || args.to) { if (!args.from || !args.to || !Number.isFinite(Date.parse(args.from)) || !Number.isFinite(Date.parse(args.to)) || Date.parse(args.from) >= Date.parse(args.to)) fail('UTC_RANGE_INVALID'); return { from: new Date(args.from).toISOString(), to: new Date(args.to).toISOString() }; }
  const days = Number(args['lookback-days'] || 7); if (!Number.isInteger(days) || days < 1 || days > 365) fail('LOOKBACK_DAYS_INVALID');
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { from: new Date(end.getTime() - days * 86400000).toISOString(), to: end.toISOString() };
}
function requireEnv(name) { const value = process.env[name]; if (!value) fail(`MISSING_ENV:${name}`); return value; }
function privateReportDirectory(dir) {
  if (!dir || path.resolve(dir) === path.parse(path.resolve(dir)).root) fail('REPORT_DIR_INVALID');
  const requested = path.resolve(dir); fs.mkdirSync(requested, { recursive: true, mode: 0o700 });
  const requestedInfo = fs.lstatSync(requested); if (requestedInfo.isSymbolicLink()) fail('REPORT_DIR_UNSAFE');
  const root = fs.realpathSync(requested); const info = fs.lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()) fail('REPORT_DIR_UNSAFE');
  fs.chmodSync(root, 0o700); return root;
}
function safeOutputPath(dir, window) { return path.join(dir, `${REPORT_PREFIX}${window.from.slice(0, 10)}_to_${window.to.slice(0, 10)}-${crypto.randomUUID()}.json`); }
function enforceRetention(dir, days, now = Date.now()) {
  if (!Number.isInteger(days) || days < 1 || days > 3650) fail('RETENTION_DAYS_INVALID');
  const root = privateReportDirectory(dir);
  for (const name of fs.readdirSync(root)) {
    if (!new RegExp(`^${REPORT_PREFIX}[0-9]{4}-[0-9]{2}-[0-9]{2}_to_[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f-]{36}\\.json$`).test(name)) continue;
    const target = path.join(root, name); const stat = fs.lstatSync(target);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.mtimeMs < now - days * 86400000) fs.unlinkSync(target);
  }
  return root;
}
function safeErrorCode(error) { const code = String(error?.code || error?.message || 'UNEXPECTED_ERROR'); return /^[A-Z0-9_:-]{1,80}$/.test(code) ? code : 'UNSAFE_ERROR'; }
async function run(args, dependencies = {}) {
  const window = utcWindow(args, dependencies.now || new Date());
  const reportDir = args['report-dir']; if (!reportDir) fail('REPORT_DIR_REQUIRED');
  const retentionDays = Number(args['retention-days']); const safeReportDir = enforceRetention(reportDir, retentionDays, dependencies.now ? new Date(dependencies.now).getTime() : Date.now());
  const sender = requireEnv('TWILIO_AUDIT_WHATSAPP_SENDER');
  const hmacSecret = requireEnv('TWILIO_LEDGER_AUDIT_HMAC_SECRET');
  const twilio = (dependencies.createTwilioReader || createTwilioReader)({ accountSid: requireEnv('TWILIO_AUDIT_ACCOUNT_SID'), apiKeySid: requireEnv('TWILIO_AUDIT_API_KEY_SID'), apiKeySecret: requireEnv('TWILIO_AUDIT_API_KEY_SECRET'), fetchFn: dependencies.fetchFn });
  const ledger = (dependencies.createPostgresLedgerReader || createPostgresLedgerReader)({ connectionString: requireEnv('SUPABASE_AUDIT_DATABASE_URL'), sslRootCertPath: requireEnv('SUPABASE_AUDIT_SSL_ROOT_CERT') });
  // Query a one-day overlap so replies/turn members crossing a requested UTC boundary remain observable.
  const overlap = { from: new Date(Date.parse(window.from) - 86400000).toISOString(), to: new Date(Date.parse(window.to) + 86400000).toISOString() };
  const [twilioResult, ledgerResult] = await Promise.all([twilio.list(overlap), ledger.list(overlap)]);
  const existingSids = new Set(twilioResult.messages.map(row => row.sid));
  const candidates = ledgerResult.rows.filter(row => row.direction === 'outbound' && row.provider_message_sid && row.is_canonical !== false && !row.is_historical && !row.is_synthetic && !row.delivery_suppressed && !existingSids.has(row.provider_message_sid)).slice(0, 50);
  let sidLookups = 0; let sidLookupFailures = 0;
  for (const candidate of candidates) {
    sidLookups++;
    try { const message = await twilio.fetchMessage(candidate.provider_message_sid); twilioResult.messages.push(message); existingSids.add(message.sid); }
    catch { sidLookupFailures++; }
  }
  const report = classify({ twilioMessages: twilioResult.messages, ledgerRows: ledgerResult.rows, window, sender, now: dependencies.now || new Date().toISOString(), hmacSecret, hmacRotation: process.env.TWILIO_LEDGER_AUDIT_HMAC_ROTATION || 'v1', coverage: { twilioComplete: twilioResult.complete, ledgerComplete: ledgerResult.complete } });
  report.generated_at = new Date(dependencies.now || Date.now()).toISOString(); report.effective_read_window = overlap;
  report.candidate_sid_lookups = { attempted: sidLookups, failed: sidLookupFailures, capped: candidates.length === 50 };
  const output = safeOutputPath(safeReportDir, window); const handle = fs.openSync(output, 'wx', 0o600); try { fs.writeFileSync(handle, `${JSON.stringify(report, null, 2)}\n`); } finally { fs.closeSync(handle); } fs.chmodSync(output, 0o600);
  return { report, output };
}
if (require.main === module) {
  (async () => { const args = parseArgs(process.argv.slice(2)); if (args.help) { process.stdout.write(`${help()}\n`); return; } const { report, output } = await run(args); process.stdout.write(`Twilio ledger audit: ${report.coverage.status}; confirmed=${report.summary.confirmed_count}; inconclusive=${report.summary.inconclusive_count}; excluded=${report.summary.excluded_count}; report=${path.basename(output)}\n`); })().catch(error => { process.stderr.write(`Twilio ledger audit failed: ${safeErrorCode(error)}\n`); process.exitCode = 1; });
}
module.exports = { enforceRetention, parseArgs, privateReportDirectory, run, safeErrorCode, utcWindow };
