-- Ticket 90D: one-purpose, content-free direct PostgreSQL audit access.
-- This migration creates no credential. A production administrator provisions a
-- password and expiry out of band only after the role/view tests are approved.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'twilio_ledger_audit_view_owner') THEN
    CREATE ROLE twilio_ledger_audit_view_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'twilio_ledger_auditor') THEN
    CREATE ROLE twilio_ledger_auditor LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD NULL;
  END IF;
END
$$;

-- PostgreSQL has no per-role DENY: a privilege granted to PUBLIC is effective
-- for every role. Do not silently revoke existing PUBLIC grants here. Instead,
-- fail closed until a separate review removes each accessible SECURITY DEFINER
-- capability without changing its legitimate callers.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM twilio_ledger_auditor;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE procedure.prosecdef
      AND namespace.nspname !~ '^pg_'
      AND namespace.nspname <> 'information_schema'
      AND has_schema_privilege('twilio_ledger_auditor', namespace.oid, 'USAGE')
      AND has_function_privilege('twilio_ledger_auditor', procedure.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'TICKET_90D_EFFECTIVE_SECURITY_DEFINER_EXECUTE';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS twilio_audit;
REVOKE ALL ON SCHEMA public FROM twilio_ledger_auditor;
REVOKE ALL ON SCHEMA twilio_audit FROM PUBLIC, anon, authenticated, service_role, twilio_ledger_audit_view_owner, twilio_ledger_auditor;
GRANT USAGE ON SCHEMA public TO twilio_ledger_audit_view_owner;
GRANT USAGE ON SCHEMA twilio_audit TO twilio_ledger_audit_view_owner, twilio_ledger_auditor;
REVOKE ALL ON TABLE public.messages FROM twilio_ledger_audit_view_owner, twilio_ledger_auditor;
GRANT SELECT (
  id, "timestamp", direction, session_id, provider, provider_message_sid,
  idempotency_key, in_reply_to_id, delivery_status, metadata,
  processing_order, processing_lease_until, processing_completed_at,
  processing_outcome
) ON public.messages TO twilio_ledger_audit_view_owner;

DROP POLICY IF EXISTS twilio_ledger_audit_view_owner_select ON public.messages;
CREATE POLICY twilio_ledger_audit_view_owner_select ON public.messages
  FOR SELECT TO twilio_ledger_audit_view_owner USING (true);

-- Supabase's postgres administrator is not a true superuser. The safe
-- attributes are already set by CREATE ROLE above, so never normalize them
-- with ALTER ROLE. It receives a temporary SET-only membership strictly for
-- the fresh ownership transfer and for a re-run to replace its existing view.
GRANT CREATE ON SCHEMA twilio_audit TO twilio_ledger_audit_view_owner;
GRANT twilio_ledger_audit_view_owner TO postgres
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

-- On a re-run the existing view is owned by the restricted owner, so replace
-- it while temporarily set to that role. The first run remains postgres-owned
-- until its ACL/comment are complete and ownership is transferred below.
DO $$
BEGIN
  IF to_regclass('twilio_audit.twilio_ledger_audit_rows') IS NOT NULL THEN
    EXECUTE 'SET LOCAL ROLE twilio_ledger_audit_view_owner';
  END IF;
END
$$;

CREATE OR REPLACE VIEW twilio_audit.twilio_ledger_audit_rows
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  message.id AS ledger_id,
  message."timestamp" AS recorded_at,
  message.direction,
  message.provider_message_sid,
  message.idempotency_key,
  message.in_reply_to_id,
  message.delivery_status,
  NULLIF(message.metadata->>'provider_status', '') AS provider_status,
  NULLIF(message.metadata->>'provider_error_code', '') AS provider_error_code,
  message.processing_order,
  message.processing_lease_until,
  message.processing_completed_at,
  message.processing_outcome,
  CASE WHEN message.metadata->>'turn_anchor_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (message.metadata->>'turn_anchor_id')::uuid ELSE message.id END AS turn_anchor_id,
  CASE WHEN message.metadata->>'turn_position' ~ '^[1-9][0-9]{0,8}$' THEN (message.metadata->>'turn_position')::integer END AS turn_position,
  CASE WHEN message.metadata->>'turn_member_count' ~ '^[1-9][0-9]{0,8}$' THEN (message.metadata->>'turn_member_count')::integer END AS turn_member_count,
  NULLIF(message.metadata->>'reconciliation_state', '') AS reconciliation_state,
  (lower(message.metadata->>'delivery_suppressed') = 'true') AS delivery_suppressed,
  (message.idempotency_key IS NULL OR message.processing_outcome = 'historical_completed' OR message.metadata->>'session_ordering_state' = 'historical_completed') AS is_historical,
  (message.session_id LIKE '__sales-conversation-harness__:%' OR message.session_id LIKE '__harness48__:%') AS is_synthetic,
  (message.idempotency_key IS NOT NULL AND message.provider = 'twilio') AS is_canonical,
  COALESCE(NULLIF(message.metadata->>'logical_reply_key', ''), message.idempotency_key) AS logical_reply_key,
  CASE WHEN message.metadata ? 'part_index' AND message.metadata->>'part_index' ~ '^[1-9][0-9]{0,8}$' THEN (message.metadata->>'part_index')::integer ELSE 1 END AS part_index,
  CASE WHEN message.metadata ? 'part_count' AND message.metadata->>'part_count' ~ '^[1-9][0-9]{0,8}$' THEN (message.metadata->>'part_count')::integer ELSE 1 END AS part_count
FROM public.messages AS message
WHERE message.provider = 'twilio';

REVOKE ALL ON TABLE twilio_audit.twilio_ledger_audit_rows FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE twilio_audit.twilio_ledger_audit_rows TO twilio_ledger_auditor;
COMMENT ON VIEW twilio_audit.twilio_ledger_audit_rows IS
  'Ticket 90D content-free Twilio ledger projection for the direct PostgreSQL audit role only.';

-- A fresh view was configured while postgres owned it. PostgreSQL requires
-- the temporary SET membership above to transfer ownership. A re-run already
-- runs as this owner and skips the transfer.
DO $$
BEGIN
  IF current_user = 'postgres' THEN
    EXECUTE 'ALTER VIEW twilio_audit.twilio_ledger_audit_rows OWNER TO twilio_ledger_audit_view_owner';
  END IF;
END
$$;

-- Leave no executor membership or owner CREATE privilege after this
-- transaction. SET LOCAL keeps a re-run's role switch transaction-scoped.
SET LOCAL ROLE NONE;
REVOKE twilio_ledger_audit_view_owner FROM postgres;
REVOKE CREATE ON SCHEMA twilio_audit FROM twilio_ledger_audit_view_owner;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM twilio_ledger_auditor;

DO $$
BEGIN
  IF pg_has_role('postgres', 'twilio_ledger_audit_view_owner', 'SET')
     OR has_schema_privilege('twilio_ledger_audit_view_owner', 'twilio_audit', 'CREATE') THEN
    RAISE EXCEPTION 'TICKET_90D_TEMPORARY_OWNERSHIP_PRIVILEGE_RETAINED';
  END IF;
END
$$;

COMMIT;
