-- Ticket 8: Sales Engine v3 operational context, append-only funnel events,
-- backend-only security, and the canonical 30-day program-start window.
-- Run the companion preflight query and retain its output before this migration.

BEGIN;

LOCK TABLE public.onboarding_sessions IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'onboarding_sessions'
      AND column_name = 'onboarding_state'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'onboarding_sessions'
      AND column_name = 'legacy_onboarding_state'
  ) THEN
    ALTER TABLE public.onboarding_sessions
      RENAME COLUMN onboarding_state TO legacy_onboarding_state;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.onboarding_sessions
    WHERE legacy_onboarding_state IS NOT NULL
      AND legacy_onboarding_state NOT IN (
        'lead', 'ask_subscription', 'subscription_deferred',
        'payment_pending', 'subscriber', 'closed'
      )
  ) THEN
    RAISE EXCEPTION 'TICKET_8_UNKNOWN_LEGACY_ONBOARDING_STATE';
  END IF;
END
$$;

ALTER TABLE public.onboarding_sessions
  ADD COLUMN IF NOT EXISTS conversation_stage text,
  ADD COLUMN IF NOT EXISTS goal text,
  ADD COLUMN IF NOT EXISTS last_question_type text,
  ADD COLUMN IF NOT EXISTS last_question_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_version text,
  ADD COLUMN IF NOT EXISTS commercial_context_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_authorization_type text,
  ADD COLUMN IF NOT EXISTS checkout_authorized_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_session_id text,
  ADD COLUMN IF NOT EXISTS checkout_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_message_sid text;

-- Historical anonymous onboarding state is not v3 commercial evidence. Start
-- these sessions in evaluation and explicitly discard every field that could
-- otherwise authorize or imply a current Checkout.
UPDATE public.onboarding_sessions AS session
SET conversation_stage = 'evaluating',
    last_question_type = NULL,
    last_question_at = NULL,
    offer_version = NULL,
    commercial_context_expires_at = NULL,
    checkout_authorization_type = NULL,
    checkout_authorized_at = NULL,
    checkout_session_id = NULL,
    checkout_sent_at = NULL
WHERE session.legacy_onboarding_state IN (
    'lead', 'ask_subscription', 'subscription_deferred', 'payment_pending'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.users AS app_user
    WHERE app_user.whatsapp_id = session.session_id
  );

-- A matching users row remains authoritative. Its historical onboarding state
-- is retained only in legacy_onboarding_state and cannot opt the known user in
-- to Sales Engine v3 or carry Checkout authority into it.
UPDATE public.onboarding_sessions AS session
SET conversation_stage = NULL,
    last_question_type = NULL,
    last_question_at = NULL,
    offer_version = NULL,
    commercial_context_expires_at = NULL,
    checkout_authorization_type = NULL,
    checkout_authorized_at = NULL,
    checkout_session_id = NULL,
    checkout_sent_at = NULL
WHERE EXISTS (
  SELECT 1
  FROM public.users AS app_user
  WHERE app_user.whatsapp_id = session.session_id
);

UPDATE public.onboarding_sessions AS session
SET conversation_stage = 'closed'
WHERE session.conversation_stage IS NULL
  AND session.legacy_onboarding_state = 'closed'
  AND NOT EXISTS (
    SELECT 1
    FROM public.users AS app_user
    WHERE app_user.whatsapp_id = session.session_id
  );

ALTER TABLE public.onboarding_sessions
  ALTER COLUMN conversation_stage SET DEFAULT 'new';

ALTER TABLE public.onboarding_sessions
  DROP CONSTRAINT IF EXISTS onboarding_sessions_conversation_stage_check,
  ADD CONSTRAINT onboarding_sessions_conversation_stage_check
    CHECK (
      conversation_stage IS NULL OR
      conversation_stage IN ('new', 'evaluating', 'offer', 'checkout_pending', 'closed')
    ),
  DROP CONSTRAINT IF EXISTS onboarding_sessions_last_question_type_check,
  ADD CONSTRAINT onboarding_sessions_last_question_type_check
    CHECK (
      last_question_type IS NULL OR
      last_question_type IN (
        'primary_goal', 'show_example', 'explain_offer',
        'purchase_confirmation', 'reminder_date'
      )
    ),
  DROP CONSTRAINT IF EXISTS onboarding_sessions_checkout_authorization_type_check,
  ADD CONSTRAINT onboarding_sessions_checkout_authorization_type_check
    CHECK (
      checkout_authorization_type IS NULL OR
      checkout_authorization_type IN ('explicit', 'contextual')
    ),
  DROP CONSTRAINT IF EXISTS onboarding_sessions_commercial_context_check,
  ADD CONSTRAINT onboarding_sessions_commercial_context_check
    CHECK (
      commercial_context_expires_at IS NULL OR
      (last_question_type = 'purchase_confirmation' AND last_question_at IS NOT NULL)
    ),
  DROP CONSTRAINT IF EXISTS onboarding_sessions_checkout_evidence_check,
  ADD CONSTRAINT onboarding_sessions_checkout_evidence_check
    CHECK (
      checkout_authorized_at IS NULL OR
      (checkout_authorization_type IS NOT NULL AND offer_version IS NOT NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_sessions_checkout_session_uidx
  ON public.onboarding_sessions (checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS onboarding_sessions_reminder_due_idx
  ON public.onboarding_sessions (reminder_scheduled_for)
  WHERE reminder_scheduled_for IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sales_funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_key text,
  buyer_signal text,
  topic text,
  strategy text,
  offer_version text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_funnel_events_type_check CHECK (event_type IN (
    'lead_started', 'meaningful_engagement', 'offer_presented',
    'purchase_intent', 'checkout_sent', 'purchase_completed',
    'setup_completed', 'program_ready', 'price_question',
    'payment_method_question', 'timing_objection', 'price_objection',
    'trust_objection', 'health_question', 'deferred_interest',
    'reminder_requested', 'reminder_sent', 'rejection'
  )),
  CONSTRAINT sales_funnel_events_buyer_signal_check CHECK (
    buyer_signal IS NULL OR buyer_signal IN (
      'information_request', 'positive_interest', 'question',
      'objection_price', 'objection_trust', 'objection_timing',
      'deferred_interest', 'explicit_purchase', 'contextual_affirmation',
      'ambiguous_acknowledgement', 'gratitude', 'rejection',
      'support_issue', 'other'
    )
  ),
  CONSTRAINT sales_funnel_events_strategy_check CHECK (
    strategy IS NULL OR strategy IN (
      'direct_purchase', 'purchase_confirmation', 'clarify',
      'answer_question', 'handle_objection', 'discovery', 'show_example',
      'explain_offer', 'deferred', 'reminder', 'graceful_close',
      'acknowledgement', 'conversational'
    )
  ),
  CONSTRAINT sales_funnel_events_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_funnel_events_event_key_uidx
  ON public.sales_funnel_events (event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_funnel_events_session_created_idx
  ON public.sales_funnel_events (session_id, created_at);

CREATE INDEX IF NOT EXISTS sales_funnel_events_user_created_idx
  ON public.sales_funnel_events (user_id, created_at);

CREATE INDEX IF NOT EXISTS sales_funnel_events_type_created_idx
  ON public.sales_funnel_events (event_type, created_at);

ALTER TABLE public.sales_funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_funnel_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sales_funnel_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sales_funnel_events TO service_role;

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

REVOKE ALL ON FUNCTION public.start_program_week_one(uuid, uuid, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_program_week_one(uuid, uuid, date, date)
  TO service_role;

COMMIT;
