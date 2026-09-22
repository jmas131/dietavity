'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hasDeterministicPortalRecoveryRequest } = require('../lib/sales-engine-v3');

const root = path.resolve(__dirname, '..');
const serverPath = require.resolve('../server');
const supabasePath = require.resolve('../lib/supabase');
const mailerPath = require.resolve('../lib/portal-recovery-mailer');
const migration = fs.readFileSync(path.join(root,
  'database/migrations/20260827_ticket_28_portal_recovery.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root,
  'database/rollback/20260827_ticket_28_rollback.sql'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
const workflow = JSON.parse(fs.readFileSync(path.join(root,
  'n8n/Dietavity Sales Engine (Ticket 10).json'), 'utf8'));
const nodes = new Map(workflow.nodes.map(node => [node.name, node]));

function loadApp(rpcHandler) {
  const state = { rpcCalls: [], emails: [] };
  const supabase = {
    from() { throw new Error('Unexpected table query'); },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      return rpcHandler(name, args, state);
    }
  };
  const mailer = {
    async sendPortalRecoveryEmail(message) { state.emails.push(message); }
  };

  delete require.cache[serverPath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true, exports: supabase
  };
  require.cache[mailerPath] = {
    id: mailerPath, filename: mailerPath, loaded: true, exports: mailer
  };
  return { app: require(serverPath), state };
}

function routeHandler(app, method, routePath) {
  const layer = app.router.stack.find(candidate =>
    candidate.route?.path === routePath && candidate.route.methods[method]);
  assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle;
}

async function invoke(handler, request = {}) {
  const result = { headers: {} };
  const response = {
    status(code) { result.status = code; return response; },
    set(name, value) { result.headers[name] = value; return response; },
    render(view, data) { result.status ||= 200; result.view = view; result.data = data; return response; },
    redirect(location) { result.status = 302; result.location = location; return response; },
    send(body) { result.status ||= 200; result.body = body; return response; }
  };
  await handler({ body: {}, params: {}, query: {}, headers: {}, ip: '203.0.113.28', ...request }, response);
  await new Promise(resolve => setImmediate(resolve));
  return result;
}

function executeCodeNode(name, input) {
  const runner = new Function('$input', nodes.get(name).parameters.jsCode);
  return runner({ first: () => ({ json: input }) })[0].json;
}

test('schema adds non-unique email and backend-only durable hashed recovery state', () => {
  assert.match(migration, /ALTER TABLE public\.users ADD COLUMN email text/);
  assert.doesNotMatch(migration, /UNIQUE\s*\(\s*email\s*\)/i);
  assert.match(migration, /CREATE TABLE public\.portal_recovery_requests/);
  assert.match(migration, /token_hash text NOT NULL UNIQUE/);
  assert.match(migration, /ALTER TABLE public\.portal_recovery_requests ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL[\s\S]*FROM anon, authenticated/);
  const usersTable = schema.match(/CREATE\s+TABLE\s+public\.users\s*\(([\s\S]*?)^\s*\)\s*;/m);
  assert.ok(usersTable, 'Missing public.users table from canonical schema');
  assert.match(usersTable[1], /^\s*email\s+text\s*,?\s*$/m);
  assert.match(schema, /CREATE TABLE public\.portal_recovery_requests/);
  assert.match(rollback, /DROP TABLE IF EXISTS public\.portal_recovery_requests/);
  assert.doesNotMatch(rollback, /DELETE FROM public\.users|TRUNCATE/i);
});

test('database contract fails closed on ambiguity and unpaid users and rotates once transactionally', () => {
  assert.match(migration, /eligible_count <> 1/);
  assert.match(migration, /purchase\.payment_status = 'paid'/);
  assert.match(migration, /request\.used_at IS NULL/);
  assert.match(migration, /request\.expires_at > now\(\)/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /SET portal_token = input_new_portal_token/);
  assert.match(migration, /SET used_at = now\(\), whatsapp_link_status/);
  assert.match(migration, /conflict_target|conflict_identity/);
  assert.match(migration, /id <> target_request\.user_id/);
});

test('Stripe event persists conservatively normalized email for website and WhatsApp identities', () => {
  const event = {
    id: 'evt_28', created: 1787821200,
    data: { object: {
      id: 'cs_test_28', mode: 'payment', payment_status: 'paid',
      payment_intent: 'pi_28', customer: 'cus_28', amount_total: 14900,
      currency: 'mxn', customer_details: { email: ' Customer+Plan@Example.COM ' },
      metadata: { user_id: '00000000-0000-4000-8000-000000000028', acquisition_source: 'website', purchase_type: '28_day_program', program_version: '1' }
    } }
  };
  const normalized = executeCodeNode('Normalize Stripe Checkout Event', event);
  assert.equal(normalized.email, 'customer+plan@example.com');
  const sql = nodes.get('Resolve User and Persist Purchase').parameters.query;
  assert.match(sql, /website_user[\s\S]*email = input\.payload->>'email'/);
  assert.match(sql, /whatsapp_user[\s\S]*payload->>'email'/);
  assert.match(sql, /ON CONFLICT \(whatsapp_id\) DO UPDATE[\s\S]*email = EXCLUDED\.email/);
  assert.doesNotMatch(sql, /ON CONFLICT \(email\)|JOIN[^\n]+email/i);
});

test('public submission is generic and stores only hashes while eligible request emails a Dietavity URL', async () => {
  const eligible = loadApp(async name => ({ data: name === 'create_portal_recovery_request', error: null }));
  const handler = routeHandler(eligible.app, 'post', '/recuperar-acceso');
  const result = await invoke(handler, { body: { email: ' Customer@Example.COM ' } });
  assert.equal(result.status, 200);
  assert.equal(result.data.state, 'submitted');
  assert.match(result.headers['Cache-Control'], /no-store/);
  assert.equal(eligible.state.rpcCalls[0].args.input_email, 'customer@example.com');
  assert.match(eligible.state.rpcCalls[0].args.input_token_hash, /^[a-f0-9]{64}$/);
  assert.equal(eligible.state.emails.length, 1);
  assert.equal(eligible.state.emails[0].email, 'customer@example.com');
  assert.match(eligible.state.emails[0].recoveryUrl,
    /^https:\/\/dietavity\.com\/recuperar-acceso\/[a-f0-9]{64}$/);
  assert.doesNotMatch(eligible.state.emails[0].recoveryUrl, /customer|@|whatsapp|user_id/);

  const unknown = loadApp(async () => ({ data: false, error: null }));
  const unknownResult = await invoke(routeHandler(unknown.app, 'post', '/recuperar-acceso'), {
    body: { email: 'unknown@example.com' }, ip: '203.0.113.29'
  });
  assert.equal(unknownResult.status, result.status);
  assert.equal(unknownResult.view, result.view);
  assert.equal(unknownResult.data.state, result.data.state);
  assert.equal(unknown.state.emails.length, 0);
});

test('valid recovery redirects with only the newly rotated token and reuse fails', async () => {
  let redeemed = false;
  const { app, state } = loadApp(async (name, args) => {
    assert.equal(name, 'redeem_portal_recovery');
    if (redeemed) return { data: [], error: null };
    redeemed = true;
    return { data: [{ portal_token: args.input_new_portal_token, whatsapp_link_status: 'linked' }], error: null };
  });
  const handler = routeHandler(app, 'get', '/recuperar-acceso/:token');
  const rawToken = 'a'.repeat(64);
  const first = await invoke(handler, { params: { token: rawToken } });
  assert.equal(first.status, 302);
  assert.match(first.location, /^\/p\/[a-f0-9]{64}$/);
  assert.notEqual(first.location, `/p/${rawToken}`);
  assert.notEqual(state.rpcCalls[0].args.input_token_hash, rawToken);
  const second = await invoke(handler, { params: { token: rawToken } });
  assert.equal(second.status, 404);
  assert.equal(second.data.state, 'invalid');
});

test('WhatsApp access-loss recognition is deterministic and email claims alone are insufficient', () => {
  for (const message of [
    'Perdí mi enlace', 'No encuentro mi programa', '¿Cómo entro a mi programa?',
    'No encuentro el enlace de Dietavity', 'Necesito nuevamente mi acceso'
  ]) assert.equal(hasDeterministicPortalRecoveryRequest(message), true, message);
  assert.equal(hasDeterministicPortalRecoveryRequest('Mi correo es customer@example.com'), false);
  assert.equal(hasDeterministicPortalRecoveryRequest('Mándame el enlace para pagar'), false);

  assert.ok(nodes.has('Create WhatsApp Recovery Initiation'));
  const initiationSql = nodes.get('Create WhatsApp Recovery Initiation').parameters.query;
  assert.match(initiationSql, /extensions\.gen_random_bytes\(32\)/);
  assert.match(initiationSql, /extensions\.digest\(secret\.raw_token, 'sha256'\)/);
  assert.doesNotMatch(initiationSql, /initiating_whatsapp_id[^\n]+recovery_url/);
  const message = nodes.get('Prepare Portal Recovery Reply').parameters.jsCode;
  assert.match(message, /Usa el correo con el que realizaste tu compra/);
  assert.doesNotMatch(message, /portal_token|user_id.*row\.recovery_url/);
});
