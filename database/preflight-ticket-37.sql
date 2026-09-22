-- Ticket 37: read-only evidence for the stranded paid reply.
-- Run through the trusted backend connection. This intentionally returns no
-- customer-visible message content and performs no mutation.
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
  outbound.id AS outbound_id,
  outbound.in_reply_to_id AS inbound_id,
  outbound.idempotency_key,
  outbound.delivery_status,
  outbound.provider_message_sid,
  outbound."timestamp" AS reserved_at,
  char_length(outbound.body) AS body_character_count,
  encode(sha256(convert_to(outbound.body, 'UTF8')), 'hex') AS body_sha256,
  NULLIF(outbound.assistant_response, '') IS NOT NULL AS stored_reply_available,
  char_length(outbound.assistant_response) AS stored_reply_character_count,
  outbound.metadata,
  inbound.processing_completed_at,
  inbound.processing_outcome
FROM target_outbound AS outbound
JOIN target_inbound AS inbound ON inbound.id = outbound.in_reply_to_id;
