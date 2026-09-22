-- Ticket 28A: generalize Ticket 28 verification for paid WhatsApp assistance.
BEGIN;

ALTER TABLE public.portal_recovery_initiations
  ADD COLUMN purpose text NOT NULL DEFAULT 'recover_portal',
  ADD COLUMN pending_message_id uuid,
  ADD CONSTRAINT portal_recovery_initiations_purpose_check CHECK (
    purpose IN ('recover_portal', 'link_whatsapp')
  ),
  ADD CONSTRAINT portal_recovery_initiations_pending_message_fkey
    FOREIGN KEY (pending_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;

ALTER TABLE public.portal_recovery_requests
  ADD COLUMN purpose text NOT NULL DEFAULT 'recover_portal',
  ADD COLUMN pending_message_id uuid,
  ADD CONSTRAINT portal_recovery_requests_purpose_check CHECK (
    purpose IN ('recover_portal', 'link_whatsapp')
  ),
  ADD CONSTRAINT portal_recovery_requests_pending_message_fkey
    FOREIGN KEY (pending_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX portal_recovery_initiations_session_active_idx
  ON public.portal_recovery_initiations (initiating_whatsapp_id, purpose, expires_at)
  WHERE used_at IS NULL;
CREATE INDEX portal_recovery_requests_session_active_idx
  ON public.portal_recovery_requests (initiating_whatsapp_id, purpose, expires_at)
  WHERE used_at IS NULL AND invalidated_at IS NULL;

ALTER TABLE public.messages DROP CONSTRAINT messages_message_kind_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_message_kind_check CHECK (
  message_kind IS NULL OR message_kind IN (
    'user', 'sales_ai', 'sales_deterministic', 'checkout', 'paid_ai',
    'paid_deterministic', 'fallback', 'customer_error', 'setup_link',
    'welcome', 'reminder_confirmation', 'reminder_scheduled',
    'media_clarification', 'legacy_cancellation', 'portal_recovery',
    'identity_verification'
  )
);

DROP FUNCTION public.redeem_portal_recovery(text, text);
DROP FUNCTION public.create_portal_recovery_request(text, text, timestamptz, text);

CREATE FUNCTION public.create_portal_recovery_request(
  input_email text,
  input_token_hash text,
  input_expires_at timestamptz,
  input_initiation_token_hash text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  normalized_email text := lower(btrim(COALESCE(input_email, '')));
  eligible_user_id uuid;
  eligible_count integer;
  recovered_whatsapp_id text;
  recovered_purpose text := 'recover_portal';
  recovered_pending_message_id uuid;
BEGIN
  IF input_token_hash !~ '^[0-9a-f]{64}$'
     OR input_expires_at <= now()
     OR input_expires_at > now() + interval '60 minutes' THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_email, 28));

  SELECT (array_agg(app_user.id))[1], count(*)
  INTO eligible_user_id, eligible_count
  FROM public.users AS app_user
  WHERE lower(app_user.email) = normalized_email
    AND EXISTS (
      SELECT 1 FROM public.purchases AS purchase
      WHERE purchase.user_id = app_user.id
        AND purchase.payment_status = 'paid'
    );

  IF eligible_count <> 1 THEN RETURN false; END IF;

  IF (
    SELECT count(*) FROM public.portal_recovery_requests
    WHERE user_id = eligible_user_id
      AND created_at > now() - interval '15 minutes'
  ) >= 5 THEN
    RETURN false;
  END IF;

  IF input_initiation_token_hash IS NOT NULL THEN
    UPDATE public.portal_recovery_initiations AS initiation
    SET used_at = now()
    WHERE initiation.token_hash = input_initiation_token_hash
      AND initiation.used_at IS NULL
      AND initiation.expires_at > now()
    RETURNING initiation.initiating_whatsapp_id, initiation.purpose,
      initiation.pending_message_id
    INTO recovered_whatsapp_id, recovered_purpose,
      recovered_pending_message_id;

    IF recovered_whatsapp_id IS NULL THEN RETURN false; END IF;
  END IF;

  UPDATE public.portal_recovery_requests
  SET invalidated_at = now()
  WHERE user_id = eligible_user_id
    AND purpose = recovered_purpose
    AND used_at IS NULL
    AND invalidated_at IS NULL;

  INSERT INTO public.portal_recovery_requests (
    user_id, token_hash, initiating_whatsapp_id, purpose,
    pending_message_id, expires_at
  ) VALUES (
    eligible_user_id, input_token_hash, recovered_whatsapp_id,
    recovered_purpose, recovered_pending_message_id, input_expires_at
  );

  RETURN true;
END;
$$;

CREATE FUNCTION public.redeem_portal_recovery(
  input_token_hash text,
  input_new_portal_token text
) RETURNS TABLE (
  portal_token text,
  whatsapp_link_status text,
  verification_purpose text,
  resume_scheduled boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  target_request public.portal_recovery_requests%ROWTYPE;
  target_whatsapp_id text;
  conflicting_user_id uuid;
  resolved_link_status text := 'not_requested';
  resumed_count integer := 0;
BEGIN
  IF input_token_hash !~ '^[0-9a-f]{64}$'
     OR input_new_portal_token !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  SELECT * INTO target_request
  FROM public.portal_recovery_requests AS request
  WHERE request.token_hash = input_token_hash
    AND request.used_at IS NULL
    AND request.invalidated_at IS NULL
    AND request.expires_at > now()
  FOR UPDATE;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.purchases AS purchase
    WHERE purchase.user_id = target_request.user_id
      AND purchase.payment_status = 'paid'
  ) THEN
    RETURN;
  END IF;

  SELECT whatsapp_id INTO target_whatsapp_id
  FROM public.users WHERE id = target_request.user_id FOR UPDATE;

  IF target_request.initiating_whatsapp_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(target_request.initiating_whatsapp_id, 28)
    );
    SELECT id INTO conflicting_user_id
    FROM public.users
    WHERE whatsapp_id = target_request.initiating_whatsapp_id
      AND id <> target_request.user_id
    LIMIT 1;

    IF target_whatsapp_id = target_request.initiating_whatsapp_id THEN
      resolved_link_status := 'already_linked';
    ELSIF target_whatsapp_id IS NOT NULL THEN
      resolved_link_status := 'conflict_target';
    ELSIF conflicting_user_id IS NOT NULL THEN
      resolved_link_status := 'conflict_identity';
    ELSE
      BEGIN
        UPDATE public.users
        SET whatsapp_id = target_request.initiating_whatsapp_id,
            updated_at = now()
        WHERE id = target_request.user_id;
        resolved_link_status := 'linked';
      EXCEPTION WHEN unique_violation THEN
        resolved_link_status := 'conflict_identity';
      END;
    END IF;
  END IF;

  IF target_request.purpose = 'recover_portal' THEN
    UPDATE public.users
    SET portal_token = input_new_portal_token, updated_at = now()
    WHERE id = target_request.user_id;
  ELSIF target_request.purpose = 'link_whatsapp'
      AND resolved_link_status IN ('linked', 'already_linked') THEN
    UPDATE public.messages AS message
    SET user_id = target_request.user_id,
        processing_owner = NULL,
        processing_lease_until = NULL,
        processing_completed_at = NULL,
        processing_outcome = NULL,
        metadata = message.metadata || jsonb_build_object(
          'identity_verification_state', 'verified',
          'identity_verified_at', now()
        )
    WHERE message.session_id = target_request.initiating_whatsapp_id
      AND message.direction = 'inbound'
      AND message.processing_order IS NOT NULL
      AND message.metadata->>'identity_verification_purpose' = 'link_whatsapp'
      AND message.metadata->>'identity_verification_state' = 'pending';
    GET DIAGNOSTICS resumed_count = ROW_COUNT;
  END IF;

  UPDATE public.portal_recovery_requests
  SET used_at = now(), whatsapp_link_status = resolved_link_status
  WHERE id = target_request.id;

  RETURN QUERY SELECT
    CASE WHEN target_request.purpose = 'recover_portal'
      THEN input_new_portal_token ELSE NULL END,
    resolved_link_status,
    target_request.purpose,
    resumed_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.create_portal_recovery_request(text, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_portal_recovery(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_portal_recovery_request(text, text, timestamptz, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_portal_recovery(text, text)
  TO service_role;

COMMIT;
