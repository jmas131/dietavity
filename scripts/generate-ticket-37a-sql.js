'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { RECOVERY_FUNCTIONS_SQL } = require('../lib/reply-recovery-sql');
const root = path.resolve(__dirname, '..');
const start = '-- BEGIN GENERATED TICKET 37A RECOVERY FUNCTIONS';
const end = '-- END GENERATED TICKET 37A RECOVERY FUNCTIONS';
const block = `${start}\n${RECOVERY_FUNCTIONS_SQL}\n${end}\n`;
// The original migration is already installed: keep it immutable.
fs.writeFileSync(path.join(root, 'database/migrations/20260904_ticket_37a_historical_reopen.sql'), `BEGIN;\n${block}\nCOMMIT;\n`);
const schemaPath = path.join(root, 'database/schema.sql');
let schema = fs.readFileSync(schemaPath, 'utf8').replace(new RegExp(`${start}[\\s\\S]*?${end}\\n*`), '');
const marker = '-- PostgreSQL database dump complete';
if (!schema.includes(marker)) throw new Error('Schema end marker missing');
schema = schema.replace(marker, () => `${block}\n${marker}`);
fs.writeFileSync(schemaPath, schema);
console.log('Generated Ticket 37A migration and synchronized schema functions');
