-- Ticket V4: resolve only evidence-backed outbound reservations.  This is a
-- bounded FIFO-head operation: it never generates a reply or inserts one.
BEGIN;

CREATE FUNCTION public.claim_v4_outbound_reconciliation(p jsonb)
RETURNS TABLE (reconciliation_state text, outbound_id uuid, session_id text, body text, idempotency_key text, redispatch_token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  inbound public.messages%ROWTYPE;
  candidate public.messages%ROWTYPE;
  unresolved integer;
  send_token text;
BEGIN
  IF jsonb_typeof(p) <> 'object'
     OR NOT (p ?& ARRAY['inbound_message_id', 'session_id', 'processing_owner'])
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) key
                WHERE key NOT IN ('inbound_message_id', 'session_id', 'processing_owner'))
     OR NULLIF(btrim(p->>'session_id'), '') IS NULL
     OR NULLIF(btrim(p->>'processing_owner'), '') IS NULL THEN
    RAISE EXCEPTION 'V4_RECONCILIATION_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p->>'session_id', 17));
  SELECT message.* INTO inbound FROM public.messages AS message
  WHERE message.id = (p->>'inbound_message_id')::uuid AND message.direction = 'inbound'
    AND message.session_id = p->>'session_id' AND message.processing_completed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.messages earlier
    WHERE earlier.session_id = inbound.session_id AND earlier.direction = 'inbound'
      AND earlier.processing_completed_at IS NULL
      AND earlier.processing_order < inbound.processing_order
  ) THEN RAISE EXCEPTION 'V4_RECONCILIATION_NOT_FIFO_HEAD'; END IF;
  IF inbound.processing_owner IS NOT NULL AND inbound.processing_lease_until > now()
     AND inbound.processing_owner IS DISTINCT FROM p->>'processing_owner' THEN
    RAISE EXCEPTION 'V4_RECONCILIATION_OWNED';
  END IF;
  IF inbound.metadata->>'reconciliation_state' = 'operator_required' THEN
    RETURN QUERY SELECT 'escalated'::text, NULL::uuid, inbound.session_id, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM 1 FROM public.messages part
  WHERE part.in_reply_to_id = inbound.id AND part.direction = 'outbound' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'V4_RECONCILIATION_RESERVATION_MISSING'; END IF;
  UPDATE public.messages member
  SET processing_owner = p->>'processing_owner', processing_lease_until = now() + interval '15 minutes',
      metadata = member.metadata || jsonb_build_object('reconciliation_claimed_at', now(), 'reconciliation_owner', p->>'processing_owner')
  WHERE member.direction = 'inbound' AND member.processing_completed_at IS NULL
    AND COALESCE(member.metadata->>'turn_anchor_id', member.id::text) = inbound.id::text;

  -- A persisted Twilio message SID is genuine provider acceptance evidence;
  -- this only repairs an interrupted local delivery-status write.
  UPDATE public.messages part
  SET delivery_status = 'accepted', metadata = part.metadata || jsonb_build_object(
        'provider_acceptance_evidence', 'message_sid',
        'reconciliation_provider_evidence_at', now())
  WHERE part.in_reply_to_id = inbound.id AND part.direction = 'outbound'
    AND part.delivery_status = 'pending'
    AND part.provider_message_sid ~ '^(SM|MM)[0-9a-fA-F]{32}$';

  SELECT count(*) INTO unresolved FROM public.messages part
  WHERE part.in_reply_to_id = inbound.id AND part.direction = 'outbound'
    AND NOT (part.delivery_status IN ('accepted', 'scheduled', 'sent', 'delivered')
      AND (part.provider_message_sid ~ '^(SM|MM)[0-9a-fA-F]{32}$'
        OR part.metadata->>'provider_acceptance_evidence' = 'message_sid'));
  IF unresolved = 0 THEN
    RETURN QUERY SELECT 'accepted'::text, NULL::uuid, inbound.session_id, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Twilio 21617 is an explicit pre-acceptance rejection.  Only one such
  -- unsent part may be reclaimed, and only once, using the original body/key.
  SELECT * INTO candidate FROM public.messages part
  WHERE part.in_reply_to_id = inbound.id AND part.direction = 'outbound'
    AND part.delivery_status = 'failed'
    AND part.metadata->>'provider_error_code' = '21617'
    AND NOT (part.metadata ? 'reconciliation_redispatch_token')
  ORDER BY (part.metadata->>'part_index')::integer
  LIMIT 1 FOR UPDATE;
  IF FOUND AND unresolved = 1 THEN
    send_token := gen_random_uuid()::text;
    UPDATE public.messages SET delivery_status = 'pending', metadata = metadata || jsonb_build_object(
      'reconciliation_redispatch_token', send_token,
      'reconciliation_redispatch_claimed_at', now(),
      'reconciliation_non_submission_evidence', 'twilio_21617')
    WHERE id = candidate.id;
    RETURN QUERY SELECT 'redispatch'::text, candidate.id, candidate.session_id, candidate.body, candidate.idempotency_key, send_token;
    RETURN;
  END IF;

  -- No SID is not proof of non-submission.  Stop future scheduled wakes and
  -- leave the FIFO head durable for operator/provider evidence reconciliation.
  UPDATE public.messages member
  SET processing_owner = NULL, processing_lease_until = NULL,
      processing_outcome = 'reconciliation', metadata = member.metadata || jsonb_build_object(
        'session_ordering_state', 'reconciliation', 'reconciliation_state', 'operator_required',
        'reconciliation_escalated_at', now(), 'reconciliation_unresolved_parts', unresolved)
  WHERE member.direction = 'inbound' AND member.processing_completed_at IS NULL
    AND COALESCE(member.metadata->>'turn_anchor_id', member.id::text) = inbound.id::text;
  INSERT INTO public.logs (event, severity, error_message, error_context)
  VALUES ('v4_outbound_reconciliation_required', 'error', 'Outbound reservation requires provider evidence before any resend.',
    jsonb_build_object('inbound_message_id', inbound.id, 'session_id', inbound.session_id, 'unresolved_parts', unresolved));
  RETURN QUERY SELECT 'escalated'::text, NULL::uuid, inbound.session_id, NULL::text, NULL::text, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_v4_outbound_reconciliation(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_v4_outbound_reconciliation(jsonb) TO service_role;
COMMENT ON FUNCTION public.claim_v4_outbound_reconciliation(jsonb) IS 'Ticket V4 bounded outbound reconciliation: acceptance evidence, one proven-non-submission redispatch, or operator escalation.';

COMMIT;
