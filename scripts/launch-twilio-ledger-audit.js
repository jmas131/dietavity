#!/usr/bin/env node
'use strict';

// Interactive, memory-only launcher for the existing read-only audit CLI.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { createTwilioReader } = require('../lib/twilio-ledger-audit-clients');

const WINDOW = Object.freeze({ from: '2026-11-05T00:00:00Z', to: '2026-11-12T00:00:00Z' });
const REPORT_DIR = path.join(os.homedir(), 'Documents/dietavity/audits');
const REQUIRED = Object.freeze(['TWILIO_AUDIT_ACCOUNT_SID', 'TWILIO_AUDIT_API_KEY_SID', 'TWILIO_AUDIT_API_KEY_SECRET', 'TWILIO_AUDIT_WHATSAPP_SENDER', 'SUPABASE_AUDIT_DATABASE_URL', 'SUPABASE_AUDIT_SSL_ROOT_CERT', 'TWILIO_LEDGER_AUDIT_HMAC_SECRET']);

function help() { return 'Usage: node scripts/launch-twilio-ledger-audit.js\n\nPrompts interactively; no credential is stored or passed as a command-line argument.'; }
function safeCode(error) { return /^[A-Z0-9_:-]{1,80}$/.test(String(error?.message || '')) ? error.message : 'AUDIT_LAUNCH_FAILED'; }
function requireValue(value, name) { if (value === null) throw new Error('AUDIT_CANCELLED'); if (!String(value || '').trim()) throw new Error(`MISSING_${name}`); return String(value).trim(); }
function validateDatabaseInput(url, certPath) {
  let parsed; try { parsed = new URL(url); } catch { throw new Error('SUPABASE_AUDIT_DATABASE_URL_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.searchParams.get('sslmode') !== 'verify-full') throw new Error('SUPABASE_AUDIT_DATABASE_URL_INVALID');
  if (!/^twilio_ledger_auditor(?:\.[a-z0-9]+)?$/i.test(decodeURIComponent(parsed.username))) throw new Error('SUPABASE_AUDIT_DATABASE_ROLE_INVALID');
  if (!fs.existsSync(certPath)) throw new Error('SUPABASE_AUDIT_TLS_CERT_REQUIRED');
}
function completeDatabaseUrl(url, password) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('SUPABASE_AUDIT_DATABASE_URL_INVALID'); }
  if (parsed.password) throw new Error('SUPABASE_AUDIT_DATABASE_URL_PASSWORD_FORBIDDEN');
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.searchParams.get('sslmode') !== 'verify-full' || !/^twilio_ledger_auditor(?:\.[a-z0-9]+)?$/i.test(decodeURIComponent(parsed.username))) throw new Error('SUPABASE_AUDIT_DATABASE_URL_INVALID');
  // URL.password preserves a literal percent sign as-is, so encode once before
  // assignment; URL then retains the remaining userinfo escaping correctly.
  parsed.password = encodeURIComponent(requireValue(password, 'SUPABASE_AUDIT_DATABASE_PASSWORD'));
  return parsed.toString();
}
function buildEnvironment(values, inherited = {}) {
  for (const name of REQUIRED) requireValue(values[name], name);
  validateDatabaseInput(values.SUPABASE_AUDIT_DATABASE_URL, values.SUPABASE_AUDIT_SSL_ROOT_CERT);
  const base = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE'].filter(name => inherited[name]).map(name => [name, inherited[name]]));
  for (const name of REQUIRED) base[name] = values[name];
  if (values.TWILIO_LEDGER_AUDIT_HMAC_ROTATION) base.TWILIO_LEDGER_AUDIT_HMAC_ROTATION = values.TWILIO_LEDGER_AUDIT_HMAC_ROTATION;
  return base;
}
function auditArgs(reportDir = REPORT_DIR) { return ['scripts/reconcile-twilio-ledger.js', '--from', WINDOW.from, '--to', WINDOW.to, '--report-dir', reportDir, '--retention-days', '30']; }
async function validateTwilio(values, factory = createTwilioReader) {
  try {
    const reader = factory({ accountSid: values.TWILIO_AUDIT_ACCOUNT_SID, apiKeySid: values.TWILIO_AUDIT_API_KEY_SID, apiKeySecret: values.TWILIO_AUDIT_API_KEY_SECRET });
    const listed = await reader.list({ ...WINDOW, pageSize: 1 });
    if (!listed.complete) throw new Error('TWILIO_AUDIT_LIST_INCOMPLETE');
    if (listed.messages[0]?.sid) await reader.fetchMessage(listed.messages[0].sid);
    return { list: true, fetch: Boolean(listed.messages[0]?.sid) };
  } catch { throw new Error('TWILIO_AUDIT_READ_ACCESS_FAILED'); }
}
function spawnAudit({ values, reportDir = REPORT_DIR, spawnFn = spawn, inherited = process.env }) {
  return spawnFn(process.execPath, auditArgs(reportDir), { env: buildEnvironment(values, inherited), stdio: 'inherit' });
}
async function askHidden(prompt, input = process.stdin, output = process.stdout) {
  if (!input.isTTY) throw new Error('INTERACTIVE_TTY_REQUIRED');
  const wasRaw = Boolean(input.isRaw);
  return new Promise((resolve, reject) => {
    let value = '';
    let settled = false;
    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      input.removeListener('data', onData);
      input.removeListener('error', onError);
      try {
        if (Boolean(input.isRaw) !== wasRaw) input.setRawMode(wasRaw);
        input.pause();
        output.write('\n');
      } catch (restoreError) {
        if (!error) error = restoreError;
      }
      if (error) reject(error); else resolve(result);
    };
    const onError = error => finish(null, error);
    const onData = data => {
      for (const key of data.toString('utf8')) {
        if (key === '\u0003') { finish(null); break; }
        if (key === '\r' || key === '\n') { finish(value); break; }
        if (key === '\u007f') value = value.slice(0, -1);
        else if (key !== '\u001b') value += key;
      }
    };
    try {
      output.write(prompt);
      input.setRawMode(true);
      input.resume();
      input.on('data', onData);
      input.once('error', onError);
    } catch (error) { finish(null, error); }
  });
}
function terminalPrompt() {
  return {
    ask: question => new Promise((resolve, reject) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      let settled = false;
      const finish = (value, error) => { if (settled) return; settled = true; rl.close(); if (error) reject(error); else resolve(value); };
      rl.once('SIGINT', () => finish(null));
      rl.once('error', error => finish(null, error));
      rl.question(question, answer => finish(answer));
    }),
    secret: askHidden,
    close() {},
  };
}
async function collectValues(prompt) {
  const ask = async (label, secret = false) => requireValue(await (secret ? prompt.secret(`${label}: `) : prompt.ask(`${label}: `)), label.replace(/[^A-Z0-9]+/gi, '_').toUpperCase());
  const accountSid = await ask('Twilio Account SID');
  const apiKeySid = await ask('Twilio restricted API Key SID');
  const apiKeySecret = await ask('Twilio restricted API Key secret', true);
  const sender = await ask('WhatsApp sender', true);
  const databaseUrl = await ask('PostgreSQL audit connection URL (without password)');
  const databasePassword = await ask('PostgreSQL audit password', true);
  const certificatePath = await ask('Supabase CA certificate path');
  const hmacSecret = await ask('Report HMAC secret', true);
  const hmacRotation = await prompt.ask('HMAC rotation label [v1]: ');
  if (hmacRotation === null) throw new Error('AUDIT_CANCELLED');
  return {
    TWILIO_AUDIT_ACCOUNT_SID: accountSid, TWILIO_AUDIT_API_KEY_SID: apiKeySid,
    TWILIO_AUDIT_API_KEY_SECRET: apiKeySecret, TWILIO_AUDIT_WHATSAPP_SENDER: sender,
    SUPABASE_AUDIT_DATABASE_URL: completeDatabaseUrl(databaseUrl, databasePassword), SUPABASE_AUDIT_SSL_ROOT_CERT: certificatePath,
    TWILIO_LEDGER_AUDIT_HMAC_SECRET: hmacSecret, TWILIO_LEDGER_AUDIT_HMAC_ROTATION: String(hmacRotation).trim() || 'v1',
  };
}
async function runInteractive({ prompt = terminalPrompt(), twilioFactory = createTwilioReader, spawnFn = spawn, inherited = process.env, output = console.log } = {}) {
  try {
    const values = await collectValues(prompt); buildEnvironment(values, inherited);
    const validateAnswer = await prompt.ask(`Validate Twilio list/fetch access for ${WINDOW.from} to ${WINDOW.to}? [y/N]: `);
    if (validateAnswer === null || String(validateAnswer).trim().toLowerCase() !== 'y') return { status: 'cancelled' };
    const validation = await validateTwilio(values, twilioFactory); output(`Twilio read validation passed${validation.fetch ? ' (list and fetch)' : ' (list; no message available to fetch)'}.`);
    if (!validation.fetch) return { status: 'failed', errorCode: 'TWILIO_AUDIT_FETCH_UNVERIFIED', validation };
    const runAnswer = await prompt.ask(`Run the read-only audit for ${WINDOW.from} to ${WINDOW.to}? Type RUN: `);
    if (runAnswer === null || String(runAnswer).trim() !== 'RUN') return { status: 'cancelled', validation };
    const child = spawnAudit({ values, spawnFn, inherited }); return { status: 'started', validation, child };
  } catch (error) { if (safeCode(error) === 'AUDIT_CANCELLED') return { status: 'cancelled' }; if (safeCode(error) === 'AUDIT_LAUNCH_FAILED') return { status: 'failed', errorCode: 'AUDIT_LAUNCH_FAILED' }; return { status: 'failed', errorCode: safeCode(error) }; }
  finally { prompt.close?.(); }
}
if (require.main === module) { if (process.argv.includes('--help')) process.stdout.write(`${help()}\n`); else runInteractive().then(result => { if (result.status === 'started') return; process.stdout.write(`Twilio ledger audit launcher: ${result.status}${result.errorCode ? ` (${result.errorCode})` : ''}\n`); process.exitCode = result.status === 'failed' ? 1 : 0; }); }
module.exports = { REQUIRED, REPORT_DIR, WINDOW, askHidden, auditArgs, buildEnvironment, collectValues, completeDatabaseUrl, help, runInteractive, spawnAudit, validateDatabaseInput, validateTwilio };
