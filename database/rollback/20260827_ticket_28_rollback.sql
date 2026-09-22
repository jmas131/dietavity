BEGIN;

-- This destructive rollback removes stored recovery email and invalidates all
-- outstanding recovery links. It does not restore portal credentials already
-- rotated, undo safe WhatsApp links, or merge users. Export data first if any
-- part of that history must be retained.
DROP FUNCTION IF EXISTS public.redeem_portal_recovery(text, text);
DROP FUNCTION IF EXISTS public.create_portal_recovery_request(text, text, timestamptz, text);
DROP TABLE IF EXISTS public.portal_recovery_requests;
DROP TABLE IF EXISTS public.portal_recovery_initiations;
DROP INDEX IF EXISTS public.users_email_recovery_idx;
ALTER TABLE public.users DROP COLUMN IF EXISTS email;

ALTER TABLE public.messages DROP CONSTRAINT messages_message_kind_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_message_kind_check CHECK (
  message_kind IS NULL OR message_kind IN (
    'user', 'sales_ai', 'sales_deterministic', 'checkout', 'paid_ai',
    'paid_deterministic', 'fallback', 'customer_error', 'setup_link',
    'welcome', 'reminder_confirmation', 'reminder_scheduled',
    'media_clarification', 'legacy_cancellation'
  )
);

COMMIT;
