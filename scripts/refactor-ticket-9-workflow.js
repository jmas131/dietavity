'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'archive', 'Dietavity Sales Engine v3 (Ticket 8).json');
const outputPath = path.join(root, 'n8n', 'Dietavity Canonical Ledger (Ticket 9).json');
const weeklyPath = path.join(root, 'n8n', 'Dietavity Weekly Report.json');
const workflow = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

const byName = (name) => {
  const found = workflow.nodes.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing workflow node: ${name}`);
  return found;
};

const uuid = () => crypto.randomUUID();
const postgresCredentials = byName('Initialize 28-Day Program').credentials;

const node = (name, type, position, parameters, extra = {}) => ({
  parameters,
  type,
  typeVersion: extra.typeVersion || 2,
  position,
  id: uuid(),
  name,
  ...extra,
});

const pg = (name, position, query, queryReplacement, notes) => node(
  name,
  'n8n-nodes-base.postgres',
  position,
  {
    operation: 'executeQuery',
    query,
    options: queryReplacement ? { queryReplacement } : {},
  },
  { typeVersion: 2.6, credentials: postgresCredentials, notes },
);

const code = (name, position, jsCode, notes) => node(
  name,
  'n8n-nodes-base.code',
  position,
  { jsCode },
  { typeVersion: 2, notes },
);

const edge = (target) => ({ node: target, type: 'main', index: 0 });
const setMain = (source, targets) => {
  workflow.connections[source] = { main: [targets.map(edge)] };
};

function replaceTarget(oldTarget, newTarget) {
  for (const groups of Object.values(workflow.connections)) {
    for (const outputs of groups.main || []) {
      for (const connection of outputs || []) {
        if (connection.node === oldTarget) connection.node = newTarget;
      }
    }
  }
}

function removeNode(name) {
  workflow.nodes = workflow.nodes.filter((candidate) => candidate.name !== name);
  delete workflow.connections[name];
  for (const groups of Object.values(workflow.connections)) {
    for (const outputs of groups.main || []) {
      for (let index = outputs.length - 1; index >= 0; index -= 1) {
        if (outputs[index].node === name) outputs.splice(index, 1);
      }
    }
  }
}

workflow.name = 'Dietavity Canonical Ledger (Ticket 9)';
workflow.active = false;

const canonicalizeInbound = code(
  'Canonicalize Inbound WhatsApp',
  [64176, 46960],
  `const trigger = $input.first().json || {};
const data = trigger.data || {};
const session_id = String(data.from || '')
  .replace(/^whatsapp:/i, '')
  .replace(/\\s+/g, '')
  .trim();
const provider_message_sid = String(data.messageSid || data.MessageSid || data.sid || '').trim();
if (!session_id) throw new Error('TICKET_9_MISSING_WHATSAPP_SESSION');
if (!/^(SM|MM)[0-9a-fA-F]{32}$/.test(provider_message_sid)) {
  throw new Error('TICKET_9_MISSING_REAL_TWILIO_MESSAGE_SID');
}
const rawBody = typeof data.body === 'string' ? data.body : '';
const body = rawBody.trim() || null;
return [{ json: {
  session_id,
  provider: 'twilio',
  provider_message_sid,
  idempotency_key: 'inbound:' + provider_message_sid,
  body,
  message_kind: body ? 'user' : 'media_clarification',
  num_media: Number(data.numMedia || 0),
  workflow_execution_id: $execution.id
} }];`,
  'Requires a real Twilio SID. The n8n execution ID is diagnostic metadata only and never provider identity.',
);

const reserveInbound = pg(
  'Reserve Canonical Inbound Message',
  [64400, 46960],
  `WITH input AS (SELECT $1::jsonb AS payload), reserved AS (
  INSERT INTO public.messages (
    user_id, session_id, direction, body, message_kind, provider,
    provider_message_sid, idempotency_key, delivery_status, metadata,
    user_message
  )
  SELECT
    (SELECT app_user.id FROM public.users AS app_user
      WHERE app_user.whatsapp_id = input.payload->>'session_id' LIMIT 1),
    input.payload->>'session_id', 'inbound', input.payload->>'body',
    input.payload->>'message_kind', 'twilio',
    input.payload->>'provider_message_sid', input.payload->>'idempotency_key',
    'received',
    jsonb_build_object(
      'workflow_execution_id', input.payload->>'workflow_execution_id',
      'num_media', COALESCE((input.payload->>'num_media')::integer, 0)
    ),
    COALESCE(input.payload->>'body', '')
  FROM input
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING *
)
SELECT * FROM reserved;`,
  '={{ JSON.stringify($json) }}',
  'The zero-row conflict result is the inbound idempotency gate: no downstream AI, Stripe, Twilio, or reminder side effect can run.',
);

workflow.nodes.push(canonicalizeInbound, reserveInbound);
setMain('Incoming Message', ['Canonicalize Inbound WhatsApp']);
setMain('Canonicalize Inbound WhatsApp', ['Reserve Canonical Inbound Message']);
setMain('Reserve Canonical Inbound Message', ['Get User from Supabase']);
byName('Get User from Supabase').parameters.filters.conditions[0].keyValue =
  "={{ $('Canonicalize Inbound WhatsApp').item.json.session_id }}";

const setSessionAssignments = byName('Set Session Id').parameters.assignments.assignments;
setSessionAssignments.find((assignment) => assignment.name === 'chatInput').value =
  "={{ $('Canonicalize Inbound WhatsApp').item.json.body || '' }}";
setSessionAssignments.find((assignment) => assignment.name === 'session_id').value =
  "={{ $('Canonicalize Inbound WhatsApp').item.json.session_id }}";
setSessionAssignments.find((assignment) => assignment.name === 'inbound_message_sid').value =
  "={{ $('Canonicalize Inbound WhatsApp').item.json.provider_message_sid }}";

removeNode('Create Inbound Message ');
replaceTarget('Create Outbound Message', 'Send All Intents Message');
removeNode('Create Outbound Message');

const reservationSql = `WITH input AS (SELECT $1::jsonb AS payload), reserved AS (
  INSERT INTO public.messages (
    user_id, session_id, direction, body, message_kind, provider,
    idempotency_key, in_reply_to_id, delivery_status, metadata,
    assistant_response
  )
  SELECT
    NULLIF(input.payload->>'user_id', '')::uuid,
    input.payload->>'session_id', 'outbound', input.payload->>'body',
    input.payload->>'message_kind', 'twilio', input.payload->>'idempotency_key',
    NULLIF(input.payload->>'in_reply_to_id', '')::uuid, 'pending',
    COALESCE(input.payload->'metadata', '{}'::jsonb), input.payload->>'body'
  FROM input
  WHERE NULLIF(input.payload->>'body', '') IS NOT NULL
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING *
)
SELECT * FROM reserved;`;

const updateSql = `WITH input AS (SELECT $1::jsonb AS payload), classified AS (
  SELECT
    payload,
    CASE
      WHEN payload->>'expected_status' = 'scheduled'
        AND payload->>'provider_status' = 'scheduled'
        AND payload->>'provider_message_sid' ~ '^(SM|MM)[0-9a-fA-F]{32}$'
        THEN 'scheduled'
      WHEN payload->>'expected_status' = 'accepted'
        AND payload->>'provider_message_sid' ~ '^(SM|MM)[0-9a-fA-F]{32}$'
        THEN 'accepted'
      WHEN COALESCE(NULLIF(payload->>'status_code', '')::integer, 0) BETWEEN 400 AND 499
        THEN 'failed'
      ELSE 'unknown'
    END AS final_status
  FROM input
), updated AS (
  UPDATE public.messages AS message
  SET provider_message_sid = CASE
        WHEN classified.payload->>'provider_message_sid' ~ '^(SM|MM)[0-9a-fA-F]{32}$'
          THEN classified.payload->>'provider_message_sid'
        ELSE message.provider_message_sid
      END,
      delivery_status = classified.final_status,
      metadata = message.metadata || jsonb_strip_nulls(jsonb_build_object(
        'provider_status', NULLIF(classified.payload->>'provider_status', ''),
        'provider_error_code', NULLIF(classified.payload->>'error_code', ''),
        'provider_error_message', LEFT(NULLIF(classified.payload->>'error_message', ''), 300)
      ))
  FROM classified
  WHERE message.idempotency_key = classified.payload->>'idempotency_key'
    AND message.delivery_status = 'pending'
  RETURNING message.*
)
SELECT * FROM updated;`;

function payloadExpression(config) {
  const metadata = config.metadata || '{}';
  return `={{ JSON.stringify({
    session_id: ${config.session},
    user_id: ${config.user || 'null'},
    body: ${config.body},
    message_kind: ${config.kindExpression || JSON.stringify(config.kind)},
    idempotency_key: ${config.key},
    in_reply_to_id: ${config.parent || 'null'},
    metadata: ${metadata}
  }) }}`;
}

function responseExpression(reservationName, expectedStatus) {
  return `={{ JSON.stringify({
    idempotency_key: $('${reservationName}').item.json.idempotency_key,
    expected_status: '${expectedStatus}',
    provider_message_sid: $json.sid || $json.messageSid || '',
    provider_status: $json.status || '',
    status_code: $json.statusCode || $json.httpCode || ($json.error && ($json.error.statusCode || $json.error.httpCode)) || '',
    error_code: $json.code || ($json.error && $json.error.code) || '',
    error_message: $json.message || ($json.error && $json.error.message) || ''
  }) }}`;
}

function wrapSend(sendName, config) {
  const send = byName(sendName);
  const reservationName = `Reserve ${config.label}`;
  const updateName = `Update ${config.label} Delivery`;
  const assertName = `Assert ${config.label} Accepted`;
  const oldTargets = (workflow.connections[sendName]?.main?.[0] || []).map((connection) => connection.node);
  const reserve = pg(
    reservationName,
    [send.position[0] - 160, send.position[1] - 80],
    reservationSql,
    payloadExpression(config),
    'Only the execution that inserts this unique logical reservation may call Twilio.',
  );
  const update = pg(
    updateName,
    [send.position[0] + 160, send.position[1] - 80],
    updateSql,
    responseExpression(reservationName, config.expectedStatus || 'accepted'),
    'Persists accepted/scheduled, definitive failure, or ambiguous unknown without deleting the intended message.',
  );
  const assertAccepted = code(
    assertName,
    [send.position[0] + 320, send.position[1] - 80],
    `const row = $input.first().json;
if (!['accepted', 'scheduled'].includes(row.delivery_status)) {
  throw new Error('TICKET_9_TWILIO_SEND_REQUIRES_RECONCILIATION:' + row.idempotency_key + ':' + row.delivery_status);
}
return $input.all();`,
    'Ambiguous sends are never retried blindly. The Global Error Handler alerts after the unknown/failed state is durable.',
  );
  workflow.nodes.push(reserve, update, assertAccepted);
  replaceTarget(sendName, reservationName);
  setMain(reservationName, [sendName]);
  setMain(sendName, [updateName]);
  setMain(updateName, [assertName]);
  setMain(assertName, oldTargets);
  // The Postgres reservation replaces the upstream item with the canonical
  // messages row. Send exactly that reserved destination/body instead of
  // expressions such as $json.output, which no longer exist at this point.
  if (send.type === 'n8n-nodes-base.twilio') {
    send.parameters.to = '={{ $json.session_id }}';
    send.parameters.message = '={{ $json.body }}';
  } else if (sendName === 'Schedule Requested WhatsApp Reminder') {
    const toParameter = send.parameters.bodyParameters.parameters.find(
      (parameter) => parameter.name === 'To',
    );
    if (!toParameter) throw new Error(`Missing Twilio To parameter: ${sendName}`);
    toParameter.value = '=whatsapp:{{ $json.session_id }}';
  }
  send.onError = 'continueRegularOutput';
  send.continueOnFail = true;
  send.retryOnFail = false;
  return { reservationName, updateName, assertName };
}

const inboundSession = "$('Canonicalize Inbound WhatsApp').item.json.session_id";
const inboundParent = "$('Reserve Canonical Inbound Message').item.json.id";
const inboundSid = "$('Canonicalize Inbound WhatsApp').item.json.provider_message_sid";
const knownUser = "($('Get User from Supabase').item.json.id || null)";
const inboundMeta = "{ workflow_execution_id: $execution.id }";

wrapSend('Send All Intents Message', {
  label: 'Paid Assistant Reply', session: inboundSession, user: knownUser,
  body: "$json.assistant_response", kind: 'paid_ai',
  kindExpression: "$json.intent ? 'paid_deterministic' : 'paid_ai'",
  key: "'reply:' + " + inboundSid + " + ':paid'", parent: inboundParent, metadata: inboundMeta,
});
wrapSend('Respond to Chat', {
  label: 'Sales Reply', session: inboundSession,
  body: "$json.output", kind: 'sales_ai',
  kindExpression: "['answer_question', 'clarify', 'discovery', 'show_example', 'explain_offer', 'graceful_close', 'deferred'].includes($json.strategy) ? 'sales_deterministic' : 'sales_ai'",
  key: "'reply:' + " + inboundSid + " + ':sales'", parent: inboundParent,
  metadata: "{ workflow_execution_id: $execution.id, strategy: $json.strategy || null, buyer_signal: $json.buyer_signal || null }",
});
wrapSend('Respond to Chat Subscription', {
  label: 'Checkout Reply', session: inboundSession,
  body: "$json.message", kind: 'checkout',
  key: "'reply:' + " + inboundSid + " + ':checkout'", parent: inboundParent,
  metadata: "{ workflow_execution_id: $execution.id, checkout_session_id: $('LIVE Stripe Checkout Session Payment').item.json.id }",
});
wrapSend('Send Message Asking for Text', {
  label: 'Media Clarification', session: inboundSession, user: knownUser,
  body: JSON.stringify(byName('Send Message Asking for Text').parameters.message), kind: 'media_clarification',
  key: "'reply:' + " + inboundSid + " + ':media_clarification'", parent: inboundParent, metadata: inboundMeta,
});
wrapSend('Send Unsubscribe Message', {
  label: 'Legacy Cancellation Success', session: inboundSession, user: knownUser,
  body: JSON.stringify(byName('Send Unsubscribe Message').parameters.message), kind: 'legacy_cancellation',
  key: "'reply:' + " + inboundSid + " + ':legacy_cancellation_success'", parent: inboundParent, metadata: inboundMeta,
});
wrapSend('Send Unsubscribe Unconfirmed Message', {
  label: 'Legacy Cancellation Failure', session: inboundSession, user: knownUser,
  body: JSON.stringify(byName('Send Unsubscribe Unconfirmed Message').parameters.message), kind: 'legacy_cancellation',
  key: "'reply:' + " + inboundSid + " + ':legacy_cancellation_failed'", parent: inboundParent, metadata: inboundMeta,
});
wrapSend('Confirm Requested Reminder', {
  label: 'Reminder Confirmation', session: inboundSession,
  body: "$('Validate Scheduled Reminder').item.json.output", kind: 'reminder_confirmation',
  key: "'reply:' + " + inboundSid + " + ':reminder_confirmation'", parent: inboundParent, metadata: inboundMeta,
});

const scheduled = wrapSend('Schedule Requested WhatsApp Reminder', {
  label: 'Scheduled Reminder', session: inboundSession,
  body: "$env.TWILIO_SALES_REMINDER_CANONICAL_BODY", kind: 'reminder_scheduled',
  key: "'reply:' + " + inboundSid + " + ':reminder_scheduled'", parent: inboundParent,
  expectedStatus: 'scheduled',
  metadata: "{ workflow_execution_id: $execution.id, content_sid: $env.TWILIO_SALES_REMINDER_CONTENT_SID, scheduled_for: $('Apply Deterministic Commercial Policy').item.json.reminder_scheduled_for }",
});
// Scheduled reservations must happen before the Twilio scheduling API call.
workflow.connections['Route Authorized Sales Action'] = {
  main: [
    [edge('Persist Checkout Authorization v3')],
    [edge(scheduled.reservationName)],
    [edge('Build Constrained Sales Response')],
    [edge('Build Constrained Sales Response')],
    [edge('Build Constrained Sales Response')],
  ],
};

wrapSend('Send 28-Day Program Setup Link', {
  label: 'Setup Link', session: "$json.whatsapp_id", user: "$json.user_id",
  body: "'🎉 ¡Tu pago fue confirmado!\\n\\nAhora completa tu perfil para preparar tu programa personalizado de 28 días:\\n\\n👉 https://dietavity.com/setup/' + $json.portal_token",
  kind: 'setup_link', key: "'setup:' + $json.stripe_checkout_session_id", metadata: "{ checkout_session_id: $json.stripe_checkout_session_id }",
});
wrapSend('Send Welcome New User', {
  label: 'Welcome Message', session: "$json.whatsapp_id", user: "$json.id || null",
  body: JSON.stringify(byName('Send Welcome New User').parameters.message), kind: 'welcome',
  key: "'welcome:' + ($('Webhook Stripe Checkout').item.json.id || $('Webhook Stripe Checkout').item.json.data.object.id)",
  metadata: "{ stripe_event_id: $('Webhook Stripe Checkout').item.json.id || null }",
});
wrapSend('Send Error Creating User Message', {
  label: 'Customer Error', session: "$json.whatsapp_id", user: 'null',
  body: JSON.stringify(byName('Send Error Creating User Message').parameters.message), kind: 'customer_error',
  key: "'customer_error:' + ($('Webhook Stripe Checkout').item.json.id || $('Webhook Stripe Checkout').item.json.data.object.id)",
  metadata: "{ stripe_event_id: $('Webhook Stripe Checkout').item.json.id || null }",
});

// Identity enrichment is allowed after a verified purchase; message content and ordering are untouched.
const purchaseNode = byName('Resolve User and Persist Purchase');
purchaseNode.parameters.query = purchaseNode.parameters.query.replace(
  '), linked_funnel AS (',
  `), linked_messages AS (
  UPDATE public.messages AS message
  SET user_id = resolved_user.id
  FROM resolved_user, input
  WHERE message.session_id = input.payload->>'whatsapp_id'
    AND message.user_id IS NULL
  RETURNING message.id
), linked_funnel AS (`,
);

fs.writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);

const weekly = JSON.parse(fs.readFileSync(weeklyPath, 'utf8'));
const weeklyQuery = weekly.nodes.find((candidate) => candidate.name === 'SQL query');
weeklyQuery.parameters.query = `SELECT
  COALESCE(message.session_id, app_user.whatsapp_id, 'user:' || message.user_id::text) AS session_id,
  message.timestamp AS created_at,
  message.direction AS role,
  regexp_replace(
    message.body,
    'https://checkout\\.stripe\\.com/[^[:space:]]+',
    '[Checkout URL]',
    'gi'
  ) AS content
FROM public.messages AS message
LEFT JOIN public.users AS app_user ON app_user.id = message.user_id
WHERE message.timestamp >= NOW() - INTERVAL '7 days'
  AND message.direction IN ('inbound', 'outbound')
  AND message.body IS NOT NULL
ORDER BY session_id, message.timestamp, message.id;`;
const builder = weekly.nodes.find((candidate) => candidate.name === 'Build Onboarding Analysis Input');
builder.parameters.jsCode = builder.parameters.jsCode
  .replace("item.json.role === 'human'", "item.json.role === 'inbound'")
  .replace('Dietavity onboarding conversations from the last 7 days.', 'Dietavity customer-visible WhatsApp conversations from the last 7 days.');
fs.writeFileSync(weeklyPath, `${JSON.stringify(weekly, null, 2)}\n`);
