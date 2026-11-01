'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ordering = require('../lib/session-ordering');
const sales = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const poller = require('../n8n/Dietavity WhatsApp Recovery Poller.json');
const migration = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '..', 'database/migrations/20261030_v4_outbound_reservation_reconciliation.sql'),
  'utf8',
);

const node = (workflow, name) => workflow.nodes.find(value => value.name === name);
const outputs = (name, index = 0) => (sales.connections[name]?.main?.[index] || []).map(edge => edge.node);

test('V4 incident: a foreign active FIFO lease is busy even with a durable reservation', () => {
  const sql = ordering.CLAIM_NEXT_INBOUND_SQL;
  const busy = sql.slice(sql.indexOf("'busy'::text AS claim_state"), sql.indexOf("'reconciliation'::text AS claim_state"));
  const reconciliation = sql.slice(sql.indexOf("'reconciliation'::text AS claim_state"), sql.indexOf("'deferred'::text AS claim_state"));

  assert.match(busy, /candidate\.processing_owner IS NOT NULL/);
  assert.match(busy, /candidate\.processing_lease_until > NOW\(\)/);
  assert.match(busy, /candidate\.processing_owner <> \(SELECT payload->>'processing_owner' FROM input\)/);
  assert.doesNotMatch(busy, /FROM public\.messages AS outbound/);
  assert.match(reconciliation, /AND NOT \([\s\S]*candidate\.processing_owner IS NOT NULL[\s\S]*candidate\.processing_lease_until > NOW\(\)[\s\S]*candidate\.processing_owner <> \(SELECT payload->>'processing_owner' FROM input\)[\s\S]*\)/);
  assert.deepEqual(outputs('Route Session Claim State', 2), ['End — Turn Already Owned']);
  assert.equal(node(sales, 'Claim Next Session Inbound').parameters.query, sql);
});

test('V4 Recovery Poller evaluates the FIFO head before lease eligibility', () => {
  const sql = node(poller, 'Find Verified WhatsApp Sessions').parameters.query;
  assert.match(sql, /^SELECT head\.session_id\nFROM public\.messages AS head/m);
  assert.match(sql, /head\.processing_order = \([\s\S]*MIN\(earlier\.processing_order\)[\s\S]*earlier\.session_id = head\.session_id/);
  assert.match(sql, /head\.processing_lease_until <= NOW\(\)/);
  assert.match(sql, /head\.metadata->>'reconciliation_state' IS DISTINCT FROM 'operator_required'/);
  assert.doesNotMatch(sql, /SELECT DISTINCT message\.session_id/);
});

test('the reconciliation RPC keeps its direct foreign-owner guard unchanged', () => {
  assert.match(migration, /IF inbound\.processing_owner IS NOT NULL AND inbound\.processing_lease_until > now\(\)\s+AND inbound\.processing_owner IS DISTINCT FROM p->>'processing_owner' THEN\s+RAISE EXCEPTION 'V4_RECONCILIATION_OWNED';/);
});
