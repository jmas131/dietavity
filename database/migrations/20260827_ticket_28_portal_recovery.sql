-- Ticket 28: verified email recovery without accounts or passwords.
BEGIN;

ALTER TABLE public.users ADD COLUMN email text;

CREATE INDEX users_email_recovery_idx
  ON public.users (lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE public.portal_recovery_initiations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  initiating_whatsapp_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.portal_recovery_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  initiating_whatsapp_id text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  invalidated_at timestamptz,
  whatsapp_link_status text CHECK (
    whatsapp_link_status IS NULL OR whatsapp_link_status IN (
      'not_requested', 'linked', 'already_linked',
      'conflict_target', 'conflict_identity'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX portal_recovery_requests_user_created_idx
  ON public.portal_recovery_requests (user_id, created_at DESC);
CREATE INDEX portal_recovery_requests_active_idx
  ON public.portal_recovery_requests (expires_at)
  WHERE used_at IS NULL AND invalidated_at IS NULL;
CREATE INDEX portal_recovery_initiations_active_idx
  ON public.portal_recovery_initiations (expires_at)
  WHERE used_at IS NULL;

ALTER TABLE public.portal_recovery_initiations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_recovery_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.portal_recovery_initiations, public.portal_recovery_requests
  FROM anon, authenticated;
GRANT ALL ON TABLE public.portal_recovery_initiations, public.portal_recovery_requests
  TO service_role;

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
BEGIN
  IF input_token_hash !~ '^[0-9a-f]{64}$'
     OR input_expires_at <= now()
     OR input_expires_at > now() + interval '60 minutes' THEN
    RETURN false;
  END IF;

  -- Serialize requests for the same claimed address without making email unique.
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
    RETURNING initiation.initiating_whatsapp_id INTO recovered_whatsapp_id;

    IF recovered_whatsapp_id IS NULL THEN RETURN false; END IF;
  END IF;

  -- A newly emailed link replaces older unused credentials for this user.
  UPDATE public.portal_recovery_requests
  SET invalidated_at = now()
  WHERE user_id = eligible_user_id
    AND used_at IS NULL
    AND invalidated_at IS NULL;

  INSERT INTO public.portal_recovery_requests (
    user_id, token_hash, initiating_whatsapp_id, expires_at
  ) VALUES (
    eligible_user_id, input_token_hash, recovered_whatsapp_id, input_expires_at
  );

  RETURN true;
END;
$$;

CREATE FUNCTION public.redeem_portal_recovery(
  input_token_hash text,
  input_new_portal_token text
) RETURNS TABLE (portal_token text, whatsapp_link_status text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  target_request public.portal_recovery_requests%ROWTYPE;
  target_whatsapp_id text;
  conflicting_user_id uuid;
  resolved_link_status text := 'not_requested';
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

  UPDATE public.users
  SET portal_token = input_new_portal_token, updated_at = now()
  WHERE id = target_request.user_id;

  UPDATE public.portal_recovery_requests
  SET used_at = now(), whatsapp_link_status = resolved_link_status
  WHERE id = target_request.id;

  RETURN QUERY SELECT input_new_portal_token, resolved_link_status;
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

ALTER TABLE public.messages DROP CONSTRAINT messages_message_kind_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_message_kind_check CHECK (
  message_kind IS NULL OR message_kind IN (
    'user', 'sales_ai', 'sales_deterministic', 'checkout', 'paid_ai',
    'paid_deterministic', 'fallback', 'customer_error', 'setup_link',
    'welcome', 'reminder_confirmation', 'reminder_scheduled',
    'media_clarification', 'legacy_cancellation', 'portal_recovery'
  )
);

COMMIT;
