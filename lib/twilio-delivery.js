'use strict';

const MESSAGE_SID_PATTERN = /^(SM|MM)[0-9a-fA-F]{32}$/;
const DEFINITIVE_FAILURE_STATUSES = new Set(['canceled', 'failed', 'undelivered']);

function normalizeTwilioResponse(raw = {}) {
  const nested = raw && typeof raw.data === 'object' && raw.data ? raw.data : {};
  const error = raw && typeof raw.error === 'object' && raw.error ? raw.error : {};
  const stringError = typeof raw.error === 'string' ? raw.error : '';
  const errorMessage = raw.message || raw.errorMessage || raw.error_message
    || error.message || error.errorMessage || error.error_message || stringError || '';
  const codeFromMessage = String(errorMessage).match(/(?:^|\D)(21617)(?:\D|$)/)?.[1] || '';
  return {
    provider_message_sid: raw.sid || raw.messageSid || raw.message_sid
      || nested.sid || nested.messageSid || nested.message_sid || '',
    provider_status: raw.status || raw.messageStatus || raw.message_status
      || nested.status || nested.messageStatus || nested.message_status || '',
    status_code: raw.statusCode || raw.httpCode || raw.status_code
      || error.statusCode || error.httpCode || error.status_code || '',
    error_code: raw.code || raw.errorCode || raw.error_code
      || error.code || error.errorCode || error.error_code || codeFromMessage || '',
    error_message: errorMessage,
  };
}

function classifyTwilioResult(raw, expectedStatus = 'accepted') {
  const normalized = normalizeTwilioResponse(raw);
  const status = String(normalized.provider_status || '').toLowerCase();
  const statusCode = Number(normalized.status_code || 0);
  const validSid = MESSAGE_SID_PATTERN.test(String(normalized.provider_message_sid || ''));
  if (String(normalized.error_code) === '21617'
      || DEFINITIVE_FAILURE_STATUSES.has(status)
      || (statusCode >= 400 && statusCode <= 499)) {
    return 'failed';
  }
  if (expectedStatus === 'scheduled' && status === 'scheduled' && validSid) return 'scheduled';
  if (expectedStatus === 'accepted' && validSid) return 'accepted';
  return 'unknown';
}

const DELIVERY_UPDATE_SQL = `WITH input AS (SELECT $1::jsonb AS payload), classified AS (
  SELECT
    payload,
    CASE
      WHEN payload->>'error_code' = '21617'
        OR LOWER(COALESCE(payload->>'provider_status', '')) IN ('canceled', 'failed', 'undelivered')
        OR COALESCE(NULLIF(payload->>'status_code', '')::integer, 0) BETWEEN 400 AND 499
        THEN 'failed'
      WHEN payload->>'expected_status' = 'scheduled'
        AND LOWER(COALESCE(payload->>'provider_status', '')) = 'scheduled'
        AND payload->>'provider_message_sid' ~ '^(SM|MM)[0-9a-fA-F]{32}$'
        THEN 'scheduled'
      WHEN payload->>'expected_status' = 'accepted'
        AND payload->>'provider_message_sid' ~ '^(SM|MM)[0-9a-fA-F]{32}$'
        THEN 'accepted'
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
        'provider_error_message', LEFT(NULLIF(classified.payload->>'error_message', ''), 300),
        'provider_acceptance_evidence', CASE
          WHEN classified.final_status IN ('accepted', 'scheduled') THEN 'message_sid'
          WHEN classified.final_status = 'failed' THEN 'definitive_failure'
          ELSE 'reconciliation_required'
        END
      ))
  FROM classified
  WHERE message.idempotency_key = classified.payload->>'idempotency_key'
    AND message.delivery_status = 'pending'
  RETURNING message.*
)
SELECT * FROM updated;`;

function responseExpression(reservationName, expectedStatus = 'accepted') {
  return `={{ JSON.stringify({
    idempotency_key: $('${reservationName}').item.json.idempotency_key,
    expected_status: '${expectedStatus}',
    provider_message_sid: $json.sid || $json.messageSid || $json.message_sid || ($json.data && ($json.data.sid || $json.data.messageSid || $json.data.message_sid)) || '',
    provider_status: $json.status || $json.messageStatus || $json.message_status || ($json.data && ($json.data.status || $json.data.messageStatus || $json.data.message_status)) || '',
    status_code: $json.statusCode || $json.httpCode || $json.status_code || ($json.error && typeof $json.error === 'object' && ($json.error.statusCode || $json.error.httpCode || $json.error.status_code)) || '',
    error_code: $json.code || $json.errorCode || $json.error_code || ($json.error && typeof $json.error === 'object' && ($json.error.code || $json.error.errorCode || $json.error.error_code)) || String($json.message || $json.errorMessage || $json.error_message || (typeof $json.error === 'string' ? $json.error : '') || '').match(/(?:^|\\D)(21617)(?:\\D|$)/)?.[1] || '',
    error_message: $json.message || $json.errorMessage || $json.error_message || ($json.error && typeof $json.error === 'object' && ($json.error.message || $json.error.errorMessage || $json.error.error_message)) || (typeof $json.error === 'string' ? $json.error : '') || ''
  }) }}`;
}

module.exports = {
  DELIVERY_UPDATE_SQL,
  MESSAGE_SID_PATTERN,
  classifyTwilioResult,
  normalizeTwilioResponse,
  responseExpression,
};
