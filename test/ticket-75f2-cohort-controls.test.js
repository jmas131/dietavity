'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path'); const { createRouteAuthorizer } = require('../lib/sales-engine-v2/claimed-turn-runtime');
const root = path.join(__dirname, '..'); const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json'), 'utf8')); const nodes = new Map(workflow.nodes.map(node => [node.name, node])); const out = name => (workflow.connections[name]?.main || []).flatMap(x => x.map(edge => edge.node)); const id = '11111111-1111-4111-8111-000000000075';
test('T75F.2 generated cohort routing is deterministic, frozen, and preserves busy/legacy/shadow/live topology', () => {
  const code = nodes.get('Route Sales Engine V2 Claim').parameters.jsCode; for (const token of ['SALES_ENGINE_V2_CONTROL', 'SALES_ENGINE_V2_ROUTE_GENERATION', 'SALES_ENGINE_V2_SHADOW_COHORT_IDS', 'SALES_ENGINE_V2_LIVE_COHORT_IDS', 'route_generation']) assert.match(code, new RegExp(token)); assert.doesNotMatch(code, /random|percentage/i);
  assert.deepEqual(out('Route Session Claim State'), ['Route Sales Engine V2 Claim', 'Wait Before Session Claim Retry']); assert.deepEqual(out('Wait Before Session Claim Retry'), ['Claim Next Session Inbound']); assert.deepEqual(out('Route Sales Engine V2 Mode'), ['Get User from Supabase', 'Invoke V2 Shadow Claimed Turn', 'Invoke V2 Live Claimed Turn']); assert.deepEqual(out('Discard V2 Shadow Result'), ['Get User from Supabase', 'Build V2 Shadow Structural Diagnostic']); assert.deepEqual(out('Invoke V2 Live Claimed Turn'), ['Validate V2 Durable Reservation Handoff']);
});
test('T75F.2 Node independently validates mode, generation and canonical cohort after claim verification', () => {
  const auth = createRouteAuthorizer({ state: 'shadow', generation: 'g1', cohortIds: [id] }); const request = { mode: 'shadow', route_generation: 'g1', canonical_inbound_message_id: id }; assert.equal(auth.authorize(request, { canonical_inbound_message_id: id }).generation, 'g1'); assert.throws(() => auth.authorize({ ...request, route_generation: 'g2' }, { canonical_inbound_message_id: id }), /forbidden_route/); assert.throws(() => auth.authorize(request, { canonical_inbound_message_id: '22222222-2222-4222-8222-000000000075' }), /forbidden_route/);
});
test('T75F.2 generated lifecycle observations are closed, detached and privacy-minimized', () => {
  const builders = ['Build V2 Route Diagnostic', 'Build V2 Shadow Structural Diagnostic', 'Build V2 Live Handoff Diagnostic', 'Build V2 Provider Acceptance Diagnostic', 'Build V2 Completion Diagnostic'];
  const recorders = ['Record V2 Route Diagnostic', 'Record V2 Shadow Structural Diagnostic', 'Record V2 Live Handoff Diagnostic', 'Record V2 Provider Acceptance Diagnostic', 'Record V2 Completion Diagnostic'];
  for (const name of builders) {
    const code = nodes.get(name).parameters.jsCode;
    assert.match(code, /ticket-75f1-v1/); assert.doesNotMatch(code, /customer|assistant.*text|phone|whatsapp|prompt|provider.*payload|destination|token|credential/i);
  }
  for (const name of recorders) {
    const node = nodes.get(name); assert.equal(node.onError, 'continueRegularOutput'); assert.deepEqual(out(name), []); assert.match(node.parameters.query, /record_v2_lifecycle_diagnostic/);
  }
  assert.deepEqual(out('Route Sales Engine V2 Claim').slice(1), ['Build V2 Route Diagnostic']);
  assert.deepEqual(out('Validate V2 Durable Reservation Handoff'), ['Loop Paid WhatsApp Parts', 'Build V2 Live Handoff Diagnostic']);
  assert.match(nodes.get('Discard V2 Shadow Result').parameters.jsCode, /shadow_v2_projection/);
  assert.doesNotMatch(nodes.get('Discard V2 Shadow Result').parameters.jsCode, /delivery\.text|customer_response|response\.text/);
});
