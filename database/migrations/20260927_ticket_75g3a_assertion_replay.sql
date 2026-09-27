-- Ticket75G.3A: durable, backend-only consume-once protection for validated
-- Ticket75A service assertions. No token, JWT body, customer, or business data
-- is stored here.
CREATE TABLE public.sales_engine_v2_assertion_replays (
  issuer text NOT NULL CHECK (issuer ~ '^[A-Za-z0-9._:-]{1,128}$'),
  client_id text NOT NULL CHECK (client_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  jti text NOT NULL CHECK (jti ~ '^[A-Za-z0-9._:-]{1,128}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_engine_v2_assertion_replays_pkey PRIMARY KEY (issuer, client_id, jti)
);

ALTER TABLE public.sales_engine_v2_assertion_replays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_engine_v2_assertion_replays FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sales_engine_v2_assertion_replays FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_sales_engine_v2_assertion_replay(p jsonb)
RETURNS TABLE(state text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
DECLARE input_expires_at timestamptz;
DECLARE inserted integer;
BEGIN
  IF jsonb_typeof(p) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p)) <> 5
     OR NOT (p ?& ARRAY['contract_version','issuer','client_id','jti','expires_at'])
     OR p->>'contract_version' <> 'ticket-75g3a-v1'
     OR p->>'issuer' !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p->>'client_id' !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p->>'jti' !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR jsonb_typeof(p->'expires_at') <> 'string' THEN
    RAISE EXCEPTION 'V2_ASSERTION_REPLAY_INPUT_INVALID';
  END IF;
  BEGIN
    input_expires_at := (p->>'expires_at')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'V2_ASSERTION_REPLAY_INPUT_INVALID';
  END;
  IF input_expires_at <= now() THEN RAISE EXCEPTION 'V2_ASSERTION_REPLAY_EXPIRED'; END IF;

  INSERT INTO public.sales_engine_v2_assertion_replays(issuer, client_id, jti, expires_at)
  VALUES (p->>'issuer', p->>'client_id', p->>'jti', input_expires_at)
  ON CONFLICT ON CONSTRAINT sales_engine_v2_assertion_replays_pkey DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 1 THEN RETURN QUERY SELECT 'consumed'::text; RETURN; END IF;
  -- A replay is a valid, bounded authentication result, not a database error.
  RETURN QUERY SELECT 'replayed'::text;
END $$;

-- Cleanup is deliberately separate from authentication. It cannot make an
-- unexpired assertion reusable and deletes only records whose validity ended.
CREATE OR REPLACE FUNCTION public.cleanup_sales_engine_v2_assertion_replays()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
DECLARE deleted_count integer;
BEGIN
  DELETE FROM public.sales_engine_v2_assertion_replays WHERE expires_at <= now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END $$;

REVOKE ALL ON FUNCTION public.consume_sales_engine_v2_assertion_replay(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cleanup_sales_engine_v2_assertion_replays() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_sales_engine_v2_assertion_replay(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_sales_engine_v2_assertion_replays() TO service_role;
COMMENT ON TABLE public.sales_engine_v2_assertion_replays IS 'Ticket75G.3A backend-only Ticket75A assertion replay keys; no JWT or customer data.';
COMMENT ON FUNCTION public.consume_sales_engine_v2_assertion_replay(jsonb) IS 'Ticket75G.3A atomic validated assertion consume-once RPC.';
