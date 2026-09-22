BEGIN;

-- Rollback is safe only after every website-originated customer has been
-- associated with a real, unique WhatsApp identity through an approved flow.
-- PostgreSQL rejects SET NOT NULL if any NULL remains; never fabricate channel
-- identities or delete customer, purchase, program, or profile history.
ALTER TABLE public.users
  ALTER COLUMN whatsapp_id SET NOT NULL;

COMMIT;
