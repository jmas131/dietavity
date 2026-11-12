-- Disposable-only fixture. It deliberately grants one SECURITY DEFINER
-- function to PUBLIC so Ticket 90D proves the auditor cannot invoke it.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TABLE public.messages (
  id uuid PRIMARY KEY,
  "timestamp" timestamptz NOT NULL,
  direction text NOT NULL,
  session_id text,
  provider text,
  provider_message_sid text,
  idempotency_key text,
  in_reply_to_id uuid,
  delivery_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_order bigint,
  processing_lease_until timestamptz,
  processing_completed_at timestamptz,
  processing_outcome text,
  body text,
  user_message text,
  assistant_response text,
  transcript text,
  audio_url text,
  user_id uuid
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.messages TO service_role;

INSERT INTO public.messages (
  id, "timestamp", direction, session_id, provider, provider_message_sid,
  idempotency_key, delivery_status, metadata, processing_order,
  processing_completed_at, processing_outcome, body
) VALUES (
  '00000000-0000-4000-8000-000000000001', '2026-11-01T00:00:00Z',
  'inbound', 'whatsapp:+15550000000', 'twilio',
  'SM00000000000000000000000000000001', 'fixture:inbound', 'received',
  '{"turn_anchor_id":"00000000-0000-4000-8000-000000000001","turn_position":1,"turn_member_count":1}',
  1, '2026-11-01T00:01:00Z', 'completed', 'sensitive fixture body'
);

CREATE FUNCTION public.ticket_90d_public_security_definer()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS
$$ SELECT 'must-not-run'::text $$;
GRANT EXECUTE ON FUNCTION public.ticket_90d_public_security_definer() TO PUBLIC;

CREATE FUNCTION public.ticket_90d_service_security_definer()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS
$$ SELECT 'service-only'::text $$;
REVOKE ALL ON FUNCTION public.ticket_90d_service_security_definer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ticket_90d_service_security_definer() TO service_role;
