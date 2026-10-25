'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(
  root, 'n8n', 'Dietavity Sales Engine (Ticket 10).json'
), 'utf8'));
const weekly = JSON.parse(fs.readFileSync(path.join(root, 'n8n', 'Dietavity Weekly Report.json'), 'utf8'));
const migration = fs.readFileSync(path.join(
  root, 'database', 'migrations', '20260814_ticket_9_canonical_message_ledger.sql'
), 'utf8');
const preflight = fs.readFileSync(path.join(root, 'database', 'preflight-ticket-9.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(
  root, 'database', 'rollback', '20260814_ticket_9_rollback.sql'
), 'utf8');
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));

function outputs(name, index = 0) {
  return (workflow.connections[name]?.main?.[index] || []).map((connection) => connection.node);
}

function predecessors(target) {
  const result = [];
  for (const [source, groups] of Object.entries(workflow.connections)) {
    for (const group of groups.main || []) {
      if ((group || []).some((connection) => connection.node === target)) result.push(source);
    }
  }
  return result;
}

test('migration extends messages as the backend-only canonical ledger', () => {
  for (const column of [
    'session_id text', 'body text', 'message_kind text', 'provider text',
    'provider_message_sid text', 'idempotency_key text', 'in_reply_to_id uuid',
    'delivery_status text', "metadata jsonb NOT NULL DEFAULT '{}'::jsonb",
  ]) assert.match(migration, new RegExp(column.replace(/[()]/g, '\\$&')));

  assert.match(migration, /messages_provider_sid_uidx[\s\S]*\(provider, provider_message_sid\)[\s\S]*WHERE provider_message_sid IS NOT NULL/);
  assert.match(migration, /messages_idempotency_key_uidx[\s\S]*\(idempotency_key\)[\s\S]*WHERE idempotency_key IS NOT NULL/);
  assert.match(migration, /messages_session_timestamp_idx/);
  assert.match(migration, /messages_user_timestamp_idx/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.messages FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /GRANT .*public\.messages TO (?:anon|authenticated)/);
});

test('historical backfill is conservative and privacy deletion semantics remain explicit', () => {
  assert.match(migration, /WHEN direction = 'inbound' THEN NULLIF\(user_message, ''\)/);
  assert.match(migration, /WHEN direction = 'outbound' THEN NULLIF\(assistant_response, ''\)/);
  assert.match(migration, /delivery_status = COALESCE\(delivery_status, 'unknown'\)/);
  assert.doesNotMatch(migration, /onboarding_chat_memory[\s\S]*(?:INSERT INTO|UPDATE) public\.messages/i);
  assert.match(rollback, /Do not drop Ticket 9 columns or indexes/);
  assert.doesNotMatch(rollback, /DROP (?:COLUMN|TABLE)|DELETE FROM|TRUNCATE/i);
});

test('a real Twilio SID is mandatory and n8n execution identity is metadata only', () => {
  const source = nodes.get('Canonicalize Inbound WhatsApp').parameters.jsCode;
  assert.match(source, /\^\(SM\|MM\)\[0-9a-fA-F\]\{32\}\$/);
  assert.doesNotMatch(source, /provider_message_sid[^\n]*\$execution\.id/);
  assert.match(source, /workflow_execution_id: \$execution\.id/);

  const execute = (data) => vm.runInNewContext(`(function () { ${source} })()`, {
    $input: { first: () => ({ json: { data } }) },
    $execution: { id: 'n8n-execution-123' },
  });
  assert.throws(() => execute({ from: 'whatsapp:+5215551234567', body: 'Hola' }), /MISSING_REAL_TWILIO/);
  const sid = `SM${'a'.repeat(32)}`;
  const result = execute({ from: 'whatsapp:+52 1 555 123 4567', body: ' Hola ', messageSid: sid })[0].json;
  assert.equal(result.session_id, '+5215551234567');
  assert.equal(result.body, 'Hola');
  assert.equal(result.provider_message_sid, sid);
  assert.equal(result.idempotency_key, `inbound:${sid}`);
});

test('inbound reservation is the shared concurrency gate before routing or side effects', () => {
  assert.deepEqual(outputs('Incoming Message'), ['Canonicalize Inbound WhatsApp']);
  assert.deepEqual(outputs('Canonicalize Inbound WhatsApp'), ['Reserve Canonical Inbound Message']);
  assert.deepEqual(outputs('Reserve Canonical Inbound Message'), ['Claim Next Session Inbound']);
  assert.deepEqual(outputs('Route Session Claim State', 0), ['Get V4 Conversation Context']);
  const sql = nodes.get('Reserve Canonical Inbound Message').parameters.query;
  assert.match(sql, /INSERT INTO public\.messages/);
  assert.match(sql, /ON CONFLICT \(idempotency_key\)[\s\S]*DO NOTHING/);
  assert.match(sql, /'received'/);
  assert.match(sql, /SELECT app_user\.id[\s\S]*app_user\.whatsapp_id/);
  assert.ok(!nodes.has('Create Inbound Message '));
});

test('every Twilio customer send has a durable reservation and delivery update', () => {
  const sends = workflow.nodes.filter((node) => (
    node.type === 'n8n-nodes-base.twilio'
    || node.name === 'Schedule Requested WhatsApp Reminder'
  ));
  assert.ok(sends.length >= 10);
  for (const send of sends) {
    const incoming = predecessors(send.name);
    assert.equal(incoming.length, 1, send.name);
    const multipartReservations = new Map([
      ['Loop Paid WhatsApp Parts', 'Reserve Paid Assistant Reply'],
      ['Loop V4 WhatsApp Parts', 'Reserve V4 Reply With Memory'],
    ]);
    const reservationName = multipartReservations.get(incoming[0]) || incoming[0];
    if (multipartReservations.has(incoming[0])) {
      assert.deepEqual(outputs(reservationName), [incoming[0]]);
      assert.deepEqual(outputs(incoming[0], 1), [send.name]);
      assert.deepEqual(nodes.get(incoming[0]).parameters, { options: {} });
    }
    assert.match(reservationName, /^Reserve /, send.name);
    const outgoing = outputs(send.name);
    assert.equal(outgoing.length, 1, send.name);
    assert.match(outgoing[0], /^Update .* Delivery$/, send.name);
    assert.equal(send.onError, 'continueRegularOutput', send.name);
    assert.equal(send.retryOnFail, false, send.name);
    const reserveSql = nodes.get(reservationName).parameters.query;
    if (reservationName === 'Reserve V4 Reply With Memory') {
      assert.match(reserveSql, /reserve_conversation_v4_reply_with_memory/, send.name);
    } else {
      assert.match(reserveSql, /ON CONFLICT \(idempotency_key\)[\s\S]*DO NOTHING/, send.name);
      assert.match(reserveSql, /delivery_status[\s\S]*'pending'/, send.name);
    }
  }
});

test('Twilio sends consume the canonical reservation row payload', () => {
  const sends = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.twilio');
  assert.ok(sends.length >= 9);
  for (const send of sends) {
    assert.equal(send.parameters.to, '={{ $json.session_id }}', send.name);
    assert.equal(send.parameters.message, '={{ $json.body }}', send.name);
  }

  const scheduled = nodes.get('Schedule Requested WhatsApp Reminder');
  const scheduledTo = scheduled.parameters.bodyParameters.parameters.find(
    (parameter) => parameter.name === 'To'
  );
  assert.equal(scheduledTo.value, '=whatsapp:{{ $json.session_id }}');

  const sales = nodes.get('Respond to Chat');
  assert.equal(sales.parameters.message, '={{ $json.body }}');
  assert.doesNotMatch(JSON.stringify(sales.parameters), /\$json\.output/);
});

test('final deterministic and Checkout text is reserved after construction', () => {
  assert.deepEqual(outputs('Validate Sales Response Contract'), ['Build Sales Response Persistence Envelope']);
  assert.deepEqual(outputs('Build Sales Response Persistence Envelope'), ['Reserve Sales Reply']);
  assert.deepEqual(outputs('Message with Stripe Payment URL'), ['Reserve Checkout Reply']);
  assert.deepEqual(outputs('Parse Assistant Response'), ['Prepare Paid WhatsApp Message Parts']);
  assert.deepEqual(outputs('Build Deterministic Customer Response'), ['Prepare Paid WhatsApp Message Parts']);
  assert.deepEqual(outputs('Prepare Paid WhatsApp Message Parts'), ['Reserve Paid Assistant Reply']);

  const salesPayload = nodes.get('Reserve Sales Reply').parameters.options.queryReplacement;
  assert.match(salesPayload, /body: \$json\.output/);
  assert.match(salesPayload, /sales_deterministic/);
  const checkoutPayload = nodes.get('Reserve Checkout Reply').parameters.options.queryReplacement;
  assert.match(checkoutPayload, /body: \[.*checkout_question_response, \$json\.message\]\.filter\(Boolean\)\.join/);
  assert.match(nodes.get('Respond to Chat Subscription').parameters.message, /body/);
  assert.match(checkoutPayload, /checkout_session_id/);
  assert.match(checkoutPayload, /reply:.*:checkout/);
});

test('Checkout retries stop before Stripe and checkout_sent still means Twilio acceptance', () => {
  const inboundSql = nodes.get('Reserve Canonical Inbound Message').parameters.query;
  assert.match(inboundSql, /ON CONFLICT/);
  assert.deepEqual(predecessors('LIVE Stripe Checkout Session Payment'), ['Add whatsapp_id']);
  assert.deepEqual(outputs('Respond to Chat Subscription'), ['Update Checkout Reply Delivery']);
  assert.deepEqual(outputs('Update Checkout Reply Delivery'), ['Assert Checkout Reply Accepted']);
  assert.deepEqual(outputs('Assert Checkout Reply Accepted'), ['Mark Checkout Sent v3']);
  assert.match(nodes.get('Mark Checkout Sent v3').parameters.query, /checkout_sent:/);
});

test('delivery failures are retained, classified, and never blindly retried', () => {
  const updateNodes = workflow.nodes.filter((node) => /^Update .* Delivery$/.test(node.name));
  assert.ok(updateNodes.length >= 10);
  for (const update of updateNodes) {
    assert.match(update.parameters.query, /THEN 'failed'/, update.name);
    assert.match(update.parameters.query, /ELSE 'unknown'/, update.name);
    assert.match(update.parameters.query, /WHERE message\.idempotency_key/, update.name);
    assert.doesNotMatch(update.parameters.query, /DELETE/i, update.name);
    const assertion = outputs(update.name)[0];
    assert.match(nodes.get(assertion).parameters.jsCode, /REQUIRES_RECONCILIATION/, update.name);
  }
  assert.doesNotMatch(JSON.stringify(workflow), /retryOnFail"\s*:\s*true/);
});

test('anonymous history is linked after verified purchase without rewriting content', () => {
  const sql = nodes.get('Resolve User and Persist Purchase').parameters.query;
  assert.match(sql, /linked_messages AS/);
  assert.match(sql, /UPDATE public\.messages AS message[\s\S]*SET user_id = resolved_user\.id/);
  assert.match(sql, /message\.session_id = input\.payload->>'whatsapp_id'/);
  const linkage = sql.match(/linked_messages AS \(([\s\S]*?)\), linked_funnel AS/)?.[1] || '';
  assert.doesNotMatch(linkage, /body\s*=|timestamp\s*=|direction\s*=|provider_message_sid\s*=/);
});

test('scheduled reminders reserve exact configured template text and preserve reminder state', () => {
  assert.deepEqual(outputs('Route Authorized Sales Action', 1), ['Reserve Scheduled Reminder']);
  const reservation = nodes.get('Reserve Scheduled Reminder').parameters.options.queryReplacement;
  assert.match(reservation, /TWILIO_SALES_REMINDER_CANONICAL_BODY/);
  assert.match(reservation, /reminder_scheduled/);
  assert.deepEqual(outputs('Assert Scheduled Reminder Accepted'), ['Validate Scheduled Reminder']);
  assert.match(nodes.get('Persist Requested Reminder').parameters.query, /reminder_message_sid/);
});

test('Weekly Report uses ordered canonical content and redacts Checkout URLs', () => {
  const query = weekly.nodes.find((node) => node.name === 'SQL query').parameters.query;
  assert.match(query, /FROM public\.messages AS message/);
  assert.doesNotMatch(query, /onboarding_chat_memory/);
  assert.match(query, /message\.direction IN \('inbound', 'outbound'\)/);
  assert.match(query, /regexp_replace[\s\S]*checkout\\\.stripe/);
  assert.match(query, /ORDER BY session_id, message\.timestamp, message\.id/);
  assert.doesNotMatch(query, /provider_message_sid|metadata/);
});

test('preflight is read-only and reports required legacy conditions', () => {
  for (const field of [
    'total_messages', 'inbound_messages', 'outbound_messages', 'missing_user_id',
    'missing_reconstructable_body', 'duplicate_candidate_groups',
    'existing_provider_sid_values', 'messages_linked_to_users', 'legacy_schema_checks',
  ]) assert.match(preflight, new RegExp(`\\b${field}\\b`));
  assert.doesNotMatch(preflight, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
});

test('workflow graph has no missing connection targets', () => {
  for (const [source, groups] of Object.entries(workflow.connections)) {
    assert.ok(nodes.has(source), `missing source: ${source}`);
    for (const outputsByType of Object.values(groups)) {
      for (const group of outputsByType) {
        for (const target of group) assert.ok(nodes.has(target.node), `missing target: ${target.node}`);
      }
    }
  }
});
