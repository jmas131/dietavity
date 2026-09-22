-- Ticket 9: canonical WhatsApp ledger and database-backed message idempotency.
-- Historical rows remain partial/non-authoritative; the deployment cutover is
-- the point from which canonical completeness is guaranteed.

BEGIN;

LOCK TABLE public.messages IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.messages
  ALTER COLUMN user_message DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS message_kind text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_message_sid text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS in_reply_to_id uuid,
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Only deterministic legacy values are backfilled. Historical provider SIDs,
-- delivery state, Checkout bodies, and overridden AI drafts are not invented.
UPDATE public.messages
SET body = CASE
      WHEN direction = 'inbound' THEN NULLIF(user_message, '')
      WHEN direction = 'outbound' THEN NULLIF(assistant_response, '')
      ELSE NULL
    END,
    delivery_status = COALESCE(delivery_status, 'unknown'),
    metadata = COALESCE(metadata, '{}'::jsonb)
WHERE body IS NULL OR delivery_status IS NULL OR metadata IS NULL;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_message_kind_check,
  ADD CONSTRAINT messages_message_kind_check CHECK (
    message_kind IS NULL OR message_kind IN (
      'user', 'sales_ai', 'sales_deterministic', 'checkout',
      'paid_ai', 'paid_deterministic', 'fallback', 'customer_error',
      'setup_link', 'welcome', 'reminder_confirmation',
      'reminder_scheduled', 'media_clarification', 'legacy_cancellation'
    )
  ),
  DROP CONSTRAINT IF EXISTS messages_provider_check,
  ADD CONSTRAINT messages_provider_check CHECK (
    provider IS NULL OR provider IN ('twilio')
  ),
  DROP CONSTRAINT IF EXISTS messages_delivery_status_check,
  ADD CONSTRAINT messages_delivery_status_check CHECK (
    delivery_status IS NULL OR delivery_status IN (
      'received', 'pending', 'accepted', 'scheduled', 'failed', 'unknown',
      'sent', 'delivered', 'undelivered'
    )
  ),
  DROP CONSTRAINT IF EXISTS messages_metadata_object_check,
  ADD CONSTRAINT messages_metadata_object_check CHECK (
    jsonb_typeof(metadata) = 'object'
  ),
  DROP CONSTRAINT IF EXISTS messages_canonical_shape_check,
  ADD CONSTRAINT messages_canonical_shape_check CHECK (
    idempotency_key IS NULL OR (
      session_id IS NOT NULL
      AND provider = 'twilio'
      AND message_kind IS NOT NULL
      AND delivery_status IS NOT NULL
      AND (direction = 'inbound' OR NULLIF(body, '') IS NOT NULL)
    )
  ),
  DROP CONSTRAINT IF EXISTS messages_in_reply_to_id_fkey,
  ADD CONSTRAINT messages_in_reply_to_id_fkey
    FOREIGN KEY (in_reply_to_id) REFERENCES public.messages(id) ON DELETE SET NULL;

-- Twilio Message SIDs are globally unique identifiers for Message resources,
-- so direction is intentionally not part of this key.
CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_sid_uidx
  ON public.messages (provider, provider_message_sid)
  WHERE provider_message_sid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency_key_uidx
  ON public.messages (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_session_timestamp_idx
  ON public.messages (session_id, "timestamp", id);

CREATE INDEX IF NOT EXISTS messages_user_timestamp_idx
  ON public.messages (user_id, "timestamp", id);

-- Preserve Ticket 2 backend-only access even on databases whose old dump still
-- contains the permissive pre-Ticket-2 policy/grants.
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messages ON public.messages;
DROP POLICY IF EXISTS policy_messages ON public.messages;
REVOKE ALL ON TABLE public.messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.messages TO service_role;

COMMENT ON TABLE public.messages IS
  'Canonical customer-visible WhatsApp ledger from Ticket 9 cutover forward; historical rows may be partial.';
COMMENT ON COLUMN public.messages.body IS
  'Exact normalized inbound text or final customer-visible outbound text; historical rows may be null.';
COMMENT ON COLUMN public.messages.provider_message_sid IS
  'Real provider message identifier only; never an n8n execution ID.';

COMMIT;

