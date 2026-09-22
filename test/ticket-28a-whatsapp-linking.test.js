'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  hasDeterministicPaidAccountRequest,
  hasDeterministicPortalRecoveryRequest,
} = require('../lib/sales-engine-v3');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root,
  'database/migrations/20260827_ticket_28a_pending_whatsapp_linking.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root,
  'database/rollback/20260827_ticket_28a_rollback.sql'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
const workflow = JSON.parse(fs.readFileSync(path.join(root,
  'n8n/Dietavity Sales Engine (Ticket 10).json'), 'utf8'));
const poller = JSON.parse(fs.readFileSync(path.join(root, 'n8n', 'Dietavity WhatsApp Recovery Poller.json'), 'utf8'));
const pollerNodes = new Map(poller.nodes.map(node => [node.name, node]));
const nodes = new Map(workflow.nodes.map(node => [node.name, node]));

function detect(message, user = {}) {
  const code = nodes.get('Detect Portal Recovery Request').parameters.jsCode;
  const lookup = name => ({ item: { json: name === 'Claim Next Session Inbound'
    ? { body: message }
    : user } });
  return new Function('$', code)(lookup)[0].json.identity_verification_purpose;
}

test('deterministic paid-context gate distinguishes account requests from prospect requests', () => {
  for (const message of [
    '¿Dónde está mi programa?', '¿Dónde veo mi plan?',
    '¿Cuándo empieza mi programa?', '¿Qué tengo de comida hoy?',
    '¿Qué tengo de cena?', '¿Me das la receta de mi comida?',
    '¿Me das la receta del pollo que tengo hoy?',
    '¿Dónde está mi lista del súper?', 'Quiero cambiar esta comida',
    'No puedo seguir esta comida hoy', '¿Qué puedo pedir según mi plan?'
  ]) assert.equal(hasDeterministicPaidAccountRequest(message), true, message);

  for (const message of [
    '¿Cuánto cuesta?', '¿Qué incluye?', '¿Cómo funciona?', '¿Aceptan OXXO?',
    '¿Es una suscripción?', 'Quiero comprarlo',
    '¿Me puedes dar una receta de pollo?', '¿Qué puedo cenar hoy?',
    '¿Dónde puedo comer saludable?'
  ]) assert.equal(hasDeterministicPaidAccountRequest(message), false, message);
});

test('workflow verifies unknown paid context, preserves sales, and bypasses linking for known customers', () => {
  assert.equal(detect('¿Qué tengo de cena?'), 'link_whatsapp');
  assert.equal(detect('¿Cuánto cuesta?'), null);
  assert.equal(detect('¿Me das una receta de pollo?'), null);
  assert.equal(detect('¿Qué tengo de cena?', { id: 'paid-user' }), null);
  assert.equal(detect('Perdí mi enlace', { id: 'paid-user' }), 'recover_portal');
  assert.equal(hasDeterministicPortalRecoveryRequest('Necesito entrar otra vez a mi programa'), true);

  assert.deepEqual(workflow.connections['If Portal Recovery Requested'].main[1]
    .map(connection => connection.node), ['Normalize User Data']);
});

test('Ticket 28 tables are generalized instead of creating a second token system', () => {
  assert.match(migration, /ALTER TABLE public\.portal_recovery_initiations/);
  assert.match(migration, /ALTER TABLE public\.portal_recovery_requests/);
  assert.match(migration, /purpose IN \('recover_portal', 'link_whatsapp'\)/);
  assert.match(migration, /pending_message_id uuid/);
  assert.match(migration, /REFERENCES public\.messages\(id\) ON DELETE SET NULL/);
  assert.doesNotMatch(migration, /CREATE TABLE/);
  assert.match(schema, /purpose text DEFAULT 'recover_portal'::text NOT NULL/);
  assert.match(schema, /identity_verification'::text/);
  assert.match(rollback, /retaining Ticket 28 portal recovery/);
});

test('ordinary linking preserves the portal credential and recovery still rotates it', () => {
  assert.match(migration, /IF target_request\.purpose = 'recover_portal'[\s\S]*SET portal_token = input_new_portal_token/);
  const linkBranch = migration.match(/ELSIF target_request\.purpose = 'link_whatsapp'[\s\S]*?END IF;/)?.[0] || '';
  assert.ok(linkBranch);
  assert.doesNotMatch(linkBranch, /SET portal_token/);
  assert.match(linkBranch, /identity_verification_state', 'verified'/);
  assert.match(migration, /resolved_link_status IN \('linked', 'already_linked'\)/);
  assert.match(migration, /conflict_target|conflict_identity/);
  assert.match(migration, /eligible_count <> 1/);
});

test('canonical pending messages are referenced, reused, and resumed through Ticket 17 ordering', () => {
  const initiation = nodes.get('Create WhatsApp Recovery Initiation').parameters.query;
  assert.match(initiation, /pending_message_id/);
  assert.match(initiation, /identity_verification_state', 'pending'/);
  assert.match(initiation, /portal_recovery_requests[\s\S]*request_reused/);
  assert.match(initiation, /WHERE NOT EXISTS \(SELECT 1 FROM active\)/);
  assert.doesNotMatch(initiation, /message\.body|user_message/);

  const finder = pollerNodes.get('Find Verified WhatsApp Sessions').parameters.query;
  assert.match(finder, /public\.messages/);
  assert.match(finder, /processing_completed_at IS NULL/);
  assert.match(finder, /identity_verification_state' = 'verified'/);
  assert.deepEqual(workflow.connections['Receive Verified WhatsApp Sessions'].main[0]
    .map(connection => connection.node), ['Claim Next Session Inbound']);
  assert.match(nodes.get('Claim Next Session Inbound').parameters.query,
    /ORDER BY message\.processing_order, message\.id/);
  assert.doesNotMatch(JSON.stringify(pollerNodes.get('Find Verified WhatsApp Sessions')), /body|email|portal_token/);
});

test('linking reply is deterministic, opaque, and canonical-ledger idempotent', () => {
  const prepare = nodes.get('Prepare Portal Recovery Reply').parameters.jsCode;
  assert.match(prepare, /Para ayudarte con tu programa necesitamos vincular este WhatsApp/);
  assert.match(prepare, /Usa el correo con el que realizaste tu compra/);
  assert.match(prepare, /request_reused/);
  const prepared = new Function('$input', '$', prepare)(
    { first: () => ({ json: { request_reused: false, recovery_url: 'https://dietavity.com/recuperar-acceso/iniciar/opaque' } }) },
    name => ({ item: { json: name === 'Detect Portal Recovery Request'
      ? { identity_verification_purpose: 'link_whatsapp' }
      : name === 'Claim Next Session Inbound'
        ? { session_id: '+525500000000' }
        : {} } }),
  )[0].json.body;
  assert.doesNotMatch(prepared, /¿|\?/);

  const reserve = nodes.get('Reserve Portal Recovery Reply');
  assert.match(reserve.parameters.query, /public\.messages/);
  assert.match(reserve.parameters.options.queryReplacement, /identity_verification/);
  assert.match(reserve.parameters.options.queryReplacement, /provider_message_sid/);
  assert.doesNotMatch(reserve.parameters.options.queryReplacement, /email|portal_token/);

  for (const [source, groups] of Object.entries(workflow.connections)) {
    assert.ok(nodes.has(source), `Missing source ${source}`);
    for (const group of groups.main || []) {
      for (const connection of group || []) {
        assert.ok(nodes.has(connection.node), `Missing target ${connection.node}`);
      }
    }
  }
});

test('server recognizes successful linking without issuing portal access', async () => {
  const serverPath = require.resolve('../server');
  const supabasePath = require.resolve('../lib/supabase');
  const mailerPath = require.resolve('../lib/portal-recovery-mailer');
  const supabase = {
    from() { throw new Error('unexpected table query'); },
    async rpc(name) {
      assert.equal(name, 'redeem_portal_recovery');
      return { data: [{
        portal_token: null,
        whatsapp_link_status: 'linked',
        verification_purpose: 'link_whatsapp',
        resume_scheduled: true,
      }], error: null };
    }
  };
  delete require.cache[serverPath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: supabase };
  require.cache[mailerPath] = { id: mailerPath, filename: mailerPath, loaded: true, exports: { sendPortalRecoveryEmail: async () => {} } };
  const app = require(serverPath);
  const layer = app.router.stack.find(candidate =>
    candidate.route?.path === '/recuperar-acceso/:token' && candidate.route.methods.get);
  const result = {};
  const response = {
    set() { return response; },
    status(code) { result.status = code; return response; },
    render(view, data) { result.status ||= 200; result.view = view; result.data = data; return response; },
    redirect(location) { result.status = 302; result.location = location; return response; }
  };
  await layer.route.stack[0].handle({ params: { token: 'b'.repeat(64) } }, response);
  assert.equal(result.status, 200);
  assert.equal(result.data.state, 'linked');
  assert.equal(result.location, undefined);
});
