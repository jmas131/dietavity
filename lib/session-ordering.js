'use strict';

const logicalReply = require('./logical-reply');

const SESSION_LEASE_MINUTES = 15;
const CLAIM_RETRY_SECONDS = 5;
const ADVISORY_LOCK_SEED = 17;
// The only conversational-turn timing knob. It is evaluated against the
// database receipt timestamp while holding the existing per-session lock.
const TURN_QUIET_SECONDS = 10;

const turnAnchorSql = (alias) => `COALESCE(${alias}.metadata->>'turn_anchor_id', ${alias}.id::text)`;

function renewTurnLeaseSql() {
  return `claim_anchor AS (
  SELECT inbound.id
  FROM public.messages AS inbound
  CROSS JOIN input
  WHERE inbound.id = NULLIF(input.payload->>'in_reply_to_id', '')::uuid
    AND inbound.direction = 'inbound'
    AND inbound.processing_completed_at IS NULL
    AND inbound.processing_owner = input.payload->>'processing_owner'
), renewed_claim AS (
  UPDATE public.messages AS member
  SET processing_lease_until = NOW() + INTERVAL '${SESSION_LEASE_MINUTES} minutes'
  FROM claim_anchor
  WHERE ${turnAnchorSql('member')} = claim_anchor.id::text
    AND member.processing_completed_at IS NULL
    AND member.processing_owner = (SELECT input.payload->>'processing_owner' FROM input)
  RETURNING member.id
)`;
}

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
    AND ${turnAnchorSql('message')} = message.id::text
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
  WHERE ${turnAnchorSql('message')} = stale_with_resolved_outbound.id::text
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
), initial_candidate AS (
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
), initial_completed_boundary AS (
  SELECT MIN(message.processing_order) AS processing_order
  FROM public.messages AS message
  CROSS JOIN initial_candidate
  WHERE message.session_id = initial_candidate.session_id
    AND message.direction = 'inbound'
    AND message.processing_order > initial_candidate.processing_order
    AND message.processing_completed_at IS NOT NULL
), initial_members AS (
  SELECT message.*
  FROM public.messages AS message
  CROSS JOIN initial_candidate
  CROSS JOIN initial_completed_boundary
  WHERE message.session_id = initial_candidate.session_id
    AND message.direction = 'inbound'
    AND message.processing_order >= initial_candidate.processing_order
    AND message.processing_completed_at IS NULL
    AND (initial_completed_boundary.processing_order IS NULL
      OR message.processing_order < initial_completed_boundary.processing_order)
  ORDER BY message.processing_order, message.id
  FOR UPDATE OF message
), initial_members_with_gap AS (
  SELECT initial_members.*,
    LAG(timestamp) OVER (ORDER BY processing_order, id) AS prior_received_at
  FROM initial_members
), initial_grouped_members AS (
  SELECT initial_members_with_gap.*,
    SUM(CASE WHEN prior_received_at IS NULL
      OR timestamp > prior_received_at + INTERVAL '${TURN_QUIET_SECONDS} seconds'
      THEN 1 ELSE 0 END) OVER (ORDER BY processing_order, id) AS group_number
  FROM initial_members_with_gap
), initial_group_summary AS (
  SELECT group_number,
    (ARRAY_AGG(id ORDER BY processing_order, id))[1] AS anchor_id,
    ARRAY_AGG(id ORDER BY processing_order, id) AS member_ids,
    BOOL_OR(processing_owner IS NOT NULL AND processing_lease_until > NOW()) AS has_active_lease
  FROM initial_grouped_members
  GROUP BY group_number
), superseded_groups AS (
  SELECT current_group.*, successor_group.anchor_id AS successor_anchor_id
  FROM initial_group_summary AS current_group
  JOIN initial_group_summary AS successor_group
    ON successor_group.group_number = current_group.group_number + 1
), superseded AS (
  UPDATE public.messages AS message
  SET processing_owner = NULL,
      processing_lease_until = NULL,
      processing_completed_at = NOW(),
      processing_outcome = 'superseded',
      metadata = message.metadata || jsonb_build_object(
        'session_ordering_state', 'superseded',
        'turn_anchor_id', superseded_groups.anchor_id::text,
        'turn_position', array_position(superseded_groups.member_ids, message.id),
        'turn_member_count', cardinality(superseded_groups.member_ids),
        'turn_superseded_at', NOW(),
        'turn_superseded_by_anchor_id', superseded_groups.successor_anchor_id::text,
        'turn_supersession_reason', 'newer_independent_turn'
      )
  FROM initial_grouped_members
  JOIN superseded_groups
    ON superseded_groups.group_number = initial_grouped_members.group_number
  WHERE message.id = initial_grouped_members.id
    AND superseded_groups.has_active_lease IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1 FROM public.messages AS outbound
      WHERE outbound.in_reply_to_id = superseded_groups.anchor_id
        AND outbound.direction = 'outbound'
    )
  RETURNING message.id
), candidate AS (
  SELECT message.*
  FROM public.messages AS message
  CROSS JOIN input
  WHERE message.session_id = input.payload->>'session_id'
    AND message.direction = 'inbound'
    AND message.processing_order IS NOT NULL
    AND message.processing_completed_at IS NULL
    AND message.id NOT IN (SELECT id FROM reconciled)
    AND message.id NOT IN (SELECT id FROM superseded)
    AND (SELECT COUNT(*) FROM reset_commercial_context) >= 0
  ORDER BY message.processing_order, message.id
  LIMIT 1
  FOR UPDATE OF message
), completed_boundary AS (
  SELECT MIN(message.processing_order) AS processing_order
  FROM public.messages AS message
  CROSS JOIN candidate
  WHERE message.session_id = candidate.session_id
    AND message.direction = 'inbound'
    AND message.processing_order > candidate.processing_order
    AND message.processing_completed_at IS NOT NULL
), members AS (
  SELECT message.*
  FROM public.messages AS message
  CROSS JOIN candidate
  CROSS JOIN completed_boundary
  WHERE message.session_id = candidate.session_id
    AND message.direction = 'inbound'
    AND message.processing_order >= candidate.processing_order
    AND message.processing_completed_at IS NULL
    AND (completed_boundary.processing_order IS NULL
      OR message.processing_order < completed_boundary.processing_order)
  ORDER BY message.processing_order, message.id
  FOR UPDATE OF message
), members_with_gap AS (
  SELECT members.*,
    LAG(timestamp) OVER (ORDER BY processing_order, id) AS prior_received_at
  FROM members
), burst_boundary AS (
  SELECT MIN(processing_order) AS processing_order
  FROM members_with_gap
  WHERE prior_received_at IS NOT NULL
    AND timestamp > prior_received_at + INTERVAL '${TURN_QUIET_SECONDS} seconds'
), turn_members AS (
  SELECT message.*
  FROM members AS message
  CROSS JOIN burst_boundary
  WHERE burst_boundary.processing_order IS NULL
    OR message.processing_order < burst_boundary.processing_order
), turn AS (
  SELECT
    (ARRAY_AGG(id ORDER BY processing_order, id))[1] AS anchor_id,
    STRING_AGG(COALESCE(body, ''), E'\\n' ORDER BY processing_order, id) AS combined_body,
    ARRAY_AGG(id ORDER BY processing_order, id) AS member_ids,
    MAX(timestamp) AS newest_received_at
  FROM turn_members
), claimed AS (
  UPDATE public.messages AS message
  SET processing_owner = input.payload->>'processing_owner',
      processing_lease_until = NOW() + INTERVAL '${SESSION_LEASE_MINUTES} minutes',
      processing_outcome = NULL,
      metadata = message.metadata || jsonb_strip_nulls(jsonb_build_object(
        'session_ordering_state', 'processing',
        'claim_acquired_at', NOW(),
        'claim_owner', NULLIF(input.payload->>'processing_owner', ''),
        'recovered_stale_claim', message.processing_lease_until <= NOW(),
        'turn_anchor_id', turn.anchor_id::text,
        'turn_position', array_position(turn.member_ids, message.id),
        'turn_member_count', cardinality(turn.member_ids)
      ))
  FROM turn_members
  CROSS JOIN turn
  CROSS JOIN input
  WHERE message.id = turn_members.id
    AND NOT EXISTS (
      SELECT 1
      FROM public.messages AS outbound
      WHERE outbound.in_reply_to_id = turn.anchor_id
        AND outbound.direction = 'outbound'
    )
    AND (
      message.processing_owner IS NULL
      OR message.processing_lease_until IS NULL
      OR message.processing_lease_until <= NOW()
      OR message.processing_owner = input.payload->>'processing_owner'
    )
    AND turn.newest_received_at <= NOW() - INTERVAL '${TURN_QUIET_SECONDS} seconds'
    AND NOT EXISTS (
      SELECT 1 FROM turn_members AS other
      WHERE other.processing_owner IS NOT NULL
        AND other.processing_lease_until > NOW()
        AND other.processing_owner <> input.payload->>'processing_owner'
    )
  RETURNING message.*
), claimed_anchor AS (
  SELECT claimed.*, turn.combined_body, turn.member_ids
  FROM claimed
  CROSS JOIN turn
  WHERE claimed.id = turn.anchor_id
)
SELECT claimed_anchor.*, 'acquired'::text AS claim_state, NULL::timestamptz AS quiet_until
FROM claimed_anchor
UNION ALL
SELECT candidate.*, NULL::text AS combined_body, NULL::uuid[] AS member_ids, 'busy'::text AS claim_state, NULL::timestamptz AS quiet_until
FROM candidate
WHERE NOT EXISTS (SELECT 1 FROM claimed_anchor)
  AND candidate.processing_owner IS NOT NULL
  AND candidate.processing_lease_until > NOW()
  AND candidate.processing_owner <> (SELECT payload->>'processing_owner' FROM input)
  AND NOT EXISTS (
    SELECT 1
    FROM public.messages AS outbound
    WHERE outbound.in_reply_to_id = candidate.id
      AND outbound.direction = 'outbound'
  )
UNION ALL
SELECT candidate.*, NULL::text AS combined_body, NULL::uuid[] AS member_ids, 'reconciliation'::text AS claim_state, NULL::timestamptz AS quiet_until
FROM candidate
WHERE NOT EXISTS (SELECT 1 FROM claimed_anchor)
  AND EXISTS (
  SELECT 1
  FROM public.messages AS outbound
  WHERE outbound.in_reply_to_id = candidate.id
    AND outbound.direction = 'outbound'
)
UNION ALL
SELECT candidate.*, NULL::text AS combined_body, NULL::uuid[] AS member_ids, 'deferred'::text AS claim_state,
  (turn.newest_received_at + INTERVAL '${TURN_QUIET_SECONDS} seconds') AS quiet_until
FROM candidate
CROSS JOIN turn
WHERE NOT EXISTS (SELECT 1 FROM claimed_anchor)
  AND turn.newest_received_at > NOW() - INTERVAL '${TURN_QUIET_SECONDS} seconds'
  AND NOT (candidate.processing_owner IS NOT NULL
    AND candidate.processing_lease_until > NOW()
    AND candidate.processing_owner <> (SELECT payload->>'processing_owner' FROM input))
  AND NOT EXISTS (
    SELECT 1 FROM public.messages AS outbound
    WHERE outbound.in_reply_to_id = candidate.id AND outbound.direction = 'outbound'
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
  NULL::text AS combined_body, NULL::uuid[] AS member_ids,
  'empty'::text AS claim_state, NULL::timestamptz AS quiet_until
FROM input
WHERE NOT EXISTS (SELECT 1 FROM candidate);`;

const COMPLETE_INBOUND_SQL = `WITH input AS (
  SELECT $1::jsonb AS payload
), anchor AS (
  SELECT message.id
  FROM public.messages AS message
  CROSS JOIN input
  WHERE message.id = NULLIF(input.payload->>'inbound_message_id', '')::uuid
    AND message.direction = 'inbound'
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
  CROSS JOIN anchor
  WHERE ${turnAnchorSql('message')} = anchor.id::text
    AND message.processing_owner = input.payload->>'processing_owner'
    AND message.processing_completed_at IS NULL
    AND ${logicalReply.fullyAcceptedSql('anchor.id')}
  RETURNING message.*
)
SELECT * FROM completed;`;

// Ticket 85: a controlled Conversation Engine availability response may be
// retried exactly once by its current owner, and only before the canonical
// outbound reservation exists.  The attempt marker is durable metadata on
// the anchor rather than a new state machine: the existing claim, reservation
// and completion contracts remain authoritative.
const AUTHORIZE_CONVERSATION_ENGINE_RECOVERY_SQL = `WITH input AS (
  SELECT $1::jsonb AS payload
), anchor AS (
  SELECT inbound.id, inbound.session_id
  FROM public.messages AS inbound
  CROSS JOIN input
  WHERE inbound.id = NULLIF(input.payload->>'inbound_message_id', '')::uuid
    AND inbound.direction = 'inbound'
  FOR UPDATE OF inbound
), turn_members AS (
  SELECT member.*
  FROM public.messages AS member
  CROSS JOIN anchor
  WHERE ${turnAnchorSql('member')} = anchor.id::text
  FOR UPDATE OF member
), eligible AS (
  SELECT anchor.id
  FROM anchor
  CROSS JOIN input
  WHERE NOT EXISTS (
    SELECT 1 FROM public.messages AS outbound
    WHERE outbound.in_reply_to_id = anchor.id
      AND outbound.direction = 'outbound'
  )
    AND NOT EXISTS (
      SELECT 1 FROM turn_members AS member
      WHERE member.processing_completed_at IS NOT NULL
        OR member.processing_owner IS DISTINCT FROM input.payload->>'processing_owner'
        OR member.processing_lease_until IS NULL
        OR member.processing_lease_until <= NOW()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.messages AS claimed_anchor
      WHERE claimed_anchor.id = anchor.id
        AND claimed_anchor.metadata ? 'ticket85_conversation_engine_recovery_attempted_at'
    )
), consumed AS (
  UPDATE public.messages AS member
  SET processing_lease_until = NOW() + INTERVAL '${SESSION_LEASE_MINUTES} minutes',
      metadata = CASE WHEN member.id = (SELECT id FROM eligible)
        THEN member.metadata || jsonb_build_object(
          'ticket85_conversation_engine_recovery_attempted_at', NOW(),
          'ticket85_conversation_engine_recovery_owner', input.payload->>'processing_owner'
        )
        ELSE member.metadata
      END
  FROM input
  WHERE member.id IN (SELECT id FROM turn_members)
    AND EXISTS (SELECT 1 FROM eligible)
  RETURNING member.id
)
SELECT CASE WHEN EXISTS (SELECT 1 FROM eligible)
  AND (SELECT COUNT(*) FROM consumed) = (SELECT COUNT(*) FROM turn_members)
  THEN 'authorized' ELSE 'ineligible' END AS recovery_state;`;

const RESERVE_MULTIPART_OUTBOUND_SQL = `WITH input AS (
  SELECT $1::jsonb AS payload
), ${renewTurnLeaseSql()}, parts AS (
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
  const withLease = sql.replace(marker, `), ${renewTurnLeaseSql()}, reserved AS (`);
  return withLease.replace(
    "  WHERE NULLIF(input.payload->>'body', '') IS NOT NULL",
    "  WHERE EXISTS (SELECT 1 FROM renewed_claim)\n    AND NULLIF(input.payload->>'body', '') IS NOT NULL",
  );
}

module.exports = {
  SESSION_LEASE_MINUTES,
  CLAIM_RETRY_SECONDS,
  TURN_QUIET_SECONDS,
  RESERVE_INBOUND_SQL,
  CLAIM_NEXT_INBOUND_SQL,
  COMPLETE_INBOUND_SQL,
  AUTHORIZE_CONVERSATION_ENGINE_RECOVERY_SQL,
  RESERVE_MULTIPART_OUTBOUND_SQL,
  addLeaseOwnershipToOutboundReservation,
};
