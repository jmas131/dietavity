# Ticket 28 deployment and controlled verification

Repository validation does not deploy or activate this change. During an approved deployment:

1. Back up the database and apply `database/migrations/20260827_ticket_28_portal_recovery.sql`.
2. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and optionally `PORTAL_RECOVERY_EMAIL_FROM` for the web service.
3. Deploy the web application.
4. Import `n8n/Dietavity Sales Engine (Ticket 10).json` and activate it only through the normal controlled workflow procedure. Keep the existing Global Error Handler association.
5. Do not use the rollback after customers have relied on recovery without first reviewing its consequences. It invalidates outstanding recovery links and cannot restore an already rotated portal token.

## Sandbox smoke test

Use only Stripe test mode, test email inboxes, and the approved test WhatsApp sender.

### Website customer

1. Complete a test website purchase and confirm that `users.email` contains the trimmed, lowercase Stripe Checkout email for that purchase's existing `users.id`.
2. Complete Setup and record the current test portal URL.
3. Submit the purchase email at `/recuperar-acceso`. Confirm the browser response is the same generic message used for an unknown email.
4. Open the email-owned Dietavity recovery link and confirm it redirects to a new `/p/<token>` URL.
5. Confirm the old portal URL returns 404, the new URL works, and opening the recovery email link again does not rotate the token a second time.

### WhatsApp customer

1. With a paid test website customer whose `whatsapp_id` is `NULL`, send `Perdí mi enlace` from the test WhatsApp identity.
2. Confirm the deterministic reply contains only a Dietavity initiation URL and instructions to use the purchase email; it must contain no email, WhatsApp number, user ID, Stripe ID, or portal token.
3. Enter the test purchase email, open the email verification link, and confirm portal access is restored and the test WhatsApp identity is linked.
4. Repeat with identities deliberately assigned to different test users. Confirm portal recovery still succeeds, neither identity is overwritten, and `whatsapp_link_status` records the conflict.

Also test unknown email, unpaid-only email, two paid users sharing one email, expired token, and reused token. None may issue or rotate portal access.
