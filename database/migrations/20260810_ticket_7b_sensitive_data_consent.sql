-- Ticket 7B: persist evidence of express sensitive-data consent with the
-- canonical structured profile collected during Setup.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sensitive_data_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_notice_version text;

COMMIT;
