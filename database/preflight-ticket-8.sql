-- Read-only Ticket 8 deployment preflight. Save the result with the change record
-- before applying 20260811_ticket_8_sales_engine_v3.sql.

SELECT onboarding_state, COUNT(*) AS row_count
FROM public.onboarding_sessions
GROUP BY onboarding_state
ORDER BY onboarding_state;

SELECT
  session.onboarding_state,
  COUNT(*) FILTER (WHERE app_user.id IS NULL) AS unknown_leads,
  COUNT(*) FILTER (WHERE app_user.id IS NOT NULL) AS verified_users
FROM public.onboarding_sessions AS session
LEFT JOIN public.users AS app_user
  ON app_user.whatsapp_id = session.session_id
GROUP BY session.onboarding_state
ORDER BY session.onboarding_state;

-- Production snapshot reviewed on 2026-08-12. Every row must report "matches".
-- Any mismatch means stop and review the new distribution before migration.
WITH expected(onboarding_state, unknown_leads, verified_users) AS (
  VALUES
    ('lead'::text, 287::bigint, 0::bigint),
    ('ask_subscription', 48, 0),
    ('subscription_deferred', 8, 0),
    ('payment_pending', 49, 1),
    ('subscriber', 0, 1)
), actual AS (
  SELECT
    session.onboarding_state,
    COUNT(*) FILTER (WHERE app_user.id IS NULL) AS unknown_leads,
    COUNT(*) FILTER (WHERE app_user.id IS NOT NULL) AS verified_users
  FROM public.onboarding_sessions AS session
  LEFT JOIN public.users AS app_user
    ON app_user.whatsapp_id = session.session_id
  GROUP BY session.onboarding_state
)
SELECT
  COALESCE(expected.onboarding_state, actual.onboarding_state) AS onboarding_state,
  expected.unknown_leads AS expected_unknown_leads,
  COALESCE(actual.unknown_leads, 0) AS actual_unknown_leads,
  expected.verified_users AS expected_verified_users,
  COALESCE(actual.verified_users, 0) AS actual_verified_users,
  CASE
    WHEN expected.onboarding_state IS NOT NULL
      AND expected.unknown_leads = COALESCE(actual.unknown_leads, 0)
      AND expected.verified_users = COALESCE(actual.verified_users, 0)
      THEN 'matches'
    ELSE 'STOP_AND_REVIEW'
  END AS preflight_status
FROM expected
FULL OUTER JOIN actual USING (onboarding_state)
ORDER BY onboarding_state;

-- Preview the exact Ticket 8 migration outcome. Known users always bypass v3;
-- legacy subscriber without a user also remains outside v3 for manual review.
SELECT
  session.onboarding_state AS legacy_onboarding_state,
  (app_user.id IS NOT NULL) AS has_matching_user,
  CASE
    WHEN app_user.id IS NOT NULL THEN NULL
    WHEN session.onboarding_state IN (
      'lead', 'ask_subscription', 'subscription_deferred', 'payment_pending'
    ) THEN 'evaluating'
    WHEN session.onboarding_state = 'closed' THEN 'closed'
    ELSE NULL
  END AS projected_conversation_stage,
  COUNT(*) AS row_count
FROM public.onboarding_sessions AS session
LEFT JOIN public.users AS app_user
  ON app_user.whatsapp_id = session.session_id
GROUP BY session.onboarding_state, (app_user.id IS NOT NULL)
ORDER BY session.onboarding_state, has_matching_user;

SELECT
  COUNT(*) FILTER (WHERE stripe_checkout_session_id IS NULL) AS missing_checkout_ids,
  COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_purchases,
  COUNT(*) AS purchases
FROM public.purchases;
