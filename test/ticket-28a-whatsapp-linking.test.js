'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
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

function reaches(start, target) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    for (const branch of workflow.connections[current]?.main || []) {
      for (const edge of branch || []) {
        if (edge.node === target) return true;
        if (!seen.has(edge.node)) {
          seen.add(edge.node);
          queue.push(edge.node);
        }
      }
    }
  }
  return false;
}

test('ordinary assistant messages never enter legacy recovery for unknown or known senders', () => {
  for (const message of [
    'mi programa', 'mi plan', 'qué tengo de cena', 'mi receta',
    'según mi plan', 'cómo se usa te digo mi comida',
  ]) {
    assert.equal(detect(message), null, `unknown sender: ${message}`);
    assert.equal(detect(message, { id: 'legacy-user' }), null, `known sender: ${message}`);
  }

  assert.equal(detect('Perdí mi enlace', { id: 'paid-user' }), 'recover_portal');
  assert.equal(detect('Perdí mi enlace'), 'recover_portal');
  assert.equal(hasDeterministicPortalRecoveryRequest('Necesito entrar otra vez a mi programa'), true);

  assert.deepEqual(workflow.connections['If Portal Recovery Requested'].main[1]
    .map(connection => connection.node), ['Normalize User Data']);
  assert.equal(reaches('Normalize User Data', 'Get Direct RAG Conversation History'), true);
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

test('historical pending WhatsApp links remain resumable through Ticket 17 ordering', () => {
  const finder = pollerNodes.get('Find Verified WhatsApp Sessions').parameters.query;
  assert.match(finder, /public\.messages/);
  assert.match(finder, /message\.direction = 'inbound'/);
  assert.match(finder, /processing_order IS NOT NULL/);
  assert.match(finder, /processing_completed_at IS NULL/);
  assert.match(finder, /processing_owner IS NULL/);
  assert.match(finder, /processing_lease_until <= NOW\(\)/);
  assert.deepEqual(workflow.connections['Receive Verified WhatsApp Sessions'].main[0]
    .map(connection => connection.node), ['Claim Next Session Inbound']);
  assert.match(nodes.get('Claim Next Session Inbound').parameters.query,
    /ORDER BY message\.processing_order, message\.id/);
  assert.doesNotMatch(JSON.stringify(pollerNodes.get('Find Verified WhatsApp Sessions')), /body|email|portal_token/);
});

test('new recovery replies are portal recovery only; no live route emits identity verification', () => {
  const prepare = nodes.get('Prepare Portal Recovery Reply').parameters.jsCode;
  assert.match(prepare, /Usa el correo con el que realizaste tu compra/);
  assert.match(prepare, /request_reused/);
  const prepared = new Function('$input', '$', prepare)(
    { first: () => ({ json: { request_reused: false, recovery_url: 'https://dietavity.com/recuperar-acceso/iniciar/opaque' } }) },
    name => ({ item: { json: name === 'Detect Portal Recovery Request'
      ? { identity_verification_purpose: 'recover_portal' }
      : name === 'Claim Next Session Inbound'
        ? { session_id: '+525500000000' }
        : {} } }),
  )[0].json.body;
  assert.doesNotMatch(prepared, /¿|\?/);

  const reserve = nodes.get('Reserve Portal Recovery Reply');
  assert.match(reserve.parameters.query, /public\.messages/);
  assert.match(reserve.parameters.options.queryReplacement, /message_kind: 'portal_recovery'/);
  assert.doesNotMatch(reserve.parameters.options.queryReplacement, /identity_verification/);
  assert.match(reserve.parameters.options.queryReplacement, /provider_message_sid/);
  assert.doesNotMatch(reserve.parameters.options.queryReplacement, /email|portal_token/);

  const detector = nodes.get('Detect Portal Recovery Request').parameters.jsCode;
  assert.doesNotMatch(detector, /link_whatsapp|hasDeterministicPaidAccountRequest|Get User from Supabase/);

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
