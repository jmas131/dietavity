--
-- PostgreSQL database dump
--

\restrict ppu74BOdonNyZyvQ1U6cB7AsrlN63zjij6QTTwrXCdDQSPmjOr4fqSPvDrywIwa

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA auth;


ALTER SCHEMA auth OWNER TO supabase_admin;

--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA extensions;


ALTER SCHEMA extensions OWNER TO postgres;

--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA graphql;


ALTER SCHEMA graphql OWNER TO supabase_admin;

--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA graphql_public;


ALTER SCHEMA graphql_public OWNER TO supabase_admin;

--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: pgbouncer
--

CREATE SCHEMA pgbouncer;


ALTER SCHEMA pgbouncer OWNER TO pgbouncer;

--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA realtime;


ALTER SCHEMA realtime OWNER TO supabase_admin;

--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA storage;


ALTER SCHEMA storage OWNER TO supabase_admin;

--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA vault;


ALTER SCHEMA vault OWNER TO supabase_admin;

--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;


--
-- Name: EXTENSION supabase_vault; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION supabase_vault IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


ALTER TYPE auth.aal_level OWNER TO supabase_auth_admin;

--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


ALTER TYPE auth.code_challenge_method OWNER TO supabase_auth_admin;

--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


ALTER TYPE auth.factor_status OWNER TO supabase_auth_admin;

--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


ALTER TYPE auth.factor_type OWNER TO supabase_auth_admin;

--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


ALTER TYPE auth.oauth_authorization_status OWNER TO supabase_auth_admin;

--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


ALTER TYPE auth.oauth_client_type OWNER TO supabase_auth_admin;

--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


ALTER TYPE auth.oauth_registration_type OWNER TO supabase_auth_admin;

--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


ALTER TYPE auth.oauth_response_type OWNER TO supabase_auth_admin;

--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


ALTER TYPE auth.one_time_token_type OWNER TO supabase_auth_admin;

--
-- Name: action; Type: TYPE; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE TYPE realtime.action AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'ERROR'
);


ALTER TYPE realtime.action OWNER TO supabase_realtime_admin;

--
-- Name: equality_op; Type: TYPE; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE TYPE realtime.equality_op AS ENUM (
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'in',
    'like',
    'ilike',
    'is',
    'match',
    'imatch',
    'isdistinct'
);


ALTER TYPE realtime.equality_op OWNER TO supabase_realtime_admin;

--
-- Name: user_defined_filter; Type: TYPE; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE TYPE realtime.user_defined_filter AS (
	column_name text,
	op realtime.equality_op,
	value text,
	negate boolean
);


ALTER TYPE realtime.user_defined_filter OWNER TO supabase_realtime_admin;

--
-- Name: wal_column; Type: TYPE; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE TYPE realtime.wal_column AS (
	name text,
	type_name text,
	type_oid oid,
	value jsonb,
	is_pkey boolean,
	is_selectable boolean
);


ALTER TYPE realtime.wal_column OWNER TO supabase_realtime_admin;

--
-- Name: wal_rls; Type: TYPE; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE TYPE realtime.wal_rls AS (
	wal jsonb,
	is_rls_enabled boolean,
	subscription_ids uuid[],
	errors text[]
);


ALTER TYPE realtime.wal_rls OWNER TO supabase_realtime_admin;

--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


ALTER TYPE storage.buckettype OWNER TO supabase_storage_admin;

--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


ALTER FUNCTION auth.email() OWNER TO supabase_auth_admin;

--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;

--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;

--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;

--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
    revoke trigger on cron.job_run_details from postgres;
  END IF;
END;
$$;


ALTER FUNCTION extensions.grant_pg_cron_access() OWNER TO supabase_admin;

--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
begin
    if not exists (
        select 1
        from pg_catalog.pg_event_trigger_ddl_commands() ev
        join pg_catalog.pg_extension e on ev.objid = e.oid
        where e.extname = 'pg_graphql'
    ) then
        return;
    end if;

    drop function if exists graphql_public.graphql;
    create or replace function graphql_public.graphql(
        "operationName" text default null,
        query text default null,
        variables jsonb default null,
        extensions jsonb default null
    )
        returns jsonb
        language sql
    as $$
        select graphql.resolve(
            query := query,
            variables := coalesce(variables, '{}'),
            "operationName" := "operationName",
            extensions := extensions
        );
    $$;

    -- Attach the wrapper to the extension so DROP EXTENSION cascades to it,
    -- which in turn triggers set_graphql_placeholder to reinstall the "not enabled" stub.
    alter extension pg_graphql add function graphql_public.graphql(text, text, jsonb, jsonb);

    grant usage on schema graphql to postgres, anon, authenticated, service_role;
    grant execute on function graphql.resolve to postgres, anon, authenticated, service_role;
    grant usage on schema graphql to postgres with grant option;
    grant usage on schema graphql_public to postgres with grant option;
end;
$_$;


ALTER FUNCTION extensions.grant_pg_graphql_access() OWNER TO supabase_admin;

--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8.0', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


ALTER FUNCTION extensions.grant_pg_net_access() OWNER TO supabase_admin;

--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


ALTER FUNCTION extensions.pgrst_ddl_watch() OWNER TO supabase_admin;

--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


ALTER FUNCTION extensions.pgrst_drop_watch() OWNER TO supabase_admin;

--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
            set search_path to ''
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


ALTER FUNCTION extensions.set_graphql_placeholder() OWNER TO supabase_admin;

--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: graphql(text, text, jsonb, jsonb); Type: FUNCTION; Schema: graphql_public; Owner: supabase_admin
--

CREATE FUNCTION graphql_public.graphql("operationName" text DEFAULT NULL::text, query text DEFAULT NULL::text, variables jsonb DEFAULT NULL::jsonb, extensions jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;


ALTER FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) OWNER TO supabase_admin;

--
-- Name: get_auth(text); Type: FUNCTION; Schema: pgbouncer; Owner: supabase_admin
--

CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  BEGIN
      RAISE DEBUG 'PgBouncer auth request: %', p_usename;

      RETURN QUERY
      SELECT
          rolname::text,
          CASE WHEN rolvaliduntil < now()
              THEN null
              ELSE rolpassword::text
          END
      FROM pg_authid
      WHERE rolname=$1 and rolcanlogin;
  END;
  $_$;


ALTER FUNCTION pgbouncer.get_auth(p_usename text) OWNER TO supabase_admin;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.authorized_action_executions (
    execution_key text NOT NULL,
    action_id text NOT NULL,
    action_type text NOT NULL,
    execution_status text NOT NULL,
    lease_owner text,
    lease_expires_at timestamp with time zone,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT authorized_action_executions_key_check CHECK ((execution_key ~ '^aek-[0-9a-f]{64}$'::text)),
    CONSTRAINT authorized_action_executions_action_check CHECK ((action_id ~ '^act-[0-9a-f]{64}$'::text)),
    CONSTRAINT authorized_action_executions_type_check CHECK ((action_type = ANY (ARRAY['provide_checkout_destination'::text, 'provide_holding_page_destination'::text]))),
    CONSTRAINT authorized_action_executions_status_check CHECK ((execution_status = ANY (ARRAY['reserved'::text, 'succeeded'::text, 'failed_retryable'::text, 'failed_terminal'::text]))),
    CONSTRAINT authorized_action_executions_lease_check CHECK ((((execution_status = 'reserved'::text) AND (lease_owner IS NOT NULL) AND (lease_expires_at IS NOT NULL) AND (result IS NULL)) OR ((execution_status = 'succeeded'::text) AND (lease_owner IS NULL) AND (lease_expires_at IS NULL) AND (result IS NOT NULL)) OR ((execution_status = ANY (ARRAY['failed_retryable'::text, 'failed_terminal'::text])) AND (lease_owner IS NULL) AND (lease_expires_at IS NULL) AND (result IS NULL))))
);

ALTER TABLE public.authorized_action_executions OWNER TO postgres;

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    direction text NOT NULL,
    user_message text,
    "timestamp" timestamp with time zone DEFAULT now(),
    audio_url text,
    transcript text,
    intent text,
    assistant_response text,
    session_id text,
    body text,
    message_kind text,
    provider text,
    provider_message_sid text,
    idempotency_key text,
    in_reply_to_id uuid,
    delivery_status text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    processing_order bigint,
    processing_owner text,
    processing_lease_until timestamp with time zone,
    processing_completed_at timestamp with time zone,
    processing_outcome text,
    CONSTRAINT messages_canonical_shape_check CHECK (((idempotency_key IS NULL) OR ((session_id IS NOT NULL) AND (provider = 'twilio'::text) AND (message_kind IS NOT NULL) AND (delivery_status IS NOT NULL) AND ((direction = 'inbound'::text) OR (NULLIF(body, ''::text) IS NOT NULL))))),
    CONSTRAINT messages_delivery_status_check CHECK (((delivery_status IS NULL) OR (delivery_status = ANY (ARRAY['received'::text, 'pending'::text, 'accepted'::text, 'scheduled'::text, 'failed'::text, 'unknown'::text, 'sent'::text, 'delivered'::text, 'undelivered'::text])))),
    CONSTRAINT messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))),
    CONSTRAINT messages_message_kind_check CHECK (((message_kind IS NULL) OR (message_kind = ANY (ARRAY['user'::text, 'sales_ai'::text, 'sales_deterministic'::text, 'checkout'::text, 'paid_ai'::text, 'paid_deterministic'::text, 'fallback'::text, 'customer_error'::text, 'setup_link'::text, 'welcome'::text, 'reminder_confirmation'::text, 'reminder_scheduled'::text, 'media_clarification'::text, 'legacy_cancellation'::text, 'portal_recovery'::text, 'identity_verification'::text])))),
    CONSTRAINT messages_metadata_object_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT messages_processing_lease_check CHECK ((((processing_owner IS NULL) AND (processing_lease_until IS NULL)) OR ((processing_owner IS NOT NULL) AND (processing_lease_until IS NOT NULL)))),
    CONSTRAINT messages_processing_outcome_check CHECK (((processing_outcome IS NULL) OR (processing_outcome = ANY (ARRAY['historical_completed'::text, 'completed'::text, 'reconciliation'::text, 'superseded'::text])))),
    CONSTRAINT messages_processing_shape_check CHECK (((processing_order IS NULL) OR ((direction = 'inbound'::text) AND (session_id IS NOT NULL) AND (provider = 'twilio'::text) AND (provider_message_sid IS NOT NULL)))),
    CONSTRAINT messages_provider_check CHECK (((provider IS NULL) OR (provider = 'twilio'::text)))
);

--
-- Name: conversation_artifacts; Type: TABLE; Schema: public; Owner: postgres
--
CREATE TABLE public.conversation_artifacts (
    artifact_id text NOT NULL,
    contract_version text DEFAULT '1.0'::text NOT NULL,
    artifact_type text NOT NULL,
    generation_operation text NOT NULL,
    generation_task_id text NOT NULL,
    logical_reply_key text NOT NULL,
    anchor_message_id uuid NOT NULL,
    CONSTRAINT conversation_artifacts_id_check CHECK ((artifact_id ~ '^ca-[A-Za-z0-9._-]+$'::text)),
    CONSTRAINT conversation_artifacts_version_check CHECK ((contract_version = '1.0'::text)),
    CONSTRAINT conversation_artifacts_type_check CHECK ((artifact_type = ANY (ARRAY['draft'::text, 'summary'::text]))),
    CONSTRAINT conversation_artifacts_operation_check CHECK ((generation_operation = ANY (ARRAY['draft'::text, 'transform'::text, 'summarize'::text]))),
    CONSTRAINT conversation_artifacts_task_id_check CHECK ((generation_task_id ~ '^cgt-[A-Za-z0-9._-]+$'::text)),
    CONSTRAINT conversation_artifacts_operation_type_check CHECK ((((generation_operation = 'summarize'::text) AND (artifact_type = 'summary'::text)) OR ((generation_operation = ANY (ARRAY['draft'::text, 'transform'::text])) AND (artifact_type = 'draft'::text))))
);

CREATE TABLE public.conversation_artifact_lineage (
    artifact_id text NOT NULL,
    source_artifact_id text NOT NULL,
    position integer NOT NULL,
    CONSTRAINT conversation_artifact_lineage_position_check CHECK ((position > 0)),
    CONSTRAINT conversation_artifact_lineage_self_check CHECK ((artifact_id <> source_artifact_id))
);

CREATE OR REPLACE FUNCTION public.persist_conversation_artifact(p jsonb)
RETURNS public.conversation_artifacts
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  anchor public.messages%ROWTYPE;
  existing public.conversation_artifacts%ROWTYPE;
  result public.conversation_artifacts%ROWTYPE;
  source_id text;
  source_ids text[];
  persisted_source_ids text[];
  proposed_id text;
  proposed_key text;
  proposed_task text;
  proposed_type text;
  proposed_operation text;
  proposed_anchor uuid;
  lineage_count integer;
  existing_count integer;
BEGIN
  IF jsonb_typeof(p) <> 'object' OR p ?| ARRAY['source','authority','delivery_status','body']
     OR NOT (p ?& ARRAY['contract_version','artifact_id','artifact_type','generation_operation','generation_task_id','logical_reply_key','anchor_message_id','lineage'])
     OR (SELECT count(*) FROM jsonb_object_keys(p)) <> 8
     OR p->>'contract_version' <> '1.0' THEN RAISE EXCEPTION 'CONVERSATION_ARTIFACT_INPUT_INVALID'; END IF;
  proposed_id := p->>'artifact_id'; proposed_type := p->>'artifact_type'; proposed_operation := p->>'generation_operation';
  proposed_task := p->>'generation_task_id'; proposed_key := p->>'logical_reply_key';
  IF proposed_id !~ '^ca-[A-Za-z0-9._-]+$' OR proposed_task !~ '^cgt-[A-Za-z0-9._-]+$' OR proposed_key = ''
     OR (proposed_type, proposed_operation) NOT IN (('draft','draft'),('draft','transform'),('summary','summarize')) THEN RAISE EXCEPTION 'CONVERSATION_ARTIFACT_INPUT_INVALID'; END IF;
  BEGIN proposed_anchor := (p->>'anchor_message_id')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'CONVERSATION_ARTIFACT_INPUT_INVALID'; END;
  IF jsonb_typeof(p->'lineage') <> 'array' THEN RAISE EXCEPTION 'CONVERSATION_ARTIFACT_LINEAGE_INVALID'; END IF;
  SELECT * INTO anchor FROM public.messages WHERE id = proposed_anchor FOR UPDATE;
  IF NOT FOUND OR anchor.direction <> 'outbound' OR anchor.idempotency_key IS DISTINCT FROM proposed_key
     OR jsonb_typeof(anchor.metadata->'logical_reply_key') <> 'string' OR anchor.metadata->>'logical_reply_key' IS DISTINCT FROM proposed_key
     OR jsonb_typeof(anchor.metadata->'part_index') <> 'number' OR anchor.metadata->>'part_index' <> '1'
     OR jsonb_typeof(anchor.metadata->'part_count') <> 'number' THEN RAISE EXCEPTION 'CONVERSATION_ARTIFACT_ANCHOR_INVALID'; END IF;
  IF EXISTS (SELECT 1 FROM public.messages sibling WHERE sibling.in_reply_to_id IS NOT DISTINCT FROM anchor.in_reply_to_id AND sibling.direction = 'outbound' AND COALESCE(NULLIF(sibling.metadata->>'logical_reply_key',''), sibling.idempotency_key) = proposed_key AND (
      jsonb_typeof(sibling.metadata->'logical_reply_key') <> 'string' OR jsonb_typeof(sibling.metadata->'part_index') <> 'number' OR jsonb_typeof(sibling.metadata->'part_count') <> 'number'
      OR sibling.metadata->>'part_index' !~ '^[1-9][0-9]{0,2}$' OR sibling.metadata->>'part_count' !~ '^[1-9][0-9]{0,2}$'
      OR (sibling.metadata->>'part_index')::integer > (sibling.metadata->>'part_count')::integer
      OR sibling.idempotency_key IS DISTINCT FROM CASE WHEN sibling.metadata->>'part_index' = '1' THEN proposed_key ELSE proposed_key || ':part:' || lpad(sibling.metadata->>'part_index', 3, '0') END
    )) THEN RAISE EXCEPTION 'CONVERSATION_ARTIFACT_MULTIPART_INVALID'; END IF;
  SELECT array_agg(value ORDER BY ordinality), count(*) INTO source_ids, lineage_count
  FROM jsonb_array_elements_text(p->'lineage') WITH ORDINALITY AS item(value, ordinality);
  IF (proposed_operation = 'draft' AND lineage_count <> 0) OR (proposed_operation IN ('transform','summarize') AND lineage_count < 1)
     OR EXISTS (SELECT 1 FROM unnest(COALESCE(source_ids, ARRAY[]::text[])) value WHERE value !~ '^ca-[A-Za-z0-9._-]+$')
     OR (SELECT count(DISTINCT value) FROM unnest(COALESCE(source_ids, ARRAY[]::text[])) value) <> lineage_count
     OR proposed_id = ANY(COALESCE(source_ids, ARRAY[]::text[])) THEN RAISE EXCEPTION 'CONVERSATION_ARTIFACT_LINEAGE_INVALID'; END IF;
  IF lineage_count > 0 AND (SELECT count(*) FROM public.conversation_artifacts WHERE artifact_id = ANY(source_ids)) <> lineage_count THEN RAISE EXCEPTION 'CONVERSATION_ARTIFACT_SOURCE_MISSING'; END IF;
  SELECT count(*) INTO existing_count FROM public.conversation_artifacts WHERE artifact_id = proposed_id OR logical_reply_key = proposed_key OR generation_task_id = proposed_task OR anchor_message_id = proposed_anchor;
  IF existing_count > 1 THEN RAISE EXCEPTION 'CONVERSATION_ARTIFACT_IDEMPOTENCY_CONFLICT'; END IF;
  SELECT * INTO existing FROM public.conversation_artifacts WHERE artifact_id = proposed_id OR logical_reply_key = proposed_key OR generation_task_id = proposed_task OR anchor_message_id = proposed_anchor FOR UPDATE;
  IF FOUND THEN
    SELECT array_agg(source_artifact_id ORDER BY position) INTO persisted_source_ids FROM public.conversation_artifact_lineage WHERE artifact_id = existing.artifact_id;
    IF existing.artifact_id = proposed_id AND existing.contract_version = '1.0' AND existing.artifact_type = proposed_type AND existing.generation_operation = proposed_operation
       AND existing.generation_task_id = proposed_task AND existing.logical_reply_key = proposed_key AND existing.anchor_message_id = proposed_anchor
       AND COALESCE(persisted_source_ids, ARRAY[]::text[]) IS NOT DISTINCT FROM COALESCE(source_ids, ARRAY[]::text[]) THEN RETURN existing; END IF;
    RAISE EXCEPTION 'CONVERSATION_ARTIFACT_IDEMPOTENCY_CONFLICT';
  END IF;
  IF EXISTS (WITH RECURSIVE ancestors(id) AS (
      SELECT source_artifact_id FROM public.conversation_artifact_lineage WHERE artifact_id = ANY(COALESCE(source_ids, ARRAY[]::text[]))
      UNION SELECT l.source_artifact_id FROM public.conversation_artifact_lineage l JOIN ancestors a ON l.artifact_id = a.id
    ) SELECT 1 FROM ancestors WHERE id = proposed_id) THEN RAISE EXCEPTION 'CONVERSATION_ARTIFACT_CYCLE'; END IF;
  INSERT INTO public.conversation_artifacts (artifact_id, contract_version, artifact_type, generation_operation, generation_task_id, logical_reply_key, anchor_message_id)
  VALUES (proposed_id, '1.0', proposed_type, proposed_operation, proposed_task, proposed_key, proposed_anchor) RETURNING * INTO result;
  INSERT INTO public.conversation_artifact_lineage (artifact_id, source_artifact_id, position)
  SELECT result.artifact_id, value, ordinality::integer FROM unnest(COALESCE(source_ids, ARRAY[]::text[])) WITH ORDINALITY AS item(value, ordinality);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_message_with_conversation_artifacts_for_privacy(target_message_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
BEGIN
  -- Lock the canonical ledger row before resolving its dependent graph. This
  -- privileged lifecycle function is deliberately not executable by runtime
  -- roles; direct deletion remains restricted while an artifact is anchored.
  PERFORM 1 FROM public.messages WHERE id = target_message_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONVERSATION_ARTIFACT_PRIVACY_ANCHOR_MISSING';
  END IF;

  WITH RECURSIVE descendants(artifact_id) AS (
    SELECT artifact_id FROM public.conversation_artifacts WHERE anchor_message_id = target_message_id
    UNION
    SELECT lineage.artifact_id FROM public.conversation_artifact_lineage lineage
    JOIN descendants parent ON lineage.source_artifact_id = parent.artifact_id
  )
  DELETE FROM public.conversation_artifacts artifact
  WHERE artifact.artifact_id IN (SELECT artifact_id FROM descendants);
  DELETE FROM public.messages WHERE id = target_message_id;
END;
$$;

ALTER TABLE ONLY public.messages FORCE ROW LEVEL SECURITY;


ALTER TABLE public.messages OWNER TO postgres;

--
-- Name: TABLE messages; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.messages IS 'Canonical customer-visible WhatsApp ledger from Ticket 9 cutover forward; historical rows may be partial.';


--
-- Name: COLUMN messages.body; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.messages.body IS 'Exact normalized inbound text or final customer-visible outbound text; historical rows may be null.';


--
-- Name: COLUMN messages.provider_message_sid; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.messages.provider_message_sid IS 'Real provider message identifier only; never an n8n execution ID.';


--
-- Name: COLUMN messages.processing_order; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.messages.processing_order IS 'Database reservation order for canonical inbound WhatsApp work; deterministic per-session tie-breaker.';


--
-- Name: COLUMN messages.processing_owner; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.messages.processing_owner IS 'Current n8n execution lease owner for per-session processing; never a provider identifier.';


--
-- Name: COLUMN messages.processing_lease_until; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.messages.processing_lease_until IS 'Crash-recoverable lease deadline for the current processing owner.';


--
-- Name: COLUMN messages.processing_completed_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.messages.processing_completed_at IS 'Safe completion boundary: customer outcome is durable and dependent state persistence has finished.';


--
-- Name: COLUMN messages.processing_outcome; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.messages.processing_outcome IS 'Normal completion or durable reconciliation disposition for stale work.';


--
-- Name: claim_whatsapp_reply_recovery_part(jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.claim_whatsapp_reply_recovery_part(p jsonb) RETURNS SETOF public.messages
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
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
$_$;


ALTER FUNCTION public.claim_whatsapp_reply_recovery_part(p jsonb) OWNER TO postgres;

--
-- Name: create_portal_recovery_request(text, text, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_portal_recovery_request(input_email text, input_token_hash text, input_expires_at timestamp with time zone, input_initiation_token_hash text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $_$
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
$_$;


ALTER FUNCTION public.create_portal_recovery_request(input_email text, input_token_hash text, input_expires_at timestamp with time zone, input_initiation_token_hash text) OWNER TO postgres;

--
-- Name: persist_setup_completed_event(text, uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.persist_setup_completed_event(target_session_id text, target_user_id uuid, target_event_key text) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  WITH inserted_event AS (
    INSERT INTO public.sales_funnel_events (
      session_id,
      user_id,
      event_type,
      event_key,
      metadata
    ) VALUES (
      target_session_id,
      target_user_id,
      'setup_completed',
      target_event_key,
      '{}'::jsonb
    )
    ON CONFLICT (event_key)
    WHERE event_key IS NOT NULL
    DO NOTHING
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM inserted_event);
$$;


ALTER FUNCTION public.persist_setup_completed_event(target_session_id text, target_user_id uuid, target_event_key text) OWNER TO postgres;

--
-- Name: prepare_whatsapp_reply_recovery(jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.prepare_whatsapp_reply_recovery(p jsonb) RETURNS SETOF public.messages
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
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
$_$;


ALTER FUNCTION public.prepare_whatsapp_reply_recovery(p jsonb) OWNER TO postgres;

--
-- Name: redeem_portal_recovery(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.redeem_portal_recovery(input_token_hash text, input_new_portal_token text) RETURNS TABLE(portal_token text, whatsapp_link_status text, verification_purpose text, resume_scheduled boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $_$
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
$_$;


ALTER FUNCTION public.redeem_portal_recovery(input_token_hash text, input_new_portal_token text) OWNER TO postgres;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO postgres;

--
-- Name: start_program_week_one(uuid, uuid, date, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.start_program_week_one(target_program_id uuid, target_user_id uuid, selected_start_date date, portal_today date) RETURNS TABLE(program_id uuid, program_status text, start_date date, week_status text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  target_program programs%ROWTYPE;
  target_week weeks%ROWTYPE;
  activate_now boolean;
BEGIN
  IF selected_start_date < portal_today
     OR selected_start_date > portal_today + 30 THEN
    RAISE EXCEPTION 'START_DATE_OUT_OF_RANGE';
  END IF;

  SELECT * INTO target_program
  FROM programs p
  WHERE p.id = target_program_id
    AND p.user_id = target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'PROGRAM_NOT_FOUND'; END IF;

  IF target_program.start_date IS NOT NULL THEN
    IF target_program.start_date = selected_start_date THEN
      RETURN QUERY
      SELECT p.id, p.status, p.start_date, w.status
      FROM programs p
      JOIN weeks w ON w.program_id = p.id AND w.week_number = 1
      WHERE p.id = target_program_id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'START_DATE_ALREADY_SELECTED';
  END IF;

  IF target_program.status <> 'personalization' THEN
    RAISE EXCEPTION 'PROGRAM_NOT_IN_PERSONALIZATION';
  END IF;

  SELECT * INTO target_week
  FROM weeks w
  WHERE w.program_id = target_program_id AND w.week_number = 1
  FOR UPDATE;

  IF NOT FOUND OR target_week.status <> 'planned' THEN
    RAISE EXCEPTION 'WEEK_ONE_NOT_PLANNED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM meal_plans mp
    WHERE mp.program_id = target_program_id
      AND mp.week_id = target_week.id
      AND mp.user_id = target_user_id
  ) THEN
    RAISE EXCEPTION 'WEEK_ONE_PLAN_NOT_FOUND';
  END IF;

  activate_now := selected_start_date = portal_today;

  IF activate_now AND EXISTS (
    SELECT 1 FROM weeks w
    WHERE w.program_id = target_program_id
      AND w.status = 'active'
      AND w.id <> target_week.id
  ) THEN
    RAISE EXCEPTION 'ANOTHER_WEEK_IS_ACTIVE';
  END IF;

  UPDATE programs p
  SET start_date = selected_start_date,
      status = CASE WHEN activate_now THEN 'active' ELSE p.status END,
      current_week = 1,
      updated_at = NOW()
  WHERE p.id = target_program_id;

  IF activate_now THEN
    UPDATE weeks w
    SET status = 'active', activated_at = NOW(), updated_at = NOW()
    WHERE w.id = target_week.id AND w.status = 'planned';
  END IF;

  RETURN QUERY
  SELECT p.id, p.status, p.start_date, w.status
  FROM programs p
  JOIN weeks w ON w.id = target_week.id
  WHERE p.id = target_program_id;
END;
$$;


ALTER FUNCTION public.start_program_week_one(target_program_id uuid, target_user_id uuid, selected_start_date date, portal_today date) OWNER TO postgres;

--
-- Name: apply_rls(jsonb, integer); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer DEFAULT (1024 * 1024)) RETURNS SETOF realtime.wal_rls
    LANGUAGE plpgsql
    AS $$
declare
    -- Regclass of the table e.g. public.notes
    entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

    -- I, U, D, T: insert, update ...
    action realtime.action = (
        case wal ->> 'action'
            when 'I' then 'INSERT'
            when 'U' then 'UPDATE'
            when 'D' then 'DELETE'
            else 'ERROR'
        end
    );

    -- Is row level security enabled for the table
    is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

    subscriptions realtime.subscription[] = array_agg(subs)
        from
            realtime.subscription subs
        where
            subs.entity = entity_
            -- Filter by action early - only get subscriptions interested in this action
            -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
            and (subs.action_filter = '*' or subs.action_filter = action::text);

    -- Subscription vars
    working_role regrole;
    working_selected_columns text[];
    claimed_role regrole;
    claims jsonb;

    subscription_id uuid;
    subscription_has_access bool;
    visible_to_subscription_ids uuid[] = '{}';

    -- structured info for wal's columns
    columns realtime.wal_column[];
    -- previous identity values for update/delete
    old_columns realtime.wal_column[];

    error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

    -- Primary jsonb output for record
    output jsonb;

    -- Loop record for iterating unique roles (outer loop)
    role_record record;
    -- Loop record for iterating unique selected_columns within a role (inner loop)
    cols_record record;
    -- Subscription ids visible at the role level (before fanning out by selected_columns)
    visible_role_sub_ids uuid[] = '{}';

begin
    perform set_config('role', null, true);

    columns =
        array_agg(
            (
                x->>'name',
                x->>'type',
                x->>'typeoid',
                realtime.cast(
                    (x->'value') #>> '{}',
                    coalesce(
                        (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                        (x->>'type')::regtype
                    )
                ),
                (pks ->> 'name') is not null,
                true
            )::realtime.wal_column
        )
        from
            jsonb_array_elements(wal -> 'columns') x
            left join jsonb_array_elements(wal -> 'pk') pks
                on (x ->> 'name') = (pks ->> 'name');

    old_columns =
        array_agg(
            (
                x->>'name',
                x->>'type',
                x->>'typeoid',
                realtime.cast(
                    (x->'value') #>> '{}',
                    coalesce(
                        (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                        (x->>'type')::regtype
                    )
                ),
                (pks ->> 'name') is not null,
                true
            )::realtime.wal_column
        )
        from
            jsonb_array_elements(wal -> 'identity') x
            left join jsonb_array_elements(wal -> 'pk') pks
                on (x ->> 'name') = (pks ->> 'name');

    for role_record in
        select claims_role
        from (select distinct claims_role from unnest(subscriptions)) t
        order by claims_role::text
    loop
        working_role := role_record.claims_role;

        -- Update `is_selectable` for columns and old_columns (once per role)
        columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(columns) c;

        old_columns =
                array_agg(
                    (
                        c.name,
                        c.type_name,
                        c.type_oid,
                        c.value,
                        c.is_pkey,
                        pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                    )::realtime.wal_column
                )
                from
                    unnest(old_columns) c;

        if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
            -- Fan out 400 error per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;
                return next (
                    jsonb_build_object(
                        'schema', wal ->> 'schema',
                        'table', wal ->> 'table',
                        'type', action
                    ),
                    is_rls_enabled,
                    (select array_agg(s.subscription_id) from unnest(subscriptions) as s where s.claims_role = working_role and (s.selected_columns is not distinct from working_selected_columns)),
                    array['Error 400: Bad Request, no primary key']
                )::realtime.wal_rls;
            end loop;

        -- The claims role does not have SELECT permission to the primary key of entity
        elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
            -- Fan out 401 error per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;
                return next (
                    jsonb_build_object(
                        'schema', wal ->> 'schema',
                        'table', wal ->> 'table',
                        'type', action
                    ),
                    is_rls_enabled,
                    (select array_agg(s.subscription_id) from unnest(subscriptions) as s where s.claims_role = working_role and (s.selected_columns is not distinct from working_selected_columns)),
                    array['Error 401: Unauthorized']
                )::realtime.wal_rls;
            end loop;

        else
            -- Create the prepared statement (once per role)
            if is_rls_enabled and action <> 'DELETE' then
                if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                    deallocate walrus_rls_stmt;
                end if;
                execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
            end if;

            -- Collect all visible subscription IDs for this role (filter check + RLS check)
            visible_role_sub_ids = '{}';

            for subscription_id, claims in (
                    select
                        subs.subscription_id,
                        subs.claims
                    from
                        unnest(subscriptions) subs
                    where
                        subs.entity = entity_
                        and subs.claims_role = working_role
                        and (
                            realtime.is_visible_through_filters(columns, subs.filters)
                            or (
                              action = 'DELETE'
                              and realtime.is_visible_through_filters(old_columns, subs.filters)
                            )
                        )
            ) loop

                if not is_rls_enabled or action = 'DELETE' then
                    visible_role_sub_ids = visible_role_sub_ids || subscription_id;
                else
                    -- Check if RLS allows the role to see the record
                    perform
                        -- Trim leading and trailing quotes from working_role because set_config
                        -- doesn't recognize the role as valid if they are included
                        set_config('role', trim(both '"' from working_role::text), true),
                        set_config('request.jwt.claims', claims::text, true);

                    execute 'execute walrus_rls_stmt' into subscription_has_access;

                    -- Reset the role on every FOR..LOOP batch execution.
                    -- The first batch of 10 rows is pre-fetched using the current connection role (PG internal behaviour)
                    -- then we have to reset it again otherwise it would use the role defined in the `set_config` above
                    -- to fetch the remaining rows when rows>10, which could be a user-defined role that lacks execution grants.
                    -- The flow is:
                    --   1. run batch with conn role
                    --   2. set_config working_role
                    --   3. execute walrus
                    --   4. reset role (revert)
                    --   5. repeat
                    perform set_config('role', null, true);

                    if subscription_has_access then
                        visible_role_sub_ids = visible_role_sub_ids || subscription_id;
                    end if;
                end if;
            end loop;

            perform set_config('role', null, true);

            -- Inner loop: per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;

                output = jsonb_build_object(
                    'schema', wal ->> 'schema',
                    'table', wal ->> 'table',
                    'type', action,
                    'commit_timestamp', to_char(
                        ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                    ),
                    'columns', (
                        select
                            jsonb_agg(
                                jsonb_build_object(
                                    'name', pa.attname,
                                    'type', pt.typname
                                )
                                order by pa.attnum asc
                            )
                        from
                            pg_attribute pa
                            join pg_type pt
                                on pa.atttypid = pt.oid
                            left join (
                                select unnest(conkey) as pkey_attnum
                                from pg_constraint
                                where conrelid = entity_ and contype = 'p'
                            ) pk on pk.pkey_attnum = pa.attnum
                        where
                            attrelid = entity_
                            and attnum > 0
                            and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
                            and (working_selected_columns is null or pa.attname = any(working_selected_columns) or pk.pkey_attnum is not null)
                    )
                )
                -- Add "record" key for insert and update
                || case
                    when action in ('INSERT', 'UPDATE') then
                        jsonb_build_object(
                            'record',
                            (
                                select
                                    jsonb_object_agg(
                                        -- if unchanged toast, get column name and value from old record
                                        coalesce((c).name, (oc).name),
                                        case
                                            when (c).name is null then (oc).value
                                            else (c).value
                                        end
                                    )
                                from
                                    unnest(columns) c
                                    full outer join unnest(old_columns) oc
                                        on (c).name = (oc).name
                                where
                                    coalesce((c).is_selectable, (oc).is_selectable)
                                    and (working_selected_columns is null or coalesce((c).name, (oc).name) = any(working_selected_columns) or coalesce((c).is_pkey, (oc).is_pkey))
                                    and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            )
                        )
                    else '{}'::jsonb
                end
                -- Add "old_record" key for update and delete
                || case
                    when action = 'UPDATE' then
                        jsonb_build_object(
                                'old_record',
                                (
                                    select jsonb_object_agg((c).name, (c).value)
                                    from unnest(old_columns) c
                                    where
                                        (c).is_selectable
                                        and (working_selected_columns is null or (c).name = any(working_selected_columns) or (c).is_pkey)
                                        and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                )
                            )
                    when action = 'DELETE' then
                        jsonb_build_object(
                            'old_record',
                            (
                                select jsonb_object_agg((c).name, (c).value)
                                from unnest(old_columns) c
                                where
                                    (c).is_selectable
                                    and (working_selected_columns is null or (c).name = any(working_selected_columns) or (c).is_pkey)
                                    and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                    and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                            )
                        )
                    else '{}'::jsonb
                end;

                -- Filter visible_role_sub_ids to those matching the current selected_columns group
                visible_to_subscription_ids = coalesce(
                    (
                        select array_agg(s.subscription_id)
                        from unnest(subscriptions) s
                        where s.claims_role = working_role
                          and (s.selected_columns is not distinct from working_selected_columns)
                          and s.subscription_id = any(visible_role_sub_ids)
                    ),
                    '{}'::uuid[]
                );

                return next (
                    output,
                    is_rls_enabled,
                    visible_to_subscription_ids,
                    case
                        when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                        else '{}'
                    end
                )::realtime.wal_rls;
            end loop;

        end if;
    end loop;

    perform set_config('role', null, true);
end;
$$;


ALTER FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) OWNER TO supabase_realtime_admin;

--
-- Name: broadcast_changes(text, text, text, text, text, record, record, text); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$$;


ALTER FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text) OWNER TO supabase_realtime_admin;

--
-- Name: build_prepared_statement_sql(text, regclass, realtime.wal_column[]); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) RETURNS text
    LANGUAGE sql
    AS $$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $$;


ALTER FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) OWNER TO supabase_realtime_admin;

--
-- Name: cast(text, regtype); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime."cast"(val text, type_ regtype) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  res jsonb;
begin
  if type_::text = 'bytea' then
    return to_jsonb(val);
  end if;
  execute format('select to_jsonb(%L::'|| type_::text || ')', val) into res;
  return res;
end
$$;


ALTER FUNCTION realtime."cast"(val text, type_ regtype) OWNER TO supabase_realtime_admin;

--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
/*
Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
*/
declare
    op_symbol text = (
        case
            when op = 'eq' then '='
            when op = 'neq' then '!='
            when op = 'lt' then '<'
            when op = 'lte' then '<='
            when op = 'gt' then '>'
            when op = 'gte' then '>='
            when op = 'in' then '= any'
            else 'UNKNOWN OP'
        end
    );
    res boolean;
begin
    execute format(
        'select %L::'|| type_::text || ' ' || op_symbol
        || ' ( %L::'
        || (
            case
                when op = 'in' then type_::text || '[]'
                else type_::text end
        )
        || ')', val_1, val_2) into res;
    return res;
end;
$$;


ALTER FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) OWNER TO supabase_realtime_admin;

--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text, negate boolean) RETURNS boolean
    LANGUAGE plpgsql STABLE
    AS $$
declare
    op_symbol text;
    res boolean;
begin
    -- IS DISTINCT FROM / IS NOT DISTINCT FROM: infix, both sides typed literals
    if op = 'isdistinct' then
        execute format(
            'select %L::%s %s %L::%s',
            val_1,
            type_::text,
            case when negate then 'IS NOT DISTINCT FROM' else 'IS DISTINCT FROM' end,
            val_2,
            type_::text
        ) into res;
        return res;
    end if;

    -- IS requires a keyword RHS (NULL, TRUE, FALSE, UNKNOWN), not a typed literal
    if op = 'is' then
        if val_2 not in ('null', 'true', 'false', 'unknown') then
            raise exception 'invalid value for is filter: must be null, true, false, or unknown';
        end if;
        execute format(
            'select %L::%s %s %s',
            val_1,
            type_::text,
            case when negate then 'IS NOT' else 'IS' end,
            upper(val_2)
        ) into res;
        return res;
    end if;

    op_symbol = case
        when op = 'eq'    then '='
        when op = 'neq'   then '!='
        when op = 'lt'    then '<'
        when op = 'lte'   then '<='
        when op = 'gt'    then '>'
        when op = 'gte'   then '>='
        when op = 'in'    then '= any'
        when op = 'like'   then 'LIKE'
        when op = 'ilike'  then 'ILIKE'
        when op = 'match'  then '~'
        when op = 'imatch' then '~*'
        else null
    end;

    if op_symbol is null then
        raise exception 'unsupported equality operator: %', op::text;
    end if;

    execute format(
        'select %L::%s %s (%L::%s)',
        val_1,
        type_::text,
        op_symbol,
        val_2,
        case when op = 'in' then type_::text || '[]' else type_::text end
    ) into res;

    return case when negate then not res else res end;
end;
$$;


ALTER FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text, negate boolean) OWNER TO supabase_realtime_admin;

--
-- Name: is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
    select
        filters is null
        or array_length(filters, 1) is null
        or coalesce(
            count(col.name) = count(1)
            and sum(
                realtime.check_equality_op(
                    op:=f.op,
                    type_:=coalesce(col.type_oid::regtype, col.type_name::regtype),
                    val_1:=col.value #>> '{}',
                    val_2:=f.value,
                    negate:=coalesce(f.negate, false)
                )::int
            ) filter (where col.name is not null) = count(col.name),
            false
        )
    from
        unnest(filters) f
        left join unnest(columns) col
            on f.column_name = col.name;
$$;


ALTER FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) OWNER TO supabase_realtime_admin;

--
-- Name: list_changes(name, name, integer, integer); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) RETURNS TABLE(wal jsonb, is_rls_enabled boolean, subscription_ids uuid[], errors text[], slot_changes_count bigint)
    LANGUAGE sql
    SET log_min_messages TO 'fatal'
    AS $$
  WITH pub AS (
    SELECT
      concat_ws(
        ',',
        CASE WHEN bool_or(pubinsert) THEN 'insert' ELSE NULL END,
        CASE WHEN bool_or(pubupdate) THEN 'update' ELSE NULL END,
        CASE WHEN bool_or(pubdelete) THEN 'delete' ELSE NULL END
      ) AS w2j_actions,
      coalesce(
        string_agg(
          realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
          ','
        ) filter (WHERE ppt.tablename IS NOT NULL),
        ''
      ) AS w2j_add_tables
    FROM pg_publication pp
    LEFT JOIN pg_publication_tables ppt ON pp.pubname = ppt.pubname
    WHERE pp.pubname = publication
    GROUP BY pp.pubname
    LIMIT 1
  ),
  -- MATERIALIZED ensures pg_logical_slot_get_changes is called exactly once
  w2j AS MATERIALIZED (
    SELECT x.*, pub.w2j_add_tables
    FROM pub,
         pg_logical_slot_get_changes(
           slot_name, null, max_changes,
           'include-pk', 'true',
           'include-transaction', 'false',
           'include-timestamp', 'true',
           'include-type-oids', 'true',
           'format-version', '2',
           'actions', pub.w2j_actions,
           'add-tables', pub.w2j_add_tables
         ) x
  ),
  slot_count AS (
    SELECT count(*)::bigint AS cnt
    FROM w2j
    WHERE w2j.w2j_add_tables <> ''
  ),
  rls_filtered AS (
    SELECT xyz.wal, xyz.is_rls_enabled, xyz.subscription_ids, xyz.errors
    FROM w2j,
         realtime.apply_rls(
           wal := w2j.data::jsonb,
           max_record_bytes := max_record_bytes
         ) xyz(wal, is_rls_enabled, subscription_ids, errors)
    WHERE w2j.w2j_add_tables <> ''
      AND xyz.subscription_ids[1] IS NOT NULL
  )
  SELECT rf.wal, rf.is_rls_enabled, rf.subscription_ids, rf.errors, sc.cnt
  FROM rls_filtered rf, slot_count sc

  UNION ALL

  SELECT null, null, null, null, sc.cnt
  FROM slot_count sc
  WHERE NOT EXISTS (SELECT 1 FROM rls_filtered)
$$;


ALTER FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) OWNER TO supabase_realtime_admin;

--
-- Name: quote_wal2json(regclass); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.quote_wal2json(entity regclass) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  SELECT
    realtime.wal2json_escape_identifier(nsp.nspname::text)
    || '.'
    || realtime.wal2json_escape_identifier(pc.relname::text)
  FROM pg_class pc
  JOIN pg_namespace nsp ON pc.relnamespace = nsp.oid
  WHERE pc.oid = entity
$$;


ALTER FUNCTION realtime.quote_wal2json(entity regclass) OWNER TO supabase_realtime_admin;

--
-- Name: send(jsonb, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


ALTER FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) OWNER TO supabase_realtime_admin;

--
-- Name: send_binary(bytea, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.send_binary(payload bytea, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();

    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    INSERT INTO realtime.messages (id, binary_payload, event, topic, private, extension)
    VALUES (generated_id, payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


ALTER FUNCTION realtime.send_binary(payload bytea, event text, topic text, private boolean) OWNER TO supabase_realtime_admin;

--
-- Name: subscription_check_filters(); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.subscription_check_filters() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    col_names text[] = coalesce(
            array_agg(a.attname order by a.attnum),
            '{}'::text[]
        )
        from
            pg_catalog.pg_attribute a
        where
            a.attrelid = new.entity
            and a.attnum > 0
            and not a.attisdropped
            and pg_catalog.has_column_privilege(
                (new.claims ->> 'role'),
                a.attrelid,
                a.attnum,
                'SELECT'
            );
    filter realtime.user_defined_filter;
    col_type regtype;
    in_val jsonb;
    selected_col text;
begin
    for filter in select * from unnest(new.filters) loop
        if not filter.column_name = any(col_names) then
            raise exception 'invalid column for filter %', filter.column_name;
        end if;

        col_type = (
            select atttypid::regtype
            from pg_catalog.pg_attribute
            where attrelid = new.entity
                  and attname = filter.column_name
        );
        if col_type is null then
            raise exception 'failed to lookup type for column %', filter.column_name;
        end if;

        if filter.op = 'in'::realtime.equality_op then
            in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
            if coalesce(jsonb_array_length(in_val), 0) > 100 then
                raise exception 'too many values for `in` filter. Maximum 100';
            end if;
        elsif filter.op = 'is'::realtime.equality_op then
            -- `is` requires a keyword RHS rather than a typed literal
            if filter.value not in ('null', 'true', 'false', 'unknown') then
                raise exception 'invalid value for is filter: must be null, true, false, or unknown';
            end if;
            -- IS NULL works for any type, but IS TRUE/FALSE/UNKNOWN require a boolean
            -- operand. Reject the non-null keywords on non-boolean columns here so they
            -- don't abort apply_rls at WAL time.
            if filter.value <> 'null' and col_type <> 'boolean'::regtype then
                raise exception 'is % filter requires a boolean column, got %', filter.value, col_type::text;
            end if;
        elsif filter.op in ('like'::realtime.equality_op, 'ilike'::realtime.equality_op) then
            -- like/ilike apply the text pattern operator (~~); reject column types that
            -- have no such operator instead of failing at WAL time
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = '~~' and oprleft = col_type
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
        elsif filter.op in ('match'::realtime.equality_op, 'imatch'::realtime.equality_op) then
            -- match/imatch apply the regex operators ~ / ~*; reject column types that have
            -- no such operator (e.g. integer) instead of failing at WAL time, mirroring the
            -- like/ilike guard above.
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = case when filter.op = 'imatch'::realtime.equality_op then '~*' else '~' end
                  and oprleft = col_type
                  and oprright = col_type
                  and oprresult = 'boolean'::regtype
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
            -- validate the regex eagerly so a bad pattern is rejected here, not inside
            -- apply_rls where it would abort the WAL stream for the entity
            begin
                perform '' ~ filter.value;
            exception when others then
                raise exception 'invalid regular expression for % filter: %', filter.op::text, sqlerrm;
            end;
        else
            -- eq/neq/lt/lte/gt/gte: value must be coercable to the type
            perform realtime.cast(filter.value, col_type);
        end if;
    end loop;

    if new.selected_columns is not null then
        for selected_col in select * from unnest(new.selected_columns) loop
            if not selected_col = any(col_names) then
                raise exception 'invalid column for select %', selected_col;
            end if;
        end loop;
    end if;

    -- Apply consistent order to filters so the unique constraint can't be tricked by a
    -- different filter order. negate is part of the sort key.
    new.filters = coalesce(
        array_agg(f order by f.column_name, f.op, f.value, f.negate),
        '{}'
    ) from unnest(new.filters) f;

    new.selected_columns = (
        select array_agg(c order by c)
        from unnest(new.selected_columns) c
    );

    return new;
end;
$$;


ALTER FUNCTION realtime.subscription_check_filters() OWNER TO supabase_realtime_admin;

--
-- Name: to_regrole(text); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.to_regrole(role_name text) RETURNS regrole
    LANGUAGE sql IMMUTABLE
    AS $$ select role_name::regrole $$;


ALTER FUNCTION realtime.to_regrole(role_name text) OWNER TO supabase_realtime_admin;

--
-- Name: topic(); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.topic() RETURNS text
    LANGUAGE sql STABLE
    AS $$
select nullif(current_setting('realtime.topic', true), '')::text;
$$;


ALTER FUNCTION realtime.topic() OWNER TO supabase_realtime_admin;

--
-- Name: wal2json_escape_identifier(text); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.wal2json_escape_identifier(name text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  -- Prefix `\`, `,`, `.`, and any whitespace with `\`
  SELECT regexp_replace(name, '([\\,.[:space:]])', '\\\1', 'g')
$$;


ALTER FUNCTION realtime.wal2json_escape_identifier(name text) OWNER TO supabase_realtime_admin;

--
-- Name: allow_any_operation(text[]); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.allow_any_operation(expected_operations text[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


ALTER FUNCTION storage.allow_any_operation(expected_operations text[]) OWNER TO supabase_storage_admin;

--
-- Name: allow_only_operation(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.allow_only_operation(expected_operation text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


ALTER FUNCTION storage.allow_only_operation(expected_operation text) OWNER TO supabase_storage_admin;

--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


ALTER FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) OWNER TO supabase_storage_admin;

--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


ALTER FUNCTION storage.enforce_bucket_name_length() OWNER TO supabase_storage_admin;

--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Get the last path segment (the actual filename)
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    -- Extract extension: reverse, split on '.', then reverse again
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


ALTER FUNCTION storage.extension(name text) OWNER TO supabase_storage_admin;

--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    RETURN _parts[array_length(_parts, 1)];
END
$$;


ALTER FUNCTION storage.filename(name text) OWNER TO supabase_storage_admin;

--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


ALTER FUNCTION storage.foldername(name text) OWNER TO supabase_storage_admin;

--
-- Name: get_common_prefix(text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


ALTER FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) OWNER TO supabase_storage_admin;

--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint)::bigint as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


ALTER FUNCTION storage.get_size_by_bucket() OWNER TO supabase_storage_admin;

--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


ALTER FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer, next_key_token text, next_upload_token text) OWNER TO supabase_storage_admin;

--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer, start_after text, next_token text, sort_order text) OWNER TO supabase_storage_admin;

--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


ALTER FUNCTION storage.operation() OWNER TO supabase_storage_admin;

--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.protect_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION storage.protect_delete() OWNER TO supabase_storage_admin;

--
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_prefix_len INT;
    v_prefix_start INT;
    v_combined_levels INT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_prefix_len := length(coalesce(prefix, ''));
    v_prefix_start := coalesce(array_length(string_to_array(coalesce(prefix, ''), v_delimiter), 1), 1);
    v_combined_levels := coalesce(array_length(string_to_array(v_prefix, v_delimiter), 1), 1);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT array_to_string(path_tokens[$1:$2], '/') AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $3 || '%%'
                  AND bucket_id = $4
                  AND array_length(objects.path_tokens, 1) <> $2
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT array_to_string(path_tokens[$1:$2], '/') AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $3 || '%%'
               AND bucket_id = $4
               AND array_length(objects.path_tokens, 1) = $2
             ORDER BY %I %s)
            LIMIT $5 OFFSET $6
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING v_prefix_start, v_combined_levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := substring(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter) from v_prefix_len + 1);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := substring(v_current.name from v_prefix_len + 1);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION storage.search(prefix text, bucketname text, limits integer, levels integer, offsets integer, search text, sortcolumn text, sortorder text) OWNER TO supabase_storage_admin;

--
-- Name: search_by_timestamp(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
    v_sort_order text;
    v_sort_column text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    -- Defense-in-depth: this function is independently reachable and must
    -- not trust p_sort_order/p_sort_column to already be validated by a
    -- caller. Normalize to the same strict allow-list storage.search_v2
    -- uses before interpolating anything into dynamic SQL below.
    v_sort_order := lower(coalesce(p_sort_order, 'asc'));
    IF v_sort_order NOT IN ('asc', 'desc') THEN
        v_sort_order := 'asc';
    END IF;

    v_sort_column := lower(coalesce(p_sort_column, 'updated_at'));
    IF v_sort_column NOT IN ('updated_at', 'created_at') THEN
        v_sort_column := 'updated_at';
    END IF;

    IF v_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        v_sort_column,
        v_cursor_op,
        v_sort_column,
        v_sort_order,
        v_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


ALTER FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) OWNER TO supabase_storage_admin;

--
-- Name: search_v2(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


ALTER FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer, levels integer, start_after text, sort_order text, sort_column text, sort_column_after text) OWNER TO supabase_storage_admin;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


ALTER FUNCTION storage.update_updated_at_column() OWNER TO supabase_storage_admin;

--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


ALTER TABLE auth.audit_log_entries OWNER TO supabase_auth_admin;

--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    custom_claims_allowlist text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


ALTER TABLE auth.custom_oauth_providers OWNER TO supabase_auth_admin;

--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


ALTER TABLE auth.flow_state OWNER TO supabase_auth_admin;

--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


ALTER TABLE auth.identities OWNER TO supabase_auth_admin;

--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


ALTER TABLE auth.instances OWNER TO supabase_auth_admin;

--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


ALTER TABLE auth.mfa_amr_claims OWNER TO supabase_auth_admin;

--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


ALTER TABLE auth.mfa_challenges OWNER TO supabase_auth_admin;

--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


ALTER TABLE auth.mfa_factors OWNER TO supabase_auth_admin;

--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: COLUMN mfa_factors.last_webauthn_challenge_data; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


ALTER TABLE auth.oauth_authorizations OWNER TO supabase_auth_admin;

--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


ALTER TABLE auth.oauth_client_states OWNER TO supabase_auth_admin;

--
-- Name: TABLE oauth_client_states; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


ALTER TABLE auth.oauth_clients OWNER TO supabase_auth_admin;

--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


ALTER TABLE auth.oauth_consents OWNER TO supabase_auth_admin;

--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


ALTER TABLE auth.one_time_tokens OWNER TO supabase_auth_admin;

--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


ALTER TABLE auth.refresh_tokens OWNER TO supabase_auth_admin;

--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: supabase_auth_admin
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE auth.refresh_tokens_id_seq OWNER TO supabase_auth_admin;

--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: supabase_auth_admin
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


ALTER TABLE auth.saml_providers OWNER TO supabase_auth_admin;

--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


ALTER TABLE auth.saml_relay_states OWNER TO supabase_auth_admin;

--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


ALTER TABLE auth.schema_migrations OWNER TO supabase_auth_admin;

--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


ALTER TABLE auth.sessions OWNER TO supabase_auth_admin;

--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN sessions.refresh_token_hmac_key; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN sessions.refresh_token_counter; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


ALTER TABLE auth.sso_domains OWNER TO supabase_auth_admin;

--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


ALTER TABLE auth.sso_providers OWNER TO supabase_auth_admin;

--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


ALTER TABLE auth.users OWNER TO supabase_auth_admin;

--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: webauthn_challenges; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge_type text NOT NULL,
    session_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT webauthn_challenges_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text])))
);


ALTER TABLE auth.webauthn_challenges OWNER TO supabase_auth_admin;

--
-- Name: webauthn_credentials; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    attestation_type text DEFAULT ''::text NOT NULL,
    aaguid uuid,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb DEFAULT '[]'::jsonb NOT NULL,
    backup_eligible boolean DEFAULT false NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    friendly_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


ALTER TABLE auth.webauthn_credentials OWNER TO supabase_auth_admin;

--
-- Name: logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now(),
    user_id uuid,
    event text NOT NULL,
    error_context jsonb,
    resolved boolean DEFAULT false,
    error_message text,
    thread_id text,
    severity text DEFAULT 'error'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT logs_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text, 'critical'::text])))
);


ALTER TABLE public.logs OWNER TO postgres;

--
-- Name: meal_plans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.meal_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    meals jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    week_id uuid,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    generation_version integer DEFAULT 1 NOT NULL,
    program_id uuid,
    CONSTRAINT meal_plans_program_week_consistency CHECK ((((program_id IS NULL) AND (week_id IS NULL)) OR ((program_id IS NOT NULL) AND (week_id IS NOT NULL))))
);


ALTER TABLE public.meal_plans OWNER TO postgres;

--
-- Name: messages_inbound_processing_order_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.messages_inbound_processing_order_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.messages_inbound_processing_order_seq OWNER TO postgres;

--
-- Name: onboarding_chat_memory; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.onboarding_chat_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    message jsonb
);


ALTER TABLE public.onboarding_chat_memory OWNER TO postgres;

--
-- Name: onboarding_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.onboarding_sessions (
    session_id text NOT NULL,
    legacy_onboarding_state text DEFAULT 'lead'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    conversation_stage text DEFAULT 'new'::text,
    goal text,
    last_question_type text,
    last_question_at timestamp with time zone,
    offer_version text,
    commercial_context_expires_at timestamp with time zone,
    checkout_authorization_type text,
    checkout_authorized_at timestamp with time zone,
    checkout_session_id text,
    checkout_sent_at timestamp with time zone,
    reminder_requested_at timestamp with time zone,
    reminder_scheduled_for timestamp with time zone,
    reminder_message_sid text,
    offer_context text,
    CONSTRAINT onboarding_sessions_checkout_authorization_type_check CHECK (((checkout_authorization_type IS NULL) OR (checkout_authorization_type = ANY (ARRAY['explicit'::text, 'contextual'::text])))),
    CONSTRAINT onboarding_sessions_checkout_evidence_check CHECK (((checkout_authorized_at IS NULL) OR ((checkout_authorization_type IS NOT NULL) AND (offer_version IS NOT NULL)))),
    CONSTRAINT onboarding_sessions_commercial_context_check CHECK (((commercial_context_expires_at IS NULL) OR ((last_question_type = 'purchase_confirmation'::text) AND (last_question_at IS NOT NULL)))),
    CONSTRAINT onboarding_sessions_conversation_stage_check CHECK (((conversation_stage IS NULL) OR (conversation_stage = ANY (ARRAY['new'::text, 'evaluating'::text, 'offer'::text, 'checkout_pending'::text, 'closed'::text])))),
    CONSTRAINT onboarding_sessions_last_question_type_check CHECK (((last_question_type IS NULL) OR (last_question_type = ANY (ARRAY['primary_goal'::text, 'show_example'::text, 'explain_offer'::text, 'purchase_confirmation'::text, 'reminder_date'::text])))),
    CONSTRAINT onboarding_sessions_offer_context_check CHECK (((offer_context IS NULL) OR (offer_context = 'glp1_validation'::text))),
    CONSTRAINT onboarding_sessions_state_check CHECK ((legacy_onboarding_state = ANY (ARRAY['lead'::text, 'ask_subscription'::text, 'subscription_deferred'::text, 'payment_pending'::text, 'subscriber'::text, 'closed'::text])))
);


ALTER TABLE public.onboarding_sessions OWNER TO postgres;

--
-- Name: portal_recovery_initiations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.portal_recovery_initiations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    initiating_whatsapp_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    purpose text DEFAULT 'recover_portal'::text NOT NULL,
    pending_message_id uuid,
    CONSTRAINT portal_recovery_initiations_purpose_check CHECK ((purpose = ANY (ARRAY['recover_portal'::text, 'link_whatsapp'::text]))),
    CONSTRAINT portal_recovery_initiations_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);


ALTER TABLE public.portal_recovery_initiations OWNER TO postgres;

--
-- Name: portal_recovery_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.portal_recovery_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    initiating_whatsapp_id text,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    invalidated_at timestamp with time zone,
    whatsapp_link_status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    purpose text DEFAULT 'recover_portal'::text NOT NULL,
    pending_message_id uuid,
    CONSTRAINT portal_recovery_requests_purpose_check CHECK ((purpose = ANY (ARRAY['recover_portal'::text, 'link_whatsapp'::text]))),
    CONSTRAINT portal_recovery_requests_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT portal_recovery_requests_whatsapp_link_status_check CHECK (((whatsapp_link_status IS NULL) OR (whatsapp_link_status = ANY (ARRAY['not_requested'::text, 'linked'::text, 'already_linked'::text, 'conflict_target'::text, 'conflict_identity'::text]))))
);


ALTER TABLE public.portal_recovery_requests OWNER TO postgres;

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    birth_year integer,
    height_cm integer,
    weight_kg numeric(5,2),
    eating_style text,
    allergies text[] DEFAULT '{}'::text[],
    medical_conditions text[] DEFAULT '{}'::text[],
    foods_to_avoid text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    birth_month smallint,
    household_size smallint,
    notes text,
    sensitive_data_consent_at timestamp with time zone,
    privacy_notice_version text,
    CONSTRAINT chk_profiles_allergies CHECK ((allergies <@ ARRAY['dairy'::text, 'eggs'::text, 'gluten'::text, 'shellfish'::text, 'tree_nuts'::text, 'other'::text])),
    CONSTRAINT chk_profiles_birth_month CHECK (((birth_month >= 1) AND (birth_month <= 12))),
    CONSTRAINT chk_profiles_birth_month_year CHECK ((((birth_month IS NULL) AND (birth_year IS NULL)) OR ((birth_month IS NOT NULL) AND (birth_year IS NOT NULL)))),
    CONSTRAINT chk_profiles_birth_year CHECK (((birth_year >= 1900) AND (birth_year <= 2100))),
    CONSTRAINT chk_profiles_eating_style CHECK ((eating_style = ANY (ARRAY['omnivore'::text, 'vegetarian'::text, 'vegan'::text, 'pescatarian'::text]))),
    CONSTRAINT chk_profiles_height CHECK (((height_cm >= 100) AND (height_cm <= 250))),
    CONSTRAINT chk_profiles_household_size CHECK (((household_size >= 1) AND (household_size <= 20))),
    CONSTRAINT chk_profiles_medical_conditions CHECK ((medical_conditions <@ ARRAY['hypertension'::text, 'high_cholesterol'::text, 'fatty_liver'::text, 'diabetes'::text, 'pcos'::text, 'hypothyroidism'::text, 'other'::text])),
    CONSTRAINT chk_profiles_weight CHECK (((weight_kg >= (25)::numeric) AND (weight_kg <= (350)::numeric)))
);


ALTER TABLE public.profiles OWNER TO postgres;

--
-- Name: programs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.programs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    profile_id uuid,
    status text DEFAULT 'personalization'::text NOT NULL,
    start_date date,
    current_week integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT programs_current_week_check CHECK (((current_week >= 1) AND (current_week <= 4))),
    CONSTRAINT programs_status_check CHECK ((status = ANY (ARRAY['personalization'::text, 'ready'::text, 'active'::text, 'completed'::text, 'cancelled'::text])))
);


ALTER TABLE public.programs OWNER TO postgres;

--
-- Name: purchases; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    program_id uuid,
    stripe_checkout_session_id text NOT NULL,
    stripe_payment_intent_id text,
    stripe_customer_id text,
    stripe_product_id text,
    stripe_price_id text NOT NULL,
    purchase_type text DEFAULT '28_day_program'::text NOT NULL,
    payment_status text NOT NULL,
    amount_total integer NOT NULL,
    currency text DEFAULT 'mxn'::text NOT NULL,
    purchased_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT purchases_amount_total_check CHECK ((amount_total >= 0)),
    CONSTRAINT purchases_currency_check CHECK ((currency = lower(currency))),
    CONSTRAINT purchases_payment_status_check CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'partially_refunded'::text]))),
    CONSTRAINT purchases_purchase_type_check CHECK ((purchase_type = '28_day_program'::text))
);


ALTER TABLE public.purchases OWNER TO postgres;

--
-- Name: product_fact_value_is_valid(text, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.reserve_authorized_action_execution(p jsonb) RETURNS TABLE(state text, action_id text, execution_key text, action_type text, result jsonb)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE existing public.authorized_action_executions%ROWTYPE; proposed_action_id text; proposed_execution_key text; proposed_action_type text; proposed_worker_id text; inserted boolean := false;
BEGIN
  IF jsonb_typeof(p) <> 'object' OR NOT (p ?& ARRAY['action_id','execution_key','action_type','worker_id']) OR (SELECT count(*) FROM jsonb_object_keys(p)) <> 4 THEN RAISE EXCEPTION 'AUTHORIZED_ACTION_RESERVATION_INPUT_INVALID'; END IF;
  proposed_action_id := p->>'action_id'; proposed_execution_key := p->>'execution_key'; proposed_action_type := p->>'action_type'; proposed_worker_id := p->>'worker_id';
  IF proposed_action_id !~ '^act-[0-9a-f]{64}$' OR proposed_execution_key !~ '^aek-[0-9a-f]{64}$' OR proposed_action_type NOT IN ('provide_checkout_destination','provide_holding_page_destination') OR proposed_worker_id IS NULL OR length(proposed_worker_id) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'AUTHORIZED_ACTION_RESERVATION_INPUT_INVALID'; END IF;
  INSERT INTO public.authorized_action_executions (execution_key, action_id, action_type, execution_status, lease_owner, lease_expires_at) VALUES (proposed_execution_key, proposed_action_id, proposed_action_type, 'reserved', proposed_worker_id, now() + interval '60 seconds') ON CONFLICT (execution_key) DO NOTHING RETURNING true INTO inserted;
  SELECT * INTO existing FROM public.authorized_action_executions WHERE execution_key = proposed_execution_key FOR UPDATE;
  IF existing.action_id <> proposed_action_id OR existing.action_type <> proposed_action_type THEN RAISE EXCEPTION 'AUTHORIZED_ACTION_RESERVATION_IDENTITY_CONFLICT'; END IF;
  IF inserted THEN RETURN QUERY SELECT 'acquired', existing.action_id, existing.execution_key, existing.action_type, NULL::jsonb; RETURN; END IF;
  IF existing.execution_status = 'succeeded' THEN RETURN QUERY SELECT 'already_succeeded', existing.action_id, existing.execution_key, existing.action_type, existing.result; RETURN; END IF;
  IF existing.execution_status = 'failed_terminal' THEN RETURN QUERY SELECT 'terminal_failure', existing.action_id, existing.execution_key, existing.action_type, NULL::jsonb; RETURN; END IF;
  IF existing.execution_status = 'reserved' AND existing.lease_expires_at > now() THEN RETURN QUERY SELECT 'in_progress', existing.action_id, existing.execution_key, existing.action_type, NULL::jsonb; RETURN; END IF;
  UPDATE public.authorized_action_executions SET execution_status = 'reserved', lease_owner = proposed_worker_id, lease_expires_at = now() + interval '60 seconds', updated_at = now() WHERE execution_key = proposed_execution_key;
  RETURN QUERY SELECT 'retry_acquired', proposed_action_id, proposed_execution_key, proposed_action_type, NULL::jsonb;
END;
$$;

CREATE FUNCTION public.complete_authorized_action_execution(p jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE affected integer;
BEGIN
  IF jsonb_typeof(p) <> 'object' OR NOT (p ?& ARRAY['action_id','execution_key','worker_id','result']) OR (SELECT count(*) FROM jsonb_object_keys(p)) <> 4 OR p->>'action_id' !~ '^act-[0-9a-f]{64}$' OR p->>'execution_key' !~ '^aek-[0-9a-f]{64}$' OR p->>'worker_id' IS NULL OR length(p->>'worker_id') NOT BETWEEN 1 AND 128 OR jsonb_typeof(p->'result') <> 'object' OR p->'result'->>'execution_status' <> 'succeeded' OR p->'result'->>'action_id' IS DISTINCT FROM p->>'action_id' OR p->'result'->>'execution_key' IS DISTINCT FROM p->>'execution_key' THEN RAISE EXCEPTION 'AUTHORIZED_ACTION_COMPLETION_INPUT_INVALID'; END IF;
  UPDATE public.authorized_action_executions SET execution_status = 'succeeded', result = p->'result', lease_owner = NULL, lease_expires_at = NULL, updated_at = now() WHERE action_id = p->>'action_id' AND execution_key = p->>'execution_key' AND execution_status = 'reserved' AND lease_owner = p->>'worker_id' AND lease_expires_at > now();
  GET DIAGNOSTICS affected = ROW_COUNT; IF affected <> 1 THEN RAISE EXCEPTION 'AUTHORIZED_ACTION_COMPLETION_NOT_RESERVED'; END IF;
END;
$$;

CREATE FUNCTION public.fail_authorized_action_execution(p jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE affected integer;
BEGIN
  IF jsonb_typeof(p) <> 'object' OR NOT (p ?& ARRAY['action_id','execution_key','worker_id','execution_status']) OR (SELECT count(*) FROM jsonb_object_keys(p)) <> 4 OR p->>'action_id' !~ '^act-[0-9a-f]{64}$' OR p->>'execution_key' !~ '^aek-[0-9a-f]{64}$' OR p->>'worker_id' IS NULL OR length(p->>'worker_id') NOT BETWEEN 1 AND 128 OR p->>'execution_status' NOT IN ('failed_retryable','failed_terminal') THEN RAISE EXCEPTION 'AUTHORIZED_ACTION_FAILURE_INPUT_INVALID'; END IF;
  UPDATE public.authorized_action_executions SET execution_status = p->>'execution_status', lease_owner = NULL, lease_expires_at = NULL, updated_at = now() WHERE action_id = p->>'action_id' AND execution_key = p->>'execution_key' AND execution_status = 'reserved' AND lease_owner = p->>'worker_id' AND lease_expires_at > now();
  GET DIAGNOSTICS affected = ROW_COUNT; IF affected <> 1 THEN RAISE EXCEPTION 'AUTHORIZED_ACTION_FAILURE_NOT_RESERVED'; END IF;
END;
$$;

CREATE FUNCTION public.product_fact_value_is_valid(target_value_type text, target_value jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE target_value_type
    WHEN 'boolean' THEN jsonb_typeof(target_value) = 'boolean'
    WHEN 'integer' THEN jsonb_typeof(target_value) = 'number' AND trunc((target_value #>> '{}')::numeric) = (target_value #>> '{}')::numeric
    WHEN 'money' THEN jsonb_typeof(target_value) = 'object' AND jsonb_typeof(target_value -> 'amount') = 'number' AND (target_value ->> 'amount')::numeric >= 0 AND jsonb_typeof(target_value -> 'currency') = 'string' AND length(target_value ->> 'currency') = 3 AND target_value ->> 'currency' = upper(target_value ->> 'currency')
    WHEN 'enum' THEN jsonb_typeof(target_value) = 'string' AND target_value #>> '{}' <> ''
    WHEN 'enum_set' THEN jsonb_typeof(target_value) = 'array' AND jsonb_array_length(target_value) > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(target_value) AS item WHERE jsonb_typeof(item) <> 'string' OR item #>> '{}' = '') AND (SELECT count(*) = count(DISTINCT item #>> '{}') FROM jsonb_array_elements(target_value) AS item)
    WHEN 'object' THEN jsonb_typeof(target_value) = 'object'
    WHEN 'text' THEN jsonb_typeof(target_value) = 'string'
    ELSE false
  END;
$$;

ALTER FUNCTION public.product_fact_value_is_valid(target_value_type text, target_value jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.product_fact_value_is_valid(target_value_type text, target_value jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.product_fact_value_is_valid(target_value_type text, target_value jsonb) TO service_role;

--
-- Name: product_facts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fact_key text NOT NULL,
    offer_version text,
    scope jsonb DEFAULT '{}'::jsonb NOT NULL,
    offer_scope_key text GENERATED ALWAYS AS (coalesce(offer_version, ''::text)) STORED,
    scope_key text GENERATED ALWAYS AS ((scope)::text) STORED,
    state text NOT NULL,
    value_type text NOT NULL,
    value jsonb,
    valid_from timestamp with time zone NOT NULL,
    valid_to timestamp with time zone,
    version integer NOT NULL,
    provenance text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_facts_deprecated_active_check CHECK ((NOT ((state = 'deprecated'::text) AND (status = 'active'::text)))),
    CONSTRAINT product_facts_key_check CHECK ((fact_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'::text)),
    CONSTRAINT product_facts_known_value_check CHECK (((state <> ALL (ARRAY['known_true'::text, 'known_false'::text])) OR ((value IS NOT NULL) AND public.product_fact_value_is_valid(value_type, value)))),
    CONSTRAINT product_facts_scope_object_check CHECK ((jsonb_typeof(scope) = 'object'::text)),
    CONSTRAINT product_facts_state_check CHECK ((state = ANY (ARRAY['known_true'::text, 'known_false'::text, 'unknown'::text, 'not_applicable'::text, 'deprecated'::text]))),
    CONSTRAINT product_facts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'deprecated'::text, 'draft'::text]))),
    CONSTRAINT product_facts_unknown_value_check CHECK (((state <> ALL (ARRAY['unknown'::text, 'not_applicable'::text])) OR (value IS NULL))),
    CONSTRAINT product_facts_validity_check CHECK (((valid_to IS NULL) OR (valid_to > valid_from))),
    CONSTRAINT product_facts_value_type_check CHECK ((value_type = ANY (ARRAY['boolean'::text, 'integer'::text, 'money'::text, 'enum'::text, 'enum_set'::text, 'object'::text, 'text'::text]))),
    CONSTRAINT product_facts_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.product_facts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.product_facts OWNER TO postgres;

--
-- Name: sales_funnel_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sales_funnel_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id text,
    user_id uuid,
    event_type text NOT NULL,
    event_key text,
    buyer_signal text,
    topic text,
    strategy text,
    offer_version text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_funnel_events_buyer_signal_check CHECK (((buyer_signal IS NULL) OR (buyer_signal = ANY (ARRAY['information_request'::text, 'broad_information_request'::text, 'positive_interest'::text, 'question'::text, 'objection_price'::text, 'objection_trust'::text, 'objection_timing'::text, 'deferred_interest'::text, 'explicit_purchase'::text, 'contextual_affirmation'::text, 'ambiguous_acknowledgement'::text, 'gratitude'::text, 'rejection'::text, 'ai_value_objection'::text, 'support_issue'::text, 'other'::text])))),
    CONSTRAINT sales_funnel_events_metadata_object_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT sales_funnel_events_strategy_check CHECK (((strategy IS NULL) OR (strategy = ANY (ARRAY['direct_purchase'::text, 'purchase_confirmation'::text, 'clarify'::text, 'answer_question'::text, 'handle_objection'::text, 'discovery'::text, 'show_example'::text, 'explain_offer'::text, 'deferred'::text, 'reminder'::text, 'graceful_close'::text, 'acknowledgement'::text, 'conversational'::text, 'answer_objection'::text, 'broad_information'::text])))),
    CONSTRAINT sales_funnel_events_type_check CHECK ((event_type = ANY (ARRAY['lead_started'::text, 'meaningful_engagement'::text, 'offer_presented'::text, 'purchase_intent'::text, 'checkout_sent'::text, 'purchase_completed'::text, 'setup_completed'::text, 'program_ready'::text, 'price_question'::text, 'payment_method_question'::text, 'timing_objection'::text, 'price_objection'::text, 'trust_objection'::text, 'health_question'::text, 'deferred_interest'::text, 'reminder_requested'::text, 'reminder_sent'::text, 'rejection'::text, 'ai_value_objection'::text])))
);

ALTER TABLE ONLY public.sales_funnel_events FORCE ROW LEVEL SECURITY;


ALTER TABLE public.sales_funnel_events OWNER TO postgres;

--
-- Name: shopping_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.shopping_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shopping_list_id uuid NOT NULL,
    name text NOT NULL,
    quantity numeric,
    unit text,
    category text,
    sort_order integer DEFAULT 0 NOT NULL,
    checked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.shopping_items OWNER TO postgres;

--
-- Name: shopping_lists; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.shopping_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meal_plan_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.shopping_lists OWNER TO postgres;

--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    provider text,
    status text,
    plan text,
    started_at timestamp with time zone,
    renewed_at timestamp with time zone,
    expires_at timestamp with time zone,
    stripe_subscription_id text,
    stripe_customer_id text,
    currency text,
    amount integer,
    metadata jsonb DEFAULT '{}'::jsonb
);


ALTER TABLE public.subscriptions OWNER TO postgres;

--
-- Name: unsubscribed_metrics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.unsubscribed_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    region text,
    allergies text[],
    dislikes text[],
    conditions text[],
    diet text,
    cuisine text,
    unsubscribed_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.unsubscribed_metrics OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    whatsapp_id text,
    name text,
    joined_at timestamp with time zone DEFAULT now(),
    plan_type text DEFAULT 'free'::text,
    is_active boolean DEFAULT false,
    last_interaction_at timestamp with time zone,
    thread_id text,
    preferences jsonb DEFAULT '{"diet": null, "cuisine": null, "dislikes": [], "allergies": [], "conditions": []}'::jsonb,
    stripe_customer_id text,
    stripe_subscription_id text,
    subscription_status text,
    last_assistant_message text,
    portal_token text DEFAULT substr(md5((random())::text), 1, 8),
    timezone text DEFAULT 'America/Mexico_City'::text,
    updated_at timestamp with time zone DEFAULT now(),
    email text
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: weeks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.weeks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    program_id uuid NOT NULL,
    week_number integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    planned_at timestamp with time zone,
    activated_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT weeks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'planned'::text, 'active'::text, 'completed'::text]))),
    CONSTRAINT weeks_week_number_check CHECK (((week_number >= 1) AND (week_number <= 4)))
);


ALTER TABLE public.weeks OWNER TO postgres;

--
-- Name: messages; Type: TABLE; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE TABLE realtime.messages (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    skip_broadcast boolean DEFAULT false NOT NULL
)
PARTITION BY RANGE (inserted_at);


ALTER TABLE realtime.messages OWNER TO supabase_realtime_admin;

--
-- Name: schema_migrations; Type: TABLE; Schema: realtime; Owner: supabase_admin
--

CREATE TABLE realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone
);


ALTER TABLE realtime.schema_migrations OWNER TO supabase_admin;

--
-- Name: subscription; Type: TABLE; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE TABLE realtime.subscription (
    id bigint NOT NULL,
    subscription_id uuid NOT NULL,
    entity regclass NOT NULL,
    filters realtime.user_defined_filter[] DEFAULT '{}'::realtime.user_defined_filter[] NOT NULL,
    claims jsonb NOT NULL,
    claims_role regrole GENERATED ALWAYS AS (realtime.to_regrole((claims ->> 'role'::text))) STORED NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    action_filter text DEFAULT '*'::text,
    selected_columns text[],
    CONSTRAINT subscription_action_filter_check CHECK ((action_filter = ANY (ARRAY['*'::text, 'INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


ALTER TABLE realtime.subscription OWNER TO supabase_realtime_admin;

--
-- Name: subscription_id_seq; Type: SEQUENCE; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER TABLE realtime.subscription ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME realtime.subscription_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL,
    versioning_status text DEFAULT 'DISABLED'::text NOT NULL,
    CONSTRAINT buckets_versioning_dark_check CHECK ((versioning_status = 'DISABLED'::text)),
    CONSTRAINT buckets_versioning_standard_only_check CHECK (((type = 'STANDARD'::storage.buckettype) OR (versioning_status = 'DISABLED'::text))),
    CONSTRAINT buckets_versioning_status_check CHECK ((versioning_status = ANY (ARRAY['DISABLED'::text, 'ENABLED'::text, 'SUSPENDED'::text])))
);


ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;

--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: supabase_storage_admin
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE storage.buckets_analytics OWNER TO supabase_storage_admin;

--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.buckets_vectors OWNER TO supabase_storage_admin;

--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE storage.migrations OWNER TO supabase_storage_admin;

--
-- Name: objects; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb,
    archived_at timestamp with time zone,
    is_delete_marker boolean DEFAULT false NOT NULL,
    is_versioned boolean DEFAULT false NOT NULL
);


ALTER TABLE storage.objects OWNER TO supabase_storage_admin;

--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: supabase_storage_admin
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb,
    metadata jsonb
);


ALTER TABLE storage.s3_multipart_uploads OWNER TO supabase_storage_admin;

--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.s3_multipart_uploads_parts OWNER TO supabase_storage_admin;

--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.vector_indexes OWNER TO supabase_storage_admin;

--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: logs logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_pkey PRIMARY KEY (id);


--
-- Name: meal_plans meal_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meal_plans
    ADD CONSTRAINT meal_plans_pkey PRIMARY KEY (id);


--
-- Name: meal_plans meal_plans_week_version_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meal_plans
    ADD CONSTRAINT meal_plans_week_version_unique UNIQUE (week_id, generation_version);

ALTER TABLE ONLY public.authorized_action_executions
    ADD CONSTRAINT authorized_action_executions_pkey PRIMARY KEY (execution_key);
ALTER TABLE ONLY public.authorized_action_executions
    ADD CONSTRAINT authorized_action_executions_action_id_key UNIQUE (action_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.conversation_artifacts
    ADD CONSTRAINT conversation_artifacts_pkey PRIMARY KEY (artifact_id);
ALTER TABLE ONLY public.conversation_artifacts
    ADD CONSTRAINT conversation_artifacts_logical_reply_key_key UNIQUE (logical_reply_key);
ALTER TABLE ONLY public.conversation_artifacts
    ADD CONSTRAINT conversation_artifacts_generation_task_id_key UNIQUE (generation_task_id);
ALTER TABLE ONLY public.conversation_artifacts
    ADD CONSTRAINT conversation_artifacts_anchor_message_id_key UNIQUE (anchor_message_id);
ALTER TABLE ONLY public.conversation_artifact_lineage
    ADD CONSTRAINT conversation_artifact_lineage_pkey PRIMARY KEY (artifact_id, position);
ALTER TABLE ONLY public.conversation_artifact_lineage
    ADD CONSTRAINT conversation_artifact_lineage_artifact_source_key UNIQUE (artifact_id, source_artifact_id);


--
-- Name: onboarding_chat_memory onboarding_chat_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.onboarding_chat_memory
    ADD CONSTRAINT onboarding_chat_memory_pkey PRIMARY KEY (id);


--
-- Name: onboarding_sessions onboarding_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.onboarding_sessions
    ADD CONSTRAINT onboarding_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: portal_recovery_initiations portal_recovery_initiations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.portal_recovery_initiations
    ADD CONSTRAINT portal_recovery_initiations_pkey PRIMARY KEY (id);


--
-- Name: portal_recovery_initiations portal_recovery_initiations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.portal_recovery_initiations
    ADD CONSTRAINT portal_recovery_initiations_token_hash_key UNIQUE (token_hash);


--
-- Name: portal_recovery_requests portal_recovery_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.portal_recovery_requests
    ADD CONSTRAINT portal_recovery_requests_pkey PRIMARY KEY (id);


--
-- Name: portal_recovery_requests portal_recovery_requests_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.portal_recovery_requests
    ADD CONSTRAINT portal_recovery_requests_token_hash_key UNIQUE (token_hash);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: programs programs_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.programs
    ADD CONSTRAINT programs_id_user_id_key UNIQUE (id, user_id);


--
-- Name: programs programs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.programs
    ADD CONSTRAINT programs_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_checkout_session_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_checkout_session_key UNIQUE (stripe_checkout_session_id);


--
-- Name: purchases purchases_payment_intent_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_payment_intent_key UNIQUE (stripe_payment_intent_id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: sales_funnel_events sales_funnel_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

--
-- Name: product_facts product_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_facts
    ADD CONSTRAINT product_facts_pkey PRIMARY KEY (id);

--
-- Name: product_facts product_facts_identity_version_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_facts
    ADD CONSTRAINT product_facts_identity_version_key UNIQUE (fact_key, offer_scope_key, scope_key, version);

--
-- Name: product_facts product_facts_no_active_validity_overlap; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_facts
    ADD CONSTRAINT product_facts_no_active_validity_overlap EXCLUDE USING gist (fact_key WITH =, offer_scope_key WITH =, scope_key WITH =, tstzrange(valid_from, coalesce(valid_to, 'infinity'::timestamp with time zone), '[)'::text) WITH &&) WHERE ((status = 'active'::text));

ALTER TABLE ONLY public.sales_funnel_events
    ADD CONSTRAINT sales_funnel_events_pkey PRIMARY KEY (id);


--
-- Name: shopping_items shopping_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shopping_items
    ADD CONSTRAINT shopping_items_pkey PRIMARY KEY (id);


--
-- Name: shopping_lists shopping_lists_meal_plan_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shopping_lists
    ADD CONSTRAINT shopping_lists_meal_plan_id_key UNIQUE (meal_plan_id);


--
-- Name: shopping_lists shopping_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shopping_lists
    ADD CONSTRAINT shopping_lists_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: unsubscribed_metrics unsubscribed_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.unsubscribed_metrics
    ADD CONSTRAINT unsubscribed_metrics_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey1; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey1 PRIMARY KEY (id);


--
-- Name: users users_portal_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_portal_token_key UNIQUE (portal_token);


--
-- Name: users users_whatsapp_id_key1; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_whatsapp_id_key1 UNIQUE (whatsapp_id);


--
-- Name: weeks weeks_id_program_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.weeks
    ADD CONSTRAINT weeks_id_program_id_key UNIQUE (id, program_id);


--
-- Name: weeks weeks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.weeks
    ADD CONSTRAINT weeks_pkey PRIMARY KEY (id);


--
-- Name: weeks weeks_program_id_week_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.weeks
    ADD CONSTRAINT weeks_program_id_week_number_key UNIQUE (program_id, week_number);


--
-- Name: messages messages_payload_exclusive; Type: CHECK CONSTRAINT; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER TABLE realtime.messages
    ADD CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL))) NOT VALID;


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER TABLE ONLY realtime.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: subscription pk_subscription; Type: CONSTRAINT; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER TABLE ONLY realtime.subscription
    ADD CONSTRAINT pk_subscription PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: webauthn_challenges_expires_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges USING btree (expires_at);


--
-- Name: webauthn_challenges_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges USING btree (user_id);


--
-- Name: webauthn_credentials_credential_id_key; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX webauthn_credentials_credential_id_key ON auth.webauthn_credentials USING btree (credential_id);


--
-- Name: webauthn_credentials_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials USING btree (user_id);


--
-- Name: idx_logs_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_logs_created_at ON public.logs USING btree (created_at DESC);


--
-- Name: idx_logs_event; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_logs_event ON public.logs USING btree (event);


--
-- Name: idx_logs_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_logs_user_id ON public.logs USING btree (user_id);


--
-- Name: idx_meal_plans_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_meal_plans_created_at ON public.meal_plans USING btree (created_at DESC);


--
-- Name: idx_meal_plans_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_meal_plans_user_id ON public.meal_plans USING btree (user_id);


--
-- Name: idx_messages_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_messages_user_id ON public.messages USING btree (user_id);


--
-- Name: idx_onboarding_chat_memory_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_onboarding_chat_memory_session ON public.onboarding_chat_memory USING btree (session_id);


--
-- Name: idx_shopping_items_list; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_shopping_items_list ON public.shopping_items USING btree (shopping_list_id);


--
-- Name: meal_plans_one_plan_per_week_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX meal_plans_one_plan_per_week_idx ON public.meal_plans USING btree (week_id) WHERE (week_id IS NOT NULL);


--
-- Name: messages_idempotency_key_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX messages_idempotency_key_uidx ON public.messages USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: messages_processing_lease_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_processing_lease_idx ON public.messages USING btree (processing_lease_until) WHERE ((processing_order IS NOT NULL) AND (processing_completed_at IS NULL));


--
-- Name: messages_processing_order_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX messages_processing_order_uidx ON public.messages USING btree (processing_order) WHERE (processing_order IS NOT NULL);


--
-- Name: messages_provider_sid_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX messages_provider_sid_uidx ON public.messages USING btree (provider, provider_message_sid) WHERE (provider_message_sid IS NOT NULL);


--
-- Name: messages_session_processing_queue_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_session_processing_queue_idx ON public.messages USING btree (session_id, processing_order) WHERE ((direction = 'inbound'::text) AND (processing_order IS NOT NULL) AND (processing_completed_at IS NULL));


--
-- Name: messages_session_timestamp_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_session_timestamp_idx ON public.messages USING btree (session_id, "timestamp", id);


--
-- Name: messages_user_timestamp_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_user_timestamp_idx ON public.messages USING btree (user_id, "timestamp", id);


--
-- Name: onboarding_sessions_checkout_session_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX onboarding_sessions_checkout_session_uidx ON public.onboarding_sessions USING btree (checkout_session_id) WHERE (checkout_session_id IS NOT NULL);


--
-- Name: onboarding_sessions_reminder_due_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX onboarding_sessions_reminder_due_idx ON public.onboarding_sessions USING btree (reminder_scheduled_for) WHERE (reminder_scheduled_for IS NOT NULL);


--
-- Name: portal_recovery_initiations_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX portal_recovery_initiations_active_idx ON public.portal_recovery_initiations USING btree (expires_at) WHERE (used_at IS NULL);


--
-- Name: portal_recovery_initiations_session_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX portal_recovery_initiations_session_active_idx ON public.portal_recovery_initiations USING btree (initiating_whatsapp_id, purpose, expires_at) WHERE (used_at IS NULL);


--
-- Name: portal_recovery_requests_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX portal_recovery_requests_active_idx ON public.portal_recovery_requests USING btree (expires_at) WHERE ((used_at IS NULL) AND (invalidated_at IS NULL));


--
-- Name: portal_recovery_requests_session_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX portal_recovery_requests_session_active_idx ON public.portal_recovery_requests USING btree (initiating_whatsapp_id, purpose, expires_at) WHERE ((used_at IS NULL) AND (invalidated_at IS NULL));


--
-- Name: portal_recovery_requests_user_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX portal_recovery_requests_user_created_idx ON public.portal_recovery_requests USING btree (user_id, created_at DESC);


--
-- Name: purchases_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX purchases_created_at_idx ON public.purchases USING btree (created_at DESC);


--
-- Name: purchases_payment_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX purchases_payment_status_idx ON public.purchases USING btree (payment_status);


--
-- Name: purchases_program_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX purchases_program_id_idx ON public.purchases USING btree (program_id);


--
-- Name: purchases_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX purchases_user_id_idx ON public.purchases USING btree (user_id);


--
-- Name: sales_funnel_events_event_key_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX sales_funnel_events_event_key_uidx ON public.sales_funnel_events USING btree (event_key) WHERE (event_key IS NOT NULL);


--
-- Name: sales_funnel_events_session_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sales_funnel_events_session_created_idx ON public.sales_funnel_events USING btree (session_id, created_at);


--
-- Name: sales_funnel_events_type_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sales_funnel_events_type_created_idx ON public.sales_funnel_events USING btree (event_type, created_at);


--
-- Name: sales_funnel_events_user_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sales_funnel_events_user_created_idx ON public.sales_funnel_events USING btree (user_id, created_at);


--
-- Name: subscriptions_stripe_sub_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX subscriptions_stripe_sub_idx ON public.subscriptions USING btree (stripe_subscription_id);


--
-- Name: subscriptions_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX subscriptions_user_id_idx ON public.subscriptions USING btree (user_id);


--
-- Name: users_email_recovery_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX users_email_recovery_idx ON public.users USING btree (lower(email)) WHERE (email IS NOT NULL);


--
-- Name: users_stripe_customer_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX users_stripe_customer_idx ON public.users USING btree (stripe_customer_id);


--
-- Name: users_whatsapp_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX users_whatsapp_idx ON public.users USING btree (whatsapp_id);


--
-- Name: weeks_one_active_per_program; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX weeks_one_active_per_program ON public.weeks USING btree (program_id) WHERE (status = 'active'::text);


--
-- Name: weeks_one_active_week_per_program_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX weeks_one_active_week_per_program_idx ON public.weeks USING btree (program_id) WHERE (status = 'active'::text);


--
-- Name: weeks_program_week_number_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX weeks_program_week_number_unique ON public.weeks USING btree (program_id, week_number);


--
-- Name: ix_realtime_subscription_entity; Type: INDEX; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription USING btree (entity);


--
-- Name: messages_inserted_at_topic_index; Type: INDEX; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE INDEX messages_inserted_at_topic_index ON ONLY realtime.messages USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: subscription_subscription_id_entity_filters_action_filter_selec; Type: INDEX; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_action_filter_selec ON realtime.subscription USING btree (subscription_id, entity, filters, action_filter, COALESCE(selected_columns, '{}'::text[]));


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");


--
-- Name: idx_objects_current_version; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX idx_objects_current_version ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE (archived_at IS NULL);


--
-- Name: idx_objects_null_version; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX idx_objects_null_version ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE (NOT is_versioned);


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: objects_bucket_id_name_version_key; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX objects_bucket_id_name_version_key ON storage.objects USING btree (bucket_id, name COLLATE "C", version) NULLS NOT DISTINCT;


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: profiles profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: programs programs_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER programs_set_updated_at BEFORE UPDATE ON public.programs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: purchases purchases_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER purchases_set_updated_at BEFORE UPDATE ON public.purchases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

--
-- Name: product_facts set_product_facts_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER set_product_facts_updated_at BEFORE UPDATE ON public.product_facts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: shopping_items shopping_items_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER shopping_items_set_updated_at BEFORE UPDATE ON public.shopping_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: shopping_lists shopping_lists_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER shopping_lists_set_updated_at BEFORE UPDATE ON public.shopping_lists FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users users_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: weeks weeks_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER weeks_set_updated_at BEFORE UPDATE ON public.weeks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscription tr_check_filters; Type: TRIGGER; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: meal_plans meal_plans_program_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meal_plans
    ADD CONSTRAINT meal_plans_program_id_user_id_fkey FOREIGN KEY (program_id, user_id) REFERENCES public.programs(id, user_id);


--
-- Name: meal_plans meal_plans_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meal_plans
    ADD CONSTRAINT meal_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: meal_plans meal_plans_week_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meal_plans
    ADD CONSTRAINT meal_plans_week_id_fkey FOREIGN KEY (week_id) REFERENCES public.weeks(id) ON DELETE CASCADE;


--
-- Name: meal_plans meal_plans_week_id_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meal_plans
    ADD CONSTRAINT meal_plans_week_id_program_id_fkey FOREIGN KEY (week_id, program_id) REFERENCES public.weeks(id, program_id);


--
-- Name: messages messages_in_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_in_reply_to_id_fkey FOREIGN KEY (in_reply_to_id) REFERENCES public.messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.conversation_artifacts
    ADD CONSTRAINT conversation_artifacts_anchor_message_id_fkey FOREIGN KEY (anchor_message_id) REFERENCES public.messages(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.conversation_artifact_lineage
    ADD CONSTRAINT conversation_artifact_lineage_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.conversation_artifacts(artifact_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.conversation_artifact_lineage
    ADD CONSTRAINT conversation_artifact_lineage_source_artifact_id_fkey FOREIGN KEY (source_artifact_id) REFERENCES public.conversation_artifacts(artifact_id) ON DELETE CASCADE;


--
-- Name: messages messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: portal_recovery_initiations portal_recovery_initiations_pending_message_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.portal_recovery_initiations
    ADD CONSTRAINT portal_recovery_initiations_pending_message_fkey FOREIGN KEY (pending_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: portal_recovery_requests portal_recovery_requests_pending_message_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.portal_recovery_requests
    ADD CONSTRAINT portal_recovery_requests_pending_message_fkey FOREIGN KEY (pending_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: portal_recovery_requests portal_recovery_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.portal_recovery_requests
    ADD CONSTRAINT portal_recovery_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: programs programs_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.programs
    ADD CONSTRAINT programs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: programs programs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.programs
    ADD CONSTRAINT programs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: purchases purchases_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id) ON DELETE SET NULL;


--
-- Name: purchases purchases_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: sales_funnel_events sales_funnel_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_funnel_events
    ADD CONSTRAINT sales_funnel_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: shopping_items shopping_items_shopping_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shopping_items
    ADD CONSTRAINT shopping_items_shopping_list_id_fkey FOREIGN KEY (shopping_list_id) REFERENCES public.shopping_lists(id) ON DELETE CASCADE;


--
-- Name: shopping_lists shopping_lists_meal_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shopping_lists
    ADD CONSTRAINT shopping_lists_meal_plan_id_fkey FOREIGN KEY (meal_plan_id) REFERENCES public.meal_plans(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: weeks weeks_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.weeks
    ADD CONSTRAINT weeks_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.programs(id) ON DELETE CASCADE;


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.authorized_action_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authorized_action_executions FORCE ROW LEVEL SECURITY;

--
-- Name: meal_plans; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.meal_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.conversation_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_artifact_lineage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_artifact_lineage FORCE ROW LEVEL SECURITY;

--
-- Name: onboarding_chat_memory; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.onboarding_chat_memory ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: portal_recovery_initiations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.portal_recovery_initiations ENABLE ROW LEVEL SECURITY;

--
-- Name: portal_recovery_requests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.portal_recovery_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: programs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;

--
-- Name: purchases; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: product_facts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.product_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_funnel_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.sales_funnel_events ENABLE ROW LEVEL SECURITY;

--
-- Name: shopping_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.shopping_items ENABLE ROW LEVEL SECURITY;

--
-- Name: shopping_lists; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: unsubscribed_metrics; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.unsubscribed_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: weeks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.weeks ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: objects Public read access; Type: POLICY; Schema: storage; Owner: supabase_storage_admin
--

CREATE POLICY "Public read access" ON storage.objects FOR SELECT USING ((bucket_id = 'dietavity-pdfs'::text));


--
-- Name: objects Service role full access; Type: POLICY; Schema: storage; Owner: supabase_storage_admin
--

CREATE POLICY "Service role full access" ON storage.objects USING ((auth.role() = 'service_role'::text));


--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: postgres
--

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


ALTER PUBLICATION supabase_realtime OWNER TO postgres;

--
-- Name: SCHEMA auth; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA auth TO anon;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
GRANT ALL ON SCHEMA auth TO dashboard_user;
GRANT USAGE ON SCHEMA auth TO postgres;


--
-- Name: SCHEMA extensions; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA extensions TO anon;
GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT USAGE ON SCHEMA extensions TO service_role;
GRANT ALL ON SCHEMA extensions TO dashboard_user;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: SCHEMA realtime; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA realtime TO postgres WITH GRANT OPTION;
GRANT USAGE ON SCHEMA realtime TO anon;
GRANT USAGE ON SCHEMA realtime TO authenticated;
GRANT USAGE ON SCHEMA realtime TO service_role;
GRANT ALL ON SCHEMA realtime TO supabase_realtime_admin;


--
-- Name: SCHEMA storage; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA storage TO postgres WITH GRANT OPTION;
GRANT USAGE ON SCHEMA storage TO anon;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT USAGE ON SCHEMA storage TO service_role;
GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
GRANT ALL ON SCHEMA storage TO dashboard_user;


--
-- Name: SCHEMA vault; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA vault TO postgres WITH GRANT OPTION;
GRANT USAGE ON SCHEMA vault TO service_role;


--
-- Name: FUNCTION email(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.email() TO dashboard_user;
GRANT ALL ON FUNCTION auth.email() TO postgres;


--
-- Name: FUNCTION jwt(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.jwt() TO postgres;
GRANT ALL ON FUNCTION auth.jwt() TO dashboard_user;


--
-- Name: FUNCTION role(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.role() TO dashboard_user;
GRANT ALL ON FUNCTION auth.role() TO postgres;


--
-- Name: FUNCTION uid(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.uid() TO dashboard_user;
GRANT ALL ON FUNCTION auth.uid() TO postgres;


--
-- Name: FUNCTION armor(bytea); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.armor(bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.armor(bytea) TO dashboard_user;


--
-- Name: FUNCTION armor(bytea, text[], text[]); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.armor(bytea, text[], text[]) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.armor(bytea, text[], text[]) TO dashboard_user;


--
-- Name: FUNCTION crypt(text, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.crypt(text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.crypt(text, text) TO dashboard_user;


--
-- Name: FUNCTION dearmor(text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.dearmor(text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.dearmor(text) TO dashboard_user;


--
-- Name: FUNCTION decrypt(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.decrypt(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.decrypt(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION decrypt_iv(bytea, bytea, bytea, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.decrypt_iv(bytea, bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.decrypt_iv(bytea, bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION digest(bytea, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.digest(bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.digest(bytea, text) TO dashboard_user;


--
-- Name: FUNCTION digest(text, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.digest(text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.digest(text, text) TO dashboard_user;


--
-- Name: FUNCTION encrypt(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.encrypt(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.encrypt(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION encrypt_iv(bytea, bytea, bytea, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.encrypt_iv(bytea, bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.encrypt_iv(bytea, bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION gen_random_bytes(integer); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.gen_random_bytes(integer) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.gen_random_bytes(integer) TO dashboard_user;


--
-- Name: FUNCTION gen_random_uuid(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.gen_random_uuid() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.gen_random_uuid() TO dashboard_user;


--
-- Name: FUNCTION gen_salt(text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.gen_salt(text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.gen_salt(text) TO dashboard_user;


--
-- Name: FUNCTION gen_salt(text, integer); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.gen_salt(text, integer) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.gen_salt(text, integer) TO dashboard_user;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION extensions.grant_pg_cron_access() FROM supabase_admin;
GRANT ALL ON FUNCTION extensions.grant_pg_cron_access() TO supabase_admin WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.grant_pg_cron_access() TO dashboard_user;
GRANT ALL ON FUNCTION extensions.grant_pg_cron_access() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.grant_pg_graphql_access() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION grant_pg_net_access(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION extensions.grant_pg_net_access() FROM supabase_admin;
GRANT ALL ON FUNCTION extensions.grant_pg_net_access() TO supabase_admin WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.grant_pg_net_access() TO dashboard_user;
GRANT ALL ON FUNCTION extensions.grant_pg_net_access() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION hmac(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.hmac(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.hmac(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION hmac(text, text, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.hmac(text, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.hmac(text, text, text) TO dashboard_user;


--
-- Name: FUNCTION pg_stat_statements(showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT shared_blk_read_time double precision, OUT shared_blk_write_time double precision, OUT local_blk_read_time double precision, OUT local_blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision, OUT jit_deform_count bigint, OUT jit_deform_time double precision, OUT stats_since timestamp with time zone, OUT minmax_stats_since timestamp with time zone); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pg_stat_statements(showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT shared_blk_read_time double precision, OUT shared_blk_write_time double precision, OUT local_blk_read_time double precision, OUT local_blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision, OUT jit_deform_count bigint, OUT jit_deform_time double precision, OUT stats_since timestamp with time zone, OUT minmax_stats_since timestamp with time zone) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pg_stat_statements(showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT shared_blk_read_time double precision, OUT shared_blk_write_time double precision, OUT local_blk_read_time double precision, OUT local_blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision, OUT jit_deform_count bigint, OUT jit_deform_time double precision, OUT stats_since timestamp with time zone, OUT minmax_stats_since timestamp with time zone) TO dashboard_user;


--
-- Name: FUNCTION pg_stat_statements_info(OUT dealloc bigint, OUT stats_reset timestamp with time zone); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pg_stat_statements_info(OUT dealloc bigint, OUT stats_reset timestamp with time zone) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pg_stat_statements_info(OUT dealloc bigint, OUT stats_reset timestamp with time zone) TO dashboard_user;


--
-- Name: FUNCTION pg_stat_statements_reset(userid oid, dbid oid, queryid bigint, minmax_only boolean); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pg_stat_statements_reset(userid oid, dbid oid, queryid bigint, minmax_only boolean) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pg_stat_statements_reset(userid oid, dbid oid, queryid bigint, minmax_only boolean) TO dashboard_user;


--
-- Name: FUNCTION pgp_armor_headers(text, OUT key text, OUT value text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_armor_headers(text, OUT key text, OUT value text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_armor_headers(text, OUT key text, OUT value text) TO dashboard_user;


--
-- Name: FUNCTION pgp_key_id(bytea); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_key_id(bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_key_id(bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea, text, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea, text, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_encrypt(text, bytea); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_encrypt(text, bytea, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_encrypt_bytea(bytea, bytea); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_encrypt_bytea(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_decrypt(bytea, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_decrypt(bytea, text, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_decrypt_bytea(bytea, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_decrypt_bytea(bytea, text, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_encrypt(text, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_encrypt(text, text, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_encrypt_bytea(bytea, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_encrypt_bytea(bytea, text, text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgrst_ddl_watch(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgrst_ddl_watch() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION pgrst_drop_watch(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgrst_drop_watch() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.set_graphql_placeholder() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION uuid_generate_v1(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.uuid_generate_v1() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v1() TO dashboard_user;


--
-- Name: FUNCTION uuid_generate_v1mc(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.uuid_generate_v1mc() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v1mc() TO dashboard_user;


--
-- Name: FUNCTION uuid_generate_v3(namespace uuid, name text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.uuid_generate_v3(namespace uuid, name text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v3(namespace uuid, name text) TO dashboard_user;


--
-- Name: FUNCTION uuid_generate_v4(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.uuid_generate_v4() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v4() TO dashboard_user;


--
-- Name: FUNCTION uuid_generate_v5(namespace uuid, name text); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.uuid_generate_v5(namespace uuid, name text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v5(namespace uuid, name text) TO dashboard_user;


--
-- Name: FUNCTION uuid_nil(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.uuid_nil() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_nil() TO dashboard_user;


--
-- Name: FUNCTION uuid_ns_dns(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.uuid_ns_dns() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_ns_dns() TO dashboard_user;


--
-- Name: FUNCTION uuid_ns_oid(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.uuid_ns_oid() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_ns_oid() TO dashboard_user;


--
-- Name: FUNCTION uuid_ns_url(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.uuid_ns_url() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_ns_url() TO dashboard_user;


--
-- Name: FUNCTION uuid_ns_x500(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.uuid_ns_x500() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_ns_x500() TO dashboard_user;


--
-- Name: FUNCTION graphql("operationName" text, query text, variables jsonb, extensions jsonb); Type: ACL; Schema: graphql_public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO postgres;
GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO anon;
GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO authenticated;
GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO service_role;


--
-- Name: FUNCTION get_auth(p_usename text); Type: ACL; Schema: pgbouncer; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION pgbouncer.get_auth(p_usename text) FROM PUBLIC;
GRANT ALL ON FUNCTION pgbouncer.get_auth(p_usename text) TO pgbouncer;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.messages TO service_role;
REVOKE ALL ON TABLE public.authorized_action_executions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_authorized_action_execution(jsonb), public.complete_authorized_action_execution(jsonb), public.fail_authorized_action_execution(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_authorized_action_execution(jsonb), public.complete_authorized_action_execution(jsonb), public.fail_authorized_action_execution(jsonb) TO service_role;
REVOKE ALL ON TABLE public.conversation_artifacts, public.conversation_artifact_lineage FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.persist_conversation_artifact(jsonb), public.delete_message_with_conversation_artifacts_for_privacy(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.persist_conversation_artifact(jsonb) TO service_role;


--
-- Name: FUNCTION claim_whatsapp_reply_recovery_part(p jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_whatsapp_reply_recovery_part(p jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_whatsapp_reply_recovery_part(p jsonb) TO service_role;


--
-- Name: FUNCTION create_portal_recovery_request(input_email text, input_token_hash text, input_expires_at timestamp with time zone, input_initiation_token_hash text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_portal_recovery_request(input_email text, input_token_hash text, input_expires_at timestamp with time zone, input_initiation_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_portal_recovery_request(input_email text, input_token_hash text, input_expires_at timestamp with time zone, input_initiation_token_hash text) TO service_role;


--
-- Name: FUNCTION persist_setup_completed_event(target_session_id text, target_user_id uuid, target_event_key text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.persist_setup_completed_event(target_session_id text, target_user_id uuid, target_event_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.persist_setup_completed_event(target_session_id text, target_user_id uuid, target_event_key text) TO service_role;


--
-- Name: FUNCTION prepare_whatsapp_reply_recovery(p jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.prepare_whatsapp_reply_recovery(p jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.prepare_whatsapp_reply_recovery(p jsonb) TO service_role;


--
-- Name: FUNCTION redeem_portal_recovery(input_token_hash text, input_new_portal_token text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.redeem_portal_recovery(input_token_hash text, input_new_portal_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.redeem_portal_recovery(input_token_hash text, input_new_portal_token text) TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION start_program_week_one(target_program_id uuid, target_user_id uuid, selected_start_date date, portal_today date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.start_program_week_one(target_program_id uuid, target_user_id uuid, selected_start_date date, portal_today date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_program_week_one(target_program_id uuid, target_user_id uuid, selected_start_date date, portal_today date) TO service_role;


--
-- Name: FUNCTION apply_rls(wal jsonb, max_record_bytes integer); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO postgres;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO anon;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO authenticated;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO service_role;


--
-- Name: FUNCTION broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text) TO postgres;
GRANT ALL ON FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text) TO dashboard_user;


--
-- Name: FUNCTION build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO postgres;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO anon;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO authenticated;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO service_role;


--
-- Name: FUNCTION "cast"(val text, type_ regtype); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO postgres;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO dashboard_user;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO anon;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO authenticated;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO service_role;


--
-- Name: FUNCTION check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO postgres;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO anon;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO authenticated;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO service_role;


--
-- Name: FUNCTION check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text, negate boolean); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text, negate boolean) TO postgres;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text, negate boolean) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text, negate boolean) TO anon;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text, negate boolean) TO authenticated;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text, negate boolean) TO service_role;


--
-- Name: FUNCTION is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO postgres;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO anon;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO authenticated;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO service_role;


--
-- Name: FUNCTION list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO postgres;
GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO dashboard_user;


--
-- Name: FUNCTION quote_wal2json(entity regclass); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO postgres;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO anon;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO authenticated;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO service_role;


--
-- Name: FUNCTION send(payload jsonb, event text, topic text, private boolean); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) TO postgres;
GRANT ALL ON FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) TO dashboard_user;


--
-- Name: FUNCTION send_binary(payload bytea, event text, topic text, private boolean); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.send_binary(payload bytea, event text, topic text, private boolean) TO postgres;
GRANT ALL ON FUNCTION realtime.send_binary(payload bytea, event text, topic text, private boolean) TO dashboard_user;


--
-- Name: FUNCTION subscription_check_filters(); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO postgres;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO dashboard_user;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO anon;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO authenticated;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO service_role;


--
-- Name: FUNCTION to_regrole(role_name text); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO postgres;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO anon;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO authenticated;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO service_role;


--
-- Name: FUNCTION topic(); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.topic() TO postgres;
GRANT ALL ON FUNCTION realtime.topic() TO dashboard_user;


--
-- Name: FUNCTION wal2json_escape_identifier(name text); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.wal2json_escape_identifier(name text) TO postgres;
GRANT ALL ON FUNCTION realtime.wal2json_escape_identifier(name text) TO dashboard_user;


--
-- Name: FUNCTION can_insert_object(bucketid text, name text, owner uuid, metadata jsonb); Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) TO postgres;


--
-- Name: FUNCTION extension(name text); Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON FUNCTION storage.extension(name text) TO postgres;


--
-- Name: FUNCTION filename(name text); Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON FUNCTION storage.filename(name text) TO postgres;


--
-- Name: FUNCTION foldername(name text); Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON FUNCTION storage.foldername(name text) TO postgres;


--
-- Name: FUNCTION list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer, next_key_token text, next_upload_token text); Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer, next_key_token text, next_upload_token text) TO postgres;


--
-- Name: FUNCTION operation(); Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON FUNCTION storage.operation() TO postgres;


--
-- Name: FUNCTION search(prefix text, bucketname text, limits integer, levels integer, offsets integer, search text, sortcolumn text, sortorder text); Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON FUNCTION storage.search(prefix text, bucketname text, limits integer, levels integer, offsets integer, search text, sortcolumn text, sortorder text) TO postgres;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON FUNCTION storage.update_updated_at_column() TO postgres;


--
-- Name: FUNCTION _crypto_aead_det_decrypt(message bytea, additional bytea, key_id bigint, context bytea, nonce bytea); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION vault._crypto_aead_det_decrypt(message bytea, additional bytea, key_id bigint, context bytea, nonce bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION vault._crypto_aead_det_decrypt(message bytea, additional bytea, key_id bigint, context bytea, nonce bytea) TO service_role;


--
-- Name: FUNCTION create_secret(new_secret text, new_name text, new_description text, new_key_id uuid); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION vault.create_secret(new_secret text, new_name text, new_description text, new_key_id uuid) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION vault.create_secret(new_secret text, new_name text, new_description text, new_key_id uuid) TO service_role;


--
-- Name: FUNCTION update_secret(secret_id uuid, new_secret text, new_name text, new_description text, new_key_id uuid); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION vault.update_secret(secret_id uuid, new_secret text, new_name text, new_description text, new_key_id uuid) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION vault.update_secret(secret_id uuid, new_secret text, new_name text, new_description text, new_key_id uuid) TO service_role;


--
-- Name: TABLE audit_log_entries; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.audit_log_entries TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.audit_log_entries TO postgres;
GRANT SELECT ON TABLE auth.audit_log_entries TO postgres WITH GRANT OPTION;


--
-- Name: TABLE custom_oauth_providers; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.custom_oauth_providers TO postgres;
GRANT ALL ON TABLE auth.custom_oauth_providers TO dashboard_user;


--
-- Name: TABLE flow_state; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.flow_state TO postgres;
GRANT SELECT ON TABLE auth.flow_state TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.flow_state TO dashboard_user;


--
-- Name: TABLE identities; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.identities TO postgres;
GRANT SELECT ON TABLE auth.identities TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.identities TO dashboard_user;


--
-- Name: TABLE instances; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.instances TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.instances TO postgres;
GRANT SELECT ON TABLE auth.instances TO postgres WITH GRANT OPTION;


--
-- Name: TABLE mfa_amr_claims; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_amr_claims TO postgres;
GRANT SELECT ON TABLE auth.mfa_amr_claims TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_amr_claims TO dashboard_user;


--
-- Name: TABLE mfa_challenges; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_challenges TO postgres;
GRANT SELECT ON TABLE auth.mfa_challenges TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_challenges TO dashboard_user;


--
-- Name: TABLE mfa_factors; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_factors TO postgres;
GRANT SELECT ON TABLE auth.mfa_factors TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_factors TO dashboard_user;


--
-- Name: TABLE oauth_authorizations; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_authorizations TO postgres;
GRANT ALL ON TABLE auth.oauth_authorizations TO dashboard_user;


--
-- Name: TABLE oauth_client_states; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_client_states TO postgres;
GRANT ALL ON TABLE auth.oauth_client_states TO dashboard_user;


--
-- Name: TABLE oauth_clients; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_clients TO postgres;
GRANT ALL ON TABLE auth.oauth_clients TO dashboard_user;


--
-- Name: TABLE oauth_consents; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_consents TO postgres;
GRANT ALL ON TABLE auth.oauth_consents TO dashboard_user;


--
-- Name: TABLE one_time_tokens; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.one_time_tokens TO postgres;
GRANT SELECT ON TABLE auth.one_time_tokens TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.one_time_tokens TO dashboard_user;


--
-- Name: TABLE refresh_tokens; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.refresh_tokens TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.refresh_tokens TO postgres;
GRANT SELECT ON TABLE auth.refresh_tokens TO postgres WITH GRANT OPTION;


--
-- Name: SEQUENCE refresh_tokens_id_seq; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON SEQUENCE auth.refresh_tokens_id_seq TO dashboard_user;
GRANT ALL ON SEQUENCE auth.refresh_tokens_id_seq TO postgres;


--
-- Name: TABLE saml_providers; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.saml_providers TO postgres;
GRANT SELECT ON TABLE auth.saml_providers TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.saml_providers TO dashboard_user;


--
-- Name: TABLE saml_relay_states; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.saml_relay_states TO postgres;
GRANT SELECT ON TABLE auth.saml_relay_states TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.saml_relay_states TO dashboard_user;


--
-- Name: TABLE sessions; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sessions TO postgres;
GRANT SELECT ON TABLE auth.sessions TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sessions TO dashboard_user;


--
-- Name: TABLE sso_domains; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sso_domains TO postgres;
GRANT SELECT ON TABLE auth.sso_domains TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sso_domains TO dashboard_user;


--
-- Name: TABLE sso_providers; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sso_providers TO postgres;
GRANT SELECT ON TABLE auth.sso_providers TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sso_providers TO dashboard_user;


--
-- Name: TABLE users; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.users TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.users TO postgres;
GRANT SELECT ON TABLE auth.users TO postgres WITH GRANT OPTION;


--
-- Name: TABLE webauthn_challenges; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.webauthn_challenges TO postgres;
GRANT ALL ON TABLE auth.webauthn_challenges TO dashboard_user;


--
-- Name: TABLE webauthn_credentials; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.webauthn_credentials TO postgres;
GRANT ALL ON TABLE auth.webauthn_credentials TO dashboard_user;


--
-- Name: TABLE pg_stat_statements; Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON TABLE extensions.pg_stat_statements TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE extensions.pg_stat_statements TO dashboard_user;


--
-- Name: TABLE pg_stat_statements_info; Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON TABLE extensions.pg_stat_statements_info TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE extensions.pg_stat_statements_info TO dashboard_user;


--
-- Name: TABLE logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.logs TO service_role;


--
-- Name: TABLE meal_plans; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.meal_plans TO service_role;


--
-- Name: SEQUENCE messages_inbound_processing_order_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.messages_inbound_processing_order_seq TO service_role;


--
-- Name: TABLE onboarding_chat_memory; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.onboarding_chat_memory TO service_role;


--
-- Name: TABLE onboarding_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.onboarding_sessions TO service_role;


--
-- Name: TABLE portal_recovery_initiations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.portal_recovery_initiations TO service_role;


--
-- Name: TABLE portal_recovery_requests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.portal_recovery_requests TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE programs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.programs TO service_role;


--
-- Name: TABLE purchases; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.purchases TO service_role;


--
-- Name: TABLE product_facts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.product_facts TO service_role;


--
-- Name: TABLE sales_funnel_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.sales_funnel_events TO service_role;


--
-- Name: TABLE shopping_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.shopping_items TO service_role;


--
-- Name: TABLE shopping_lists; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.shopping_lists TO service_role;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.subscriptions TO service_role;


--
-- Name: TABLE unsubscribed_metrics; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.unsubscribed_metrics TO service_role;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.users TO service_role;


--
-- Name: TABLE weeks; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.weeks TO service_role;


--
-- Name: TABLE messages; Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON TABLE realtime.messages TO postgres;
GRANT ALL ON TABLE realtime.messages TO dashboard_user;
GRANT SELECT,INSERT,UPDATE ON TABLE realtime.messages TO anon;
GRANT SELECT,INSERT,UPDATE ON TABLE realtime.messages TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE realtime.messages TO service_role;


--
-- Name: TABLE subscription; Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON TABLE realtime.subscription TO postgres;
GRANT ALL ON TABLE realtime.subscription TO dashboard_user;
GRANT SELECT ON TABLE realtime.subscription TO anon;
GRANT SELECT ON TABLE realtime.subscription TO authenticated;
GRANT SELECT ON TABLE realtime.subscription TO service_role;


--
-- Name: SEQUENCE subscription_id_seq; Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON SEQUENCE realtime.subscription_id_seq TO postgres;
GRANT ALL ON SEQUENCE realtime.subscription_id_seq TO dashboard_user;
GRANT USAGE ON SEQUENCE realtime.subscription_id_seq TO anon;
GRANT USAGE ON SEQUENCE realtime.subscription_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE realtime.subscription_id_seq TO service_role;


--
-- Name: TABLE buckets; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

REVOKE ALL ON TABLE storage.buckets FROM supabase_storage_admin;
GRANT ALL ON TABLE storage.buckets TO supabase_storage_admin WITH GRANT OPTION;
GRANT ALL ON TABLE storage.buckets TO anon;
GRANT ALL ON TABLE storage.buckets TO authenticated;
GRANT ALL ON TABLE storage.buckets TO service_role;
GRANT ALL ON TABLE storage.buckets TO postgres WITH GRANT OPTION;


--
-- Name: TABLE buckets_analytics; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.buckets_analytics TO service_role;
GRANT ALL ON TABLE storage.buckets_analytics TO authenticated;
GRANT ALL ON TABLE storage.buckets_analytics TO anon;


--
-- Name: TABLE buckets_vectors; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT SELECT ON TABLE storage.buckets_vectors TO service_role;
GRANT SELECT ON TABLE storage.buckets_vectors TO authenticated;
GRANT SELECT ON TABLE storage.buckets_vectors TO anon;


--
-- Name: TABLE objects; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

REVOKE ALL ON TABLE storage.objects FROM supabase_storage_admin;
GRANT ALL ON TABLE storage.objects TO supabase_storage_admin WITH GRANT OPTION;
GRANT ALL ON TABLE storage.objects TO anon;
GRANT ALL ON TABLE storage.objects TO authenticated;
GRANT ALL ON TABLE storage.objects TO service_role;
GRANT ALL ON TABLE storage.objects TO postgres WITH GRANT OPTION;


--
-- Name: TABLE s3_multipart_uploads; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.s3_multipart_uploads TO service_role;
GRANT SELECT ON TABLE storage.s3_multipart_uploads TO authenticated;
GRANT SELECT ON TABLE storage.s3_multipart_uploads TO anon;
GRANT ALL ON TABLE storage.s3_multipart_uploads TO postgres;


--
-- Name: TABLE s3_multipart_uploads_parts; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.s3_multipart_uploads_parts TO service_role;
GRANT SELECT ON TABLE storage.s3_multipart_uploads_parts TO authenticated;
GRANT SELECT ON TABLE storage.s3_multipart_uploads_parts TO anon;
GRANT ALL ON TABLE storage.s3_multipart_uploads_parts TO postgres;


--
-- Name: TABLE vector_indexes; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT SELECT ON TABLE storage.vector_indexes TO service_role;
GRANT SELECT ON TABLE storage.vector_indexes TO authenticated;
GRANT SELECT ON TABLE storage.vector_indexes TO anon;


--
-- Name: TABLE secrets; Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT SELECT,REFERENCES,DELETE,TRUNCATE ON TABLE vault.secrets TO postgres WITH GRANT OPTION;
GRANT SELECT,DELETE ON TABLE vault.secrets TO service_role;


--
-- Name: TABLE decrypted_secrets; Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT SELECT,REFERENCES,DELETE,TRUNCATE ON TABLE vault.decrypted_secrets TO postgres WITH GRANT OPTION;
GRANT SELECT,DELETE ON TABLE vault.decrypted_secrets TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON SEQUENCES TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON FUNCTIONS TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON TABLES TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: graphql; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: graphql; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: graphql; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: graphql_public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: graphql_public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: graphql_public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: realtime; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON SEQUENCES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: realtime; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON FUNCTIONS TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: realtime; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON TABLES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO service_role;


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


ALTER EVENT TRIGGER issue_graphql_placeholder OWNER TO supabase_admin;

--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


ALTER EVENT TRIGGER issue_pg_cron_access OWNER TO supabase_admin;

--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE FUNCTION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


ALTER EVENT TRIGGER issue_pg_graphql_access OWNER TO supabase_admin;

--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


ALTER EVENT TRIGGER issue_pg_net_access OWNER TO supabase_admin;

--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


ALTER EVENT TRIGGER pgrst_ddl_watch OWNER TO supabase_admin;

--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();


ALTER EVENT TRIGGER pgrst_drop_watch OWNER TO supabase_admin;

--
-- Ticket 71 local schema addition (not evidence of production installation).
CREATE FUNCTION public.product_fact_authority_value_is_valid(target_value_type text, target_value jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE target_value_type
    WHEN 'boolean' THEN jsonb_typeof(target_value) = 'boolean'
    WHEN 'integer' THEN jsonb_typeof(target_value) = 'number' AND trunc((target_value #>> '{}')::numeric) = (target_value #>> '{}')::numeric
    WHEN 'money' THEN jsonb_typeof(target_value) = 'object' AND jsonb_typeof(target_value -> 'amount') = 'number' AND (target_value ->> 'amount')::numeric >= 0 AND jsonb_typeof(target_value -> 'currency') = 'string' AND length(target_value ->> 'currency') = 3 AND target_value ->> 'currency' = upper(target_value ->> 'currency')
    WHEN 'enum' THEN jsonb_typeof(target_value) = 'string' AND target_value #>> '{}' <> ''
    WHEN 'enum_set' THEN jsonb_typeof(target_value) = 'array' AND jsonb_array_length(target_value) > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(target_value) AS item WHERE jsonb_typeof(item) <> 'string' OR item #>> '{}' = '') AND (SELECT count(*) = count(DISTINCT item #>> '{}') FROM jsonb_array_elements(target_value) AS item)
    WHEN 'object' THEN jsonb_typeof(target_value) = 'object'
    WHEN 'text' THEN jsonb_typeof(target_value) = 'string'
    ELSE false END;
$$;
CREATE TABLE public.product_fact_authority_sets (
    authority_set_id text NOT NULL,
    authority_version text NOT NULL,
    scope jsonb NOT NULL,
    scope_key text GENERATED ALWAYS AS ((scope)::text) STORED,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_fact_authority_sets_pkey PRIMARY KEY (authority_set_id),
    CONSTRAINT product_fact_authority_sets_scope_typed CHECK (((scope = '{"scope_type":"provider"}'::jsonb) OR ((jsonb_typeof(scope) = 'object'::text) AND (scope ?& ARRAY['scope_type'::text, 'offer_version'::text]) AND ((scope ->> 'scope_type'::text) = 'offer_version'::text) AND (jsonb_typeof((scope -> 'offer_version'::text)) = 'string'::text) AND (((scope - 'scope_type'::text) - 'offer_version'::text) = '{}'::jsonb)))),
    CONSTRAINT product_fact_authority_sets_status CHECK ((status = ANY (ARRAY['draft'::text, 'reviewed_active'::text, 'retired'::text))),
    CONSTRAINT product_fact_authority_sets_version CHECK ((authority_version <> ''::text))
);
ALTER TABLE ONLY public.product_fact_authority_sets FORCE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX product_fact_authority_one_active_scope ON public.product_fact_authority_sets USING btree (scope_key) WHERE (status = 'reviewed_active'::text);
CREATE TABLE public.product_fact_authority_records (
    fact_id text NOT NULL,
    authority_set_id text NOT NULL,
    fact_key text NOT NULL,
    state text NOT NULL,
    value_type text NOT NULL,
    value jsonb,
    CONSTRAINT product_fact_authority_records_pkey PRIMARY KEY (fact_id),
    CONSTRAINT product_fact_authority_record_unique_key UNIQUE (authority_set_id, fact_key),
    CONSTRAINT product_fact_authority_record_key CHECK ((fact_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'::text)),
    CONSTRAINT product_fact_authority_record_state CHECK ((state = ANY (ARRAY['known_true'::text, 'known_false'::text, 'unknown'::text, 'not_applicable'::text))),
    CONSTRAINT product_fact_authority_record_value_type CHECK ((value_type = ANY (ARRAY['boolean'::text, 'integer'::text, 'money'::text, 'enum'::text, 'enum_set'::text, 'object'::text, 'text'::text))),
    CONSTRAINT product_fact_authority_record_unknown_value CHECK ((state <> ALL (ARRAY['unknown'::text, 'not_applicable'::text])) OR (value IS NULL)),
    CONSTRAINT product_fact_authority_record_known_value CHECK ((state <> ALL (ARRAY['known_true'::text, 'known_false'::text])) OR ((value IS NOT NULL) AND public.product_fact_authority_value_is_valid(value_type, value))),
    CONSTRAINT product_fact_authority_records_authority_set_id_fkey FOREIGN KEY (authority_set_id) REFERENCES public.product_fact_authority_sets(authority_set_id) ON DELETE RESTRICT
);
ALTER TABLE ONLY public.product_fact_authority_records FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_fact_authority_sets, public.product_fact_authority_records FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.product_fact_authority_sets, public.product_fact_authority_records TO service_role;

-- Ticket 72 local reviewed-nutrition authority (not production verification).
CREATE TABLE public.reviewed_nutrition_knowledge_sets (
    knowledge_set_id text NOT NULL,
    knowledge_version text NOT NULL,
    locale text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reviewed_nutrition_knowledge_sets_pkey PRIMARY KEY (knowledge_set_id),
    CONSTRAINT reviewed_nutrition_knowledge_sets_version CHECK ((knowledge_version <> ''::text)),
    CONSTRAINT reviewed_nutrition_knowledge_sets_locale CHECK ((locale ~ '^[a-z]{2}-[A-Z]{2}$'::text)),
    CONSTRAINT reviewed_nutrition_knowledge_sets_status CHECK ((status = ANY (ARRAY['draft'::text, 'reviewed_active'::text, 'retired'::text)))
);
ALTER TABLE ONLY public.reviewed_nutrition_knowledge_sets FORCE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX reviewed_nutrition_knowledge_one_active_locale ON public.reviewed_nutrition_knowledge_sets USING btree (locale) WHERE (status = 'reviewed_active'::text);
CREATE TABLE public.reviewed_nutrition_knowledge_records (
    knowledge_id text NOT NULL,
    knowledge_set_id text NOT NULL,
    knowledge_domain text NOT NULL,
    topic text NOT NULL,
    task_kinds jsonb NOT NULL,
    applicable_input_types jsonb NOT NULL,
    content text NOT NULL,
    provenance jsonb NOT NULL,
    CONSTRAINT reviewed_nutrition_knowledge_records_pkey PRIMARY KEY (knowledge_id, knowledge_set_id),
    CONSTRAINT reviewed_nutrition_knowledge_id CHECK ((knowledge_id ~ '^[a-z][a-z0-9-]*$'::text)),
    CONSTRAINT reviewed_nutrition_knowledge_domain CHECK ((knowledge_domain = 'nutrition_practical'::text)),
    CONSTRAINT reviewed_nutrition_knowledge_topic CHECK ((topic = ANY (ARRAY['food_storage'::text, 'meal_preparation'::text))),
    CONSTRAINT reviewed_nutrition_knowledge_content CHECK ((content <> ''::text)),
    CONSTRAINT reviewed_nutrition_knowledge_records_set_fkey FOREIGN KEY (knowledge_set_id) REFERENCES public.reviewed_nutrition_knowledge_sets(knowledge_set_id) ON DELETE RESTRICT
);
ALTER TABLE ONLY public.reviewed_nutrition_knowledge_records FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reviewed_nutrition_knowledge_sets, public.reviewed_nutrition_knowledge_records FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.reviewed_nutrition_knowledge_sets, public.reviewed_nutrition_knowledge_records TO service_role;

-- Conversation Engine V4 durable-memory foundation. This local snapshot is
-- synchronized with 20261024_v4_authority_and_durable_memory.sql.
CREATE TABLE public.conversation_durable_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id text NOT NULL,
    user_id uuid,
    kind text NOT NULL,
    value text NOT NULL,
    normalized_value text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    source_inbound_message_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversation_durable_memory_pkey PRIMARY KEY (id),
    CONSTRAINT conversation_durable_memory_kind_check CHECK ((kind = ANY (ARRAY['allergy'::text, 'dietary_restriction'::text, 'preference'::text]))),
    CONSTRAINT conversation_durable_memory_status_check CHECK ((status = ANY (ARRAY['active'::text, 'removed'::text]))),
    CONSTRAINT conversation_durable_memory_value_check CHECK (((char_length(value) >= 1) AND (char_length(value) <= 160) AND (char_length(normalized_value) >= 1) AND (char_length(normalized_value) <= 160))),
    CONSTRAINT conversation_durable_memory_normalized_check CHECK ((normalized_value = (lower(regexp_replace(btrim(value), '\s+', ' ', 'g')) COLLATE "C"))),
    CONSTRAINT conversation_durable_memory_session_value_uidx UNIQUE (session_id, kind, normalized_value),
    CONSTRAINT conversation_durable_memory_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT conversation_durable_memory_source_inbound_message_id_fkey FOREIGN KEY (source_inbound_message_id) REFERENCES public.messages(id) ON DELETE RESTRICT
);
ALTER TABLE ONLY public.conversation_durable_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.conversation_durable_memory FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.conversation_durable_memory FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX conversation_durable_memory_active_session_idx ON public.conversation_durable_memory USING btree (session_id, kind, normalized_value) WHERE (status = 'active'::text);
CREATE INDEX conversation_durable_memory_active_user_idx ON public.conversation_durable_memory USING btree (user_id, kind, normalized_value) WHERE ((status = 'active'::text) AND (user_id IS NOT NULL));

CREATE TABLE public.conversation_durable_memory_updates (
    source_inbound_message_id uuid NOT NULL,
    update_index smallint NOT NULL,
    memory_id uuid,
    kind text NOT NULL,
    action text NOT NULL,
    value text NOT NULL,
    normalized_value text NOT NULL,
    outcome text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversation_durable_memory_updates_pkey PRIMARY KEY (source_inbound_message_id, update_index),
    CONSTRAINT conversation_durable_memory_updates_kind_check CHECK ((kind = ANY (ARRAY['allergy'::text, 'dietary_restriction'::text, 'preference'::text]))),
    CONSTRAINT conversation_durable_memory_updates_action_check CHECK ((action = ANY (ARRAY['add'::text, 'remove'::text]))),
    CONSTRAINT conversation_durable_memory_updates_outcome_check CHECK ((outcome = ANY (ARRAY['applied'::text, 'no_change'::text]))),
    CONSTRAINT conversation_durable_memory_updates_value_check CHECK (((char_length(value) >= 1) AND (char_length(value) <= 160) AND (char_length(normalized_value) >= 1) AND (char_length(normalized_value) <= 160))),
    CONSTRAINT conversation_durable_memory_updates_normalized_check CHECK ((normalized_value = (lower(regexp_replace(btrim(value), '\s+', ' ', 'g')) COLLATE "C"))),
    CONSTRAINT conversation_durable_memory_updates_memory_id_fkey FOREIGN KEY (memory_id) REFERENCES public.conversation_durable_memory(id) ON DELETE RESTRICT,
    CONSTRAINT conversation_durable_memory_updates_source_inbound_message_id_fkey FOREIGN KEY (source_inbound_message_id) REFERENCES public.messages(id) ON DELETE RESTRICT
);
ALTER TABLE ONLY public.conversation_durable_memory_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.conversation_durable_memory_updates FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.conversation_durable_memory_updates FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.read_conversation_durable_memory(target_session_id text, target_user_id uuid DEFAULT NULL::uuid) RETURNS TABLE(kind text, value text, source text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  SELECT DISTINCT ON (memory.kind, memory.normalized_value)
    memory.kind, memory.value,
    CASE WHEN memory.session_id = target_session_id THEN 'session' ELSE 'user' END AS source
  FROM public.conversation_durable_memory AS memory
  WHERE memory.status = 'active'
    AND (memory.session_id = target_session_id OR (target_user_id IS NOT NULL AND memory.user_id = target_user_id))
  ORDER BY memory.kind, memory.normalized_value,
    CASE WHEN memory.session_id = target_session_id THEN 0 ELSE 1 END,
    memory.updated_at DESC, memory.id DESC;
$$;
CREATE FUNCTION public.link_conversation_durable_memory(target_session_id text, target_user_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE linked_count integer;
BEGIN
  IF NULLIF(btrim(target_session_id), '') IS NULL OR target_user_id IS NULL THEN RAISE EXCEPTION 'CONVERSATION_MEMORY_LINK_INVALID'; END IF;
  UPDATE public.conversation_durable_memory SET user_id = target_user_id, updated_at = now() WHERE session_id = target_session_id AND user_id IS NULL;
  GET DIAGNOSTICS linked_count = ROW_COUNT;
  RETURN linked_count;
END;
$$;
CREATE FUNCTION public.reserve_conversation_v4_reply_with_memory(p jsonb) RETURNS SETOF public.messages
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  inbound public.messages%ROWTYPE; part jsonb; update_value jsonb; part_count integer; i integer;
  memory_row public.conversation_durable_memory%ROWTYPE; candidate_body text; update_kind text; update_action text; update_text text; update_normalized text;
  expected_user_id uuid; expected_key text; existing_count integer; changed boolean;
BEGIN
  IF jsonb_typeof(p) <> 'object' OR NOT (p ?& ARRAY['in_reply_to_id', 'session_id', 'processing_owner', 'base_idempotency_key', 'logical_body', 'message_kind', 'parts', 'memory_updates']) OR (CASE WHEN jsonb_typeof(p) = 'object' THEN EXISTS (SELECT 1 FROM jsonb_object_keys(p) AS supplied(key) WHERE supplied.key NOT IN ('in_reply_to_id', 'session_id', 'processing_owner', 'base_idempotency_key', 'logical_body', 'message_kind', 'parts', 'memory_updates', 'user_id')) ELSE false END) OR jsonb_typeof(p->'parts') <> 'array' OR jsonb_typeof(p->'memory_updates') <> 'array' OR jsonb_array_length(p->'parts') < 1 OR jsonb_array_length(p->'parts') > 8 OR jsonb_array_length(p->'memory_updates') > 12 OR NULLIF(btrim(p->>'session_id'), '') IS NULL OR NULLIF(btrim(p->>'processing_owner'), '') IS NULL OR NULLIF(btrim(p->>'base_idempotency_key'), '') IS NULL OR NULLIF(btrim(p->>'logical_body'), '') IS NULL OR char_length(p->>'logical_body') > 4000 OR p->>'message_kind' NOT IN ('sales_ai', 'paid_ai') OR (p ? 'user_id' AND (jsonb_typeof(p->'user_id') <> 'string' OR (p->>'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')) THEN RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p->>'session_id', 17));
  SELECT * INTO inbound FROM public.messages WHERE id = (p->>'in_reply_to_id')::uuid AND direction = 'inbound' AND session_id = p->>'session_id' FOR UPDATE;
  IF NOT FOUND OR inbound.processing_completed_at IS NOT NULL OR inbound.processing_owner IS DISTINCT FROM p->>'processing_owner' OR inbound.processing_lease_until IS NULL OR inbound.processing_lease_until <= now() THEN RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_NOT_OWNED'; END IF;
  IF EXISTS (SELECT 1 FROM public.messages AS member WHERE member.session_id = inbound.session_id AND member.direction = 'inbound' AND COALESCE(member.metadata->>'turn_anchor_id', member.id::text) = inbound.id::text AND member.processing_completed_at IS NULL AND (member.processing_owner IS DISTINCT FROM p->>'processing_owner' OR member.processing_lease_until IS NULL OR member.processing_lease_until <= now())) THEN RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_TURN_NOT_OWNED'; END IF;
  expected_user_id := NULLIF(p->>'user_id', '')::uuid;
  IF expected_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = expected_user_id) THEN RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_USER_UNKNOWN'; END IF;
  FOR i IN 0..jsonb_array_length(p->'parts') - 1 LOOP
    part := p->'parts'->i; candidate_body := CASE WHEN jsonb_typeof(part) = 'string' THEN part #>> '{}' ELSE NULL END;
    IF candidate_body IS NULL OR NULLIF(btrim(candidate_body), '') IS NULL OR char_length(candidate_body) > 1500 THEN RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_PART_INVALID'; END IF;
  END LOOP;
  FOR i IN 0..jsonb_array_length(p->'memory_updates') - 1 LOOP
    update_value := p->'memory_updates'->i;
    IF jsonb_typeof(update_value) <> 'object' OR NOT (update_value ?& ARRAY['kind', 'action', 'value']) OR (CASE WHEN jsonb_typeof(update_value) = 'object' THEN EXISTS (SELECT 1 FROM jsonb_object_keys(update_value) AS supplied(key) WHERE supplied.key NOT IN ('kind', 'action', 'value')) ELSE false END) OR jsonb_typeof(update_value->'kind') <> 'string' OR jsonb_typeof(update_value->'action') <> 'string' OR jsonb_typeof(update_value->'value') <> 'string' THEN RAISE EXCEPTION 'CONVERSATION_V4_MEMORY_UPDATE_INVALID'; END IF;
    update_kind := update_value->>'kind'; update_action := update_value->>'action'; update_text := btrim(update_value->>'value'); update_normalized := lower(regexp_replace(update_text, '\s+', ' ', 'g')) COLLATE "C";
    IF update_kind NOT IN ('allergy', 'dietary_restriction', 'preference') OR update_action NOT IN ('add', 'remove') OR char_length(update_text) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'CONVERSATION_V4_MEMORY_UPDATE_INVALID'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'memory_updates') WITH ORDINALITY AS other(value, ordinality) WHERE other.ordinality > i + 1 AND other.value->>'kind' = update_kind AND lower(regexp_replace(btrim(other.value->>'value'), '\s+', ' ', 'g')) COLLATE "C" = update_normalized) THEN RAISE EXCEPTION 'CONVERSATION_V4_MEMORY_UPDATE_DUPLICATE'; END IF;
  END LOOP;
  SELECT count(*) INTO existing_count FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound';
  IF existing_count > 0 THEN
    IF existing_count <> jsonb_array_length(p->'parts') OR EXISTS (SELECT 1 FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound' AND (metadata->>'logical_reply_key' IS DISTINCT FROM p->>'base_idempotency_key' OR assistant_response IS DISTINCT FROM p->>'logical_body' OR message_kind IS DISTINCT FROM p->>'message_kind' OR user_id IS DISTINCT FROM expected_user_id)) OR (SELECT count(*) FROM public.conversation_durable_memory_updates WHERE source_inbound_message_id = inbound.id) <> jsonb_array_length(p->'memory_updates') THEN RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_REPLAY_CHANGED'; END IF;
    FOR i IN 0..jsonb_array_length(p->'memory_updates') - 1 LOOP
      update_value := p->'memory_updates'->i;
      IF NOT EXISTS (SELECT 1 FROM public.conversation_durable_memory_updates AS logged WHERE logged.source_inbound_message_id = inbound.id AND logged.update_index = i + 1 AND logged.kind = update_value->>'kind' AND logged.action = update_value->>'action' AND logged.normalized_value = lower(regexp_replace(btrim(update_value->>'value'), '\s+', ' ', 'g')) COLLATE "C") THEN RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_REPLAY_CHANGED'; END IF;
    END LOOP;
    FOR i IN 0..jsonb_array_length(p->'parts') - 1 LOOP
      expected_key := CASE WHEN i = 0 THEN p->>'base_idempotency_key' ELSE p->>'base_idempotency_key' || ':part:' || lpad((i + 1)::text, 3, '0') END;
      IF NOT EXISTS (SELECT 1 FROM public.messages AS reserved WHERE reserved.in_reply_to_id = inbound.id AND reserved.direction = 'outbound' AND reserved.idempotency_key = expected_key AND reserved.body IS NOT DISTINCT FROM p->'parts'->>i AND reserved.metadata->'part_index' = to_jsonb(i + 1) AND reserved.metadata->'part_count' = to_jsonb(jsonb_array_length(p->'parts'))) THEN RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_REPLAY_CHANGED'; END IF;
    END LOOP;
    RETURN QUERY SELECT * FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound' ORDER BY (metadata->>'part_index')::integer; RETURN;
  END IF;
  part_count := jsonb_array_length(p->'parts');
  FOR i IN 0..part_count - 1 LOOP
    candidate_body := p->'parts'->>i; expected_key := CASE WHEN i = 0 THEN p->>'base_idempotency_key' ELSE p->>'base_idempotency_key' || ':part:' || lpad((i + 1)::text, 3, '0') END;
    INSERT INTO public.messages (user_id, session_id, direction, body, message_kind, provider, idempotency_key, in_reply_to_id, delivery_status, metadata, assistant_response) VALUES (expected_user_id, inbound.session_id, 'outbound', candidate_body, p->>'message_kind', 'twilio', expected_key, inbound.id, 'pending', jsonb_build_object('logical_reply_key', p->>'base_idempotency_key', 'part_index', i + 1, 'part_count', part_count), p->>'logical_body');
  END LOOP;
  FOR i IN 0..jsonb_array_length(p->'memory_updates') - 1 LOOP
    update_value := p->'memory_updates'->i; update_kind := update_value->>'kind'; update_action := update_value->>'action'; update_text := btrim(update_value->>'value'); update_normalized := lower(regexp_replace(update_text, '\s+', ' ', 'g')) COLLATE "C"; changed := false;
    IF update_action = 'add' THEN
        INSERT INTO public.conversation_durable_memory (session_id, user_id, kind, value, normalized_value, status, source_inbound_message_id) VALUES (inbound.session_id, expected_user_id, update_kind, update_text, update_normalized, 'active', inbound.id) ON CONFLICT (session_id, kind, normalized_value) DO UPDATE SET value = EXCLUDED.value, user_id = COALESCE(EXCLUDED.user_id, conversation_durable_memory.user_id), status = 'active', source_inbound_message_id = EXCLUDED.source_inbound_message_id, updated_at = now() WHERE conversation_durable_memory.status IS DISTINCT FROM 'active' OR (conversation_durable_memory.user_id IS NULL AND EXCLUDED.user_id IS NOT NULL) RETURNING * INTO memory_row; changed := FOUND;
    ELSE
      UPDATE public.conversation_durable_memory SET status = 'removed', source_inbound_message_id = inbound.id, updated_at = now(), user_id = COALESCE(expected_user_id, user_id) WHERE session_id = inbound.session_id AND kind = update_kind AND normalized_value = update_normalized AND status = 'active' RETURNING * INTO memory_row; changed := FOUND;
    END IF;
    INSERT INTO public.conversation_durable_memory_updates (source_inbound_message_id, update_index, memory_id, kind, action, value, normalized_value, outcome) VALUES (inbound.id, i + 1, CASE WHEN changed THEN memory_row.id ELSE NULL END, update_kind, update_action, update_text, update_normalized, CASE WHEN changed THEN 'applied' ELSE 'no_change' END);
  END LOOP;
  RETURN QUERY SELECT * FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound' ORDER BY (metadata->>'part_index')::integer;
END;
$$;
REVOKE ALL ON FUNCTION public.read_conversation_durable_memory(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_conversation_durable_memory(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_conversation_v4_reply_with_memory(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_conversation_durable_memory(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_conversation_durable_memory(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_conversation_v4_reply_with_memory(jsonb) TO service_role;
COMMENT ON TABLE public.conversation_durable_memory IS 'V4 explicit durable customer allergy, dietary-restriction, and preference memory. It never stores situational food context.';
COMMENT ON TABLE public.conversation_durable_memory_updates IS 'Idempotent source-inbound provenance for V4 durable memory updates.';

-- PostgreSQL database dump complete
--

\unrestrict ppu74BOdonNyZyvQ1U6cB7AsrlN63zjij6QTTwrXCdDQSPmjOr4fqSPvDrywIwa
