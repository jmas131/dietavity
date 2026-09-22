const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadWorkflow } = require('../test-support/workflow-fixture');

const workflow = loadWorkflow();
const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const node = (name) => {
  assert.ok(nodes.has(name), `expected node ${name}`);
  return nodes.get(name);
};
const outputs = (name, index = 0) => (
  workflow.connections[name]?.main?.[index] || []
).map((connection) => connection.node);

test('successful Stripe cancellation validates status, object, and the resolved user subscription ID', () => {
  const stripe = node('Stripe Cancel a Subscription');
  assert.equal(stripe.parameters.method, 'DELETE');
  assert.equal(
    stripe.parameters.url,
    "=https://api.stripe.com/v1/subscriptions/{{ $('Get User from Supabase').item.json.stripe_subscription_id }}",
  );
  assert.doesNotMatch(stripe.parameters.url, /Incoming Message|chatInput|data\.body/);

  const conditions = node('If Stripe Unsubscribe ').parameters.conditions.conditions;
  assert.equal(conditions.length, 3);
  assert.ok(conditions.some((condition) => condition.leftValue === '={{ $json.status }}' && condition.rightValue === 'canceled'));
  assert.ok(conditions.some((condition) => condition.leftValue === '={{ $json.object }}' && condition.rightValue === 'subscription'));
  assert.ok(conditions.some((condition) => (
    condition.leftValue === '={{ $json.id }}'
      && condition.rightValue.includes("$('Get User from Supabase').item.json.stripe_subscription_id")
  )));
});

test('successful cancellation atomically updates local state and preserves identity fields', () => {
  const persist = node('Persist Legacy Cancellation');
  assert.equal(persist.type, 'n8n-nodes-base.postgres');
  const sql = persist.parameters.query;

  assert.match(sql, /UPDATE public\.users/);
  assert.match(sql, /SET subscription_status = 'canceled'/);
  assert.match(sql, /UPDATE public\.subscriptions/);
  assert.match(sql, /SET status = 'canceled'/);
  assert.match(sql, /legacy_subscription\.provider = 'stripe'/);
  assert.match(sql, /legacy_subscription\.stripe_subscription_id = .*Stripe Cancel a Subscription/s);
  assert.match(sql, /legacy_user\.stripe_subscription_id = .*Stripe Cancel a Subscription/s);

  assert.doesNotMatch(sql, /DELETE\s+FROM/i);
  assert.doesNotMatch(sql, /SET\s+is_active/i);
  assert.doesNotMatch(sql, /SET\s+plan_type/i);
  assert.doesNotMatch(sql, /SET\s+stripe_(?:subscription|customer)_id/i);
  assert.match(sql, /AS local_state_canceled/);
  for (const table of ['purchases', 'programs', 'profiles', 'weeks', 'meal_plans', 'messages', 'onboarding_chat_memory', 'onboarding_sessions']) {
    assert.doesNotMatch(sql, new RegExp(`(?:DELETE|TRUNCATE)\\s+(?:FROM\\s+)?(?:public\\.)?${table}`, 'i'));
  }
});

test('local updates and metric insert use only fields present in the current schema', () => {
  const usersTable = schema.match(/CREATE TABLE public\.users \([\s\S]*?\n\);/)?.[0] || '';
  const subscriptionsTable = schema.match(/CREATE TABLE public\.subscriptions \([\s\S]*?\n\);/)?.[0] || '';
  const metricsTable = schema.match(/CREATE TABLE public\.unsubscribed_metrics \([\s\S]*?\n\);/)?.[0] || '';
  for (const field of ['subscription_status', 'updated_at', 'is_active', 'plan_type', 'stripe_customer_id', 'stripe_subscription_id']) {
    assert.match(usersTable, new RegExp(`\\b${field}\\b`));
  }
  for (const field of ['provider', 'status', 'stripe_subscription_id']) {
    assert.match(subscriptionsTable, new RegExp(`\\b${field}\\b`));
  }
  for (const field of ['region', 'allergies', 'dislikes', 'conditions', 'diet', 'cuisine', 'unsubscribed_at']) {
    assert.match(metricsTable, new RegExp(`\\b${field}\\b`));
  }
});

test('Delete User and every user-deletion production path are removed', () => {
  assert.equal(nodes.has('Delete User'), false);
  assert.doesNotMatch(JSON.stringify(workflow), /"operation":\s*"delete"[\s\S]{0,200}"tableId":\s*"users"/i);
  assert.doesNotMatch(node('Persist Legacy Cancellation').parameters.query, /DELETE\s+FROM\s+(?:public\.)?users/i);
});

test('unsubscribe metric is inserted at most once for the active-to-canceled transition', () => {
  const sql = node('Persist Legacy Cancellation').parameters.query;
  assert.match(sql, /INSERT INTO public\.unsubscribed_metrics/);
  assert.match(sql, /subscription_status IS DISTINCT FROM 'canceled'/);
  assert.match(sql, /WHERE EXISTS \(SELECT 1 FROM updated_user\)/);
  assert.deepEqual(outputs('If Stripe Unsubscribe ', 0), ['Persist Legacy Cancellation']);
  assert.deepEqual(outputs('Persist Legacy Cancellation'), ['If Local Cancellation Persisted']);
});

test('Stripe and database failures cannot send a false success confirmation', () => {
  assert.deepEqual(outputs('Stripe Cancel a Subscription'), ['If Stripe Unsubscribe ']);
  assert.deepEqual(outputs('If Stripe Unsubscribe ', 1), ['Send Unsubscribe Unconfirmed Message']);
  assert.deepEqual(outputs('Persist Legacy Cancellation'), ['If Local Cancellation Persisted']);
  assert.deepEqual(outputs('If Local Cancellation Persisted', 0), ['Send Unsubscribe Message']);
  assert.deepEqual(outputs('If Local Cancellation Persisted', 1), ['Send Unsubscribe Unconfirmed Message']);
  assert.equal(workflow.settings.errorWorkflow, 'sa10JQEAbxNYvCGG');

  const fallback = node('Send Unsubscribe Unconfirmed Message').parameters.message;
  assert.match(fallback, /No pudimos confirmar la cancelación/);
  assert.match(fallback, /No marcaremos tu suscripción como cancelada hasta verificarla/);
  assert.doesNotMatch(fallback, /12 horas|será cancelada/i);
});

test('confirmation accurately describes synchronous recurring cancellation', () => {
  const message = node('Send Unsubscribe Message').parameters.message;
  assert.equal(
    message,
    'Tu suscripción ha sido cancelada correctamente. No se realizarán más cargos recurrentes por esa suscripción.',
  );
  assert.doesNotMatch(message, /eliminad|borrad|12 horas|será cancelada/i);
});

test('Ticket 5 gate blocks canceled and one-time-only customers from Stripe', () => {
  const query = node('Get Customer Assistant Context').parameters.query;
  assert.match(query, /legacy_user\.stripe_subscription_id IS NOT NULL/);
  assert.match(query, /legacy_user\.subscription_status IN \('active', 'trialing', 'past_due'\)/);
  assert.match(query, /legacy_subscription\.status IN \('active', 'trialing', 'past_due'\)/);
  assert.doesNotMatch(query, /'canceled'/);
  assert.deepEqual(outputs('If Active Legacy Subscription', 0), ['Unsubscribe User Message']);
  assert.deepEqual(outputs('If Active Legacy Subscription', 1), ['Build Deterministic Customer Response']);
  assert.match(node('Build Deterministic Customer Response').parameters.jsCode, /compra única/i);
});

test('all workflow connections remain valid with no dangling cancellation branches', () => {
  for (const [source, groups] of Object.entries(workflow.connections)) {
    assert.ok(nodes.has(source), `connection source missing: ${source}`);
    for (const outputsByType of Object.values(groups)) {
      for (const output of outputsByType) {
        for (const target of output) assert.ok(nodes.has(target.node), `connection target missing: ${target.node}`);
      }
    }
  }
});
