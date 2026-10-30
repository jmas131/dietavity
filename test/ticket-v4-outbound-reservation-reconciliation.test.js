'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ordering = require('../lib/session-ordering');

const root = path.resolve(__dirname, '..');
const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const poller = require('../n8n/Dietavity WhatsApp Recovery Poller.json');
const migration = fs.readFileSync(path.join(root, 'database/migrations/20261030_v4_outbound_reservation_reconciliation.sql'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
const node = name => workflow.nodes.find(value => value.name === name);
const outputs = (name, index = 0) => (workflow.connections[name]?.main?.[index] || []).map(edge => edge.node);

test('V4 reconciliation is an explicit, terminally bounded claim branch', () => {
  assert.deepEqual(outputs('Route Session Claim State', 3), ['Reconcile V4 Outbound Reservation']);
  assert.equal(node('Reconcile V4 Outbound Reservation').parameters.query, ordering.CLAIM_V4_OUTBOUND_RECONCILIATION_SQL);
  assert.deepEqual(outputs('Route V4 Outbound Reconciliation', 0), ['Mark Session Inbound Complete']);
  assert.deepEqual(outputs('Route V4 Outbound Reconciliation', 1), ['Respond to Reconciled V4 Reservation']);
  assert.deepEqual(outputs('Route V4 Outbound Reconciliation', 2), ['End — V4 Reconciliation Escalated']);
  assert.deepEqual(outputs('Assert Reconciled V4 Reservation Accepted'), ['Reconcile V4 Outbound Reservation']);
  assert.match(node('Persist Reconciled V4 Provider Result').parameters.query, /reconciliation_redispatch_token/);
});

test('reconciliation locks FIFO ownership, repairs only persisted SID evidence, and bounds ambiguity', () => {
  for (const text of [migration, schema]) {
    assert.match(text, /CREATE FUNCTION public\.claim_v4_outbound_reconciliation/);
    assert.match(text, /pg_advisory_xact_lock\(hashtextextended\(p->>'session_id', 17\)\)/);
    assert.match(text, /V4_RECONCILIATION_NOT_FIFO_HEAD/);
    assert.match(text, /FOR UPDATE/);
    assert.match(text, /provider_message_sid ~ '\^\(SM\|MM\)/);
    assert.match(text, /reconciliation_non_submission_evidence', 'twilio_21617'/);
    assert.match(text, /reconciliation_state', 'operator_required'/);
    assert.match(text, /v4_outbound_reconciliation_required/);
  }
  assert.doesNotMatch(migration, /INSERT INTO public\.messages/);
  assert.match(migration, /reconciliation_redispatch_token/);
});

test('poller excludes an entire session behind an escalated FIFO head', () => {
  const finder = poller.nodes.find(value => value.name === 'Find Verified WhatsApp Sessions');
  assert.match(finder.parameters.query, /NOT EXISTS \([\s\S]*FROM public\.messages AS head/);
  assert.match(finder.parameters.query, /head\.metadata->>'reconciliation_state' = 'operator_required'/);
  assert.match(finder.parameters.query, /MIN\(earlier\.processing_order\)/);
  assert.match(migration, /processing_completed_at IS NULL/);
  assert.match(migration, /processing_outcome = 'reconciliation'/);
});
