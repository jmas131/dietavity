'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const root = path.join(__dirname, '..'); const generator = fs.readFileSync(path.join(root, 'scripts/refactor-ticket-10-workflow.js'), 'utf8'); const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json'), 'utf8')); const nodes = new Map(workflow.nodes.map(node => [node.name, node]));
const out = name => (workflow.connections[name]?.main || []).flatMap(group => (group || []).map(edge => edge.node));
function reachable(start, target) { const seen = new Set([start]); const queue = [start]; while (queue.length) { const node = queue.shift(); if (node === target) return true; for (const next of out(node)) if (!seen.has(next)) { seen.add(next); queue.push(next); } } return false; }
test('T75E.1 generator is authoritative and inactive artifact contains the post-claim v2 boundary', () => {
  assert.equal(workflow.active, false); assert.match(generator, /Ticket75E\.1/); for (const name of ['Route Sales Engine V2 Claim', 'Route Sales Engine V2 Mode', 'Invoke V2 Shadow Claimed Turn', 'Invoke V2 Live Claimed Turn', 'Validate V2 Durable Reservation Handoff']) assert.ok(nodes.has(name), name);
  assert.deepEqual(out('Route Session Claim State'), ['Route Sales Engine V2 Claim', 'Wait Before Session Claim Retry']);
  assert.deepEqual(out('Wait Before Session Claim Retry'), ['Claim Next Session Inbound']);
});
test('T75E.1 defaults legacy, shadow rejoins legacy, and live cannot fall through', () => {
  const route = nodes.get('Route Sales Engine V2 Claim'); assert.match(route.parameters.jsCode, /SALES_ENGINE_V2_ROUTE \|\| 'legacy'/); assert.doesNotMatch(route.parameters.jsCode, /random|percentage/i);
  assert.deepEqual(out('Route Sales Engine V2 Mode'), ['Get User from Supabase', 'Invoke V2 Shadow Claimed Turn', 'Invoke V2 Live Claimed Turn']);
  assert.deepEqual(out('Discard V2 Shadow Result'), ['Get User from Supabase']);
  assert.deepEqual(out('Invoke V2 Live Claimed Turn'), ['Validate V2 Durable Reservation Handoff']);
  assert.deepEqual(out('Validate V2 Durable Reservation Handoff'), ['Loop Paid WhatsApp Parts']);
  assert.equal(out('Invoke V2 Live Claimed Turn').includes('Get User from Supabase'), false);
  assert.equal(out('Invoke V2 Live Claimed Turn').includes('Prepare Paid WhatsApp Message Parts'), false);
  assert.equal(out('Invoke V2 Live Claimed Turn').includes('Reserve Paid Assistant Reply'), false);
});
test('T75E.1 internal request is capability-only and uses a secret-free RS256 credential seam', () => {
  for (const [name, mode] of [['Invoke V2 Shadow Claimed Turn', 'shadow'], ['Invoke V2 Live Claimed Turn', 'live']]) { const node = nodes.get(name); const body = node.parameters.jsonBody; assert.match(node.parameters.url, /SALES_ENGINE_V2_CLAIMED_TURN_URL/); for (const key of ['contract_version', 'canonical_inbound_message_id', 'session_id', 'processing_owner', 'claimed_lease_until', 'claim_attempt_id', 'mode', 'workflow_execution_id']) assert.match(body, new RegExp(key)); assert.match(body, new RegExp(`mode: '${mode}'`)); for (const forbidden of ['body:', 'phone', 'history', 'prompt', 'provider_', 'Authorization', 'Bearer ']) assert.doesNotMatch(body, new RegExp(forbidden)); assert.equal(node.credentials.httpHeaderAuth.id, '__T75E_RS256_SERVICE_ASSERTION__'); }
  assert.doesNotMatch(JSON.stringify(workflow), /BEGIN (?:RSA )?PRIVATE KEY|eyJ[a-zA-Z0-9_-]{20,}/);
});
test('T75E.1 accepts only complete durable rows and reuses the existing provider-evidence/completion continuation', () => {
  const code = nodes.get('Validate V2 Durable Reservation Handoff').parameters.jsCode; for (const token of ['reserved_new', 'reserved_existing', 'seenIds', 'seenKeys', 'part_count', 'T75E_V2_PART_INVALID']) assert.match(code, new RegExp(token)); assert.doesNotMatch(code, /delivery\.text|formatWhatsAppMessage|Reserve Paid Assistant Reply/);
  assert.deepEqual(out('Validate V2 Durable Reservation Handoff'), ['Loop Paid WhatsApp Parts']); assert.equal(reachable('Loop Paid WhatsApp Parts', 'Update Paid Assistant Reply Delivery'), true); assert.equal(reachable('Update Paid Assistant Reply Delivery', 'Assert Paid Assistant Reply Accepted'), true); assert.equal(reachable('Assert Paid Assistant Reply Accepted', 'Mark Session Inbound Complete'), true);
});
