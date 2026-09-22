BEGIN;
-- BEGIN GENERATED TICKET 37A RECOVERY FUNCTIONS

CREATE OR REPLACE FUNCTION public.prepare_whatsapp_reply_recovery(p jsonb)
RETURNS SETOF public.messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE
  inbound public.messages%ROWTYPE;
  base public.messages%ROWTYPE;
  session_key text;
  source_hash text;
  part_total integer;
  i integer;
  candidate text;
  common_metadata jsonb;
BEGIN
  IF p->>'expected_hash' !~ '^[0-9a-f]{64}$'
     OR COALESCE(p->>'confirmed_error_code', '') <> '21617'
     OR COALESCE(p->>'evidence_reference', '') = ''
     OR length(p->>'evidence_reference') > 200 THEN
    RAISE EXCEPTION 'RECOVERY_INVALID_EVIDENCE';
  END IF;
  SELECT session_id INTO STRICT session_key FROM public.messages WHERE id = (p->>'inbound_id')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(session_key, 17));
  SELECT * INTO STRICT inbound FROM public.messages WHERE id = (p->>'inbound_id')::uuid FOR UPDATE;
  SELECT * INTO STRICT base FROM public.messages WHERE id = (p->>'outbound_id')::uuid FOR UPDATE;
  PERFORM id FROM public.messages WHERE in_reply_to_id = inbound.id ORDER BY id FOR UPDATE;
  source_hash := encode(sha256(convert_to(base.assistant_response, 'UTF8')), 'hex');
  IF inbound.direction <> 'inbound' OR base.direction <> 'outbound'
     OR base.in_reply_to_id IS DISTINCT FROM inbound.id
     OR base.session_id IS DISTINCT FROM inbound.session_id
     OR base.session_id IS DISTINCT FROM p->>'expected_session_id'
     OR base.provider <> 'twilio' OR inbound.provider <> 'twilio'
     OR base.idempotency_key IS DISTINCT FROM p->>'expected_key'
     OR base.idempotency_key IS DISTINCT FROM 'reply:' || inbound.provider_message_sid || ':paid'
     OR source_hash IS DISTINCT FROM p->>'expected_hash'
     OR NULLIF(base.assistant_response, '') IS NULL THEN
    RAISE EXCEPTION 'RECOVERY_IDENTITY_OR_HASH_CHANGED';
  END IF;
  IF jsonb_typeof(p->'parts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'RECOVERY_INVALID_PARTS'; END IF;
  part_total := jsonb_array_length(p->'parts');
  IF part_total NOT BETWEEN 1 AND 999 THEN RAISE EXCEPTION 'RECOVERY_INVALID_PART_COUNT'; END IF;
  FOR i IN 1..part_total LOOP
    candidate := p->'parts'->>(i - 1);
    IF jsonb_typeof(p->'parts'->(i - 1)) <> 'string' OR NULLIF(btrim(candidate), '') IS NULL
       OR char_length(candidate) > 1500
       OR (SELECT SUM(CASE WHEN ascii(c) > 65535 THEN 2 ELSE 1 END) FROM regexp_split_to_table(candidate, '') c) > 1500
       THEN RAISE EXCEPTION 'RECOVERY_INVALID_PART_BODY'; END IF;
  END LOOP;
  -- A duplicate preparation is read-only, including after successful sending.
  IF base.metadata ? 'recovery_source_hash' THEN
    IF base.metadata->>'recovery_source_hash' IS DISTINCT FROM source_hash
       OR base.metadata->>'recovery_evidence_reference' IS DISTINCT FROM p->>'evidence_reference'
       OR (SELECT jsonb_agg(body ORDER BY (metadata->>'part_index')::integer)
           FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound') IS DISTINCT FROM p->'parts'
       OR EXISTS (SELECT 1 FROM public.messages AS sibling WHERE sibling.in_reply_to_id = inbound.id AND sibling.direction = 'outbound'
          AND (sibling.metadata->>'logical_reply_key' IS DISTINCT FROM base.idempotency_key
            OR sibling.metadata->'part_count' IS DISTINCT FROM to_jsonb(part_total)
            OR sibling.metadata->>'recovery_source_hash' IS DISTINCT FROM source_hash
            OR sibling.assistant_response IS DISTINCT FROM base.assistant_response
            OR sibling.delivery_status NOT IN ('pending', 'accepted', 'scheduled', 'sent', 'delivered')
            OR (sibling.delivery_status = 'pending' AND sibling.provider_message_sid IS NOT NULL)
            OR (sibling.delivery_status <> 'pending' AND NOT COALESCE(sibling.provider_message_sid ~ '^(SM|MM)[0-9a-fA-F]{32}$'
              OR sibling.metadata->>'provider_acceptance_evidence' = 'message_sid', FALSE)))) THEN
      RAISE EXCEPTION 'RECOVERY_PREPARED_STATE_CHANGED';
    END IF;
    FOR i IN 1..part_total LOOP
      IF NOT EXISTS (SELECT 1 FROM public.messages AS sibling WHERE sibling.in_reply_to_id = inbound.id
        AND sibling.direction = 'outbound' AND sibling.session_id = session_key
        AND sibling.metadata->'part_index' = to_jsonb(i)
        AND sibling.idempotency_key = CASE WHEN i = 1 THEN base.idempotency_key ELSE base.idempotency_key || ':part:' || LPAD(i::text, 3, '0') END
        AND sibling.metadata->>'recovery_body_hash' = encode(sha256(convert_to(p->'parts'->>(i - 1), 'UTF8')), 'hex')) THEN
        RAISE EXCEPTION 'RECOVERY_PREPARED_STATE_CHANGED';
      END IF;
    END LOOP;
    RETURN QUERY SELECT * FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound'
      ORDER BY (metadata->>'part_index')::integer;
    RETURN;
  END IF;
  -- Historical reconciliation completion is not successful delivery. Reopen
  -- only by explicit compare-and-set, under the same session/row locks as parts.
  IF inbound.processing_completed_at IS NOT NULL THEN
    IF p->'reopen_historical_reconciliation' IS DISTINCT FROM 'true'::jsonb
       OR inbound.processing_outcome IS DISTINCT FROM 'reconciliation'
       OR inbound.processing_completed_at IS DISTINCT FROM (p->>'expected_processing_completed_at')::timestamptz
       OR inbound.processing_owner IS NOT NULL OR inbound.processing_lease_until IS NOT NULL
       OR inbound.processing_order IS NULL
       OR base.metadata ?| ARRAY['part_index', 'part_count', 'logical_reply_key']
       OR inbound.metadata ? 'recovery_historical_reopen' THEN
      RAISE EXCEPTION 'RECOVERY_HISTORICAL_REOPEN_NOT_ALLOWED';
    END IF;
    -- An old completion may already have released FIFO to another execution.
    -- Never reopen behind a worker that could still perform side effects.
    IF EXISTS (SELECT 1 FROM public.messages other
      WHERE other.session_id = session_key AND other.direction = 'inbound' AND other.id <> inbound.id
        AND (other.processing_owner IS NOT NULL OR other.processing_lease_until > NOW()
          OR (other.processing_completed_at IS NULL AND EXISTS (
            SELECT 1 FROM public.messages outbound WHERE outbound.in_reply_to_id = other.id
              AND outbound.direction = 'outbound')))) THEN
      RAISE EXCEPTION 'RECOVERY_SESSION_RECONCILIATION_REQUIRED';
    END IF;
  ELSIF p->'reopen_historical_reconciliation' = 'true'::jsonb THEN
    RAISE EXCEPTION 'RECOVERY_HISTORICAL_STATE_CHANGED';
  END IF;
  IF (inbound.processing_owner IS NOT NULL AND inbound.processing_lease_until > NOW())
     OR base.delivery_status NOT IN ('unknown', 'failed')
     OR base.provider_message_sid IS NOT NULL
     OR base.metadata ? 'recovery_send_token' OR base.metadata ? 'recovery_prepared_at'
     OR (NULLIF(base.metadata->>'provider_error_code', '') IS NOT NULL AND base.metadata->>'provider_error_code' <> '21617')
     OR base.metadata->>'provider_acceptance_evidence' = 'message_sid'
     OR EXISTS (SELECT 1 FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound' AND id <> base.id) THEN
    RAISE EXCEPTION 'RECOVERY_UNSAFE_EXISTING_STATE';
  END IF;
  common_metadata := jsonb_build_object(
    'original_character_count', p->'length_metadata'->'original_character_count',
    'final_character_count', p->'length_metadata'->'final_character_count',
    'was_compacted', p->'length_metadata'->'was_compacted',
    'was_split', part_total > 1,
    'logical_reply_key', base.idempotency_key, 'part_count', part_total,
    'recovery_source_hash', source_hash, 'recovery_prepared_at', NOW(),
    'recovery_evidence_reference', p->>'evidence_reference',
    'recovery_original_evidence', jsonb_build_object(
      'delivery_status', base.delivery_status, 'verified_error_code', '21617',
      'provider_error_code', base.metadata->'provider_error_code',
      'provider_error_message', base.metadata->'provider_error_message',
      'provider_status', base.metadata->'provider_status',
      'original_body_sha256', encode(sha256(convert_to(base.body, 'UTF8')), 'hex')
    ));
  UPDATE public.messages SET body = p->'parts'->>0, delivery_status = 'pending',
    metadata = metadata || common_metadata || jsonb_build_object('part_index', 1,
      'recovery_body_hash', encode(sha256(convert_to(p->'parts'->>0, 'UTF8')), 'hex'))
  WHERE id = base.id;
  FOR i IN 2..part_total LOOP
    candidate := p->'parts'->>(i - 1);
    INSERT INTO public.messages (user_id, session_id, direction, body, message_kind, provider,
      idempotency_key, in_reply_to_id, delivery_status, metadata, assistant_response)
    VALUES (base.user_id, base.session_id, 'outbound', candidate, base.message_kind, 'twilio',
      base.idempotency_key || ':part:' || LPAD(i::text, 3, '0'), inbound.id, 'pending',
      common_metadata || jsonb_build_object('part_index', i,
        'recovery_body_hash', encode(sha256(convert_to(candidate, 'UTF8')), 'hex')), base.assistant_response);
  END LOOP;
  UPDATE public.messages SET processing_owner = NULL, processing_lease_until = NULL,
    processing_completed_at = NULL,
    processing_outcome = 'reconciliation', metadata = metadata ||
      CASE WHEN inbound.processing_completed_at IS NOT NULL THEN jsonb_build_object(
        'recovery_historical_reopen', jsonb_build_object(
          'previous_processing_completed_at', inbound.processing_completed_at,
          'previous_processing_outcome', inbound.processing_outcome,
          'previous_session_ordering_state', inbound.metadata->'session_ordering_state',
          'reopened_at', NOW(), 'outbound_id', base.id,
          'source_hash', source_hash, 'evidence_reference', p->>'evidence_reference',
          'confirmed_error_code', '21617')) ELSE '{}'::jsonb END ||
      jsonb_build_object('session_ordering_state', 'reconciliation')
  WHERE id = inbound.id;
  RETURN QUERY SELECT * FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound'
    ORDER BY (metadata->>'part_index')::integer;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_whatsapp_reply_recovery_part(p jsonb)
RETURNS SETOF public.messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE
  inbound public.messages%ROWTYPE;
  base public.messages%ROWTYPE;
  part public.messages%ROWTYPE;
  selected_id uuid;
  session_key text;
  part_total integer;
  i integer := 0;
BEGIN
  SELECT session_id INTO STRICT session_key FROM public.messages WHERE id = (p->>'inbound_id')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(session_key, 17));
  SELECT * INTO STRICT inbound FROM public.messages WHERE id = (p->>'inbound_id')::uuid FOR UPDATE;
  SELECT * INTO STRICT base FROM public.messages WHERE id = (p->>'outbound_id')::uuid FOR UPDATE;
  IF base.in_reply_to_id IS DISTINCT FROM inbound.id OR base.idempotency_key IS DISTINCT FROM p->>'expected_key'
     OR base.session_id IS DISTINCT FROM p->>'expected_session_id'
     OR base.session_id IS DISTINCT FROM inbound.session_id OR inbound.direction <> 'inbound'
     OR base.metadata->>'recovery_source_hash' IS DISTINCT FROM p->>'expected_hash'
     OR p->>'expected_hash' IS NULL OR inbound.processing_completed_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.messages earlier WHERE earlier.session_id = session_key
       AND earlier.direction = 'inbound' AND earlier.processing_completed_at IS NULL
       AND earlier.processing_order < inbound.processing_order)
     OR (inbound.processing_owner IS NOT NULL AND inbound.processing_lease_until > NOW()) THEN
    RAISE EXCEPTION 'RECOVERY_CLAIM_IDENTITY_CHANGED';
  END IF;
  IF COALESCE(p->>'send_token', '') !~ '^[0-9a-f-]{36}$'
     OR NOT EXISTS (SELECT 1 FROM public.messages WHERE direction = 'inbound' AND provider = 'twilio'
       AND session_id = session_key AND provider_message_sid = p->>'window_inbound_sid'
       AND timestamp > NOW() - INTERVAL '23 hours 55 minutes' AND timestamp <= NOW())
     OR p->>'window_verified_at' IS NULL
     OR (p->>'window_verified_at')::timestamptz NOT BETWEEN NOW() - INTERVAL '1 minute' AND NOW() + INTERVAL '5 seconds' THEN
    RAISE EXCEPTION 'RECOVERY_WINDOW_NOT_VERIFIED';
  END IF;
  part_total := (base.metadata->>'part_count')::integer;
  IF part_total IS NULL OR part_total NOT BETWEEN 1 AND 999 THEN RAISE EXCEPTION 'RECOVERY_PART_INTEGRITY'; END IF;
  FOR part IN SELECT * FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound'
    ORDER BY (metadata->>'part_index')::integer FOR UPDATE LOOP
    i := i + 1;
    IF part.metadata->'part_index' IS DISTINCT FROM to_jsonb(i)
       OR part.metadata->'part_count' IS DISTINCT FROM to_jsonb(part_total)
       OR part.metadata->>'logical_reply_key' IS DISTINCT FROM base.idempotency_key
       OR part.metadata->>'recovery_source_hash' IS DISTINCT FROM p->>'expected_hash'
       OR encode(sha256(convert_to(part.assistant_response, 'UTF8')), 'hex') IS DISTINCT FROM p->>'expected_hash'
       OR part.metadata->>'recovery_body_hash' IS DISTINCT FROM encode(sha256(convert_to(part.body, 'UTF8')), 'hex')
       OR part.session_id IS DISTINCT FROM session_key
       OR part.idempotency_key IS DISTINCT FROM (CASE WHEN i = 1 THEN base.idempotency_key ELSE base.idempotency_key || ':part:' || LPAD(i::text, 3, '0') END) THEN
      RAISE EXCEPTION 'RECOVERY_PART_INTEGRITY';
    END IF;
    IF selected_id IS NULL AND part.delivery_status NOT IN ('accepted', 'scheduled', 'sent', 'delivered') THEN
      IF part.delivery_status <> 'pending' OR part.provider_message_sid IS NOT NULL
         OR part.metadata ? 'recovery_send_token' THEN RAISE EXCEPTION 'RECOVERY_RECONCILIATION_REQUIRED'; END IF;
      selected_id := part.id;
    ELSIF selected_id IS NOT NULL AND part.id <> selected_id AND
      (part.delivery_status <> 'pending' OR part.provider_message_sid IS NOT NULL OR part.metadata ? 'recovery_send_token') THEN
      RAISE EXCEPTION 'RECOVERY_UNEXPECTED_LATER_PART_STATE';
    ELSIF selected_id IS NULL AND NOT COALESCE(part.provider_message_sid ~ '^(SM|MM)[0-9a-fA-F]{32}$'
      OR part.metadata->>'provider_acceptance_evidence' = 'message_sid', FALSE) THEN
      RAISE EXCEPTION 'RECOVERY_ACCEPTANCE_EVIDENCE_MISSING';
    END IF;
  END LOOP;
  IF i <> part_total THEN RAISE EXCEPTION 'RECOVERY_PART_MISSING'; END IF;
  IF selected_id IS NULL THEN RETURN; END IF;
  RETURN QUERY UPDATE public.messages SET metadata = metadata || jsonb_build_object(
    'recovery_send_token', p->>'send_token', 'recovery_send_claimed_at', NOW(),
    'recovery_window_inbound_sid', p->>'window_inbound_sid') WHERE id = selected_id RETURNING *;
END;
$function$;

REVOKE ALL ON FUNCTION public.prepare_whatsapp_reply_recovery(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_whatsapp_reply_recovery_part(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_whatsapp_reply_recovery(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_reply_recovery_part(jsonb) TO service_role;

-- END GENERATED TICKET 37A RECOVERY FUNCTIONS

COMMIT;
