BEGIN;

-- Existing UNIQUE (whatsapp_id) remains in place. PostgreSQL permits multiple
-- NULL values while continuing to reject duplicate non-NULL channel identities.
ALTER TABLE public.users
  ALTER COLUMN whatsapp_id DROP NOT NULL;

COMMIT;
