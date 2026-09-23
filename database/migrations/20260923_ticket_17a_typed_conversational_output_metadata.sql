-- Ticket 17A: prospective, non-authoritative metadata for bounded
-- conversational artifacts. Legacy messages deliberately receive no rows.
BEGIN;

CREATE TABLE public.conversation_artifacts (
  artifact_id text PRIMARY KEY,
  contract_version text NOT NULL DEFAULT '1.0',
  artifact_type text NOT NULL,
  generation_operation text NOT NULL,
  generation_task_id text NOT NULL UNIQUE,
  logical_reply_key text NOT NULL UNIQUE,
  -- Ordinary ledger deletion must not erase semantic history. The explicit,
  -- ungranted privacy boundary below deletes the graph and then its anchor.
  anchor_message_id uuid NOT NULL UNIQUE REFERENCES public.messages(id) ON DELETE RESTRICT,
  CONSTRAINT conversation_artifacts_id_check CHECK (artifact_id ~ '^ca-[A-Za-z0-9._-]+$'),
  CONSTRAINT conversation_artifacts_version_check CHECK (contract_version = '1.0'),
  CONSTRAINT conversation_artifacts_type_check CHECK (artifact_type IN ('draft', 'summary')),
  CONSTRAINT conversation_artifacts_operation_check CHECK (generation_operation IN ('draft', 'transform', 'summarize')),
  CONSTRAINT conversation_artifacts_task_id_check CHECK (generation_task_id ~ '^cgt-[A-Za-z0-9._-]+$'),
  CONSTRAINT conversation_artifacts_operation_type_check CHECK (
    (generation_operation = 'summarize' AND artifact_type = 'summary') OR
    (generation_operation IN ('draft', 'transform') AND artifact_type = 'draft')
  )
);

CREATE TABLE public.conversation_artifact_lineage (
  artifact_id text NOT NULL REFERENCES public.conversation_artifacts(artifact_id) ON DELETE CASCADE,
  source_artifact_id text NOT NULL REFERENCES public.conversation_artifacts(artifact_id) ON DELETE CASCADE,
  position integer NOT NULL,
  PRIMARY KEY (artifact_id, position),
  UNIQUE (artifact_id, source_artifact_id),
  CONSTRAINT conversation_artifact_lineage_position_check CHECK (position > 0),
  CONSTRAINT conversation_artifact_lineage_self_check CHECK (artifact_id <> source_artifact_id)
);

ALTER TABLE public.conversation_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_artifact_lineage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_artifact_lineage FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.conversation_artifacts, public.conversation_artifact_lineage FROM PUBLIC, anon, authenticated, service_role;

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

REVOKE ALL ON FUNCTION public.persist_conversation_artifact(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.persist_conversation_artifact(jsonb) TO service_role;

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

REVOKE ALL ON FUNCTION public.delete_message_with_conversation_artifacts_for_privacy(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.conversation_artifacts IS 'Ticket 17A prospective typed conversational metadata. It links bounded non-authoritative material to a canonical outbound message; message body remains the content source.';
COMMENT ON TABLE public.conversation_artifact_lineage IS 'Ordered bounded artifact lineage. It is inserted only by persist_conversation_artifact.';
COMMENT ON FUNCTION public.persist_conversation_artifact(jsonb) IS 'The sole runtime artifact persistence boundary: validates canonical logical-reply anchor, lineage, idempotency, and cycles atomically.';
COMMENT ON FUNCTION public.delete_message_with_conversation_artifacts_for_privacy(uuid) IS 'Privileged privacy/deletion lifecycle boundary: recursively deletes an anchored artifact graph, then its canonical message. It is intentionally unavailable to runtime roles.';
COMMIT;
