'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  CHECKOUT_NODE_NAMES,
  PURCHASE_NODE_NAMES,
  SANDBOX_CREDENTIAL_NAME,
  SANDBOX_PRICE_ID,
  buildSandboxWorkflow,
  sandboxName,
  serialize,
} = require('../scripts/refactor-ticket-24a-stripe-sandbox-workflow');

const root = path.resolve(__dirname, '..');
const productionPath = path.join(root, 'n8n', 'Dietavity Sales Engine (Ticket 10).json');
const sandboxPath = path.join(root, 'n8n', 'Dietavity Stripe Checkout Sandbox.json');
const production = JSON.parse(fs.readFileSync(productionPath, 'utf8'));
const sandboxText = fs.readFileSync(sandboxPath, 'utf8');
const sandbox = JSON.parse(sandboxText);
const productionNodes = new Map(production.nodes.map(node => [node.name, node]));
const nodes = new Map(sandbox.nodes.map(node => [node.name, node]));

function outputs(name, index = 0) {
  return (sandbox.connections[name]?.main?.[index] || [])
    .map(connection => connection.node);
}

function reachableFrom(name) {
  const visited = new Set();
  const remaining = [name];
  while (remaining.length) {
    const current = remaining.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const output of sandbox.connections[current]?.main || []) {
      for (const connection of output || []) remaining.push(connection.node);
    }
  }
  return visited;
}

function executeNode(name, input, lookup = () => ({ item: { json: {} } })) {
  const runner = new Function('$input', '$', nodes.get(name).parameters.jsCode);
  return runner({ first: () => ({ json: input }) }, lookup)[0].json;
}

function stripeEvent(metadata, session = {}) {
  return {
    id: 'evt_test_ticket_24a',
    created: 1786046400,
    data: {
      object: {
        id: 'cs_test_ticket_24a',
        mode: 'payment',
        payment_status: 'paid',
        payment_intent: 'pi_test_ticket_24a',
        customer: 'cus_test_ticket_24a',
        customer_details: { email: 'customer@example.com' },
        amount_total: 14900,
        currency: 'mxn',
        metadata: {
          purchase_type: '28_day_program',
          program_version: '1',
          ...metadata,
        },
        ...session,
      },
    },
  };
}

test('dedicated sandbox workflow is inactive, isolated, import-safe, and synchronized', () => {
  assert.equal(sandbox.name, 'Dietavity Stripe Checkout Sandbox');
  assert.equal(sandbox.active, false);
  assert.equal(Object.hasOwn(sandbox, 'id'), false,
    'import must create a distinct workflow rather than overwrite production');
  assert.equal(sandbox.settings.errorWorkflow, production.settings.errorWorkflow);
  assert.equal(sandboxText, serialize(buildSandboxWorkflow(production)));

  const names = sandbox.nodes.map(node => node.name);
  const ids = sandbox.nodes.map(node => node.id);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(names.every(name => name.startsWith('Sandbox ')));

  for (const [source, group] of Object.entries(sandbox.connections)) {
    assert.ok(nodes.has(source), `Missing connection source: ${source}`);
    for (const output of group.main || []) {
      for (const connection of output || []) {
        assert.ok(nodes.has(connection.node), `Missing connection target: ${connection.node}`);
      }
    }
  }

  for (const node of sandbox.nodes) {
    const parameters = JSON.stringify(node.parameters);
    for (const reference of parameters.matchAll(/\$\(['"]([^'"]+)['"]\)/g)) {
      assert.ok(nodes.has(reference[1]),
        `${node.name} references missing workflow node: ${reference[1]}`);
    }
  }

  const triggers = sandbox.nodes.filter(node => /trigger|webhook/i.test(node.type));
  assert.deepEqual(triggers.map(node => node.name).sort(), [
    'Sandbox Start Authorized WhatsApp Checkout',
    'Sandbox Webhook Stripe Checkout',
  ]);
  assert.notEqual(nodes.get('Sandbox Webhook Stripe Checkout').webhookId,
    productionNodes.get('Webhook Stripe Checkout').webhookId);
  assert.equal(sandbox.nodes.some(node => node.type === 'n8n-nodes-base.twilioTrigger'), false);
  assert.equal(sandbox.nodes.some(node => node.type === 'n8n-nodes-base.scheduleTrigger'), false);
  assert.equal(sandbox.nodes.some(node => node.type === 'n8n-nodes-base.webhook'), false);
  assert.equal(nodes.has('Sandbox Stripe Cancel a Subscription'), false);
});

test('sandbox Stripe nodes use only test credentials, a test API key, and the test Price', () => {
  const webhook = nodes.get('Sandbox Webhook Stripe Checkout');
  assert.equal(webhook.type, 'n8n-nodes-base.stripeTrigger');
  assert.deepEqual(webhook.parameters.events, ['checkout.session.completed']);
  assert.deepEqual(webhook.credentials.stripeApi, { name: SANDBOX_CREDENTIAL_NAME });

  const checkout = nodes.get('Sandbox Stripe Checkout Session Payment');
  const authorization = checkout.parameters.headerParameters.parameters
    .find(parameter => parameter.name === 'Authorization');
  assert.equal(authorization.value, '=Bearer {{ $env.STRIPE_TEST_API_KEY }}');
  const checkoutParameters = Object.fromEntries(checkout.parameters.bodyParameters.parameters
    .map(({ name, value }) => [name, value]));
  assert.equal(checkoutParameters.mode, 'payment');
  assert.equal(checkoutParameters['line_items[0][price]'], SANDBOX_PRICE_ID);
  assert.equal(checkoutParameters['line_items[0][quantity]'], '1');
  assert.equal(checkoutParameters['metadata[purchase_type]'], '28_day_program');
  assert.equal(checkoutParameters['metadata[program_version]'], '1');
  assert.equal(checkoutParameters['metadata[whatsapp_id]'],
    '={{ $json.metadata.whatsapp_id }}');
  assert.equal(checkoutParameters['payment_intent_data[metadata][whatsapp_id]'],
    '={{ $json.metadata.whatsapp_id }}');
  assert.equal(checkoutParameters['metadata[lead_session_id]'],
    "={{ $('Sandbox Validate WhatsApp Checkout Input').item.json.session_id }}");

  const retrieve = nodes.get('Sandbox Retrieve Stripe Checkout Line Items');
  assert.equal(retrieve.parameters.authentication, 'predefinedCredentialType');
  assert.equal(retrieve.parameters.nodeCredentialType, 'stripeApi');
  assert.deepEqual(retrieve.credentials.stripeApi, { name: SANDBOX_CREDENTIAL_NAME });

  assert.doesNotMatch(sandboxText, /\bSTRIPE_API_KEY\b/);
  assert.doesNotMatch(sandboxText, /price_1U1QlXCVZMBOTTlaU1QD7FRT/);
  assert.doesNotMatch(sandboxText, /"name": "Stripe account"/);
  assert.doesNotMatch(sandboxText, /"id": "U1vXJ0j6ZSynmXZZ"/);
  for (const node of sandbox.nodes) {
    if (node.credentials?.stripeApi) {
      assert.deepEqual(node.credentials.stripeApi, { name: SANDBOX_CREDENTIAL_NAME });
    }
  }
});

test('operator Checkout fails closed and requires existing explicit or contextual authorization', () => {
  assert.deepEqual(outputs('Sandbox Start Authorized WhatsApp Checkout'), [
    'Sandbox Configure WhatsApp Checkout',
  ]);
  assert.deepEqual(outputs('Sandbox Configure WhatsApp Checkout'), [
    'Sandbox Validate WhatsApp Checkout Input',
  ]);
  assert.deepEqual(outputs('Sandbox Validate WhatsApp Checkout Input'), [
    'Sandbox Verify Existing Checkout Authorization',
  ]);
  assert.deepEqual(outputs('Sandbox Verify Existing Checkout Authorization'), [
    'Sandbox Add whatsapp_id',
  ]);
  assert.deepEqual(outputs('Sandbox Add whatsapp_id'), [
    'Sandbox Stripe Checkout Session Payment',
  ]);
  assert.deepEqual(outputs('Sandbox Stripe Checkout Session Payment'), [
    'Sandbox Persist Checkout Session Evidence v3',
  ]);
  assert.deepEqual(outputs('Sandbox Persist Checkout Session Evidence v3'), [
    'Sandbox Message with Stripe Payment URL',
  ]);

  const configured = nodes.get('Sandbox Configure WhatsApp Checkout')
    .parameters.assignments.assignments[0];
  assert.equal(configured.name, 'session_id');
  assert.equal(configured.value, '');
  for (const invalid of ['', 'website', '5512345678', '+52-55-1234-5678']) {
    assert.throws(() => executeNode('Sandbox Validate WhatsApp Checkout Input', {
      session_id: invalid,
    }), /SANDBOX_AUTHORIZED_WHATSAPP_SESSION_REQUIRED/);
  }
  assert.equal(executeNode('Sandbox Validate WhatsApp Checkout Input', {
    session_id: ' whatsapp: +52 55 1234 5678 ',
  }).session_id, '+525512345678');

  const gate = nodes.get('Sandbox Verify Existing Checkout Authorization');
  assert.equal(gate.type, 'n8n-nodes-base.postgres');
  assert.match(gate.parameters.query, /session\.session_id = input\.payload->>'session_id'/);
  assert.match(gate.parameters.query, /checkout_authorized_at IS NOT NULL/);
  assert.match(gate.parameters.query, /checkout_authorization_type IN \('explicit', 'contextual'\)/);
  assert.match(gate.parameters.query, /offer_version = '28d-149-v1'/);
  assert.match(gate.parameters.query, /checkout_session_id IS NULL/);
  assert.doesNotMatch(gate.parameters.query, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.equal(outputs('Sandbox Message with Stripe Payment URL').length, 0,
    'manual Checkout URLs must not bypass the canonical WhatsApp outbound ledger');
});

test('sandbox payment graph preserves production validation, persistence, and retry suppression', () => {
  assert.deepEqual(outputs('Sandbox Webhook Stripe Checkout'), [
    'Sandbox Normalize Stripe Checkout Event',
  ]);
  assert.deepEqual(outputs('Sandbox Switch Checkout Session Mode', 0), [
    'Sandbox Validate One-Time Payment Basics',
  ]);
  assert.deepEqual(outputs('Sandbox Switch Checkout Session Mode', 1), [
    'Sandbox Prepare Stripe Checkout Rejection',
  ]);
  assert.deepEqual(outputs('Sandbox If One-Time Payment Basics Valid', 0), [
    'Sandbox Retrieve Stripe Checkout Line Items',
  ]);
  assert.deepEqual(outputs('Sandbox If One-Time Payment Basics Valid', 1), [
    'Sandbox Prepare Stripe Checkout Rejection',
  ]);
  assert.deepEqual(outputs('Sandbox If Purchased Stripe Price Valid', 0), [
    'Sandbox Resolve User and Persist Purchase',
  ]);
  assert.deepEqual(outputs('Sandbox If Purchased Stripe Price Valid', 1), [
    'Sandbox Prepare Stripe Checkout Rejection',
  ]);
  assert.deepEqual(outputs('Sandbox If New Purchase Inserted', 0), [
    'Sandbox Mark Onboarding Session Subscriber',
  ]);
  assert.deepEqual(outputs('Sandbox If New Purchase Inserted', 1), [
    'Sandbox Log Duplicate Stripe Checkout',
  ]);

  const persistence = nodes.get('Sandbox Resolve User and Persist Purchase');
  assert.equal(persistence.parameters.query,
    productionNodes.get('Resolve User and Persist Purchase').parameters.query);
  assert.match(persistence.parameters.query, /ON CONFLICT \(whatsapp_id\) DO UPDATE/);
  assert.match(persistence.parameters.query, /ON CONFLICT \(stripe_checkout_session_id\) DO UPDATE/);
  assert.match(persistence.parameters.query, /target_purchase\.xmax = 0/);
  assert.match(persistence.parameters.query, /target_user\.whatsapp_id IS NULL/);
  assert.match(persistence.parameters.query, /'purchase_completed:' \|\| resolved_purchase\.stripe_checkout_session_id/);
  assert.doesNotMatch(persistence.parameters.query, /INSERT INTO public\.programs/);
  assert.equal(nodes.get('Sandbox Mark Onboarding Session Subscriber').parameters.query,
    productionNodes.get('Mark Onboarding Session Subscriber').parameters.query);

  assert.equal(reachableFrom('Sandbox Log Duplicate Stripe Checkout')
    .has('Sandbox Reserve Setup Link'), false);
  assert.equal(reachableFrom('Sandbox Prepare Stripe Checkout Rejection')
    .has('Sandbox Resolve User and Persist Purchase'), false);
});

test('sandbox WhatsApp purchase retains normalized identity and rejects unsafe payment variants', () => {
  const normalized = executeNode('Sandbox Normalize Stripe Checkout Event', stripeEvent({
    whatsapp_id: ' whatsapp: +52 55 1234 5678 ',
  }));

  assert.equal(normalized.checkout_session_id, 'cs_test_ticket_24a');
  assert.equal(normalized.whatsapp_id, '+525512345678');
  assert.equal(normalized.acquisition_source, 'whatsapp');
  assert.equal(normalized.user_id, '');
  assert.equal(executeNode('Sandbox Validate One-Time Payment Basics', normalized)
    .validation_valid, true);

  for (const mutation of [
    { whatsapp_id: '' },
    { acquisition_source: 'unknown' },
    { payment_status: 'unpaid' },
    { amount_total: 14899 },
    { currency: 'usd' },
    { purchase_type: 'subscription' },
    { program_version: '2' },
    { checkout_session_id: '' },
    { payment_intent_id: '' },
  ]) {
    assert.equal(executeNode('Sandbox Validate One-Time Payment Basics', {
      ...normalized,
      ...mutation,
    }).validation_valid, false, JSON.stringify(mutation));
  }
});

test('sandbox line-item verification accepts only the sandbox Price and one item', () => {
  const normalized = { checkout_session_id: 'cs_test_ticket_24a', whatsapp_id: '+525512345678' };
  const lookup = name => {
    assert.equal(name, 'Sandbox Normalize Stripe Checkout Event');
    return { item: { json: normalized } };
  };
  const valid = executeNode('Sandbox Verify Purchased Stripe Price', {
    data: [{ quantity: 1, price: { id: SANDBOX_PRICE_ID, product: 'prod_test_ticket_24a' } }],
  }, lookup);
  assert.equal(valid.price_validation_valid, true);
  assert.equal(valid.verified_price_id, SANDBOX_PRICE_ID);
  assert.equal(valid.verified_product_id, 'prod_test_ticket_24a');

  for (const invalid of [
    { data: [{ quantity: 1, price: { id: 'price_1U1QlXCVZMBOTTlaU1QD7FRT' } }] },
    { data: [{ quantity: 1, price: { id: 'price_test_unrelated' } }] },
    { data: [{ quantity: 2, price: { id: SANDBOX_PRICE_ID } }] },
    { data: [] },
    { data: [
      { quantity: 1, price: { id: SANDBOX_PRICE_ID } },
      { quantity: 1, price: { id: SANDBOX_PRICE_ID } },
    ] },
  ]) {
    assert.equal(executeNode('Sandbox Verify Purchased Stripe Price', invalid, lookup)
      .price_validation_valid, false, JSON.stringify(invalid));
  }
});

test('sandbox preserves nullable website identities and restricts Setup messages to WhatsApp', () => {
  const userId = crypto.randomUUID();
  const website = executeNode('Sandbox Normalize Stripe Checkout Event', stripeEvent({
    user_id: userId,
    acquisition_source: 'website',
  }));

  assert.equal(website.whatsapp_id, '');
  assert.equal(website.user_id, userId);
  assert.equal(executeNode('Sandbox Validate One-Time Payment Basics', website)
    .validation_valid, true);
  for (const mutation of [
    { user_id: '' },
    { user_id: 'not-a-uuid' },
    { whatsapp_id: '+525512345678' },
  ]) {
    assert.equal(executeNode('Sandbox Validate One-Time Payment Basics', {
      ...website,
      ...mutation,
    }).validation_valid, false, JSON.stringify(mutation));
  }

  assert.deepEqual(outputs('Sandbox Mark Onboarding Session Subscriber'), [
    'Sandbox If Customer Has WhatsApp',
  ]);
  assert.equal(nodes.get('Sandbox If Customer Has WhatsApp')
    .parameters.conditions.conditions[0].leftValue, '={{ Boolean($json.whatsapp_id) }}');
  assert.deepEqual(outputs('Sandbox If Customer Has WhatsApp', 0), [
    'Sandbox Reserve Setup Link',
  ]);
  assert.deepEqual(outputs('Sandbox If Customer Has WhatsApp', 1), []);
  assert.deepEqual(outputs('Sandbox Reserve Setup Link'), [
    'Sandbox Send 28-Day Program Setup Link',
  ]);
  assert.deepEqual(outputs('Sandbox Send 28-Day Program Setup Link'), [
    'Sandbox Update Setup Link Delivery',
  ]);
  assert.deepEqual(outputs('Sandbox Update Setup Link Delivery'), [
    'Sandbox Assert Setup Link Accepted',
  ]);
  assert.equal(nodes.get('Sandbox Reserve Setup Link').parameters.query,
    productionNodes.get('Reserve Setup Link').parameters.query);
  assert.match(nodes.get('Sandbox Reserve Setup Link').parameters.options.queryReplacement,
    /idempotency_key: 'setup:' \+ \$json\.stripe_checkout_session_id/);
  assert.deepEqual(nodes.get('Sandbox Send 28-Day Program Setup Link').parameters,
    productionNodes.get('Send 28-Day Program Setup Link').parameters);
});

test('production Stripe, website, Sales Engine, and legacy workflow nodes remain untouched', () => {
  assert.equal(production.name, 'Dietavity Sales Engine (Ticket 10)');
  assert.equal(production.active, false);
  assert.equal(productionNodes.get('Webhook Stripe Checkout').credentials.stripeApi.name,
    'Stripe account');
  assert.equal(productionNodes.get('Retrieve Stripe Checkout Line Items')
    .credentials.stripeApi.name, 'Stripe account');
  assert.match(JSON.stringify(productionNodes.get('LIVE Stripe Checkout Session Payment')),
    /STRIPE_API_KEY/);
  assert.match(productionNodes.get('Verify Purchased Stripe Price').parameters.jsCode,
    /price_1U1QlXCVZMBOTTlaU1QD7FRT/);

  for (const name of [...PURCHASE_NODE_NAMES, ...CHECKOUT_NODE_NAMES]) {
    assert.ok(productionNodes.has(name), `Missing production source node: ${name}`);
    assert.ok(nodes.has(sandboxName(name)), `Missing generated sandbox node: ${name}`);
  }

  assert.deepEqual(production.connections['Switch Checkout Session Mode'].main[1]
    .map(connection => connection.node), ['Restore Legacy Subscription Event']);
  assert.deepEqual(production.connections['Add whatsapp_id'].main[0]
    .map(connection => connection.node), ['LIVE Stripe Checkout Session Payment']);
  assert.equal(production.nodes.some(node => node.name.startsWith('Sandbox ')), false);
});
