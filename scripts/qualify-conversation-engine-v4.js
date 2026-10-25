'use strict';

// Explicit model-backed qualification. It does not write durable memory,
// reserve messages, contact Twilio, or call production infrastructure.
const { createConversationEngineV4 } = require('../lib/conversation-engine-v4/service');
const { FIXTURES } = require('../test-support/conversation-engine-v4-qualification-fixtures');

async function main() {
  const engine = createConversationEngineV4();
  const results = [];
  for (const [index, item] of FIXTURES.entries()) {
    try {
      const result = await engine.resolve({ request_id: `v4-qualification-${index + 1}`, session_id: `v4-qualification-${item.id}`, claimed_inbound_message_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, processing_order: index + 1, current_message: item.current_message, canonical_history: item.canonical_history, durable_memory: item.durable_memory });
      results.push({ id: item.id, criteria: item.criteria, response: result.response, memory_updates: result.memory_updates, model: result.model, status: 'generated' });
    } catch (error) {
      results.push({ id: item.id, criteria: item.criteria, status: 'failed', failure_code: error?.code || 'unknown' });
    }
  }
  process.stdout.write(`${JSON.stringify({ engine_version: 'conversation-engine-v4-primary-v1', results }, null, 2)}\n`);
  if (results.some(result => result.status !== 'generated')) process.exitCode = 1;
}

main().catch(error => { process.stderr.write(`qualification_failed:${error?.code || 'unknown'}\n`); process.exitCode = 1; });
