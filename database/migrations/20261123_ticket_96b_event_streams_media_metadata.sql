BEGIN;

-- Event Streams identifies an inbound attachment by account/message SID but
-- deliberately omits a webhook MediaUrl. Retain both the deployed legacy
-- descriptor and the new identifier-only form so pending work can recover.
CREATE OR REPLACE FUNCTION public.persist_media_enrichment(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF jsonb_typeof(p) <> 'object'
    OR p->>'inbound_message_id' !~ '^[0-9a-fA-F-]{36}$'
    OR length(COALESCE(p->>'processing_owner','')) > 160
    OR jsonb_typeof(p->'enrichment') <> 'object'
    OR p->'enrichment' ?| ARRAY['url','base64','bytes']
    OR p->'enrichment'->>'kind' NOT IN ('image','audio')
    OR length(trim(COALESCE(p->'enrichment'->>'text',''))) NOT BETWEEN 1 AND 1200
  THEN RAISE EXCEPTION 'TICKET_96B_ENRICHMENT_INVALID'; END IF;

  SELECT m.metadata->'media_enrichment' INTO result FROM public.messages m
  WHERE m.id = (p->>'inbound_message_id')::uuid FOR UPDATE;
  IF result IS NOT NULL AND result->>'status' = 'complete'
    AND result->>'kind' IN ('image','audio')
    AND length(trim(COALESCE(result->>'text',''))) BETWEEN 1 AND 1200
  THEN RETURN result; END IF;
  IF result IS NOT NULL THEN RAISE EXCEPTION 'TICKET_96B_ENRICHMENT_CONFLICT'; END IF;

  UPDATE public.messages AS m SET metadata = m.metadata || jsonb_build_object(
    'media_enrichment', jsonb_build_object('status', 'complete', 'kind', p->'enrichment'->>'kind', 'text', p->'enrichment'->>'text', 'completed_at', now())
  )
  WHERE m.id = NULLIF(p->>'inbound_message_id','')::uuid
    AND m.direction = 'inbound' AND m.processing_owner = p->>'processing_owner'
    AND m.processing_completed_at IS NULL
    AND m.processing_lease_until > now()
    AND jsonb_array_length(COALESCE(m.metadata->'attachments','[]'::jsonb)) = 1
    AND (
      (
        (m.metadata->'attachments'->0->>'account_sid') ~ '^AC[0-9a-fA-F]{32}$'
        AND m.metadata->'attachments'->0->>'provider_message_sid' = m.provider_message_sid
        AND m.metadata->'attachments'->0->>'ordinal' = '0'
      )
      OR (
        (m.metadata->'attachments'->0->>'provider_message_sid') = m.provider_message_sid
        AND (m.metadata->'attachments'->0->>'content_type') LIKE CASE WHEN p->'enrichment'->>'kind' = 'image' THEN 'image/%' ELSE 'audio/%' END
      )
    );
  IF NOT FOUND THEN RAISE EXCEPTION 'TICKET_96B_ENRICHMENT_STALE_OR_CONFLICT'; END IF;
  SELECT metadata->'media_enrichment' INTO result FROM public.messages WHERE id = NULLIF(p->>'inbound_message_id','')::uuid;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.persist_media_enrichment(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_media_enrichment(jsonb) TO service_role;

COMMENT ON COLUMN public.messages.metadata IS
  'Canonical operational metadata. Ticket 96B stores only Twilio media identifiers and derived text; never binary, Base64, credentials, or full media URLs.';

COMMIT;
