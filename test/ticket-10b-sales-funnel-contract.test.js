'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  BUYER_SIGNALS,
  RESPONSE_STRATEGIES,
  SECONDARY_EVENT_BY_SIGNAL,
  decideSalesTurn,
  topicEvent,
} = require('../lib/sales-engine-v3');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(
  root,
  'database/migrations/20260817_ticket_10b_sales_funnel_contract.sql',
), 'utf8');
const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
const workflow = JSON.parse(fs.readFileSync(path.join(
  root,
  'n8n/Dietavity Sales Engine (Ticket 10).json',
), 'utf8'));

const DATABASE_EVENT_TYPES_OUTSIDE_SALES_ENGINE = Object.freeze([
  'setup_completed',
  'reminder_sent',
]);

function extractConstraint(sql, marker) {
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, `missing constraint marker: ${marker}`);

  const checkStart = sql.indexOf('CHECK (', start);
  assert.notEqual(checkStart, -1, `missing CHECK after: ${marker}`);

  let depth = 0;
  for (let index = checkStart + 'CHECK '.length; index < sql.length; index += 1) {
    if (sql[index] === '(') depth += 1;
    if (sql[index] === ')') depth -= 1;
    if (depth === 0) return sql.slice(checkStart, index + 1);
  }

  assert.fail(`unterminated CHECK after: ${marker}`);
}

function allowedValues(sql, marker) {
  const constraint = extractConstraint(sql, marker);
  return [...constraint.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function runtimeSalesEventTypes() {
  const values = [];
  const decisionSource = decideSalesTurn.toString();

  for (const match of decisionSource.matchAll(
    /events\.push\('([a-z_]+)'\)|\.\.\.base\.events,\s*'([a-z_]+)'/g,
  )) values.push(match[1] || match[2]);

  values.push(...Object.values(SECONDARY_EVENT_BY_SIGNAL));
  for (const match of topicEvent.toString().matchAll(/return '([a-z_]+)'/g)) {
    values.push(match[1]);
  }

  for (const node of workflow.nodes) {
    const query = node.parameters?.query;
    if (typeof query !== 'string' || !query.includes('sales_funnel_events')) continue;
    for (const match of query.matchAll(/'([a-z_]+)',\s*'\1:/g)) values.push(match[1]);
  }

  return sortedUnique(values);
}

const RUNTIME_CONTRACT = Object.freeze({
  buyer_signal: sortedUnique(BUYER_SIGNALS),
  strategy: sortedUnique(RESPONSE_STRATEGIES),
  event_type: runtimeSalesEventTypes(),
});

const FINAL_DATABASE_CONTRACT = Object.freeze({
  buyer_signal: RUNTIME_CONTRACT.buyer_signal,
  strategy: RUNTIME_CONTRACT.strategy,
  event_type: sortedUnique([
    ...RUNTIME_CONTRACT.event_type,
    ...DATABASE_EVENT_TYPES_OUTSIDE_SALES_ENGINE,
  ]),
});

function assertContract(sql, markerPrefix) {
  for (const [column, expected] of Object.entries(FINAL_DATABASE_CONTRACT)) {
    const constraintName = column === 'event_type' ? 'type' : column;
    const marker = `${markerPrefix} sales_funnel_events_${constraintName}_check`;
    const constraint = extractConstraint(sql, marker);
    const allowed = allowedValues(sql, marker);

    if (column !== 'event_type') assert.match(constraint, new RegExp(`${column} IS NULL`));
    assert.equal(new Set(allowed).size, allowed.length, `${column} constraint has duplicates`);
    assert.deepEqual(sortedUnique(allowed), expected, `${column} contract drift`);
    for (const runtimeValue of RUNTIME_CONTRACT[column]) {
      assert.ok(allowed.includes(runtimeValue), `${column} rejects runtime value ${runtimeValue}`);
    }
  }
}

test('Ticket 10B migration permits the complete current Sales Engine vocabulary', () => {
  assertContract(migration, 'ADD CONSTRAINT');
});

test('canonical schema exactly matches the Ticket 10B funnel contract', () => {
  assertContract(schema, 'CONSTRAINT');
});

test('runtime event audit derives policy and direct workflow persistence values', () => {
  assert.deepEqual(RUNTIME_CONTRACT.event_type, [
    'ai_value_objection', 'checkout_sent', 'deferred_interest',
    'health_question', 'lead_started', 'meaningful_engagement',
    'offer_presented', 'payment_method_question', 'price_objection',
    'price_question', 'program_ready', 'purchase_completed', 'purchase_intent',
    'rejection', 'reminder_requested', 'timing_objection', 'trust_objection',
  ]);
});
