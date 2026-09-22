'use strict';

const crypto = require('node:crypto');
const { formatWhatsAppMessage } = require('./whatsapp-message');
const { fullyAcceptedSql } = require('./logical-reply');
const { normalizeTwilioResponse, classifyTwilioResult, DELIVERY_UPDATE_SQL } = require('./twilio-delivery');

const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
const jsonSql = (value) => `convert_from(decode('${Buffer.from(JSON.stringify(value)).toString('hex')}', 'hex'), 'UTF8')::jsonb`;

function validateInput(input, requireHash = true) {
  for (const key of ['inbound_id', 'outbound_id']) {
    if (!/^[0-9a-f-]{36}$/i.test(input[key] || '')) throw new Error(`Invalid ${key}`);
  }
  if (!/^reply:(SM|MM)[0-9a-fA-F]{32}:paid$/.test(input.expected_key || '')) throw new Error('Invalid expected_key');
  if (!/^\+[1-9]\d{7,14}$/.test(input.expected_session_id || '')) throw new Error('Invalid expected_session_id');
  if (requireHash && !/^[a-f0-9]{64}$/.test(input.expected_hash || '')) throw new Error('expected_hash is required');
}

function preflightSql(input) {
  return `WITH p AS (SELECT ${jsonSql(input)} AS value)
SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.timestamp, m.id), '[]'::jsonb)
FROM public.messages m, p
WHERE m.id = (p.value->>'inbound_id')::uuid OR m.in_reply_to_id = (p.value->>'inbound_id')::uuid;`;
}

function validateIncident(input, rows) {
  const inbound = rows.find((row) => row.id === input.inbound_id);
  const base = rows.find((row) => row.id === input.outbound_id);
  if (!inbound || !base || inbound.direction !== 'inbound' || base.direction !== 'outbound'
    || base.in_reply_to_id !== inbound.id || base.idempotency_key !== input.expected_key
    || base.session_id !== input.expected_session_id || inbound.session_id !== base.session_id
    || input.expected_key !== `reply:${inbound.provider_message_sid}:paid`
    || typeof base.assistant_response !== 'string' || !base.assistant_response.trim()) {
    throw new Error('Incident identity or stored response does not match');
  }
  if (input.expected_hash && sha256(base.assistant_response) !== input.expected_hash) throw new Error('Stored response hash changed');
  return { inbound, base };
}

function preparationPayload(input, rows) {
  validateInput(input);
  const { base } = validateIncident(input, rows);
  if (String(input.confirmed_error_code) !== '21617' || !input.evidence_reference) throw new Error('Verified 21617 evidence is required');
  const formatted = formatWhatsAppMessage(base.assistant_response);
  if (formatted.part_count > 999) throw new Error('Recovery part count exceeds the supported integrity bound');
  const { parts, ...length_metadata } = formatted;
  return { ...input, parts, length_metadata };
}

function summarize(rows) {
  return rows.map((row) => ({
    id: row.id, direction: row.direction, in_reply_to_id: row.in_reply_to_id,
    idempotency_key: row.idempotency_key, delivery_status: row.delivery_status,
    provider_message_sid: row.provider_message_sid,
    processing_completed_at: row.processing_completed_at,
    processing_outcome: row.processing_outcome,
    part_index: row.metadata?.part_index, part_count: row.metadata?.part_count,
    body_length: row.body?.length, body_hash: row.body ? sha256(row.body) : null,
    stored_response_hash: row.assistant_response ? sha256(row.assistant_response) : null,
    recovery_send_claimed: Boolean(row.metadata?.recovery_send_token),
  }));
}

function verifyMessagingWindow(resource, { accountSid, from, sessionId, now = Date.now() }) {
  const created = Date.parse(resource?.date_created);
  if (resource?.account_sid !== accountSid || resource?.direction !== 'inbound'
    || resource?.from !== `whatsapp:${sessionId}` || resource?.to !== `whatsapp:${from}`
    || !/^(SM|MM)[0-9a-fA-F]{32}$/.test(resource?.sid || '')
    || !Number.isFinite(created) || created > now || now - created >= (24 * 60 - 5) * 60_000) {
    throw new Error('Free-form messaging window not verified; stop and obtain customer/operator action. No template is sent.');
  }
}

function rpcSql(name, payload) {
  if (!['prepare_whatsapp_reply_recovery', 'claim_whatsapp_reply_recovery_part'].includes(name)) throw new Error('Unsupported recovery RPC');
  return `SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM public.${name}(${jsonSql(payload)}) r;`;
}

function completionSql(input) {
  return `WITH p AS (SELECT ${jsonSql(input)} AS value), completed AS (
UPDATE public.messages AS inbound SET processing_completed_at = NOW(), processing_outcome = 'completed',
  processing_owner = NULL, processing_lease_until = NULL,
  metadata = metadata || jsonb_build_object('session_ordering_state', 'completed', 'recovery_completed_at', NOW())
FROM p WHERE inbound.id = (p.value->>'inbound_id')::uuid AND inbound.processing_completed_at IS NULL
  AND inbound.processing_owner IS NULL
  AND EXISTS (SELECT 1 FROM public.messages base WHERE base.id = (p.value->>'outbound_id')::uuid
    AND base.in_reply_to_id = inbound.id AND base.idempotency_key = p.value->>'expected_key'
    AND base.metadata->>'recovery_source_hash' = p.value->>'expected_hash')
  AND NOT EXISTS (SELECT 1 FROM public.messages part WHERE part.in_reply_to_id = inbound.id AND part.direction = 'outbound'
    AND (part.metadata->>'recovery_source_hash' IS DISTINCT FROM p.value->>'expected_hash'
      OR encode(sha256(convert_to(part.assistant_response, 'UTF8')), 'hex') IS DISTINCT FROM p.value->>'expected_hash'
      OR part.metadata->>'recovery_body_hash' IS DISTINCT FROM encode(sha256(convert_to(part.body, 'UTF8')), 'hex')))
  AND ${fullyAcceptedSql('inbound.id')}
RETURNING inbound.id
), memory AS (
UPDATE public.users AS app_user SET last_assistant_message = base.assistant_response
FROM public.messages base, p WHERE base.id = (p.value->>'outbound_id')::uuid
  AND app_user.id = base.user_id AND base.in_reply_to_id IN (SELECT id FROM completed)
RETURNING app_user.id
)
SELECT jsonb_build_object('completed', EXISTS (SELECT 1 FROM completed), 'memory_updated', (SELECT count(*) FROM memory));`;
}

async function sendNext(input, { db, provider, accountSid, from, now = () => Date.now() }) {
  validateInput(input);
  if (!/^\+[1-9]\d{7,14}$/.test(from || '') || !/^AC[0-9a-fA-F]{32}$/.test(accountSid || '')) throw new Error('Twilio sender/account configuration missing');
  if (!/^(SM|MM)[0-9a-fA-F]{32}$/.test(input.window_inbound_sid || '')) throw new Error('window_inbound_sid is required');
  const rows = await db(preflightSql(input));
  validateIncident(input, rows);
  const windowMessage = await provider.getMessage(input.window_inbound_sid);
  verifyMessagingWindow(windowMessage, { accountSid, from, sessionId: input.expected_session_id, now: now() });
  const sendToken = crypto.randomUUID();
  const claimed = await db(rpcSql('claim_whatsapp_reply_recovery_part', {
    ...input, send_token: sendToken, window_verified_at: new Date(now()).toISOString(),
  }));
  if (claimed.length === 0) return await db(completionSql(input));
  if (claimed.length !== 1) throw new Error('Recovery claim did not return exactly one part');
  const row = claimed[0];
  if (row.delivery_status !== 'pending' || row.provider_message_sid || row.session_id !== input.expected_session_id
    || !row.body || row.body.length > 1500 || row.metadata?.recovery_send_token !== sendToken) throw new Error('Claimed part is unsafe; reconcile before continuing');
  let raw;
  try {
    raw = await provider.sendMessage({ from: `whatsapp:${from}`, to: `whatsapp:${row.session_id}`, body: row.body });
  } catch (error) {
    // Never expose transport objects/credentials or retry an ambiguous POST.
    raw = { ...(error.response?.data || {}), statusCode: error.response?.status || '', error: 'Recovery transport request failed' };
  }
  const normalized = normalizeTwilioResponse(raw);
  const payload = { ...normalized, expected_status: 'accepted', idempotency_key: row.idempotency_key };
  const sql = DELIVERY_UPDATE_SQL.replace('$1::jsonb', jsonSql(payload)).replace(
    "AND message.delivery_status = 'pending'",
    `AND message.delivery_status = 'pending' AND message.metadata->>'recovery_send_token' = '${sendToken}'`,
  ).replace('SELECT * FROM updated;', "SELECT COALESCE(jsonb_agg(to_jsonb(updated)), '[]'::jsonb) FROM updated;");
  const updated = await db(sql);
  if (updated.length !== 1) throw new Error('Provider result was not persisted; do not resend, reconcile the claimed part');
  if (classifyTwilioResult(raw) !== 'accepted') throw new Error(`Recovery part is ${classifyTwilioResult(raw)}; stop and reconcile. No retry was attempted.`);
  const completion = await db(completionSql(input));
  return { parts: summarize(updated), completion };
}

module.exports = { completionSql, jsonSql, preflightSql, preparationPayload, rpcSql, sendNext, sha256, summarize, validateIncident, validateInput, verifyMessagingWindow };
