-- Ticket 8 operational rollback. This intentionally preserves v3 columns and
-- sales_funnel_events for audit/recovery while restoring the legacy workflow's
-- required onboarding_state column and 7-day start-date contract.
-- Run only after deactivating Sales Engine v3.

BEGIN;

LOCK TABLE public.onboarding_sessions IN SHARE ROW EXCLUSIVE MODE;

UPDATE public.onboarding_sessions AS session
SET legacy_onboarding_state = COALESCE(
  session.legacy_onboarding_state,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.users WHERE users.whatsapp_id = session.session_id
    ) THEN 'subscriber'
    WHEN session.conversation_stage = 'checkout_pending' THEN 'payment_pending'
    WHEN session.conversation_stage = 'closed' THEN 'closed'
    ELSE 'lead'
  END
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'onboarding_sessions'
      AND column_name = 'legacy_onboarding_state'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'onboarding_sessions'
      AND column_name = 'onboarding_state'
  ) THEN
    ALTER TABLE public.onboarding_sessions
      RENAME COLUMN legacy_onboarding_state TO onboarding_state;
  END IF;
END
$$;

ALTER TABLE public.onboarding_sessions
  ALTER COLUMN onboarding_state SET DEFAULT 'lead',
  ALTER COLUMN onboarding_state SET NOT NULL;

CREATE OR REPLACE FUNCTION public.start_program_week_one(
  target_program_id uuid,
  target_user_id uuid,
  selected_start_date date,
  portal_today date
) RETURNS TABLE(
  program_id uuid,
  program_status text,
  start_date date,
  week_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_program programs%ROWTYPE;
  target_week weeks%ROWTYPE;
  activate_now boolean;
BEGIN
  IF selected_start_date < portal_today
     OR selected_start_date > portal_today + 7 THEN
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

REVOKE ALL ON FUNCTION public.start_program_week_one(uuid, uuid, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_program_week_one(uuid, uuid, date, date)
  TO service_role;

COMMIT;
