-- Read-only, exact incident evidence. Run only through the trusted backend.
SELECT inbound.id AS inbound_id, base.id AS outbound_id,
  base.idempotency_key AS expected_key, base.session_id AS expected_session_id,
  base.delivery_status, base.provider_message_sid,
  inbound.processing_owner, inbound.processing_lease_until,
  inbound.processing_completed_at, inbound.processing_outcome,
  char_length(base.assistant_response) AS stored_reply_character_count,
  encode(sha256(convert_to(base.assistant_response, 'UTF8')), 'hex') AS expected_hash,
  to_regprocedure('public.prepare_whatsapp_reply_recovery(jsonb)') IS NOT NULL AS prepare_rpc_installed,
  COALESCE(pg_get_functiondef(to_regprocedure('public.prepare_whatsapp_reply_recovery(jsonb)'))
    LIKE '%RECOVERY_HISTORICAL_REOPEN_NOT_ALLOWED%', FALSE) AS historical_reopen_guard_installed,
  to_regprocedure('public.claim_whatsapp_reply_recovery_part(jsonb)') IS NOT NULL AS claim_rpc_installed
FROM public.messages inbound JOIN public.messages base ON base.in_reply_to_id = inbound.id
WHERE inbound.id = 'b97863b2-611c-4ffc-91d0-13202cbfb298'
  AND base.id = '349000f3-1c94-4efe-97f2-03637584c671'
  AND inbound.direction = 'inbound' AND base.direction = 'outbound'
  AND base.idempotency_key = 'reply:SMf79859ae7c0c371d57060f58334c6bce:paid';

SELECT id, idempotency_key, delivery_status, provider_message_sid,
  metadata->>'part_index' AS part_index, metadata->>'part_count' AS part_count,
  metadata->>'logical_reply_key' AS logical_reply_key,
  metadata->>'recovery_source_hash' AS recovery_source_hash,
  metadata ? 'recovery_send_token' AS send_claimed,
  encode(sha256(convert_to(body, 'UTF8')), 'hex') AS body_hash
FROM public.messages
WHERE direction = 'outbound' AND in_reply_to_id = 'b97863b2-611c-4ffc-91d0-13202cbfb298'
ORDER BY timestamp, id;

-- Review other work already released by the historical completion. No bodies.
SELECT id, processing_order, processing_owner, processing_lease_until,
  processing_completed_at, processing_outcome,
  EXISTS (SELECT 1 FROM public.messages outbound WHERE outbound.in_reply_to_id = inbound.id
    AND outbound.direction = 'outbound') AS has_outbound
FROM public.messages inbound
WHERE inbound.direction = 'inbound' AND inbound.session_id = (
  SELECT session_id FROM public.messages WHERE id = 'b97863b2-611c-4ffc-91d0-13202cbfb298')
ORDER BY processing_order, id;
