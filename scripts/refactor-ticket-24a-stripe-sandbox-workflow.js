'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const productionPath = path.join(root, 'n8n', 'Dietavity Sales Engine (Ticket 10).json');
const sandboxPath = path.join(root, 'n8n', 'Dietavity Stripe Checkout Sandbox.json');
const SANDBOX_PRICE_ID = 'price_1U1SvtCXkbpCbNJI0sAqDeQF';
const SANDBOX_CREDENTIAL_NAME = 'Stripe Account Sandbox';

const PURCHASE_NODE_NAMES = [
  'Webhook Stripe Checkout',
  'Normalize Stripe Checkout Event',
  'Switch Checkout Session Mode',
  'Validate One-Time Payment Basics',
  'If One-Time Payment Basics Valid',
  'Retrieve Stripe Checkout Line Items',
  'Verify Purchased Stripe Price',
  'If Purchased Stripe Price Valid',
  'Resolve User and Persist Purchase',
  'If New Purchase Inserted',
  'Mark Onboarding Session Subscriber',
  'If Customer Has WhatsApp',
  'Reserve Setup Link',
  'Send 28-Day Program Setup Link',
  'Update Setup Link Delivery',
  'Assert Setup Link Accepted',
  'Prepare Stripe Checkout Rejection',
  'Log Stripe Checkout Rejection',
  'Log Duplicate Stripe Checkout',
];

const CHECKOUT_NODE_NAMES = [
  'Add whatsapp_id',
  'LIVE Stripe Checkout Session Payment',
  'Persist Checkout Session Evidence v3',
  'Message with Stripe Payment URL',
];

function stableUuid(label) {
  const bytes = crypto.createHash('sha256')
    .update(`dietavity-ticket-24a:${label}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sandboxName(name) {
  return name === 'LIVE Stripe Checkout Session Payment'
    ? 'Sandbox Stripe Checkout Session Payment'
    : `Sandbox ${name}`;
}

function remapNodeReferences(value, names) {
  let serialized = JSON.stringify(value);
  for (const [productionName, replacement] of names) {
    serialized = serialized.replaceAll(
      `$('${productionName}')`,
      `$('${replacement}')`,
    ).replaceAll(
      `$(\\\"${productionName}\\\")`,
      `$(\\\"${replacement}\\\")`,
    );
  }
  return JSON.parse(serialized);
}

function assertNode(workflow, name) {
  const node = workflow.nodes.find(candidate => candidate.name === name);
  if (!node) throw new Error(`Missing production workflow node: ${name}`);
  return node;
}

function buildSandboxWorkflow(production) {
  const sourceNames = [...PURCHASE_NODE_NAMES, ...CHECKOUT_NODE_NAMES];
  const renamed = new Map(sourceNames.map(name => [name, sandboxName(name)]));
  renamed.set('Set Session Id', 'Sandbox Validate WhatsApp Checkout Input');
  renamed.set('Persist Checkout Authorization v3', 'Sandbox Verify Existing Checkout Authorization');

  const nodes = sourceNames.map(name => {
    const copied = remapNodeReferences(structuredClone(assertNode(production, name)), renamed);
    copied.name = sandboxName(name);
    copied.id = stableUuid(`node:${name}`);
    return copied;
  });
  const byName = name => nodes.find(node => node.name === name);

  const sandboxWebhook = byName('Sandbox Webhook Stripe Checkout');
  sandboxWebhook.webhookId = stableUuid('webhook:stripe-checkout');
  sandboxWebhook.credentials = {
    stripeApi: { name: SANDBOX_CREDENTIAL_NAME },
  };

  const checkout = byName('Sandbox Stripe Checkout Session Payment');
  const authorizationHeader = checkout.parameters.headerParameters.parameters
    .find(parameter => parameter.name.toLowerCase() === 'authorization');
  if (!authorizationHeader) throw new Error('Production Checkout Authorization header is missing');
  authorizationHeader.value = '=Bearer {{ $env.STRIPE_TEST_API_KEY }}';

  const checkoutPrice = checkout.parameters.bodyParameters.parameters
    .find(parameter => parameter.name === 'line_items[0][price]');
  if (!checkoutPrice) throw new Error('Production Checkout Stripe Price is missing');
  const productionPriceId = checkoutPrice.value;
  checkoutPrice.value = SANDBOX_PRICE_ID;

  const lineItems = byName('Sandbox Retrieve Stripe Checkout Line Items');
  if (lineItems.parameters.nodeCredentialType !== 'stripeApi') {
    throw new Error('Production line-item retrieval no longer uses Stripe API credentials');
  }
  lineItems.credentials = {
    stripeApi: { name: SANDBOX_CREDENTIAL_NAME },
  };

  const verifyPrice = byName('Sandbox Verify Purchased Stripe Price');
  if (!verifyPrice.parameters.jsCode.includes(productionPriceId)) {
    throw new Error('Production Checkout and line-item Price verification are inconsistent');
  }
  verifyPrice.parameters.jsCode = verifyPrice.parameters.jsCode
    .replaceAll(productionPriceId, SANDBOX_PRICE_ID);

  const postgresCredentials = structuredClone(
    assertNode(production, 'Persist Checkout Authorization v3').credentials,
  );
  nodes.unshift(
    {
      parameters: {},
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [66000, 49520],
      id: stableUuid('node:manual-sandbox-checkout'),
      name: 'Sandbox Start Authorized WhatsApp Checkout',
      notes: 'Operator-only test entry. Configure an existing authorized test WhatsApp session before executing; never expose this path as a public webhook.',
    },
    {
      parameters: {
        assignments: {
          assignments: [{
            id: stableUuid('assignment:sandbox-whatsapp-session'),
            name: 'session_id',
            value: '',
            type: 'string',
          }],
        },
        options: {},
      },
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [66224, 49520],
      id: stableUuid('node:configure-sandbox-checkout'),
      name: 'Sandbox Configure WhatsApp Checkout',
      notes: 'Set session_id to an existing authorized test WhatsApp identity, such as its normalized +52... value. The empty default deliberately fails closed.',
    },
    {
      parameters: {
        jsCode: `const input = $input.first().json || {};
const sessionId = String(input.session_id || '')
  .trim()
  .replace(/^whatsapp:/i, '')
  .replace(/\\s+/g, '');

if (!/^\\+[1-9]\\d{7,14}$/.test(sessionId)) {
  throw new Error('SANDBOX_AUTHORIZED_WHATSAPP_SESSION_REQUIRED');
}

return [{ json: { ...input, session_id: sessionId } }];`,
      },
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [66448, 49520],
      id: stableUuid('node:validate-sandbox-whatsapp-checkout'),
      name: 'Sandbox Validate WhatsApp Checkout Input',
      notes: 'Reject empty, malformed, website-only, and non-WhatsApp checkout input before any Stripe request.',
    },
    {
      parameters: {
        operation: 'executeQuery',
        query: `WITH input AS (
  SELECT $1::jsonb AS payload
)
SELECT
  session.session_id,
  session.checkout_authorization_type,
  session.offer_version
FROM public.onboarding_sessions AS session
CROSS JOIN input
WHERE session.session_id = input.payload->>'session_id'
  AND session.checkout_authorized_at IS NOT NULL
  AND session.checkout_authorization_type IN ('explicit', 'contextual')
  AND session.offer_version = '28d-149-v1'
  AND session.checkout_session_id IS NULL;`,
        options: {
          queryReplacement: '={{ JSON.stringify($json) }}',
        },
      },
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [66672, 49520],
      id: stableUuid('node:verify-sandbox-checkout-authorization'),
      name: 'Sandbox Verify Existing Checkout Authorization',
      credentials: postgresCredentials,
      notes: 'Read-only production-equivalent authorization gate. Missing authorization or an existing Checkout Session emits no item and cannot create a duplicate sandbox session.',
    },
  );

  const selected = new Set(sourceNames);
  const connections = {};
  for (const sourceName of sourceNames) {
    const original = production.connections[sourceName];
    if (!original) continue;

    connections[sandboxName(sourceName)] = remapNodeReferences({
      ...structuredClone(original),
      main: (original.main || []).map(output => (output || [])
        .filter(connection => selected.has(connection.node))
        .map(connection => ({ ...connection, node: sandboxName(connection.node) }))),
    }, renamed);
  }

  // Recurring subscriptions are intentionally outside this isolated one-time
  // sandbox. Reject them through the existing production rejection/logging path.
  connections['Sandbox Switch Checkout Session Mode'].main[1] = [{
    node: 'Sandbox Prepare Stripe Checkout Rejection',
    type: 'main',
    index: 0,
  }];

  const connect = (source, target) => {
    connections[source] = {
      main: [[{ node: target, type: 'main', index: 0 }]],
    };
  };
  connect('Sandbox Start Authorized WhatsApp Checkout', 'Sandbox Configure WhatsApp Checkout');
  connect('Sandbox Configure WhatsApp Checkout', 'Sandbox Validate WhatsApp Checkout Input');
  connect('Sandbox Validate WhatsApp Checkout Input', 'Sandbox Verify Existing Checkout Authorization');
  connect('Sandbox Verify Existing Checkout Authorization', 'Sandbox Add whatsapp_id');

  return {
    name: 'Dietavity Stripe Checkout Sandbox',
    nodes,
    pinData: {},
    connections,
    active: false,
    settings: structuredClone(production.settings),
    versionId: stableUuid('workflow:version'),
    meta: { templateCredsSetupCompleted: true },
    nodeGroups: [],
    tags: [],
  };
}

function serialize(workflow) {
  return `${JSON.stringify(workflow, null, 2)}\n`;
}

function main() {
  const production = JSON.parse(fs.readFileSync(productionPath, 'utf8'));
  const generated = serialize(buildSandboxWorkflow(production));

  if (process.argv.includes('--check')) {
    const current = fs.existsSync(sandboxPath)
      ? fs.readFileSync(sandboxPath, 'utf8')
      : '';
    if (current !== generated) {
      console.error('Dietavity Stripe Checkout Sandbox.json is not synchronized with the current production workflow and Ticket 24A generator.');
      process.exitCode = 1;
    }
    return;
  }

  fs.writeFileSync(sandboxPath, generated);
  console.log(`Wrote ${path.relative(root, sandboxPath)}`);
}

if (require.main === module) main();

module.exports = {
  CHECKOUT_NODE_NAMES,
  PURCHASE_NODE_NAMES,
  SANDBOX_CREDENTIAL_NAME,
  SANDBOX_PRICE_ID,
  buildSandboxWorkflow,
  sandboxName,
  serialize,
};
