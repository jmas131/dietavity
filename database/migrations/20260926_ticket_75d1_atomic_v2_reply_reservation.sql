-- Ticket75D.1: Node-owned, lease-checked durable reservation.  This is an
-- additive boundary; it neither sends nor completes a WhatsApp reply.
BEGIN;

CREATE OR REPLACE FUNCTION public.reserve_v2_approved_logical_reply(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  inbound public.messages%ROWTYPE;
  part jsonb;
  existing public.messages%ROWTYPE;
  persisted_artifact public.conversation_artifacts%ROWTYPE;
  physical_key text;
  source_hash text;
  computed_binding text;
  preimage text;
  part_count integer;
  i integer;
  expected_key text;
  artifact_input jsonb;
  existing_parts jsonb;
  result_rows jsonb;
BEGIN
  -- This is deliberately a closed wire contract.  In particular it accepts no
  -- caller metadata, provider evidence, pricing, prompt, or model material.
  IF jsonb_typeof(p) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p)) <> 11
     OR NOT (p ?& ARRAY['contract_version','canonical_inbound_message_id','session_id','processing_owner','logical_reply_key','eligible_response_binding','approved_response_text','approved_response_digest','parts','artifact_projection','reservation_binding'])
     OR p->>'contract_version' <> 'ticket-75d1-v1'
     OR p->>'canonical_inbound_message_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR NULLIF(p->>'session_id','') IS NULL OR NULLIF(p->>'processing_owner','') IS NULL
     OR p->>'logical_reply_key' !~ '^lrk-[0-9a-f]{64}$'
     OR p->>'eligible_response_binding' !~ '^pgrsp-[0-9a-f]{64}$'
     OR p->>'approved_response_digest' !~ '^[0-9a-f]{64}$'
     OR p->>'reservation_binding' !~ '^rrb-[0-9a-f]{64}$'
     OR jsonb_typeof(p->'approved_response_text') <> 'string'
     OR NULLIF(p->>'approved_response_text','') IS NULL
     OR jsonb_typeof(p->'parts') <> 'array'
     OR jsonb_typeof(p->'artifact_projection') NOT IN ('object','null') THEN
    RAISE EXCEPTION 'V2_REPLY_RESERVATION_INPUT_INVALID';
  END IF;
  part_count := jsonb_array_length(p->'parts');
  IF part_count NOT BETWEEN 1 AND 999 THEN RAISE EXCEPTION 'V2_REPLY_RESERVATION_PARTS_INVALID'; END IF;
  FOR i IN 1..part_count LOOP
    part := p->'parts'->(i - 1);
    IF jsonb_typeof(part) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(part)) <> 3
       OR NOT (part ?& ARRAY['part_index','part_count','body'])
       OR jsonb_typeof(part->'part_index') <> 'number'
       OR jsonb_typeof(part->'part_count') <> 'number'
       OR jsonb_typeof(part->'body') <> 'string'
       OR part->>'part_index' !~ '^[1-9][0-9]{0,2}$'
       OR part->>'part_count' !~ '^[1-9][0-9]{0,2}$'
       OR (part->>'part_index')::integer <> i
       OR (part->>'part_count')::integer <> part_count
       OR NULLIF(part->>'body','') IS NULL THEN
      RAISE EXCEPTION 'V2_REPLY_RESERVATION_PARTS_INVALID';
    END IF;
  END LOOP;
  IF jsonb_typeof(p->'artifact_projection') = 'object' AND (
       (SELECT count(*) FROM jsonb_object_keys(p->'artifact_projection')) <> 5
       OR NOT (p->'artifact_projection' ?& ARRAY['artifact_id','artifact_type','generation_operation','generation_task_id','ordered_lineage_artifact_ids'])
       OR jsonb_typeof(p->'artifact_projection'->'ordered_lineage_artifact_ids') <> 'array'
       OR p->'artifact_projection'->>'artifact_id' !~ '^ca-[A-Za-z0-9._-]+$'
       OR p->'artifact_projection'->>'generation_task_id' !~ '^cgt-[A-Za-z0-9._-]+$'
       OR (p->'artifact_projection'->>'artifact_type', p->'artifact_projection'->>'generation_operation') NOT IN (('draft','draft'),('draft','transform'),('summary','summarize'))
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p->'artifact_projection'->'ordered_lineage_artifact_ids') x WHERE jsonb_typeof(x) <> 'string' OR NULLIF(x #>> '{}','') IS NULL)
       OR (SELECT count(*) FROM jsonb_array_elements_text(p->'artifact_projection'->'ordered_lineage_artifact_ids')) <> (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p->'artifact_projection'->'ordered_lineage_artifact_ids') x)
     ) THEN RAISE EXCEPTION 'V2_REPLY_RESERVATION_ARTIFACT_INVALID'; END IF;

  source_hash := encode(digest(convert_to(p->>'approved_response_text', 'UTF8'), 'sha256'), 'hex');
  IF source_hash IS DISTINCT FROM p->>'approved_response_digest' THEN RAISE EXCEPTION 'V2_REPLY_RESERVATION_RESPONSE_DIGEST_INVALID'; END IF;

  -- Exact Ticket75D.0A byte grammar, deliberately not JSON serialization.
  preimage := 'a9[' || 's' || octet_length(convert_to('ticket-75d0a-approved-reply-reservation-v1','UTF8')) || ':ticket-75d0a-approved-reply-reservation-v1'
    || 's' || octet_length(convert_to('ticket-75d0a-reservation-binding-v1','UTF8')) || ':ticket-75d0a-reservation-binding-v1'
    || 's36:' || lower(p->>'canonical_inbound_message_id')
    || 's' || octet_length(convert_to(p->>'session_id','UTF8')) || ':' || p->>'session_id'
    || 's' || octet_length(convert_to(p->>'logical_reply_key','UTF8')) || ':' || p->>'logical_reply_key'
    || 's' || octet_length(convert_to(p->>'eligible_response_binding','UTF8')) || ':' || p->>'eligible_response_binding'
    || 's64:' || p->>'approved_response_digest'
    || 'a' || part_count || '[';
  FOR i IN 1..part_count LOOP
    part := p->'parts'->(i - 1);
    preimage := preimage || 'a3[s' || octet_length(convert_to(i::text,'UTF8')) || ':' || i::text
      || 's' || octet_length(convert_to(part_count::text,'UTF8')) || ':' || part_count::text
      || 's' || octet_length(convert_to(part->>'body','UTF8')) || ':' || part->>'body' || ']';
  END LOOP;
  preimage := preimage || ']';
  IF jsonb_typeof(p->'artifact_projection') = 'null' THEN
    preimage := preimage || 'z';
  ELSE
    preimage := preimage || 'a5['
      || 's' || octet_length(convert_to(p->'artifact_projection'->>'artifact_id','UTF8')) || ':' || p->'artifact_projection'->>'artifact_id'
      || 's' || octet_length(convert_to(p->'artifact_projection'->>'artifact_type','UTF8')) || ':' || p->'artifact_projection'->>'artifact_type'
      || 's' || octet_length(convert_to(p->'artifact_projection'->>'generation_operation','UTF8')) || ':' || p->'artifact_projection'->>'generation_operation'
      || 's' || octet_length(convert_to(p->'artifact_projection'->>'generation_task_id','UTF8')) || ':' || p->'artifact_projection'->>'generation_task_id'
      || 'a' || jsonb_array_length(p->'artifact_projection'->'ordered_lineage_artifact_ids') || '[';
    FOR part IN SELECT value FROM jsonb_array_elements(p->'artifact_projection'->'ordered_lineage_artifact_ids') LOOP
      preimage := preimage || 's' || octet_length(convert_to(part #>> '{}','UTF8')) || ':' || (part #>> '{}');
    END LOOP;
    preimage := preimage || ']]';
  END IF;
  preimage := preimage || ']';
  computed_binding := 'rrb-' || encode(digest(convert_to(preimage,'UTF8'),'sha256'),'hex');
  IF computed_binding IS DISTINCT FROM p->>'reservation_binding' THEN RAISE EXCEPTION 'V2_REPLY_RESERVATION_BINDING_INVALID'; END IF;

  SELECT * INTO inbound FROM public.messages WHERE id = (p->>'canonical_inbound_message_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'V2_REPLY_RESERVATION_CLAIM_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(inbound.session_id, 17));
  SELECT * INTO inbound FROM public.messages WHERE id = inbound.id FOR UPDATE;
  IF inbound.direction <> 'inbound' OR inbound.session_id IS DISTINCT FROM p->>'session_id'
     OR inbound.processing_owner IS DISTINCT FROM p->>'processing_owner'
     OR inbound.processing_lease_until IS NULL OR inbound.processing_lease_until <= NOW()
     OR inbound.processing_completed_at IS NOT NULL OR inbound.processing_order IS NULL
     OR EXISTS (SELECT 1 FROM public.messages earlier WHERE earlier.session_id = inbound.session_id AND earlier.direction = 'inbound' AND earlier.processing_completed_at IS NULL AND earlier.processing_order < inbound.processing_order) THEN
    RAISE EXCEPTION 'V2_REPLY_RESERVATION_CLAIM_INVALID';
  END IF;
  PERFORM 1 FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound' ORDER BY id FOR UPDATE;
  physical_key := 'reply:' || inbound.provider_message_sid || ':paid';
  IF inbound.provider <> 'twilio' OR NULLIF(inbound.provider_message_sid,'') IS NULL THEN RAISE EXCEPTION 'V2_REPLY_RESERVATION_CLAIM_INVALID'; END IF;

  IF EXISTS (SELECT 1 FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound') THEN
    SELECT jsonb_agg(jsonb_build_object('id',id,'body',body,'assistant_response',assistant_response,'idempotency_key',idempotency_key,'metadata',metadata,'delivery_status',delivery_status) ORDER BY (metadata->>'part_index')::integer) INTO existing_parts
    FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound';
    IF (SELECT count(*) FROM public.messages WHERE in_reply_to_id = inbound.id AND direction = 'outbound') <> part_count
       OR EXISTS (SELECT 1 FROM public.messages m WHERE m.in_reply_to_id=inbound.id AND m.direction='outbound' AND (m.session_id IS DISTINCT FROM inbound.session_id OR m.assistant_response IS DISTINCT FROM p->>'approved_response_text' OR m.delivery_status <> 'pending' OR m.provider_message_sid IS NOT NULL OR m.metadata->>'v2_reservation_binding' IS DISTINCT FROM computed_binding OR m.metadata->>'v2_logical_reply_key' IS DISTINCT FROM p->>'logical_reply_key' OR m.metadata->>'eligible_response_binding' IS DISTINCT FROM p->>'eligible_response_binding' OR m.metadata->>'recovery_source_hash' IS DISTINCT FROM source_hash))
       OR EXISTS (SELECT 1 FROM generate_series(1,part_count) n WHERE NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.in_reply_to_id=inbound.id AND m.direction='outbound' AND m.metadata->'part_index'=to_jsonb(n) AND m.metadata->'part_count'=to_jsonb(part_count) AND m.body IS NOT DISTINCT FROM p->'parts'->(n-1)->>'body' AND m.idempotency_key IS NOT DISTINCT FROM CASE WHEN n=1 THEN physical_key ELSE physical_key || ':part:' || lpad(n::text,3,'0') END)) THEN
      RAISE EXCEPTION 'V2_REPLY_RESERVATION_CONFLICT';
    END IF;
    IF jsonb_typeof(p->'artifact_projection') = 'object' AND NOT EXISTS (SELECT 1 FROM public.conversation_artifacts a WHERE a.artifact_id=p->'artifact_projection'->>'artifact_id' AND a.artifact_type=p->'artifact_projection'->>'artifact_type' AND a.generation_operation=p->'artifact_projection'->>'generation_operation' AND a.generation_task_id=p->'artifact_projection'->>'generation_task_id' AND a.logical_reply_key=physical_key AND a.anchor_message_id=(SELECT id FROM public.messages WHERE in_reply_to_id=inbound.id AND direction='outbound' AND metadata->'part_index'='1'::jsonb) AND COALESCE((SELECT jsonb_agg(source_artifact_id ORDER BY position) FROM public.conversation_artifact_lineage l WHERE l.artifact_id=a.artifact_id),'[]'::jsonb) IS NOT DISTINCT FROM p->'artifact_projection'->'ordered_lineage_artifact_ids') THEN RAISE EXCEPTION 'V2_REPLY_RESERVATION_CONFLICT'; END IF;
    IF jsonb_typeof(p->'artifact_projection') = 'null' AND EXISTS (SELECT 1 FROM public.conversation_artifacts a JOIN public.messages m ON m.id=a.anchor_message_id WHERE m.in_reply_to_id=inbound.id AND m.direction='outbound') THEN RAISE EXCEPTION 'V2_REPLY_RESERVATION_CONFLICT'; END IF;
    UPDATE public.messages SET processing_lease_until=NOW()+INTERVAL '5 minutes' WHERE id=inbound.id;
    RETURN jsonb_build_object('state','reserved_existing','physical_logical_reply_key',physical_key,'messages',existing_parts);
  END IF;

  FOR i IN 1..part_count LOOP
    INSERT INTO public.messages (session_id,direction,body,message_kind,provider,idempotency_key,in_reply_to_id,delivery_status,metadata,assistant_response)
    VALUES (inbound.session_id,'outbound',p->'parts'->(i-1)->>'body','paid_ai','twilio',CASE WHEN i=1 THEN physical_key ELSE physical_key || ':part:' || lpad(i::text,3,'0') END,inbound.id,'pending',jsonb_build_object('logical_reply_key',physical_key,'part_index',i,'part_count',part_count,'recovery_source_hash',source_hash,'recovery_body_hash',encode(digest(convert_to(p->'parts'->(i-1)->>'body','UTF8'),'sha256'),'hex'),'v2_logical_reply_key',p->>'logical_reply_key','eligible_response_binding',p->>'eligible_response_binding','approved_response_digest',source_hash,'v2_reservation_binding',computed_binding),p->>'approved_response_text');
  END LOOP;
  IF jsonb_typeof(p->'artifact_projection') = 'object' THEN
    artifact_input := jsonb_build_object('contract_version','1.0','artifact_id',p->'artifact_projection'->>'artifact_id','artifact_type',p->'artifact_projection'->>'artifact_type','generation_operation',p->'artifact_projection'->>'generation_operation','generation_task_id',p->'artifact_projection'->>'generation_task_id','logical_reply_key',physical_key,'anchor_message_id',(SELECT id FROM public.messages WHERE in_reply_to_id=inbound.id AND direction='outbound' AND metadata->'part_index'='1'::jsonb),'lineage',p->'artifact_projection'->'ordered_lineage_artifact_ids');
    SELECT * INTO persisted_artifact FROM public.persist_conversation_artifact(artifact_input);
  END IF;
  UPDATE public.messages SET processing_lease_until=NOW()+INTERVAL '5 minutes' WHERE id=inbound.id;
  SELECT jsonb_agg(jsonb_build_object('id',id,'body',body,'assistant_response',assistant_response,'idempotency_key',idempotency_key,'metadata',metadata,'delivery_status',delivery_status) ORDER BY (metadata->>'part_index')::integer) INTO result_rows FROM public.messages WHERE in_reply_to_id=inbound.id AND direction='outbound';
  RETURN jsonb_build_object('state','reserved_new','physical_logical_reply_key',physical_key,'messages',result_rows,'artifact_id',persisted_artifact.artifact_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_v2_approved_logical_reply(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_v2_approved_logical_reply(jsonb) TO service_role;
COMMENT ON FUNCTION public.reserve_v2_approved_logical_reply(jsonb) IS 'Ticket75D.1 Node-owned atomic v2 reservation: revalidates Ticket17 claim/FIFO, persists recovery-compatible multipart rows and optional Ticket17A metadata atomically.';
COMMIT;
