'use strict';

const fs = require('node:fs');
const path = require('node:path');
const monitor = require('../lib/ledger-health-monitor');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'n8n', 'Dietavity Ledger Health Monitor.json');
const globalErrorHandler = JSON.parse(fs.readFileSync(path.join(root, 'n8n', 'Global Error Handler.json'), 'utf8'));
const errorWorkflowId = 'sa10JQEAbxNYvCGG';
const globalErrorEmailNode = globalErrorHandler.nodes.find(node => node.name === 'Send Error Notification');
const operationsRecipient = globalErrorEmailNode?.parameters?.toEmail;
if (typeof operationsRecipient !== 'string' || !operationsRecipient.trim()) {
  throw new Error('Global Error Handler fixed email recipient is required');
}
// Production uses the existing SMTP credential named Error. The canonical
// Global Error Handler serializes a different credential name/ID, so no Error
// credential ID is available to safely include in this import-ready artifact.
const productionSmtpCredential = { name: 'Error' };

const detectionSql = `WITH fifo_heads AS (
  SELECT head.id, head.processing_owner, head.processing_lease_until,
         head.metadata, head.timestamp
  FROM public.messages AS head
  WHERE head.direction = 'inbound'
    AND head.processing_order IS NOT NULL
    AND head.processing_completed_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.messages AS earlier
      WHERE earlier.session_id = head.session_id
        AND earlier.direction = 'inbound'
        AND earlier.processing_order IS NOT NULL
        AND earlier.processing_completed_at IS NULL
        AND earlier.processing_order < head.processing_order
    )
), classified AS (
  SELECT head.*,
    CASE
      WHEN head.metadata->>'reconciliation_state' = 'operator_required' THEN 'operator_required'
      WHEN head.processing_owner IS NOT NULL
        AND head.processing_lease_until IS NULL THEN 'missing_lease_expiration'
      WHEN head.processing_owner IS NOT NULL
        AND head.processing_lease_until <= NOW() - INTERVAL '${monitor.EXPIRED_LEASE_GRACE_MINUTES} minutes' THEN 'expired_lease'
      WHEN head.processing_owner IS NULL
        AND head.timestamp <= NOW() - INTERVAL '${monitor.STALE_UNCLAIMED_HEAD_MINUTES} minutes' THEN 'stale_unclaimed_head'
      ELSE NULL
    END AS category
  FROM fifo_heads AS head
), incidents AS (
  SELECT classified.*,
    CASE category
      WHEN 'expired_lease' THEN processing_lease_until
      ELSE timestamp
    END AS condition_started_at
  FROM classified
  WHERE category IS NOT NULL
)
SELECT incident.id AS inbound_message_id,
       incident.category,
       incident.timestamp AS inbound_received_at,
       incident.processing_lease_until AS lease_until,
       incident.condition_started_at,
       FLOOR(EXTRACT(EPOCH FROM NOW() - incident.condition_started_at))::bigint AS condition_age_seconds,
       1::integer AS affected_session_count,
       (1 + (
         SELECT COUNT(*)::integer
         FROM public.messages AS successor
         WHERE successor.session_id = (
           SELECT source.session_id FROM public.messages AS source WHERE source.id = incident.id
         )
           AND successor.direction = 'inbound'
           AND successor.processing_order > (
             SELECT source.processing_order FROM public.messages AS source WHERE source.id = incident.id
           )
           AND successor.processing_completed_at IS NULL
       )) AS affected_message_count
FROM incidents AS incident
ORDER BY incident.condition_started_at, incident.id;`;

const reserveSql = `WITH input AS (SELECT $1::jsonb AS payload), reservation AS (
  SELECT reserved.*
  FROM input
  CROSS JOIN LATERAL public.reserve_ledger_health_alert(
    jsonb_build_object('inbound_message_id', input.payload->>'inbound_message_id', 'category', input.payload->>'category')
  ) AS reserved
)
SELECT input.payload->>'inbound_message_id' AS inbound_message_id,
       input.payload->>'category' AS category,
       (input.payload->>'inbound_received_at')::timestamptz AS inbound_received_at,
       NULLIF(input.payload->>'lease_until', '')::timestamptz AS lease_until,
       (input.payload->>'condition_started_at')::timestamptz AS condition_started_at,
       (input.payload->>'condition_age_seconds')::bigint AS condition_age_seconds,
       (input.payload->>'affected_session_count')::integer AS affected_session_count,
       (input.payload->>'affected_message_count')::integer AS affected_message_count,
       reservation.alert_key,
       reservation.reservation_token,
       reservation.reservation_token IS NOT NULL AS should_email
FROM input
LEFT JOIN reservation ON TRUE;`;

const workflow = {
  name: 'Dietavity Ledger Health Monitor',
  active: false,
  settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', errorWorkflow: errorWorkflowId },
  nodes: [
    { name: 'Monitor Canonical Ledger Every Five Minutes', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0], id: '88000000-0000-4000-8000-000000000001', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: monitor.MONITOR_INTERVAL_MINUTES }] } }, notes: 'Independent Ticket 88 monitor. It does not invoke the Sales Engine or Recovery Poller.' },
    { name: 'Detect Ledger Health Incidents', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [256, 0], id: '88000000-0000-4000-8000-000000000002', parameters: { operation: 'executeQuery', query: detectionSql }, credentials: { postgres: { id: '__POSTGRES_CREDENTIAL_ID__', name: 'Dietavity Postgres' } }, notes: `Read-only public.messages inspection. Active leases are excluded; expired leases receive ${monitor.EXPIRED_LEASE_GRACE_MINUTES} minutes of grace and unclaimed heads ${monitor.STALE_UNCLAIMED_HEAD_MINUTES} minutes.` },
    { name: 'Process Ledger Health Incidents', type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, position: [512, 0], id: '88000000-0000-4000-8000-000000000003', parameters: { batchSize: 1, options: {} }, notes: 'One incident is reserved and delivered at a time. The database reservation prevents overlapping monitor executions from duplicating an email.' },
    { name: 'Reserve Ledger Health Alert', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [768, 0], id: '88000000-0000-4000-8000-000000000004', parameters: { operation: 'executeQuery', query: reserveSql, options: { queryReplacement: "={{ JSON.stringify($json) }}" } }, credentials: { postgres: { id: '__POSTGRES_CREDENTIAL_ID__', name: 'Dietavity Postgres' } }, notes: `Reservation expires after ${monitor.ALERT_RESERVATION_MINUTES} minutes if the email node fails or the execution is abandoned. The ${monitor.ALERT_DEDUPLICATION_MINUTES}-minute deduplication interval begins only after confirmation.` },
    { name: 'Alert Email Reserved', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1024, 0], id: '88000000-0000-4000-8000-000000000005', parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ leftValue: '={{ $json.should_email }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } },
    { name: 'Build Ledger Health Alert Email', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1280, -96], id: '88000000-0000-4000-8000-000000000006', parameters: { jsCode: `const row = $input.first().json;
const age = Math.max(0, Number(row.condition_age_seconds || 0));
const minutes = Math.floor(age / 60); const seconds = age % 60;
const when = value => value ? new Date(value).toISOString() : 'not applicable';
const category = ({ operator_required: 'operator reconciliation required', missing_lease_expiration: 'processing owner missing lease expiration', expired_lease: 'expired processing lease', stale_unclaimed_head: 'stale unclaimed FIFO head' })[row.category] || 'unknown';
return [{ json: { ...row,
  subject: 'Dietavity ledger health: ' + category,
  html: '<p><b>Category:</b> ' + category + '</p>' +
    '<p><b>Inbound message ID:</b> ' + row.inbound_message_id + '</p>' +
    '<p><b>Condition age:</b> ' + minutes + 'm ' + seconds + 's</p>' +
    '<p><b>Inbound received:</b> ' + when(row.inbound_received_at) + '</p>' +
    '<p><b>Lease until:</b> ' + when(row.lease_until) + '</p>' +
    '<p><b>Condition started:</b> ' + when(row.condition_started_at) + '</p>' +
    '<p><b>Affected sessions:</b> ' + row.affected_session_count + '</p>' +
    '<p><b>Affected inbound messages:</b> ' + row.affected_message_count + '</p>' +
    '<p>Investigate the canonical ledger, the relevant n8n execution, and Twilio Monitor. This alert intentionally contains no phone number or message content.</p>'
} }];` }, notes: 'Privacy-safe operational alert: no session identifier, phone number, customer body, or conversation content.' },
    { name: 'Send Ledger Health Alert Email', type: 'n8n-nodes-base.emailSend', typeVersion: 2.1, position: [1536, -96], id: '88000000-0000-4000-8000-000000000007', parameters: { fromEmail: 'error@dietavity.com', toEmail: operationsRecipient, subject: '={{ $json.subject }}', html: '={{ $json.html }}', options: { appendAttribution: false } }, credentials: { smtp: productionSmtpCredential }, notes: 'Production uses the existing SMTP credential named Error. A node error intentionally fails the execution: no confirmation is written, so the reservation expires and becomes retryable.' },
    { name: 'Assert Ledger Health Email Accepted', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1792, -96], id: '88000000-0000-4000-8000-000000000008', parameters: { jsCode: `const result = $input.first().json || {};
if (!Array.isArray(result.accepted) || result.accepted.length < 1 || (Array.isArray(result.rejected) && result.rejected.length > 0)) {
  throw new Error('LEDGER_HEALTH_EMAIL_NOT_ACCEPTED');
}
return $input.all();` }, notes: 'SMTP/nodemailer acceptance evidence is required before the delivery confirmation can begin deduplication.' },
    { name: 'Confirm Ledger Health Alert Delivery', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [2048, -96], id: '88000000-0000-4000-8000-000000000009', parameters: { operation: 'executeQuery', query: "SELECT public.confirm_ledger_health_alert_delivery($1::jsonb);", options: { queryReplacement: "={{ JSON.stringify({ alert_key: $('Reserve Ledger Health Alert').item.json.alert_key, reservation_token: $('Reserve Ledger Health Alert').item.json.reservation_token }) }}" } }, credentials: { postgres: { id: '__POSTGRES_CREDENTIAL_ID__', name: 'Dietavity Postgres' } }, notes: 'Only confirmed provider acceptance reaches this node; it starts the confirmed-delivery deduplication window.' },
    { name: 'Continue Ledger Health Incident Batch', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2048, 80], id: '88000000-0000-4000-8000-000000000010', parameters: { jsCode: 'return $input.all();' } },
  ],
  connections: {
    'Monitor Canonical Ledger Every Five Minutes': { main: [[{ node: 'Detect Ledger Health Incidents', type: 'main', index: 0 }]] },
    'Detect Ledger Health Incidents': { main: [[{ node: 'Process Ledger Health Incidents', type: 'main', index: 0 }]] },
    'Process Ledger Health Incidents': { main: [[{ node: 'Reserve Ledger Health Alert', type: 'main', index: 0 }], []] },
    'Reserve Ledger Health Alert': { main: [[{ node: 'Alert Email Reserved', type: 'main', index: 0 }]] },
    'Alert Email Reserved': { main: [[{ node: 'Build Ledger Health Alert Email', type: 'main', index: 0 }], [{ node: 'Continue Ledger Health Incident Batch', type: 'main', index: 0 }]] },
    'Build Ledger Health Alert Email': { main: [[{ node: 'Send Ledger Health Alert Email', type: 'main', index: 0 }]] },
    'Send Ledger Health Alert Email': { main: [[{ node: 'Assert Ledger Health Email Accepted', type: 'main', index: 0 }]] },
    'Assert Ledger Health Email Accepted': { main: [[{ node: 'Confirm Ledger Health Alert Delivery', type: 'main', index: 0 }]] },
    'Confirm Ledger Health Alert Delivery': { main: [[{ node: 'Continue Ledger Health Incident Batch', type: 'main', index: 0 }]] },
    'Continue Ledger Health Incident Batch': { main: [[{ node: 'Process Ledger Health Incidents', type: 'main', index: 0 }]] },
  },
  pinData: {},
  versionId: '88000000-0000-4000-8000-000000000088',
  meta: { templateCredsSetupCompleted: true },
  tags: [],
};

fs.writeFileSync(output, `${JSON.stringify(workflow, null, 2)}\n`);
console.log('Wrote n8n/Dietavity Ledger Health Monitor.json');
