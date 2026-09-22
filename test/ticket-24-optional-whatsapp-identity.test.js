'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const serverPath = require.resolve('../server');
const supabasePath = require.resolve('../lib/supabase');
const axiosPath = require.resolve('axios');
const migration = fs.readFileSync(path.join(
  root, 'database/migrations/20260824_ticket_24_optional_whatsapp_identity.sql',
), 'utf8');
const rollback = fs.readFileSync(path.join(
  root, 'database/rollback/20260824_ticket_24_rollback.sql',
), 'utf8');
const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
const workflow = JSON.parse(fs.readFileSync(path.join(
  root, 'n8n/Dietavity Sales Engine (Ticket 10).json',
), 'utf8'));
const nodes = new Map(workflow.nodes.map(node => [node.name, node]));
const originalStripeApiKey = process.env.STRIPE_API_KEY;
const originalGenerationWebhook = process.env.PROGRAM_GENERATION_WEBHOOK_URL;

test.after(() => {
  if (originalStripeApiKey === undefined) delete process.env.STRIPE_API_KEY;
  else process.env.STRIPE_API_KEY = originalStripeApiKey;

  if (originalGenerationWebhook === undefined) {
    delete process.env.PROGRAM_GENERATION_WEBHOOK_URL;
  } else {
    process.env.PROGRAM_GENERATION_WEBHOOK_URL = originalGenerationWebhook;
  }
});

function loadApp(initial = {}) {
  const state = {
    users: [...(initial.users || [])],
    purchases: [...(initial.purchases || [])],
    profiles: [...(initial.profiles || [])],
    programs: [...(initial.programs || [])],
    weeks: [...(initial.weeks || [])],
    meal_plans: [...(initial.meal_plans || [])],
    stripeCalls: [],
    generationCalls: [],
    setupEvents: new Map(),
    insertedUsers: [],
    failUserInsert: initial.failUserInsert || false,
    failPurchaseRead: initial.failPurchaseRead || false,
    stripeResponse: initial.stripeResponse || {
      id: 'cs_test_website_1',
      url: 'https://checkout.stripe.com/c/pay/cs_test_website_1',
    },
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.insertValues = null;
      this.updateValues = null;
      this.rowLimit = null;
    }

    select() { return this; }
    eq(field, value) { this.filters.push([field, value]); return this; }
    is(field, value) { this.filters.push([field, value]); return this; }
    limit(value) { this.rowLimit = value; return this; }
    order() { return this; }
    insert(values) { this.insertValues = values; return this; }
    update(values) { this.updateValues = values; return this; }

    rows() {
      const rows = (state[this.table] || []).filter(row =>
        this.filters.every(([field, value]) => row[field] === value),
      );
      return this.rowLimit === null ? rows : rows.slice(0, this.rowLimit);
    }

    async upsert(values) {
      const existing = state[this.table].find(row => row.user_id === values.user_id);
      if (existing) Object.assign(existing, values);
      else state[this.table].push({ ...values });
      return { data: null, error: null };
    }

    async single() {
      if (this.insertValues) {
        if (state.failUserInsert) {
          return { data: null, error: { message: 'user insert failed' } };
        }

        const user = { id: crypto.randomUUID(), ...this.insertValues };
        state.users.push(user);
        state.insertedUsers.push(user);
        return { data: user, error: null };
      }

      const row = this.rows()[0] || null;
      return row
        ? { data: row, error: null }
        : { data: null, error: { message: 'not found' } };
    }

    async maybeSingle() {
      if (this.table === 'purchases' && state.failPurchaseRead) {
        return { data: null, error: { message: 'database unavailable' } };
      }

      const row = this.rows()[0] || null;
      if (row && this.updateValues) Object.assign(row, this.updateValues);
      return { data: row, error: null };
    }
  }

  const supabase = {
    from(table) { return new Query(table); },
    async rpc(name, args) {
      assert.equal(name, 'persist_setup_completed_event');
      const created = !state.setupEvents.has(args.target_event_key);
      if (created) state.setupEvents.set(args.target_event_key, { ...args });
      return { data: created, error: null };
    },
  };

  const axios = {
    async post(url, body, options) {
      if (url === 'https://api.stripe.com/v1/checkout/sessions') {
        state.stripeCalls.push({ url, body, options });
        return { status: 200, data: state.stripeResponse };
      }

      state.generationCalls.push({ url, body, options });
      return { status: 202, data: {} };
    },
  };

  delete require.cache[serverPath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true, exports: supabase,
  };
  require.cache[axiosPath] = {
    id: axiosPath, filename: axiosPath, loaded: true, exports: axios,
  };

  return { app: require(serverPath), state };
}

function routeHandler(app, method, routePath) {
  const layer = app.router.stack.find(candidate =>
    candidate.route?.path === routePath && candidate.route.methods[method],
  );
  assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle;
}

async function invoke(handler, request = {}) {
  const result = { cookies: [] };
  const response = {
    status(code) { result.status = code; return response; },
    json(body) { result.status ||= 200; result.body = body; return response; },
    send(body) { result.status ||= 200; result.body = body; return response; },
    redirect(location) { result.status = 302; result.location = location; return response; },
    render(view, data) {
      result.status ||= 200;
      result.view = view;
      result.data = data;
      return response;
    },
    cookie(name, value, options) {
      result.cookies.push({ name, value, options });
      return response;
    },
  };

  await handler({ headers: {}, params: {}, query: {}, body: {}, ...request }, response);
  return result;
}

function executeNode(name, input) {
  const runner = new Function('$input', nodes.get(name).parameters.jsCode);
  return runner({ first: () => ({ json: input }) })[0].json;
}

function stripeEvent(metadata, overrides = {}) {
  return {
    id: 'evt_website_1',
    created: 1786046400,
    data: {
      object: {
        id: 'cs_test_website_1',
        mode: 'payment',
        payment_status: 'paid',
        payment_intent: 'pi_website_1',
        customer: 'cus_website_1',
        customer_details: { email: 'customer@example.com' },
        amount_total: 14900,
        currency: 'mxn',
        metadata: {
          purchase_type: '28_day_program',
          program_version: '1',
          ...metadata,
        },
        ...overrides,
      },
    },
  };
}

test('migration makes WhatsApp optional while retaining unique non-null identities', () => {
  assert.match(migration, /ALTER TABLE public\.users\s+ALTER COLUMN whatsapp_id DROP NOT NULL/);
  assert.doesNotMatch(migration, /DROP\s+(?:CONSTRAINT|INDEX|TABLE)|DELETE|UPDATE/i);
  assert.match(schema, /CREATE TABLE public\.users \([\s\S]*?\n    whatsapp_id text,/);
  assert.match(schema, /ADD CONSTRAINT users_whatsapp_id_key1 UNIQUE \(whatsapp_id\)/);
  assert.match(schema, /ADD CONSTRAINT users_portal_token_key UNIQUE \(portal_token\)/);
  assert.match(rollback, /ALTER COLUMN whatsapp_id SET NOT NULL/);
  assert.doesNotMatch(rollback, /^\s*(?:DELETE|UPDATE|DROP)\b/im);
});

test('website Checkout creates canonical customers without collecting phone or WhatsApp', async () => {
  process.env.STRIPE_API_KEY = 'sk_test_ticket_24';
  const { app, state } = loadApp();
  const result = await invoke(routeHandler(app, 'post', '/api/checkout'));

  assert.equal(result.status, 200);
  assert.equal(result.body.checkout_url, state.stripeResponse.url);
  assert.equal(state.users.length, 1);
  assert.equal(state.users[0].whatsapp_id, null);
  assert.match(state.users[0].id, /^[0-9a-f-]{36}$/);
  assert.match(state.users[0].portal_token, /^[a-f0-9]{64}$/);
  assert.equal(result.cookies[0].value, state.users[0].portal_token);
  assert.deepEqual(result.cookies[0].options, {
    httpOnly: true, secure: true, sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, path: '/',
  });

  const request = state.stripeCalls[0];
  const parameters = new URLSearchParams(request.body);
  assert.equal(parameters.get('metadata[user_id]'), state.users[0].id);
  assert.equal(parameters.get('metadata[acquisition_source]'), 'website');
  assert.equal(parameters.get('metadata[purchase_type]'), '28_day_program');
  assert.equal(parameters.get('metadata[program_version]'), '1');
  assert.equal(parameters.get('payment_intent_data[metadata][user_id]'), state.users[0].id);
  assert.equal(parameters.get('line_items[0][price]'), 'price_1U1QlXCVZMBOTTlaU1QD7FRT');
  assert.equal(parameters.get('success_url'),
    'https://dietavity.com/pago-exitoso?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(parameters.has('metadata[whatsapp_id]'), false);
  assert.equal(parameters.has('phone_number_collection[enabled]'), false);
  assert.doesNotMatch(request.body, /whatsapp|phone|portal_token/i);
  assert.equal(request.options.headers['Idempotency-Key'],
    `dietavity-website-checkout:${state.users[0].id}`);
  assert.deepEqual(Object.keys(result.body), ['checkout_url']);
});

test('website retries reuse the same canonical customer and Stripe idempotency key', async () => {
  process.env.STRIPE_API_KEY = 'sk_test_ticket_24';
  const { app, state } = loadApp();
  const handler = routeHandler(app, 'post', '/api/checkout');
  const first = await invoke(handler);
  const retry = await invoke(handler, {
    headers: { cookie: `${first.cookies[0].name}=${first.cookies[0].value}` },
  });

  assert.equal(retry.status, 200);
  assert.equal(state.insertedUsers.length, 1);
  assert.equal(state.stripeCalls.length, 2);
  assert.equal(
    state.stripeCalls[0].options.headers['Idempotency-Key'],
    state.stripeCalls[1].options.headers['Idempotency-Key'],
  );
});

test('distinct website visitors receive distinct users with null WhatsApp identities', async () => {
  process.env.STRIPE_API_KEY = 'sk_test_ticket_24';
  const { app, state } = loadApp();
  const handler = routeHandler(app, 'post', '/api/checkout');

  await invoke(handler);
  await invoke(handler);

  assert.equal(state.users.length, 2);
  assert.equal(state.users[0].whatsapp_id, null);
  assert.equal(state.users[1].whatsapp_id, null);
  assert.notEqual(state.users[0].id, state.users[1].id);
  assert.notEqual(state.users[0].portal_token, state.users[1].portal_token);
});

test('website Checkout fails closed before Stripe when credentials or user persistence fail', async () => {
  delete process.env.STRIPE_API_KEY;
  const missingKey = loadApp();
  const missingKeyResult = await invoke(routeHandler(
    missingKey.app, 'post', '/api/checkout',
  ));
  assert.equal(missingKeyResult.status, 503);
  assert.equal(missingKey.state.users.length, 0);
  assert.equal(missingKey.state.stripeCalls.length, 0);

  process.env.STRIPE_API_KEY = 'sk_test_ticket_24';
  const failedUser = loadApp({ failUserInsert: true });
  const failedUserResult = await invoke(routeHandler(
    failedUser.app, 'post', '/api/checkout',
  ));
  assert.equal(failedUserResult.status, 502);
  assert.equal(failedUser.state.stripeCalls.length, 0);
});

test('website Checkout rejects unusable Stripe URLs without disclosing customer identity', async () => {
  process.env.STRIPE_API_KEY = 'sk_test_ticket_24';
  const { app, state } = loadApp({
    stripeResponse: { id: 'cs_test_bad', url: 'https://example.test/not-stripe' },
  });

  const result = await invoke(routeHandler(app, 'post', '/api/checkout'));
  assert.equal(result.status, 502);
  assert.equal(state.users.length, 1);
  assert.doesNotMatch(JSON.stringify(result.body), new RegExp(state.users[0].portal_token));
});

test('paid website success redirects directly to existing token-authenticated Setup', async () => {
  const user = {
    id: crypto.randomUUID(), whatsapp_id: null,
    portal_token: crypto.randomBytes(32).toString('hex'),
  };
  const { app } = loadApp({
    users: [user],
    purchases: [{
      user_id: user.id, payment_status: 'paid',
      stripe_checkout_session_id: 'cs_test_website_1',
    }],
  });

  const result = await invoke(routeHandler(app, 'get', '/pago-exitoso'), {
    query: { session_id: 'cs_test_website_1' },
  });
  assert.equal(result.status, 302);
  assert.equal(result.location, `/setup/${user.portal_token}`);
});

test('success redirect waits for durable payment evidence without requiring WhatsApp', async () => {
  const { app } = loadApp();
  const result = await invoke(routeHandler(app, 'get', '/pago-exitoso'), {
    query: { session_id: 'cs_test_website_1' },
  });
  const html = await ejs.renderFile(path.join(root, 'views/success.ejs'), result.data);

  assert.equal(result.status, 200);
  assert.equal(result.data.paymentPending, true);
  assert.match(html, /Estamos confirmando tu pago/);
  assert.match(html, /http-equiv="refresh" content="3"/);
  assert.doesNotMatch(html, /Volver a WhatsApp|wa\.me/);

  const unpaid = loadApp({
    purchases: [{
      user_id: crypto.randomUUID(), payment_status: 'unpaid',
      stripe_checkout_session_id: 'cs_test_website_1',
    }],
  });
  const unpaidResult = await invoke(routeHandler(unpaid.app, 'get', '/pago-exitoso'), {
    query: { session_id: 'cs_test_website_1' },
  });
  assert.equal(unpaidResult.data.paymentPending, true);
});

test('existing WhatsApp customers retain the established payment success page', async () => {
  const user = {
    id: crypto.randomUUID(), whatsapp_id: '+525512345678', portal_token: 'legacy-token',
  };
  const { app } = loadApp({
    users: [user],
    purchases: [{
      user_id: user.id, payment_status: 'paid',
      stripe_checkout_session_id: 'cs_test_whatsapp_1',
    }],
  });

  const result = await invoke(routeHandler(app, 'get', '/pago-exitoso'), {
    query: { session_id: 'cs_test_whatsapp_1' },
  });
  const html = await ejs.renderFile(path.join(root, 'views/success.ejs'), result.data);
  assert.equal(result.status, 200);
  assert.match(html, /¡Pago confirmado!/);
  assert.match(html, /Volver a WhatsApp/);
});

test('malformed sessions and payment database failures remain controlled errors', async () => {
  const app = loadApp().app;
  const invalid = await invoke(routeHandler(app, 'get', '/pago-exitoso'), {
    query: { session_id: 'not-a-stripe-session' },
  });
  assert.equal(invalid.status, 400);

  const failed = loadApp({ failPurchaseRead: true });
  const unavailable = await invoke(routeHandler(failed.app, 'get', '/pago-exitoso'), {
    query: { session_id: 'cs_test_website_1' },
  });
  assert.equal(unavailable.status, 500);
});

test('signed Stripe metadata validates canonical website identity without WhatsApp', () => {
  const userId = crypto.randomUUID();
  const website = executeNode('Normalize Stripe Checkout Event', stripeEvent({
    user_id: userId, acquisition_source: 'website',
  }));

  assert.equal(website.user_id, userId);
  assert.equal(website.acquisition_source, 'website');
  assert.equal(website.whatsapp_id, '');
  assert.equal(executeNode('Validate One-Time Payment Basics', website).validation_valid, true);

  for (const mutation of [
    { user_id: '' },
    { user_id: 'not-a-uuid' },
    { whatsapp_id: '+525512345678' },
    { acquisition_source: 'unknown' },
    { payment_status: 'unpaid' },
    { amount_total: 14899 },
  ]) {
    const result = executeNode('Validate One-Time Payment Basics', { ...website, ...mutation });
    assert.equal(result.validation_valid, false, JSON.stringify(mutation));
  }
});

test('existing WhatsApp Stripe metadata remains valid and cannot omit channel identity', () => {
  const existing = executeNode('Normalize Stripe Checkout Event', stripeEvent({
    whatsapp_id: ' whatsapp: +52 55 1234 5678 ',
  }));
  assert.equal(existing.acquisition_source, 'whatsapp');
  assert.equal(existing.user_id, '');
  assert.equal(existing.whatsapp_id, '+525512345678');
  assert.equal(executeNode('Validate One-Time Payment Basics', existing).validation_valid, true);

  const missing = executeNode('Validate One-Time Payment Basics', {
    ...existing, whatsapp_id: '',
  });
  assert.equal(missing.validation_valid, false);
});

test('payment persistence binds website purchases to the existing user and remains idempotent', () => {
  const sql = nodes.get('Resolve User and Persist Purchase').parameters.query;

  assert.match(sql, /website_user AS \([\s\S]*?UPDATE public\.users AS target_user/);
  assert.match(sql, /target_user\.id = NULLIF\(input\.payload->>'user_id', ''\)::uuid/);
  assert.match(sql, /target_user\.whatsapp_id IS NULL/);
  assert.match(sql, /NULLIF\(target_user\.portal_token, ''\) IS NOT NULL/);
  assert.match(sql, /whatsapp_user AS \([\s\S]*?INSERT INTO public\.users AS target_user/);
  assert.match(sql, /ON CONFLICT \(whatsapp_id\) DO UPDATE/);
  assert.match(sql, /1 \/ COUNT\(\*\)::integer AS resolution_valid/);
  assert.match(sql, /FROM user_resolution_assertion\s+LEFT JOIN resolved_user ON TRUE/);
  assert.match(sql, /ON CONFLICT \(stripe_checkout_session_id\) DO UPDATE/);
  assert.match(sql, /target_purchase\.xmax = 0/);
  assert.match(sql, /'purchase_completed:' \|\| resolved_purchase\.stripe_checkout_session_id/);
  assert.match(sql, /ON CONFLICT \(event_key\) WHERE event_key IS NOT NULL DO NOTHING/);
  assert.doesNotMatch(sql, /website-user|no-whatsapp|0000000000/);
});

test('website fulfillment never reserves a WhatsApp message or calls Twilio', () => {
  const outputs = name => workflow.connections[name]?.main || [];
  const channelRouter = nodes.get('If Customer Has WhatsApp');

  assert.equal(workflow.active, false);
  assert.deepEqual(outputs('Mark Onboarding Session Subscriber')[0].map(item => item.node), [
    'If Customer Has WhatsApp',
  ]);
  assert.equal(channelRouter.parameters.conditions.conditions[0].leftValue,
    '={{ Boolean($json.whatsapp_id) }}');
  assert.deepEqual(outputs('If Customer Has WhatsApp')[0].map(item => item.node), [
    'Reserve Setup Link',
  ]);
  assert.deepEqual(outputs('If Customer Has WhatsApp')[1], []);
  assert.deepEqual(outputs('If New Purchase Inserted')[1].map(item => item.node), [
    'Log Duplicate Stripe Checkout',
  ]);
});

test('website users complete Setup, generate their program, and persist a nullable event', async () => {
  process.env.PROGRAM_GENERATION_WEBHOOK_URL = 'https://example.test/generate';
  const user = {
    id: crypto.randomUUID(), whatsapp_id: null,
    portal_token: crypto.randomBytes(32).toString('hex'), name: null,
  };
  const { app, state } = loadApp({ users: [user] });

  const setupPage = await invoke(routeHandler(app, 'get', '/setup/:portal_token'), {
    params: { portal_token: user.portal_token },
  });
  assert.equal(setupPage.status, 200);
  assert.equal(setupPage.data.user.id, user.id);
  assert.equal(setupPage.data.user.whatsapp_id, null);

  const completed = await invoke(routeHandler(app, 'post', '/setup/:portal_token'), {
    params: { portal_token: user.portal_token },
    body: { name: 'Ana', sensitive_data_consent: 'true' },
  });
  assert.equal(completed.status, 302);
  assert.equal(completed.location, `/p/${user.portal_token}`);
  assert.equal(state.profiles[0].user_id, user.id);
  assert.equal(state.generationCalls.length, 1);
  assert.deepEqual(state.generationCalls[0].body, { id: user.id });
  assert.deepEqual([...state.setupEvents.values()], [{
    target_session_id: null,
    target_user_id: user.id,
    target_event_key: `setup_completed:${user.id}:2026-08-11`,
  }]);

  const generationSql = nodes.get('Initialize 28-Day Program').parameters.query;
  assert.match(generationSql, /WHERE u\.id = '\{\{ \$json\.id \}\}'::uuid/);
  assert.match(generationSql, /purchase\.user_id = program\.user_id/);
  assert.match(generationSql, /purchase\.payment_status = 'paid'/);
  assert.doesNotMatch(generationSql, /whatsapp_id/);
});
