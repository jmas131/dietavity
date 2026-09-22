-- Ticket 17: durable per-session ordering for canonical WhatsApp inbound work.
-- Ordering extends the messages ledger; it does not replace provider-SID or
-- logical outbound idempotency.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.messages_inbound_processing_order_seq;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS processing_order bigint,
  ADD COLUMN IF NOT EXISTS processing_owner text,
  ADD COLUMN IF NOT EXISTS processing_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS processing_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_outcome text;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_processing_shape_check,
  ADD CONSTRAINT messages_processing_shape_check CHECK (
    processing_order IS NULL OR (
      direction = 'inbound'
      AND session_id IS NOT NULL
      AND provider = 'twilio'
      AND provider_message_sid IS NOT NULL
    )
  ),
  DROP CONSTRAINT IF EXISTS messages_processing_outcome_check,
  ADD CONSTRAINT messages_processing_outcome_check CHECK (
    processing_outcome IS NULL OR processing_outcome IN (
      'historical_completed', 'completed', 'reconciliation'
    )
  ),
  DROP CONSTRAINT IF EXISTS messages_processing_lease_check,
  ADD CONSTRAINT messages_processing_lease_check CHECK (
    (processing_owner IS NULL AND processing_lease_until IS NULL)
    OR (processing_owner IS NOT NULL AND processing_lease_until IS NOT NULL)
  );

-- Ticket 9 canonical rows that predate this migration already completed under
-- the old runtime. Mark them complete so deployment never replays history.
UPDATE public.messages
SET processing_order = nextval('public.messages_inbound_processing_order_seq'),
    processing_completed_at = COALESCE("timestamp", NOW()),
    processing_outcome = 'historical_completed',
    metadata = metadata || jsonb_build_object(
      'session_ordering_state', 'historical_completed'
    )
WHERE direction = 'inbound'
  AND provider = 'twilio'
  AND provider_message_sid IS NOT NULL
  AND idempotency_key IS NOT NULL
  AND processing_order IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_processing_order_uidx
  ON public.messages (processing_order)
  WHERE processing_order IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_session_processing_queue_idx
  ON public.messages (session_id, processing_order)
  WHERE direction = 'inbound'
    AND processing_order IS NOT NULL
    AND processing_completed_at IS NULL;

CREATE INDEX IF NOT EXISTS messages_processing_lease_idx
  ON public.messages (processing_lease_until)
  WHERE processing_order IS NOT NULL
    AND processing_completed_at IS NULL;

ALTER SEQUENCE public.messages_inbound_processing_order_seq OWNER TO postgres;
REVOKE ALL ON SEQUENCE public.messages_inbound_processing_order_seq
  FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.messages_inbound_processing_order_seq
  TO service_role;

COMMENT ON COLUMN public.messages.processing_order IS
  'Database reservation order for canonical inbound WhatsApp work; deterministic per-session tie-breaker.';
COMMENT ON COLUMN public.messages.processing_owner IS
  'Current n8n execution lease owner for per-session processing; never a provider identifier.';
COMMENT ON COLUMN public.messages.processing_lease_until IS
  'Crash-recoverable lease deadline for the current processing owner.';
COMMENT ON COLUMN public.messages.processing_completed_at IS
  'Safe completion boundary: customer outcome is durable and dependent state persistence has finished.';
COMMENT ON COLUMN public.messages.processing_outcome IS
  'Normal completion or durable reconciliation disposition for stale work.';

COMMIT;
