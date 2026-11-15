'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const monitor = require('../lib/ledger-health-monitor');

const root = path.resolve(__dirname, '..');
const workflow = require('../n8n/Dietavity Ledger Health Monitor.json');
const globalErrorHandler = require('../n8n/Global Error Handler.json');
const migration = fs.readFileSync(path.join(root, 'database/migrations/20261102_ticket_88_ledger_health_monitor.sql'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
const node = name => workflow.nodes.find(value => value.name === name);
const globalNode = name => globalErrorHandler.nodes.find(value => value.name === name);
const outputs = (name, index = 0) => (workflow.connections[name]?.main?.[index] || []).map(edge => edge.node);
const now = Date.parse('2026-11-02T12:00:00.000Z');
const minutesAgo = minutes => new Date(now - minutes * 60_000).toISOString();

test('Ticket 88 detects only unhealthy FIFO heads and leaves healthy or active processing silent', () => {
  assert.equal(monitor.classifyInboundHead({ timestamp: minutesAgo(1), processing_owner: null }, now), null, 'healthy queued work is silent');
  assert.equal(monitor.classifyInboundHead({ timestamp: minutesAgo(30), processing_owner: 'active', processing_lease_until: minutesAgo(-10) }, now), null, 'active valid lease is not a failure');
  assert.equal(monitor.classifyInboundHead({ timestamp: minutesAgo(1), processing_owner: 'corrupt-owner', processing_lease_until: null }, now), 'missing_lease_expiration', 'an owner without a lease expiration cannot be silent');
  assert.equal(monitor.classifyInboundHead({ timestamp: minutesAgo(30), processing_owner: 'recovery', processing_lease_until: minutesAgo(4) }, now), null, 'temporary recovery delay is within grace');
  assert.equal(monitor.classifyInboundHead({ timestamp: minutesAgo(30), processing_owner: 'lost', processing_lease_until: minutesAgo(6) }, now), 'expired_lease');
  assert.equal(monitor.classifyInboundHead({ timestamp: minutesAgo(21), processing_owner: null }, now), 'stale_unclaimed_head');
  assert.equal(monitor.classifyInboundHead({ timestamp: minutesAgo(1), reconciliation_state: 'operator_required' }, now), 'operator_required');
  assert.equal(monitor.classifyInboundHead({ timestamp: minutesAgo(30), processing_completed_at: minutesAgo(1) }, now), null, 'completed work is never alerted');
});

test('Ticket 88 workflow is a separate inactive five-minute, read-only monitor', () => {
  assert.equal(workflow.active, false);
  assert.equal(node('Monitor Canonical Ledger Every Five Minutes').parameters.rule.interval[0].minutesInterval, 5);
  assert.equal(workflow.settings.errorWorkflow, 'sa10JQEAbxNYvCGG');
  const sql = node('Detect Ledger Health Incidents').parameters.query;
  assert.match(sql, /FROM public\.messages AS head/);
  assert.match(sql, /operator_required/);
  assert.match(sql, /missing_lease_expiration/);
  assert.match(sql, /expired_lease/);
  assert.match(sql, /stale_unclaimed_head/);
  assert.match(sql, /processing_lease_until <= NOW\(\) - INTERVAL '5 minutes'/);
  assert.match(sql, /timestamp <= NOW\(\) - INTERVAL '20 minutes'/);
  assert.match(sql, /affected_message_count/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL)\b/i);
  const executableNodeTypes = workflow.nodes.map(value => value.type).join('\n');
  assert.doesNotMatch(executableNodeTypes, /executeWorkflow|twilioTrigger|n8n-nodes-base\.twilio/);
  assert.deepEqual(outputs('Detect Ledger Health Incidents'), ['Process Ledger Health Incidents'], 'empty query results have no email path');
});

test('Ticket 88 reports operator-blocked successors and multiple independent affected sessions without exposing customer data', () => {
  const sql = node('Detect Ledger Health Incidents').parameters.query;
  const email = node('Build Ledger Health Alert Email').parameters.jsCode;
  assert.match(sql, /successor\.processing_order >/);
  assert.match(sql, /successor\.processing_completed_at IS NULL/);
  assert.match(sql, /1::integer AS affected_session_count/);
  assert.match(email, /Affected sessions/);
  assert.match(email, /Affected inbound messages/);
  assert.match(email, /Inbound message ID/);
  assert.doesNotMatch(email, /row\.session_id|row\.body|row\.phone|row\.customer/i);
  assert.deepEqual(outputs('Alert Email Reserved', 0), ['Build Ledger Health Alert Email']);
  assert.deepEqual(outputs('Alert Email Reserved', 1), ['Continue Ledger Health Incident Batch']);
});

test('Ticket 88 holds overlapping executions to one reservation and starts suppression only after email success', () => {
  const fresh = { reservation_expires_at: minutesAgo(1), last_alerted_at: null };
  const activeReservation = { reservation_expires_at: new Date(now + 9 * 60_000).toISOString(), last_alerted_at: null };
  const delivered = { reservation_expires_at: null, last_alerted_at: minutesAgo(1) };
  const abandoned = { reservation_expires_at: minutesAgo(1), last_alerted_at: null };
  assert.equal(monitor.canReserveAlert(fresh, now), true);
  assert.equal(monitor.canReserveAlert(activeReservation, now), false, 'concurrent monitor loses the active reservation');
  assert.equal(monitor.canReserveAlert(delivered, now), false, 'confirmed delivery is suppressed for 60 minutes');
  assert.equal(monitor.canReserveAlert(abandoned, now), true, 'abandoned reservation becomes retryable');
  assert.deepEqual(outputs('Send Ledger Health Alert Email'), ['Assert Ledger Health Email Accepted']);
  assert.deepEqual(outputs('Assert Ledger Health Email Accepted'), ['Confirm Ledger Health Alert Delivery']);
  assert.match(node('Assert Ledger Health Email Accepted').parameters.jsCode, /result\.accepted/);
  assert.match(node('Assert Ledger Health Email Accepted').parameters.jsCode, /LEDGER_HEALTH_EMAIL_NOT_ACCEPTED/);
  assert.equal(node('Send Ledger Health Alert Email').onError, undefined, 'email failure aborts before confirmation');
  assert.match(node('Confirm Ledger Health Alert Delivery').parameters.query, /confirm_ledger_health_alert_delivery/);
  assert.match(migration, /reservation_expires_at = now\(\) \+ interval '10 minutes'/);
  assert.match(migration, /last_alerted_at = now\(\)/);
  assert.match(migration, /reservation_token = NULL/);
});

test('Ticket 88 derives the fixed recipient from Global Error Handler and references production SMTP Error without inventing an ID', () => {
  const globalEmail = globalNode('Send Error Notification');
  const alertEmail = node('Send Ledger Health Alert Email');
  assert.ok(globalEmail);
  assert.equal(alertEmail.parameters.toEmail, globalEmail.parameters.toEmail);
  assert.doesNotMatch(alertEmail.parameters.toEmail, /\$env/);
  assert.deepEqual(alertEmail.credentials.smtp, { name: 'Error' });
  assert.equal(Object.hasOwn(alertEmail.credentials.smtp, 'id'), false);
});

test('Ticket 88 persists only monitoring alert coordination and exposes query/delivery failures to the global error workflow', () => {
  for (const text of [migration, schema]) {
    assert.match(text, /CREATE TABLE public\.ledger_health_alerts/);
    assert.match(text, /ENABLE ROW LEVEL SECURITY/);
    assert.match(text, /FORCE ROW LEVEL SECURITY/);
    assert.match(text, /REVOKE ALL ON TABLE public\.ledger_health_alerts/);
    assert.match(text, /CREATE FUNCTION public\.reserve_ledger_health_alert/);
    assert.match(text, /CREATE FUNCTION public\.confirm_ledger_health_alert_delivery/);
    assert.match(text, /FOR UPDATE/);
    assert.match(text, /interval '60 minutes'/);
    assert.match(text, /interval '10 minutes'/);
    assert.match(text, /missing_lease_expiration/);
    assert.match(text, /ON CONFLICT ON CONSTRAINT ledger_health_alerts_pkey DO NOTHING/);
    assert.doesNotMatch(text, /ON CONFLICT \(alert_key\) DO NOTHING/);
  }
  assert.doesNotMatch(migration, /UPDATE public\.messages|INSERT INTO public\.messages|DELETE FROM public\.messages/i);
  assert.equal(workflow.settings.errorWorkflow, 'sa10JQEAbxNYvCGG', 'database-query or email delivery failures are not silently healthy');
});

test('Ticket 88 canonical schema retains the complete migration objects and generated workflow is synchronized', () => {
  for (const definition of [
    'CREATE TABLE public.ledger_health_alerts',
    'CREATE FUNCTION public.reserve_ledger_health_alert',
    'CREATE FUNCTION public.confirm_ledger_health_alert_delivery',
    'missing_lease_expiration',
    "interval '60 minutes'",
    "interval '10 minutes'",
  ]) {
    assert.ok(migration.includes(definition), `migration includes ${definition}`);
    assert.ok(schema.includes(definition), `schema snapshot includes ${definition}`);
  }
  const artifact = path.join(root, 'n8n', 'Dietavity Ledger Health Monitor.json');
  const before = fs.readFileSync(artifact, 'utf8');
  execFileSync(process.execPath, [path.join(root, 'scripts/generate-ticket-88-ledger-health-monitor.js')], { cwd: root });
  assert.equal(fs.readFileSync(artifact, 'utf8'), before, 'generator reproduces the committed import-ready artifact exactly');
});
