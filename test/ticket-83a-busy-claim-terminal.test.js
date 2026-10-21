'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const ordering = require('../lib/session-ordering');

const node = name => workflow.nodes.find(item => item.name === name);
const outputs = (name, output = 0) => (workflow.connections[name]?.main?.[output] || []).map(edge => edge.node);

test('Ticket 83A makes a busy session claim terminal without changing the deferred quiet path', () => {
  const terminal = node('End — Turn Already Owned');
  assert.ok(terminal);
  assert.equal(terminal.type, 'n8n-nodes-base.code');
  assert.equal(terminal.parameters.jsCode, 'return $input.all();');
  assert.match(terminal.notes, /claim_state=busy/);

  assert.deepEqual(outputs('Route Session Claim State', 0), ['Get User from Supabase']);
  assert.deepEqual(outputs('Route Session Claim State', 1), ['Wait For Turn Quiet Period']);
  assert.deepEqual(outputs('Wait For Turn Quiet Period'), ['Claim Next Session Inbound']);
  assert.deepEqual(outputs('Route Session Claim State', 2), ['End — Turn Already Owned']);
  assert.equal(workflow.connections['End — Turn Already Owned'], undefined);
  assert.equal(node('Wait Before Session Claim Retry'), undefined);

  assert.equal(ordering.TURN_QUIET_SECONDS, 10);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /'deferred'::text AS claim_state/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /newest_received_at > NOW\(\) - INTERVAL '10 seconds'/);
  assert.match(ordering.CLAIM_NEXT_INBOUND_SQL, /timestamp > prior_received_at \+ INTERVAL '10 seconds'/);
  assert.equal(node('Claim Next Session Inbound').parameters.query, ordering.CLAIM_NEXT_INBOUND_SQL);
});
