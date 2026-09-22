const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorkflow } = require('../test-support/workflow-fixture');

const workflow = loadWorkflow();
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));

function outputs(name, index = 0) {
  return (workflow.connections[name]?.main?.[index] || []).map((connection) => connection.node);
}

function reachableFrom(start) {
  const visited = new Set();
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const output of workflow.connections[current]?.main || []) {
      for (const connection of output || []) queue.push(connection.node);
    }
  }
  return visited;
}

function bodyParameters(nodeName) {
  return Object.fromEntries(
    nodes.get(nodeName).parameters.bodyParameters.parameters.map(({ name, value }) => [name, value]),
  );
}

function executeCodeNode(nodeName, input, nodeLookup = () => ({ item: { json: {} } })) {
  const code = nodes.get(nodeName).parameters.jsCode;
  const runner = new Function('$input', '$', code);
  return runner({ first: () => ({ json: input }) }, nodeLookup)[0].json;
}

test('canonical development workflow is structurally valid and inactive before controlled import', () => {
  assert.equal(workflow.active, false);
  assert.ok(workflow.settings.errorWorkflow);

  const names = workflow.nodes.map((node) => node.name);
  const ids = workflow.nodes.map((node) => node.id);
  assert.equal(new Set(names).size, names.length, 'node names must be unique');
  assert.equal(new Set(ids).size, ids.length, 'node IDs must be unique');

  for (const [source, connectionGroup] of Object.entries(workflow.connections)) {
    assert.ok(nodes.has(source), `connection source must exist: ${source}`);
    for (const output of connectionGroup.main || []) {
      for (const connection of output || []) {
        assert.ok(nodes.has(connection.node), `connection target must exist: ${connection.node}`);
      }
    }
  }
});

test('active sales path uses only the one-time payment Checkout configuration', () => {
  assert.ok(nodes.has('LIVE Stripe Checkout Session Payment'));
  assert.ok(!nodes.has('LIVE Stripe Checkout Session Subscriptions'));
  assert.deepEqual(outputs('Add whatsapp_id'), ['LIVE Stripe Checkout Session Payment']);
  assert.deepEqual(outputs('LIVE Stripe Checkout Session Payment'), ['Persist Checkout Session Evidence v3']);
  assert.deepEqual(outputs('Persist Checkout Session Evidence v3'), ['Message with Stripe Payment URL']);
  assert.deepEqual(outputs('Message with Stripe Payment URL'), ['Respond to Chat Subscription']);
  assert.deepEqual(outputs('Respond to Chat Subscription'), ['Mark Checkout Sent v3']);

  const params = bodyParameters('LIVE Stripe Checkout Session Payment');
  assert.equal(params.mode, 'payment');
  assert.equal(params.success_url, 'https://dietavity.com/pago-exitoso?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(params.cancel_url, 'https://dietavity.com/pago-cancelado');
  assert.equal(params['line_items[0][price]'], 'price_1U1QlXCVZMBOTTlaU1QD7FRT');
  assert.equal(params['line_items[0][quantity]'], '1');
  assert.equal(params.customer_creation, 'if_required');
  assert.equal(params['metadata[whatsapp_id]'], '={{ $json.metadata.whatsapp_id }}');
  assert.equal(params['metadata[purchase_type]'], '28_day_program');
  assert.equal(params['metadata[program_version]'], '1');
  assert.equal(params['payment_intent_data[metadata][whatsapp_id]'], '={{ $json.metadata.whatsapp_id }}');
  assert.equal(params['payment_intent_data[metadata][purchase_type]'], '28_day_program');
  assert.equal(params['payment_intent_data[metadata][program_version]'], '1');
});

test('Stripe event normalization produces the stable normalized object', () => {
  const normalized = executeCodeNode('Normalize Stripe Checkout Event', {
    id: 'evt_1',
    created: 1786046400,
    data: {
      object: {
        id: 'cs_1',
        mode: 'PAYMENT',
        payment_status: 'PAID',
        payment_intent: { id: 'pi_1' },
        customer: 'cus_1',
        customer_details: { email: 'customer@example.com' },
        amount_total: 14900,
        currency: 'MXN',
        metadata: {
          whatsapp_id: ' whatsapp: +52 55 1234 5678 ',
          purchase_type: '28_day_program',
          program_version: '1',
        },
      },
    },
  });

  assert.equal(normalized.event_id, 'evt_1');
  assert.equal(normalized.checkout_session_id, 'cs_1');
  assert.equal(normalized.mode, 'payment');
  assert.equal(normalized.payment_status, 'paid');
  assert.equal(normalized.payment_intent_id, 'pi_1');
  assert.equal(normalized.customer_id, 'cus_1');
  assert.equal(normalized.amount_total, 14900);
  assert.equal(normalized.currency, 'mxn');
  assert.equal(normalized.whatsapp_id, '+525512345678');
  assert.equal(normalized.purchase_type, '28_day_program');
  assert.equal(normalized.program_version, '1');
  assert.ok(normalized.purchased_at.endsWith('Z'));
});

test('one-time basics reject unpaid, malformed, or wrong payment data', () => {
  const valid = {
    mode: 'payment',
    payment_status: 'paid',
    purchase_type: '28_day_program',
    program_version: '1',
    currency: 'mxn',
    email: 'customer@example.com',
    amount_total: 14900,
    whatsapp_id: '+525512345678',
    checkout_session_id: 'cs_1',
    payment_intent_id: 'pi_1',
    purchased_at: '2026-08-06T12:00:00.000Z',
  };
  assert.equal(executeCodeNode('Validate One-Time Payment Basics', valid).validation_valid, true);

  for (const mutation of [
    { payment_status: 'unpaid' },
    { amount_total: 14899 },
    { currency: 'usd' },
    { purchase_type: 'other' },
    { program_version: '2' },
    { whatsapp_id: '' },
    { checkout_session_id: '' },
    { payment_intent_id: '' },
  ]) {
    const result = executeCodeNode('Validate One-Time Payment Basics', { ...valid, ...mutation });
    assert.equal(result.validation_valid, false, JSON.stringify(mutation));
    assert.ok(result.validation_errors.length > 0);
  }
});

test('line-item verification requires the exact Price and quantity', () => {
  const normalized = { checkout_session_id: 'cs_1', whatsapp_id: '+525512345678' };
  const lookup = (name) => {
    assert.equal(name, 'Normalize Stripe Checkout Event');
    return { item: { json: normalized } };
  };
  const valid = executeCodeNode('Verify Purchased Stripe Price', {
    data: [{ quantity: 1, price: { id: 'price_1U1QlXCVZMBOTTlaU1QD7FRT', product: 'prod_1' } }],
  }, lookup);
  assert.equal(valid.price_validation_valid, true);
  assert.equal(valid.verified_price_id, 'price_1U1QlXCVZMBOTTlaU1QD7FRT');
  assert.equal(valid.verified_product_id, 'prod_1');

  const wrongPrice = executeCodeNode('Verify Purchased Stripe Price', {
    data: [{ quantity: 1, price: { id: 'price_wrong', product: 'prod_2' } }],
  }, lookup);
  assert.equal(wrongPrice.price_validation_valid, false);
});

test('line-item retrieval uses the n8n Stripe credential', () => {
  const node = nodes.get('Retrieve Stripe Checkout Line Items');
  assert.equal(node.parameters.authentication, 'predefinedCredentialType');
  assert.equal(node.parameters.nodeCredentialType, 'stripeApi');
  assert.equal(node.credentials.stripeApi.name, 'Stripe account');
  assert.doesNotMatch(JSON.stringify(node), /STRIPE_API_KEY/);
});

test('payment fulfillment is isolated from legacy questionnaire and program generation', () => {
  assert.deepEqual(outputs('Webhook Stripe Checkout'), ['Normalize Stripe Checkout Event']);
  assert.deepEqual(outputs('Switch Checkout Session Mode', 0), ['Validate One-Time Payment Basics']);
  assert.deepEqual(outputs('Switch Checkout Session Mode', 1), ['Restore Legacy Subscription Event']);
  assert.deepEqual(outputs('Switch Checkout Session Mode', 2), ['Prepare Stripe Checkout Rejection']);

  const paymentReachable = reachableFrom('Validate One-Time Payment Basics');
  for (const forbidden of [
    'Extract Metadata',
    'Create User Record',
    'Send Welcome New User',
    'Update User Ask Name',
    'Send Ask Name Again',
    'If Ask Name',
    'If User Name',
    'Update User Name',
    'Send Ask Diet',
    'Update User Ask Diet',
    'If Ask Diet',
    'Persist Preference General',
    'Initialize 28-Day Program',
    'Generate 28-Day Program Webhook',
    'Build Weekly Update Prompt',
  ]) {
    assert.ok(!paymentReachable.has(forbidden), `payment branch must not reach ${forbidden}`);
  }

  assert.ok(paymentReachable.has('Resolve User and Persist Purchase'));
  assert.ok(paymentReachable.has('Mark Onboarding Session Subscriber'));
  assert.ok(paymentReachable.has('Send 28-Day Program Setup Link'));
  assert.ok(paymentReachable.has('Log Stripe Checkout Rejection'));
});

test('atomic persistence reuses users and sessions without limiting purchases per user', () => {
  const sql = nodes.get('Resolve User and Persist Purchase').parameters.query;
  assert.match(sql, /INSERT INTO public\.users AS target_user/);
  assert.match(sql, /ON CONFLICT \(whatsapp_id\) DO UPDATE/);
  assert.match(sql, /SET whatsapp_id = EXCLUDED\.whatsapp_id/);
  assert.doesNotMatch(sql, /SET stripe_subscription_id/);
  assert.doesNotMatch(sql, /SET subscription_status/);
  assert.match(sql, /INSERT INTO public\.purchases AS target_purchase/);
  assert.match(sql, /ON CONFLICT \(stripe_checkout_session_id\) DO UPDATE/);
  assert.doesNotMatch(sql, /ON CONFLICT \(user_id\)/);
  assert.match(sql, /NULL,\n    input\.payload->>'checkout_session_id'/);
  assert.match(sql, /NULLIF\(input\.payload->>'verified_product_id', ''\)/);
  assert.match(sql, /NULLIF\(input\.payload->>'verified_price_id', ''\)/);
  assert.match(sql, /target_purchase\.xmax = 0/);
  assert.deepEqual(outputs('If New Purchase Inserted', 0), ['Mark Onboarding Session Subscriber']);
  assert.deepEqual(outputs('If New Purchase Inserted', 1), ['Log Duplicate Stripe Checkout']);
});

test('new purchases update an existing onboarding session without blocking fulfillment', () => {
  const updateNode = nodes.get('Mark Onboarding Session Subscriber');
  assert.ok(updateNode);
  assert.equal(updateNode.type, 'n8n-nodes-base.postgres');
  assert.equal(updateNode.parameters.operation, 'executeQuery');

  const sql = updateNode.parameters.query;
  assert.match(sql, /UPDATE public\.onboarding_sessions AS target_session/);
  assert.match(sql, /conversation_stage = NULL/);
  assert.match(sql, /updated_at = NOW\(\)/);
  assert.match(sql, /target_session\.session_id = input\.payload->>'whatsapp_id'/);
  assert.doesNotMatch(sql, /INSERT INTO public\.onboarding_sessions/);
  assert.match(sql, /EXISTS \(SELECT 1 FROM updated_session\) AS onboarding_session_updated/);
  assert.match(sql, /FROM input;$/);

  assert.deepEqual(outputs('Mark Onboarding Session Subscriber'), ['Send 28-Day Program Setup Link']);
  assert.deepEqual(outputs('If New Purchase Inserted', 1), ['Log Duplicate Stripe Checkout']);
  assert.ok(!reachableFrom('Log Duplicate Stripe Checkout').has('Mark Onboarding Session Subscriber'));
});

test('setup message uses the persisted user token and normalized destination', () => {
  const setupNode = nodes.get('Send 28-Day Program Setup Link');
  assert.equal(setupNode.parameters.to, '={{ $json.whatsapp_id }}');
  assert.equal(
    setupNode.parameters.message,
    '=🎉 ¡Tu pago fue confirmado!\n\nAhora completa tu perfil para preparar tu programa personalizado de 28 días:\n\n👉 https://dietavity.com/setup/{{ $json.portal_token }}',
  );
});

test('legacy subscription and cancellation branches remain connected', () => {
  assert.deepEqual(outputs('Restore Legacy Subscription Event'), ['Extract Metadata']);
  assert.deepEqual(outputs('Extract Metadata'), ['Create User Record']);
  assert.ok(!reachableFrom('Restore Legacy Subscription Event').has('Mark Onboarding Session Subscriber'));
  assert.deepEqual(outputs('Stripe Cancel a Subscription'), ['If Stripe Unsubscribe ']);
  assert.deepEqual(outputs('If Stripe Unsubscribe ', 0), ['Persist Legacy Cancellation']);
  assert.deepEqual(outputs('If Stripe Unsubscribe ', 1), ['Send Unsubscribe Unconfirmed Message']);
  assert.deepEqual(outputs('Persist Legacy Cancellation'), ['If Local Cancellation Persisted']);
  assert.deepEqual(outputs('If Local Cancellation Persisted', 0), ['Send Unsubscribe Message']);
  assert.deepEqual(outputs('If Local Cancellation Persisted', 1), ['Send Unsubscribe Unconfirmed Message']);
});
