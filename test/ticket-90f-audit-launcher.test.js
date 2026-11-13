'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { askHidden, auditArgs, buildEnvironment, runInteractive, validateTwilio } = require('../scripts/launch-twilio-ledger-audit');
const values = { TWILIO_AUDIT_ACCOUNT_SID: `AC${'a'.repeat(32)}`, TWILIO_AUDIT_API_KEY_SID: `SK${'b'.repeat(32)}`, TWILIO_AUDIT_API_KEY_SECRET: 'synthetic-secret', TWILIO_AUDIT_WHATSAPP_SENDER: 'whatsapp:+15550000000', SUPABASE_AUDIT_DATABASE_URL: 'postgresql://twilio_ledger_auditor:synthetic-password@db.example.test/postgres?sslmode=verify-full', SUPABASE_AUDIT_SSL_ROOT_CERT: __filename, TWILIO_LEDGER_AUDIT_HMAC_SECRET: 'synthetic-hmac-secret', TWILIO_LEDGER_AUDIT_HMAC_ROTATION: 'test' };
function prompts(items) { return { ask: async () => items.shift(), secret: async () => items.shift(), close() {} }; }
function hiddenTerminal() {
  const input = new EventEmitter(); input.isTTY = true; input.isRaw = false; input.rawCalls = []; input.setRawMode = value => { input.isRaw = value; input.rawCalls.push(value); }; input.resume = () => { input.resumed = true; }; input.pause = () => { input.paused = true; };
  const output = { text: '', write(value) { this.text += value; } };
  return { input, output };
}
test('Ticket 90F passes credentials only in a minimal child environment', () => {
  const env = buildEnvironment(values, { PATH: '/bin', HOME: '/tmp', UNRELATED_SECRET: 'must-not-pass' });
  assert.equal(env.UNRELATED_SECRET, undefined); assert.equal(env.TWILIO_AUDIT_API_KEY_SECRET, 'synthetic-secret');
  const args = auditArgs('/private/audits'); assert.ok(args.every(arg => !arg.includes('synthetic'))); assert.deepEqual(args.slice(1, 5), ['--from', '2026-11-05T00:00:00Z', '--to', '2026-11-12T00:00:00Z']);
});
test('Ticket 90F cancellation never validates or spawns a child', async () => {
  const result = await runInteractive({ prompt: prompts([values.TWILIO_AUDIT_ACCOUNT_SID, values.TWILIO_AUDIT_API_KEY_SID, values.TWILIO_AUDIT_API_KEY_SECRET, values.TWILIO_AUDIT_WHATSAPP_SENDER, values.SUPABASE_AUDIT_DATABASE_URL, values.SUPABASE_AUDIT_SSL_ROOT_CERT, values.TWILIO_LEDGER_AUDIT_HMAC_SECRET, 'v1', 'n']), twilioFactory: () => { throw new Error('must not validate'); }, spawnFn: () => { throw new Error('must not spawn'); } });
  assert.deepEqual(result, { status: 'cancelled' });
});
test('Ticket 90F Ctrl-C-style confirmation cancellation never validates or spawns a child', async () => {
  const result = await runInteractive({ prompt: prompts([values.TWILIO_AUDIT_ACCOUNT_SID, values.TWILIO_AUDIT_API_KEY_SID, values.TWILIO_AUDIT_API_KEY_SECRET, values.TWILIO_AUDIT_WHATSAPP_SENDER, values.SUPABASE_AUDIT_DATABASE_URL, values.SUPABASE_AUDIT_SSL_ROOT_CERT, values.TWILIO_LEDGER_AUDIT_HMAC_SECRET, 'v1', null]), twilioFactory: () => { throw new Error('must not validate'); }, spawnFn: () => { throw new Error('must not spawn'); } });
  assert.deepEqual(result, { status: 'cancelled' });
});
test('Ticket 90F Ctrl-C-style secret cancellation never spawns a child', async () => {
  const result = await runInteractive({ prompt: prompts([null]), spawnFn: () => { throw new Error('must not spawn'); } });
  assert.deepEqual(result, { status: 'cancelled' });
});
test('Ticket 90F hidden input never echoes and always restores terminal mode', async () => {
  const { input, output } = hiddenTerminal();
  const result = askHidden('Secret: ', input, output);
  input.emit('data', Buffer.from('abc\r'));
  assert.equal(await result, 'abc');
  assert.equal(output.text, 'Secret: \n');
  assert.deepEqual(input.rawCalls, [true, false]);
  assert.equal(input.paused, true);
});
test('Ticket 90F restores terminal mode after Ctrl-C and input errors', async () => {
  const cancelled = hiddenTerminal(); const cancellation = askHidden('Secret: ', cancelled.input, cancelled.output);
  cancelled.input.emit('data', Buffer.from('\u0003'));
  assert.equal(await cancellation, null); assert.deepEqual(cancelled.input.rawCalls, [true, false]);
  const failed = hiddenTerminal(); const failure = askHidden('Secret: ', failed.input, failed.output);
  failed.input.emit('error', new Error('synthetic terminal failure'));
  await assert.rejects(failure, /synthetic terminal failure/); assert.deepEqual(failed.input.rawCalls, [true, false]);
});
test('Ticket 90F validates with read-only list/fetch then spawns without credential argv', async () => {
  let listed = 0; let fetched = 0; let call;
  const result = await runInteractive({ prompt: prompts([values.TWILIO_AUDIT_ACCOUNT_SID, values.TWILIO_AUDIT_API_KEY_SID, values.TWILIO_AUDIT_API_KEY_SECRET, values.TWILIO_AUDIT_WHATSAPP_SENDER, values.SUPABASE_AUDIT_DATABASE_URL, values.SUPABASE_AUDIT_SSL_ROOT_CERT, values.TWILIO_LEDGER_AUDIT_HMAC_SECRET, 'v1', 'y', 'RUN']), twilioFactory: () => ({ list: async () => { listed++; return { complete: true, messages: [{ sid: `SM${'1'.repeat(32)}` }] }; }, fetchMessage: async () => { fetched++; return {}; } }), spawnFn: (file, args, options) => { call = { file, args, options }; return {}; }, output: () => {} });
  assert.equal(result.status, 'started'); assert.equal(listed, 1); assert.equal(fetched, 1); assert.ok(call.args.every(arg => !arg.includes('synthetic'))); assert.equal(call.options.env.TWILIO_AUDIT_API_KEY_SECRET, 'synthetic-secret');
});
test('Ticket 90F reports safe Twilio authentication failure', async () => {
  await assert.rejects(() => validateTwilio(values, () => ({ list: async () => { throw new Error('https://key:secret@example.test'); } })), /TWILIO_AUDIT_READ_ACCESS_FAILED/);
});
test('Ticket 90F refuses a full audit when fetch access cannot be validated', async () => {
  const result = await runInteractive({ prompt: prompts([values.TWILIO_AUDIT_ACCOUNT_SID, values.TWILIO_AUDIT_API_KEY_SID, values.TWILIO_AUDIT_API_KEY_SECRET, values.TWILIO_AUDIT_WHATSAPP_SENDER, values.SUPABASE_AUDIT_DATABASE_URL, values.SUPABASE_AUDIT_SSL_ROOT_CERT, values.TWILIO_LEDGER_AUDIT_HMAC_SECRET, 'v1', 'y']), twilioFactory: () => ({ list: async () => ({ complete: true, messages: [] }) }), spawnFn: () => { throw new Error('must not spawn'); }, output: () => {} });
  assert.deepEqual(result, { status: 'failed', errorCode: 'TWILIO_AUDIT_FETCH_UNVERIFIED', validation: { list: true, fetch: false } });
});
test('Ticket 90F keeps secret input in memory and adds no delivery or mutation path', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/launch-twilio-ledger-audit.js'), 'utf8');
  assert.match(source, /setRawMode\(true\)/);
  assert.doesNotMatch(source, /(?:writeFile|appendFile|mkdirSync|unlinkSync|n8n|Recovery Poller|\b(?:INSERT|UPDATE|DELETE)\b|method:\s*['"]POST)/i);
});
