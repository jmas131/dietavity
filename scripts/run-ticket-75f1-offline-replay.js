'use strict';
const fixtures = require('../test-support/ticket-75f1/offline-replay-fixtures.json');
const { createOfflineReplayHarness } = require('../lib/sales-engine-v2/offline-replay');
async function main() { const harness = createOfflineReplayHarness(); const results = []; for (const fixture of fixtures) results.push(await harness.replay(fixture)); process.stdout.write(`${JSON.stringify(results.map(item => ({ output: item.output, counters: item.counters })), null, 2)}\n`); }
if (require.main === module) main().catch(() => { process.stderr.write('Ticket75F.1 offline replay failed.\n'); process.exitCode = 1; });
module.exports = { main };
