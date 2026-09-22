-- Ticket 36: read-only production evidence for the reported paid reply.
-- This file intentionally performs no mutation and does not query Twilio.
WITH target_outbound AS (
  SELECT message.*
  FROM public.messages AS message
  WHERE message.idempotency_key =
    'reply:SMf79859ae7c0c371d57060f58334c6bce:paid'
    AND message.direction = 'outbound'
), target_inbound AS (
  SELECT inbound.*
  FROM public.messages AS inbound
  JOIN target_outbound AS outbound ON outbound.in_reply_to_id = inbound.id
)
SELECT
  'outbound'::text AS record_type,
  outbound.id,
  outbound.direction,
  outbound.delivery_status,
  outbound.provider,
  outbound.provider_message_sid,
  outbound.idempotency_key,
  outbound.in_reply_to_id,
  outbound.processing_completed_at,
  outbound.processing_outcome,
  outbound."timestamp",
  outbound.metadata
FROM target_outbound AS outbound
UNION ALL
SELECT
  'inbound'::text AS record_type,
  inbound.id,
  inbound.direction,
  inbound.delivery_status,
  inbound.provider,
  inbound.provider_message_sid,
  inbound.idempotency_key,
  inbound.in_reply_to_id,
  inbound.processing_completed_at,
  inbound.processing_outcome,
  inbound."timestamp",
  inbound.metadata
FROM target_inbound AS inbound
ORDER BY record_type;
