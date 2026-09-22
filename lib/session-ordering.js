'use strict';

const logicalReply = require('./logical-reply');

const SESSION_LEASE_MINUTES = 15;
const CLAIM_RETRY_SECONDS = 5;
const ADVISORY_LOCK_SEED = 17;

const RESERVE_INBOUND_SQL = `WITH input AS (
  SELECT $1::jsonb AS payload
), session_serialized AS (
  SELECT pg_advisory_xact_lock(
    hashtextextended(input.payload->>'session_id', ${ADVISORY_LOCK_SEED})
  )
  FROM input
), reserved AS (
  INSERT INTO public.messages (
    user_id, session_id, direction, body, message_kind, provider,
    provider_message_sid, idempotency_key, delivery_status, metadata,
    user_message, processing_order
  )
  SELECT
    (SELECT app_user.id FROM public.users AS app_user
      WHERE app_user.whatsapp_id = input.payload->>'session_id' LIMIT 1),
    input.payload->>'session_id', 'inbound', input.payload->>'body',
    input.payload->>'message_kind', 'twilio',
    input.payload->>'provider_message_sid', input.payload->>'idempotency_key',
    'received',
    jsonb_strip_nulls(jsonb_build_object(
      'workflow_execution_id', input.payload->>'workflow_execution_id',
      'num_media', COALESCE((input.payload->>'num_media')::integer, 0),
      'provider_event_timestamp', NULLIF(input.payload->>'provider_event_timestamp', ''),
      'session_ordering_state', 'queued'
    )),
    COALESCE(input.payload->>'body', ''),
    nextval('public.messages_inbound_processing_order_seq')
  FROM input
  CROSS JOIN session_serialized
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING *
)
SELECT * FROM reserved;`;

const CLAIM_NEXT_INBOUND_SQL = `WITH input AS (
  SELECT $1::jsonb AS payload
), session_serialized AS (
  SELECT pg_advisory_xact_lock(
    hashtextextended(input.payload->>'session_id', ${ADVISORY_LOCK_SEED})
  )
  FROM input
), stale_with_resolved_outbound AS (
  SELECT message.id, message.session_id
  FROM public.messages AS message
  CROSS JOIN input
  CROSS JOIN session_serialized
  WHERE message.session_id = input.payload->>'session_id'
    AND message.direction = 'inbound'
    AND message.processing_order IS NOT NULL
    AND message.processing_completed_at IS NULL
    AND message.processing_lease_until <= NOW()
    AND ${logicalReply.fullyAcceptedSql('message.id')}
  FOR UPDATE OF message
), reconciled AS (
  UPDATE public.messages AS message
  SET processing_owner = NULL,
      processing_lease_until = NULL,
      processing_completed_at = NOW(),
      processing_outcome = 'reconciliation',
      metadata = message.metadata || jsonb_build_object(
        'session_ordering_state', 'reconciliation',
        'stale_claim_recovered_at', NOW()
      )
  FROM stale_with_resolved_outbound
  WHERE message.id = stale_with_resolved_outbound.id
  RETURNING message.id, message.session_id
), reset_commercial_context AS (
  UPDATE public.onboarding_sessions AS session
  SET last_question_type = NULL,
      last_question_at = NULL,
      commercial_context_expires_at = NULL,
      checkout_authorization_type = NULL,
      checkout_authorized_at = NULL,
      updated_at = NOW()
  WHERE session.session_id IN (SELECT DISTINCT session_id FROM reconciled)
  RETURNING session.session_id
), candidate AS (
  SELECT message.*
  FROM public.messages AS message
  CROSS JOIN input
  WHERE message.session_id = input.payload->>'session_id'
    AND message.direction = 'inbound'
    AND message.processing_order IS NOT NULL
    AND message.processing_completed_at IS NULL
    AND message.id NOT IN (SELECT id FROM reconciled)
    AND (SELECT COUNT(*) FROM reset_commercial_context) >= 0
  ORDER BY message.processing_order, message.id
  LIMIT 1
  FOR UPDATE OF message
), claimed AS (
  UPDATE public.messages AS message
  SET processing_owner = input.payload->>'processing_owner',
      processing_lease_until = NOW() + INTERVAL '${SESSION_LEASE_MINUTES} minutes',
      processing_outcome = NULL,
      metadata = message.metadata || jsonb_strip_nulls(jsonb_build_object(
        'session_ordering_state', 'processing',
        'claim_acquired_at', NOW(),
        'claim_owner', NULLIF(input.payload->>'processing_owner', ''),
        'recovered_stale_claim', message.processing_lease_until <= NOW()
      ))
  FROM candidate
  CROSS JOIN input
  WHERE message.id = candidate.id
    AND NOT EXISTS (
      SELECT 1
      FROM public.messages AS outbound
      WHERE outbound.in_reply_to_id = message.id
        AND outbound.direction = 'outbound'
    )
    AND (
      message.processing_owner IS NULL
      OR message.processing_lease_until IS NULL
      OR message.processing_lease_until <= NOW()
      OR message.processing_owner = input.payload->>'processing_owner'
    )
  RETURNING message.*
)
SELECT claimed.*, 'acquired'::text AS claim_state
FROM claimed
UNION ALL
SELECT candidate.*, 'busy'::text AS claim_state
FROM candidate
WHERE NOT EXISTS (SELECT 1 FROM claimed)
  AND NOT EXISTS (
    SELECT 1
    FROM public.messages AS outbound
    WHERE outbound.in_reply_to_id = candidate.id
      AND outbound.direction = 'outbound'
  )
UNION ALL
SELECT candidate.*, 'reconciliation'::text AS claim_state
FROM candidate
WHERE EXISTS (
  SELECT 1
  FROM public.messages AS outbound
  WHERE outbound.in_reply_to_id = candidate.id
    AND outbound.direction = 'outbound'
)
UNION ALL
SELECT
  NULL::uuid AS id, NULL::uuid AS user_id, NULL::text AS direction,
  NULL::text AS user_message, NULL::timestamptz AS timestamp,
  NULL::text AS audio_url, NULL::text AS transcript, NULL::text AS intent,
  NULL::text AS assistant_response, input.payload->>'session_id' AS session_id,
  NULL::text AS body, NULL::text AS message_kind, NULL::text AS provider,
  NULL::text AS provider_message_sid, NULL::text AS idempotency_key,
  NULL::uuid AS in_reply_to_id, NULL::text AS delivery_status,
  '{}'::jsonb AS metadata, NULL::bigint AS processing_order,
  NULL::text AS processing_owner, NULL::timestamptz AS processing_lease_until,
  NULL::timestamptz AS processing_completed_at, NULL::text AS processing_outcome,
  'empty'::text AS claim_state
FROM input
WHERE NOT EXISTS (SELECT 1 FROM candidate);`;

const COMPLETE_INBOUND_SQL = `WITH input AS (
  SELECT $1::jsonb AS payload
), completed AS (
  UPDATE public.messages AS message
  SET processing_owner = NULL,
      processing_lease_until = NULL,
      processing_completed_at = NOW(),
      processing_outcome = 'completed',
      metadata = message.metadata || jsonb_build_object(
        'session_ordering_state', 'completed',
        'processing_completed_at', NOW()
      )
  FROM input
  WHERE message.id = NULLIF(input.payload->>'inbound_message_id', '')::uuid
    AND message.processing_owner = input.payload->>'processing_owner'
    AND message.processing_completed_at IS NULL
    AND ${logicalReply.fullyAcceptedSql('message.id')}
  RETURNING message.*
)
SELECT * FROM completed;`;

const RESERVE_MULTIPART_OUTBOUND_SQL = `WITH input AS (
  SELECT $1::jsonb AS payload
), renewed_claim AS (
  UPDATE public.messages AS inbound
  SET processing_lease_until = NOW() + INTERVAL '${SESSION_LEASE_MINUTES} minutes'
  FROM input
  WHERE inbound.id = NULLIF(input.payload->>'in_reply_to_id', '')::uuid
    AND inbound.direction = 'inbound'
    AND inbound.processing_completed_at IS NULL
    AND inbound.processing_owner = input.payload->>'processing_owner'
  RETURNING inbound.id
), parts AS (
  SELECT
    part.body,
    part.ordinality::integer AS part_index,
    jsonb_array_length(input.payload->'parts') AS part_count,
    input.payload
  FROM input
  CROSS JOIN LATERAL jsonb_array_elements_text(input.payload->'parts')
    WITH ORDINALITY AS part(body, ordinality)
  WHERE EXISTS (SELECT 1 FROM renewed_claim)
    AND NOT EXISTS (SELECT 1 FROM public.messages existing
      WHERE existing.in_reply_to_id = NULLIF(input.payload->>'in_reply_to_id', '')::uuid
        AND existing.direction = 'outbound')
), reserved AS (
  INSERT INTO public.messages (
    user_id, session_id, direction, body, message_kind, provider,
    idempotency_key, in_reply_to_id, delivery_status, metadata,
    assistant_response
  )
  SELECT
    NULLIF(parts.payload->>'user_id', '')::uuid,
    parts.payload->>'session_id', 'outbound', parts.body,
    parts.payload->>'message_kind', 'twilio',
    CASE WHEN parts.part_index = 1
      THEN parts.payload->>'base_idempotency_key'
      ELSE parts.payload->>'base_idempotency_key' || ':part:' || LPAD(parts.part_index::text, 3, '0')
    END,
    NULLIF(parts.payload->>'in_reply_to_id', '')::uuid, 'pending',
    COALESCE(parts.payload->'metadata', '{}'::jsonb) || jsonb_build_object(
      'logical_reply_key', parts.payload->>'base_idempotency_key',
      'part_index', parts.part_index,
      'part_count', parts.part_count
    ),
    parts.payload->>'logical_body'
  FROM parts
  WHERE NULLIF(parts.body, '') IS NOT NULL
  ORDER BY parts.part_index
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING *
)
SELECT * FROM reserved
ORDER BY (metadata->>'part_index')::integer;`;

function addLeaseOwnershipToOutboundReservation(sql) {
  const marker = '), reserved AS (';
  if (!sql.includes(marker)) throw new Error('Unsupported outbound reservation SQL shape');
  const withLease = sql.replace(marker, `), renewed_claim AS (
  UPDATE public.messages AS inbound
  SET processing_lease_until = NOW() + INTERVAL '${SESSION_LEASE_MINUTES} minutes'
  FROM input
  WHERE inbound.id = NULLIF(input.payload->>'in_reply_to_id', '')::uuid
    AND inbound.direction = 'inbound'
    AND inbound.processing_completed_at IS NULL
    AND inbound.processing_owner = input.payload->>'processing_owner'
  RETURNING inbound.id
), reserved AS (`);
  return withLease.replace(
    "  WHERE NULLIF(input.payload->>'body', '') IS NOT NULL",
    "  WHERE EXISTS (SELECT 1 FROM renewed_claim)\n    AND NULLIF(input.payload->>'body', '') IS NOT NULL",
  );
}

module.exports = {
  SESSION_LEASE_MINUTES,
  CLAIM_RETRY_SECONDS,
  RESERVE_INBOUND_SQL,
  CLAIM_NEXT_INBOUND_SQL,
  COMPLETE_INBOUND_SQL,
  RESERVE_MULTIPART_OUTBOUND_SQL,
  addLeaseOwnershipToOutboundReservation,
};
