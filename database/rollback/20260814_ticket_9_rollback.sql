-- Ticket 9 non-destructive database rollback.
--
-- The previous workflows remain compatible because legacy columns are retained.
-- Do not drop Ticket 9 columns or indexes: doing so would destroy or weaken the
-- canonical history and duplicate-prevention guarantees accumulated after cutover.
-- Roll application behavior back by deactivating the Ticket 9 workflow and
-- reactivating the backed-up Ticket 8 workflow only after disabling Twilio
-- ingress to avoid two consumers. Canonical rows remain authoritative evidence.

BEGIN;

-- Reassert backend-only security during an application rollback.
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messages ON public.messages;
DROP POLICY IF EXISTS policy_messages ON public.messages;
REVOKE ALL ON TABLE public.messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.messages TO service_role;

COMMIT;

