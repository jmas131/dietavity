-- Additive campaign context; no backfill and no privilege changes.
BEGIN;
ALTER TABLE public.onboarding_sessions
  ADD COLUMN offer_context text,
  ADD CONSTRAINT onboarding_sessions_offer_context_check
    CHECK (offer_context IS NULL OR offer_context = 'glp1_validation');
COMMIT;
