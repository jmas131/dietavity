-- Ticket 65D: a private, durable reservation/result boundary for the two
-- launch actions whose successful execution can provide a customer destination.
BEGIN;

CREATE TABLE public.authorized_action_executions (
  execution_key text PRIMARY KEY,
  action_id text NOT NULL UNIQUE,
  action_type text NOT NULL,
  execution_status text NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT authorized_action_executions_key_check CHECK (execution_key ~ '^aek-[0-9a-f]{64}$'),
  CONSTRAINT authorized_action_executions_action_check CHECK (action_id ~ '^act-[0-9a-f]{64}$'),
  CONSTRAINT authorized_action_executions_type_check CHECK (action_type IN ('provide_checkout_destination', 'provide_holding_page_destination')),
  CONSTRAINT authorized_action_executions_status_check CHECK (execution_status IN ('reserved', 'succeeded', 'failed_retryable', 'failed_terminal')),
  CONSTRAINT authorized_action_executions_lease_check CHECK (
    (execution_status = 'reserved' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND result IS NULL)
    OR (execution_status = 'succeeded' AND lease_owner IS NULL AND lease_expires_at IS NULL AND result IS NOT NULL)
    OR (execution_status IN ('failed_retryable', 'failed_terminal') AND lease_owner IS NULL AND lease_expires_at IS NULL AND result IS NULL)
  )
);

ALTER TABLE public.authorized_action_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authorized_action_executions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.authorized_action_executions FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserve_authorized_action_execution(p jsonb)
RETURNS TABLE(state text, action_id text, execution_key text, action_type text, result jsonb)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  existing public.authorized_action_executions%ROWTYPE;
  proposed_action_id text;
  proposed_execution_key text;
  proposed_action_type text;
  proposed_worker_id text;
  inserted boolean := false;
BEGIN
  IF jsonb_typeof(p) <> 'object' OR NOT (p ?& ARRAY['action_id','execution_key','action_type','worker_id'])
     OR (SELECT count(*) FROM jsonb_object_keys(p)) <> 4 THEN RAISE EXCEPTION 'AUTHORIZED_ACTION_RESERVATION_INPUT_INVALID'; END IF;
  proposed_action_id := p->>'action_id'; proposed_execution_key := p->>'execution_key';
  proposed_action_type := p->>'action_type'; proposed_worker_id := p->>'worker_id';
  IF proposed_action_id !~ '^act-[0-9a-f]{64}$' OR proposed_execution_key !~ '^aek-[0-9a-f]{64}$'
     OR proposed_action_type NOT IN ('provide_checkout_destination','provide_holding_page_destination')
     OR proposed_worker_id IS NULL OR length(proposed_worker_id) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'AUTHORIZED_ACTION_RESERVATION_INPUT_INVALID'; END IF;

  INSERT INTO public.authorized_action_executions (execution_key, action_id, action_type, execution_status, lease_owner, lease_expires_at)
  VALUES (proposed_execution_key, proposed_action_id, proposed_action_type, 'reserved', proposed_worker_id, now() + interval '60 seconds')
  ON CONFLICT (execution_key) DO NOTHING RETURNING true INTO inserted;
  SELECT * INTO existing FROM public.authorized_action_executions WHERE execution_key = proposed_execution_key FOR UPDATE;
  IF existing.action_id <> proposed_action_id OR existing.action_type <> proposed_action_type THEN RAISE EXCEPTION 'AUTHORIZED_ACTION_RESERVATION_IDENTITY_CONFLICT'; END IF;
  IF inserted THEN RETURN QUERY SELECT 'acquired', existing.action_id, existing.execution_key, existing.action_type, NULL::jsonb; RETURN; END IF;
  IF existing.execution_status = 'succeeded' THEN RETURN QUERY SELECT 'already_succeeded', existing.action_id, existing.execution_key, existing.action_type, existing.result; RETURN; END IF;
  IF existing.execution_status = 'failed_terminal' THEN RETURN QUERY SELECT 'terminal_failure', existing.action_id, existing.execution_key, existing.action_type, NULL::jsonb; RETURN; END IF;
  IF existing.execution_status = 'reserved' AND existing.lease_expires_at > now() THEN RETURN QUERY SELECT 'in_progress', existing.action_id, existing.execution_key, existing.action_type, NULL::jsonb; RETURN; END IF;
  UPDATE public.authorized_action_executions
     SET execution_status = 'reserved', lease_owner = proposed_worker_id, lease_expires_at = now() + interval '60 seconds', updated_at = now()
   WHERE execution_key = proposed_execution_key;
  RETURN QUERY SELECT CASE WHEN existing.execution_status = 'reserved' THEN 'retry_acquired' ELSE 'retry_acquired' END, proposed_action_id, proposed_execution_key, proposed_action_type, NULL::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_authorized_action_execution(p jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
DECLARE affected integer;
BEGIN
  IF jsonb_typeof(p) <> 'object' OR NOT (p ?& ARRAY['action_id','execution_key','worker_id','result'])
     OR (SELECT count(*) FROM jsonb_object_keys(p)) <> 4
     OR p->>'action_id' !~ '^act-[0-9a-f]{64}$' OR p->>'execution_key' !~ '^aek-[0-9a-f]{64}$'
     OR p->>'worker_id' IS NULL OR length(p->>'worker_id') NOT BETWEEN 1 AND 128
     OR jsonb_typeof(p->'result') <> 'object'
     OR p->'result'->>'execution_status' <> 'succeeded'
     OR p->'result'->>'action_id' IS DISTINCT FROM p->>'action_id'
     OR p->'result'->>'execution_key' IS DISTINCT FROM p->>'execution_key' THEN RAISE EXCEPTION 'AUTHORIZED_ACTION_COMPLETION_INPUT_INVALID'; END IF;
  UPDATE public.authorized_action_executions
     SET execution_status = 'succeeded', result = p->'result', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE action_id = p->>'action_id' AND execution_key = p->>'execution_key' AND execution_status = 'reserved'
     AND lease_owner = p->>'worker_id' AND lease_expires_at > now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'AUTHORIZED_ACTION_COMPLETION_NOT_RESERVED'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_authorized_action_execution(p jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
DECLARE affected integer;
BEGIN
  IF jsonb_typeof(p) <> 'object' OR NOT (p ?& ARRAY['action_id','execution_key','worker_id','execution_status'])
     OR (SELECT count(*) FROM jsonb_object_keys(p)) <> 4
     OR p->>'action_id' !~ '^act-[0-9a-f]{64}$' OR p->>'execution_key' !~ '^aek-[0-9a-f]{64}$'
     OR p->>'worker_id' IS NULL OR length(p->>'worker_id') NOT BETWEEN 1 AND 128
     OR p->>'execution_status' NOT IN ('failed_retryable','failed_terminal') THEN RAISE EXCEPTION 'AUTHORIZED_ACTION_FAILURE_INPUT_INVALID'; END IF;
  UPDATE public.authorized_action_executions
     SET execution_status = p->>'execution_status', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE action_id = p->>'action_id' AND execution_key = p->>'execution_key' AND execution_status = 'reserved'
     AND lease_owner = p->>'worker_id' AND lease_expires_at > now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'AUTHORIZED_ACTION_FAILURE_NOT_RESERVED'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_authorized_action_execution(jsonb), public.complete_authorized_action_execution(jsonb), public.fail_authorized_action_execution(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_authorized_action_execution(jsonb), public.complete_authorized_action_execution(jsonb), public.fail_authorized_action_execution(jsonb) TO service_role;

COMMIT;
