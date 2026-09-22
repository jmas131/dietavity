-- Operator-run cleanup only. Never called by the chat workflow.
-- Stop sending harness turns before running this transaction.
-- These are namespaced test keys, NOT the corresponding real WhatsApp numbers.
BEGIN;
DELETE FROM public.onboarding_chat_memory
WHERE session_id IN ('ticket41a:+5215554111111', 'ticket41a:+5215554222222');
DELETE FROM public.onboarding_sessions
WHERE session_id IN ('ticket41a:+5215554111111', 'ticket41a:+5215554222222');
COMMIT;
