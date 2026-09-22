BEGIN;

CREATE OR REPLACE FUNCTION public.persist_setup_completed_event(
  target_session_id text,
  target_user_id uuid,
  target_event_key text
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
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

REVOKE ALL ON FUNCTION public.persist_setup_completed_event(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_setup_completed_event(text, uuid, text)
  TO service_role;

COMMIT;
