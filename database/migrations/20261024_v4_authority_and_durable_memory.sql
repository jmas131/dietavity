-- Conversation Engine V4 foundation: request-scoped commercial authority is
-- defined in application code. This migration stores only explicit durable
-- customer memory and binds accepted updates to an outbound reservation.

BEGIN;

CREATE TABLE public.conversation_durable_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  value text NOT NULL,
  normalized_value text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  source_inbound_message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_durable_memory_kind_check CHECK (kind IN ('allergy', 'dietary_restriction', 'preference')),
  CONSTRAINT conversation_durable_memory_status_check CHECK (status IN ('active', 'removed')),
  CONSTRAINT conversation_durable_memory_value_check CHECK (
    char_length(value) BETWEEN 1 AND 160
    AND char_length(normalized_value) BETWEEN 1 AND 160
  ),
  CONSTRAINT conversation_durable_memory_normalized_check CHECK (normalized_value = lower(regexp_replace(btrim(value), '\s+', ' ', 'g')) COLLATE "C"),
  CONSTRAINT conversation_durable_memory_session_value_uidx UNIQUE (session_id, kind, normalized_value)
);

CREATE TABLE public.conversation_durable_memory_updates (
  source_inbound_message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE RESTRICT,
  update_index smallint NOT NULL,
  memory_id uuid NULL REFERENCES public.conversation_durable_memory(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  action text NOT NULL,
  value text NOT NULL,
  normalized_value text NOT NULL,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_inbound_message_id, update_index),
  CONSTRAINT conversation_durable_memory_updates_kind_check CHECK (kind IN ('allergy', 'dietary_restriction', 'preference')),
  CONSTRAINT conversation_durable_memory_updates_action_check CHECK (action IN ('add', 'remove')),
  CONSTRAINT conversation_durable_memory_updates_outcome_check CHECK (outcome IN ('applied', 'no_change')),
  CONSTRAINT conversation_durable_memory_updates_value_check CHECK (
    char_length(value) BETWEEN 1 AND 160
    AND char_length(normalized_value) BETWEEN 1 AND 160
  ),
  CONSTRAINT conversation_durable_memory_updates_normalized_check CHECK (normalized_value = lower(regexp_replace(btrim(value), '\s+', ' ', 'g')) COLLATE "C")
);

CREATE INDEX conversation_durable_memory_active_session_idx
  ON public.conversation_durable_memory (session_id, kind, normalized_value)
  WHERE status = 'active';
CREATE INDEX conversation_durable_memory_active_user_idx
  ON public.conversation_durable_memory (user_id, kind, normalized_value)
  WHERE status = 'active' AND user_id IS NOT NULL;

ALTER TABLE public.conversation_durable_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_durable_memory FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_durable_memory_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_durable_memory_updates FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.conversation_durable_memory, public.conversation_durable_memory_updates FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.read_conversation_durable_memory(target_session_id text, target_user_id uuid DEFAULT NULL)
RETURNS TABLE (kind text, value text, source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT DISTINCT ON (memory.kind, memory.normalized_value)
    memory.kind,
    memory.value,
    CASE WHEN memory.session_id = target_session_id THEN 'session' ELSE 'user' END AS source
  FROM public.conversation_durable_memory AS memory
  WHERE memory.status = 'active'
    AND (memory.session_id = target_session_id OR (target_user_id IS NOT NULL AND memory.user_id = target_user_id))
  ORDER BY memory.kind, memory.normalized_value,
    CASE WHEN memory.session_id = target_session_id THEN 0 ELSE 1 END,
    memory.updated_at DESC, memory.id DESC;
$$;

CREATE FUNCTION public.link_conversation_durable_memory(target_session_id text, target_user_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE linked_count integer;
BEGIN
  IF NULLIF(btrim(target_session_id), '') IS NULL OR target_user_id IS NULL THEN
    RAISE EXCEPTION 'CONVERSATION_MEMORY_LINK_INVALID';
  END IF;
  UPDATE public.conversation_durable_memory
  SET user_id = target_user_id, updated_at = now()
  WHERE session_id = target_session_id
    AND user_id IS NULL;
  GET DIAGNOSTICS linked_count = ROW_COUNT;
  RETURN linked_count;
END;
$$;

CREATE FUNCTION public.reserve_conversation_v4_reply_with_memory(p jsonb)
RETURNS SETOF public.messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  inbound public.messages%ROWTYPE;
  part jsonb;
  update_value jsonb;
  part_count integer;
  i integer;
  memory_row public.conversation_durable_memory%ROWTYPE;
  candidate_body text;
  update_kind text;
  update_action text;
  update_text text;
  update_normalized text;
  expected_user_id uuid;
  expected_key text;
  existing_count integer;
  changed boolean;
BEGIN
  IF jsonb_typeof(p) <> 'object'
    OR NOT (p ?& ARRAY['in_reply_to_id', 'session_id', 'processing_owner', 'base_idempotency_key', 'logical_body', 'message_kind', 'parts', 'memory_updates'])
    OR CASE WHEN jsonb_typeof(p) = 'object' THEN EXISTS (
      SELECT 1 FROM jsonb_object_keys(p) AS supplied(key)
      WHERE supplied.key NOT IN ('in_reply_to_id', 'session_id', 'processing_owner', 'base_idempotency_key', 'logical_body', 'message_kind', 'parts', 'memory_updates', 'user_id')
    ) ELSE false END
    OR jsonb_typeof(p->'parts') <> 'array'
    OR jsonb_typeof(p->'memory_updates') <> 'array'
    OR jsonb_array_length(p->'parts') < 1
    OR jsonb_array_length(p->'parts') > 8
    OR jsonb_array_length(p->'memory_updates') > 12
    OR NULLIF(btrim(p->>'session_id'), '') IS NULL
    OR NULLIF(btrim(p->>'processing_owner'), '') IS NULL
    OR NULLIF(btrim(p->>'base_idempotency_key'), '') IS NULL
    OR NULLIF(btrim(p->>'logical_body'), '') IS NULL
    OR char_length(p->>'logical_body') > 4000
    OR p->>'message_kind' NOT IN ('sales_ai', 'paid_ai')
    OR (p ? 'user_id' AND (jsonb_typeof(p->'user_id') <> 'string' OR (p->>'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
  THEN RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_INVALID'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p->>'session_id', 17));
  SELECT * INTO inbound
  FROM public.messages
  WHERE id = (p->>'in_reply_to_id')::uuid
    AND direction = 'inbound'
    AND session_id = p->>'session_id'
  FOR UPDATE;
  IF NOT FOUND
    OR inbound.processing_completed_at IS NOT NULL
    OR inbound.processing_owner IS DISTINCT FROM p->>'processing_owner'
    OR inbound.processing_lease_until IS NULL
    OR inbound.processing_lease_until <= now()
  THEN RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_NOT_OWNED'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.messages AS member
    WHERE member.session_id = inbound.session_id
      AND member.direction = 'inbound'
      AND COALESCE(member.metadata->>'turn_anchor_id', member.id::text) = inbound.id::text
      AND member.processing_completed_at IS NULL
      AND (member.processing_owner IS DISTINCT FROM p->>'processing_owner'
        OR member.processing_lease_until IS NULL OR member.processing_lease_until <= now())
  ) THEN RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_TURN_NOT_OWNED'; END IF;

  expected_user_id := NULLIF(p->>'user_id', '')::uuid;
  IF expected_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = expected_user_id) THEN
    RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_USER_UNKNOWN';
  END IF;

  FOR i IN 0..jsonb_array_length(p->'parts') - 1 LOOP
    part := p->'parts'->i;
    candidate_body := CASE WHEN jsonb_typeof(part) = 'string' THEN part #>> '{}' ELSE NULL END;
    IF candidate_body IS NULL OR NULLIF(btrim(candidate_body), '') IS NULL OR char_length(candidate_body) > 1500 THEN
      RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_PART_INVALID';
    END IF;
  END LOOP;

  FOR i IN 0..jsonb_array_length(p->'memory_updates') - 1 LOOP
    update_value := p->'memory_updates'->i;
    IF jsonb_typeof(update_value) <> 'object'
      OR NOT (update_value ?& ARRAY['kind', 'action', 'value'])
      OR CASE WHEN jsonb_typeof(update_value) = 'object' THEN EXISTS (
        SELECT 1 FROM jsonb_object_keys(update_value) AS supplied(key)
        WHERE supplied.key NOT IN ('kind', 'action', 'value')
      ) ELSE false END
      OR jsonb_typeof(update_value->'kind') <> 'string'
      OR jsonb_typeof(update_value->'action') <> 'string'
      OR jsonb_typeof(update_value->'value') <> 'string'
    THEN RAISE EXCEPTION 'CONVERSATION_V4_MEMORY_UPDATE_INVALID'; END IF;
    update_kind := update_value->>'kind'; update_action := update_value->>'action'; update_text := btrim(update_value->>'value'); update_normalized := lower(regexp_replace(update_text, '\s+', ' ', 'g')) COLLATE "C";
    IF update_kind NOT IN ('allergy', 'dietary_restriction', 'preference')
      OR update_action NOT IN ('add', 'remove')
      OR char_length(update_text) NOT BETWEEN 1 AND 160
    THEN RAISE EXCEPTION 'CONVERSATION_V4_MEMORY_UPDATE_INVALID'; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p->'memory_updates') WITH ORDINALITY AS other(value, ordinality)
      WHERE other.ordinality > i + 1
        AND other.value->>'kind' = update_kind
        AND lower(regexp_replace(btrim(other.value->>'value'), '\s+', ' ', 'g')) COLLATE "C" = update_normalized
    ) THEN RAISE EXCEPTION 'CONVERSATION_V4_MEMORY_UPDATE_DUPLICATE'; END IF;
  END LOOP;

  SELECT count(*) INTO existing_count
  FROM public.messages
  WHERE in_reply_to_id = inbound.id AND direction = 'outbound';
  IF existing_count > 0 THEN
    IF existing_count <> jsonb_array_length(p->'parts')
      OR EXISTS (
      SELECT 1 FROM public.messages
      WHERE in_reply_to_id = inbound.id AND direction = 'outbound'
        AND (metadata->>'logical_reply_key' IS DISTINCT FROM p->>'base_idempotency_key'
          OR assistant_response IS DISTINCT FROM p->>'logical_body'
          OR message_kind IS DISTINCT FROM p->>'message_kind'
          OR user_id IS DISTINCT FROM expected_user_id)
    ) OR (SELECT count(*) FROM public.conversation_durable_memory_updates WHERE source_inbound_message_id = inbound.id) <> jsonb_array_length(p->'memory_updates') THEN
      RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_REPLAY_CHANGED';
    END IF;
    FOR i IN 0..jsonb_array_length(p->'memory_updates') - 1 LOOP
      update_value := p->'memory_updates'->i;
      IF NOT EXISTS (
        SELECT 1 FROM public.conversation_durable_memory_updates AS logged
        WHERE logged.source_inbound_message_id = inbound.id AND logged.update_index = i + 1
          AND logged.kind = update_value->>'kind' AND logged.action = update_value->>'action'
          AND logged.normalized_value = lower(regexp_replace(btrim(update_value->>'value'), '\s+', ' ', 'g')) COLLATE "C"
      ) THEN RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_REPLAY_CHANGED'; END IF;
    END LOOP;
    FOR i IN 0..jsonb_array_length(p->'parts') - 1 LOOP
      expected_key := CASE WHEN i = 0 THEN p->>'base_idempotency_key' ELSE p->>'base_idempotency_key' || ':part:' || lpad((i + 1)::text, 3, '0') END;
      IF NOT EXISTS (
        SELECT 1 FROM public.messages AS reserved
        WHERE reserved.in_reply_to_id = inbound.id
          AND reserved.direction = 'outbound'
          AND reserved.idempotency_key = expected_key
          AND reserved.body IS NOT DISTINCT FROM p->'parts'->>i
          AND reserved.metadata->'part_index' = to_jsonb(i + 1)
          AND reserved.metadata->'part_count' = to_jsonb(jsonb_array_length(p->'parts'))
      ) THEN RAISE EXCEPTION 'CONVERSATION_V4_RESERVATION_REPLAY_CHANGED'; END IF;
    END LOOP;
    RETURN QUERY SELECT * FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound'
      ORDER BY (metadata->>'part_index')::integer;
    RETURN;
  END IF;

  part_count := jsonb_array_length(p->'parts');
  FOR i IN 0..part_count - 1 LOOP
    candidate_body := p->'parts'->>i;
    expected_key := CASE WHEN i = 0 THEN p->>'base_idempotency_key' ELSE p->>'base_idempotency_key' || ':part:' || lpad((i + 1)::text, 3, '0') END;
    INSERT INTO public.messages (user_id, session_id, direction, body, message_kind, provider, idempotency_key, in_reply_to_id, delivery_status, metadata, assistant_response)
    VALUES (expected_user_id, inbound.session_id, 'outbound', candidate_body, p->>'message_kind', 'twilio', expected_key, inbound.id, 'pending',
      jsonb_build_object('logical_reply_key', p->>'base_idempotency_key', 'part_index', i + 1, 'part_count', part_count), p->>'logical_body');
  END LOOP;

  FOR i IN 0..jsonb_array_length(p->'memory_updates') - 1 LOOP
    update_value := p->'memory_updates'->i;
    update_kind := update_value->>'kind'; update_action := update_value->>'action'; update_text := btrim(update_value->>'value'); update_normalized := lower(regexp_replace(update_text, '\s+', ' ', 'g')) COLLATE "C";
    changed := false;
    IF update_action = 'add' THEN
      INSERT INTO public.conversation_durable_memory (session_id, user_id, kind, value, normalized_value, status, source_inbound_message_id)
      VALUES (inbound.session_id, expected_user_id, update_kind, update_text, update_normalized, 'active', inbound.id)
      ON CONFLICT (session_id, kind, normalized_value) DO UPDATE
      SET value = EXCLUDED.value, user_id = COALESCE(EXCLUDED.user_id, conversation_durable_memory.user_id), status = 'active', source_inbound_message_id = EXCLUDED.source_inbound_message_id, updated_at = now()
      WHERE conversation_durable_memory.status IS DISTINCT FROM 'active'
         OR (conversation_durable_memory.user_id IS NULL AND EXCLUDED.user_id IS NOT NULL)
      RETURNING * INTO memory_row;
      changed := FOUND;
    ELSE
      UPDATE public.conversation_durable_memory
      SET status = 'removed', source_inbound_message_id = inbound.id, updated_at = now(), user_id = COALESCE(expected_user_id, user_id)
      WHERE session_id = inbound.session_id AND kind = update_kind AND normalized_value = update_normalized AND status = 'active'
      RETURNING * INTO memory_row;
      changed := FOUND;
    END IF;
    INSERT INTO public.conversation_durable_memory_updates (source_inbound_message_id, update_index, memory_id, kind, action, value, normalized_value, outcome)
    VALUES (inbound.id, i + 1, CASE WHEN changed THEN memory_row.id ELSE NULL END, update_kind, update_action, update_text, update_normalized, CASE WHEN changed THEN 'applied' ELSE 'no_change' END);
  END LOOP;

  RETURN QUERY SELECT * FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound'
    ORDER BY (metadata->>'part_index')::integer;
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

COMMIT;
