# Ticket 28A deployment and controlled verification

This repository change does not deploy, migrate, import, or activate production systems.

During an approved deployment, apply `database/migrations/20260827_ticket_28a_pending_whatsapp_linking.sql` after the Ticket 28 migration, deploy the web application, and import the inactive generated `n8n/Dietavity Sales Engine (Ticket 10).json` through the normal controlled workflow process. Preserve its existing Global Error Handler configuration.

Ticket 17 remains the message-ordering authority. Verification completion marks the original canonical inbound rows eligible again; the workflow's one-minute wake-up checks those rows and passes each session into `Claim Next Session Inbound`. That claim always selects `processing_order, id`, so multiple verified requests resume chronologically and the existing outbound idempotency keys prevent duplicate paid-assistant replies.

## Sandbox smoke test

Use only paid Stripe test-mode users, test inboxes, and an approved test WhatsApp sender.

1. Start with a paid website customer whose normalized Stripe email is present and whose `whatsapp_id` is `NULL`. Record the current `portal_token`.
2. From the test WhatsApp identity, send `¿Me das la receta de mi comida?`. Confirm the deterministic response contains an opaque Dietavity verification URL and no email, WhatsApp number, user ID, Stripe ID, portal token, or pending message text.
3. Send a second clear paid-context request before verifying. Confirm no second active verification credential is created and both inbound messages remain in the canonical ledger.
4. Enter the purchase email, open the email verification link, and confirm `users.whatsapp_id` is linked while the recorded `portal_token` remains unchanged.
5. Confirm the original requests are answered by the existing paid assistant in canonical order without asking the customer to repeat them. Refresh the verification page and confirm no answer is duplicated.
6. Send another paid request from the now-linked identity and confirm it goes directly to the known-customer path.
7. Repeat with an unknown identity asking `¿Cuánto cuesta?` and `¿Me das una receta de pollo?`; both must retain existing prospect behavior without verification.
8. Test a duplicate paid email and both WhatsApp conflict directions. Confirm no identity is overwritten, no request resumes as the wrong customer, and the customer sees only the generic support-safe result.
9. Re-run Ticket 28 portal recovery and confirm it still rotates the portal token, unlike ordinary linking.

The rollback file restores Ticket 28-only recovery behavior. Review pending verification state before using it because rollback intentionally removes Ticket 28A continuation metadata.
