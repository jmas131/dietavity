#!/usr/bin/env node
'use strict';

// Explicit operator action only. No credentials or message content in argv or
// output. libpq reads PG* / PGSERVICE credentials from the operator environment.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const axios = require('axios');
const recovery = require('../lib/reply-recovery');

function database(sql) {
  try {
    const result = execFileSync(process.env.DIETAVITY_PSQL_BIN || 'psql',
      ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], {
        input: "SET statement_timeout = '30s'; SET lock_timeout = '5s';\n" + sql, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    return JSON.parse(result.trim());
  } catch (_) { throw new Error('Recovery database action failed. Stop; inspect trusted database diagnostics without copying message content.'); }
}

async function main(args = process.argv.slice(2)) {
  const [action, inputPath, confirmation, ...extra] = args;
  if (!['preflight', 'preview', 'prepare', 'send-next', 'verify', 'complete'].includes(action) || !inputPath || extra.length) {
    throw new Error('Usage: node scripts/ticket-37a-recovery.js preflight|preview|prepare|send-next|verify|complete /secure/input.json [--execute]');
  }
  if (['prepare', 'send-next', 'complete'].includes(action) && confirmation !== '--execute') throw new Error('This operation requires explicit --execute');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  recovery.validateInput(input, !['preflight', 'verify'].includes(action));
  let output;
  if (action === 'send-next') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) throw new Error('TWILIO_AUTH_TOKEN is required');
    const client = axios.create({ baseURL: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`,
      auth: { username: accountSid, password: authToken }, timeout: 20000, maxRedirects: 0 });
    output = await recovery.sendNext(input, { db: database, accountSid, from: process.env.TWILIO_WHATSAPP_FROM,
      provider: {
        getMessage: async (sid) => {
          try { return (await client.get(`/Messages/${sid}.json`)).data; }
          catch (_) { throw new Error('Could not verify Twilio messaging window; nothing sent'); }
        },
        sendMessage: async ({ from, to, body }) => (await client.post('/Messages.json',
          new URLSearchParams({ From: from, To: to, Body: body }).toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).data,
      },
    });
  } else {
    const rows = database(recovery.preflightSql(input));
    recovery.validateIncident(input, rows);
    if (action === 'prepare' || action === 'preview') {
      const payload = recovery.preparationPayload(input, rows);
      output = action === 'prepare'
        ? recovery.summarize(database(recovery.rpcSql('prepare_whatsapp_reply_recovery', payload)))
        : { length_metadata: payload.length_metadata, part_hashes: payload.parts.map(recovery.sha256), part_lengths: payload.parts.map((p) => p.length) };
    } else if (action === 'complete') output = database(recovery.completionSql(input));
    else output = recovery.summarize(rows);
  }
  console.log(JSON.stringify(output, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
