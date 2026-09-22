# Ticket 9 - Canonical WhatsApp Ledger and Twilio Idempotency

## Status and cutover boundary

The implementation is complete in the repository and intentionally does not modify production. Import `n8n/Dietavity Canonical Ledger (Ticket 9).json` inactive and follow the deployment procedure below. The exact activation timestamp and imported n8n version are the canonical-history cutover marker; record both in the deployment log. Rows before that marker remain partial even when `body` was reliably backfilled.

## 1. Final architecture

All real inbound Twilio messages now take one route:

`Twilio -> validate/normalize real SID -> INSERT inbound reservation -> user lookup -> known/unknown routing`

The insert uses `ON CONFLICT DO NOTHING`. A conflict returns no item from the Postgres node, so the duplicate execution cannot reach AI, Stripe, Twilio, or reminder scheduling. Known and unknown users therefore share the same gate.

Every customer-facing send follows:

`final body -> INSERT outbound reservation -> Twilio -> delivery update -> accepted assertion -> business-state update`

Only the reservation winner reaches Twilio. The legacy `Create Inbound Message` and `Create Outbound Message` nodes are absent from the Ticket 9 workflow, preventing parallel duplicate persistence.

## 2. Migration details

`20260814_ticket_9_canonical_message_ledger.sql` locks `messages` against concurrent structural writes, relaxes the legacy `user_message NOT NULL` requirement, adds canonical fields, backfills only unambiguous legacy content, adds checks and indexes, and reasserts Ticket 2 backend-only RLS/grants. It preserves all existing rows and columns.

Historical inbound `body` comes only from `user_message`; historical outbound `body` comes only from `assistant_response`. Historical SIDs, delivery states, Checkout bodies, and deterministic overrides are not fabricated. Historical delivery state is `unknown`.

## 3. Final messages schema

Legacy fields remain. Canonical additions are `session_id`, `body`, `message_kind`, `provider`, `provider_message_sid`, `idempotency_key`, `in_reply_to_id`, `delivery_status`, and `metadata`. `user_id` remains nullable for leads. The existing `messages.user_id -> users.id ON DELETE CASCADE` is retained deliberately: current account/ARCO deletion removes identifiable conversation history instead of silently retaining it for analytics.

`delivery_status` supports `received`, `pending`, `accepted`, `scheduled`, `failed`, and `unknown`, plus future callback states `sent`, `delivered`, and `undelivered`. `accepted` means provider API acceptance, never handset delivery.

## 4. Idempotency-key design

- Inbound: `inbound:<real Twilio SID>`
- Reply: `reply:<inbound Twilio SID>:<logical purpose>`
- Setup: `setup:<Stripe Checkout Session ID>`
- Legacy post-payment welcome/error: keyed by the Stripe event/session identity

The partial unique index on `idempotency_key` is the final concurrency authority. n8n execution IDs appear only in safe diagnostic metadata.

## 5. Provider SID uniqueness

The partial unique index is `(provider, provider_message_sid)` for non-null SIDs. Twilio Message resource SIDs are globally unique across inbound and outbound resources, so direction is intentionally excluded. Missing inbound SIDs fail closed; outbound SIDs are recorded only when they match a real `SM`/`MM` SID shape.

## 6. Inbound reservation behavior

The canonicalizer requires a normalized sender and real Twilio SID. It records text exactly after edge whitespace normalization, or a null body plus media metadata for non-text inbound events. The reservation sets `received`, resolves an existing `users.id` in the same SQL statement when possible, and returns no item on duplicate conflict.

## 7. Outbound reservation behavior

Reservations occur after all AI validation, deterministic substitution, fallback selection, or Checkout URL construction. They store the final body, `pending`, the inbound `in_reply_to_id` when applicable, a constrained kind, and small operational metadata. A reservation failure or conflict prevents the send.

The scheduled reminder reserves `TWILIO_SALES_REMINDER_CANONICAL_BODY`. Deployment must set this to the exact approved template content associated with `TWILIO_SALES_REMINDER_CONTENT_SID`; a mismatched value invalidates the canonical-content guarantee.

## 8. Twilio failure semantics

A valid SID produces `accepted`, or `scheduled` for a confirmed scheduled message. A definitive 4xx response produces `failed`. Missing/ambiguous acceptance evidence produces `unknown`. The intended row and body remain. Send nodes have retry disabled and continue only far enough to persist classification; the subsequent assertion raises the Global Error Handler. It never blindly resends. If Twilio accepted but the database update fails, execution stops after Twilio and requires reconciliation.

## 9. Anonymous-to-user linkage

Verified one-time purchase resolution updates matching `messages.user_id` rows where `session_id = whatsapp_id` and `user_id IS NULL`. It does not modify body, direction, timestamp, provider SID, or ordering. Funnel-event linkage remains separate.

## 10. Weekly Report cutover

The Weekly Report now reads ordered inbound/outbound `messages.body`, supports anonymous and known identities, and redacts Stripe Checkout URLs before analysis. It does not select provider SIDs or metadata. `onboarding_chat_memory` remains AI context only.

## 11. Privacy and deletion

Canonical logging increases stored personal conversation data but adds no profile/health payloads to metadata. The existing cascade is preserved to align with current deletion semantics. Ticket 9 does not invent a new retention period; confirming and documenting an explicit message-retention schedule remains a compliance follow-up.

## 12. Performance

Each inbound turn adds one reservation write. Each outbound send adds one reservation and one delivery update. Required indexes cover session/time, user/time, provider SID, and idempotency key. No additional synchronous read is used for duplicate prevention; uniqueness is enforced by PostgreSQL.

## 13. Exact files changed

- `.env.example.text`
- `database/dietavity-database-schema.sql`
- `database/migrations/20260814_ticket_9_canonical_message_ledger.sql`
- `database/preflight-ticket-9.sql`
- `database/rollback/20260814_ticket_9_rollback.sql`
- `n8n/Dietavity Canonical Ledger (Ticket 9).json`
- `n8n/Dietavity Weekly Report.json`
- `scripts/refactor-ticket-9-workflow.js`
- `test/ticket-9-canonical-message-ledger.test.js`
- `docs/TICKET-9-IMPLEMENTATION.md`
- `docs/TICKET-9-MANUAL-SANDBOX-TESTS.md`
- `docs/CHANGELOG.md`

## 14-15. Test results

Focused result: 13 passed, 0 failed, 0 skipped. Full repository result: 134 passed, 0 failed, 0 skipped. The focused suite statically verifies migration/backfill/security, real-SID enforcement, inbound and outbound reservation placement, Checkout ordering, failure states, anonymous linkage, reminder persistence, Weekly Report cutover, and graph integrity. The full suite includes Ticket 8/8D, paid assistant, cancellation, purchase, privacy/security, and application regression tests. Repeat `npm test` during deployment and record that environment's counts in the deployment log.

## 16. Deployment procedure

1. Back up the database and active n8n workflows.
2. Run `database/preflight-ticket-9.sql`; retain and review its output.
3. Apply `database/migrations/20260814_ticket_9_canonical_message_ledger.sql`.
4. Import the Ticket 9 workflow inactive. Bind existing Postgres, OpenAI, Stripe, and Twilio credentials.
5. Set and verify all Twilio reminder variables, including the exact canonical template body.
6. Import the updated Weekly Report inactive or pause its schedule during verification.
7. Run automated tests and every sandbox case in `TICKET-9-MANUAL-SANDBOX-TESTS.md`.
8. Disable Twilio ingress, deactivate the Ticket 8 workflow, activate Ticket 9, and restore ingress in one controlled window. Never leave two ingress workflows active.
9. Activate the updated Weekly Report.
10. Run the three live smoke tests using a fresh test lead and verify ledger rows directly with the service role.
11. Record activation time/version as the canonical cutover.

## 17. Rollback procedure

Disable ingress, deactivate Ticket 9, reactivate the backed-up Ticket 8 workflow, then restore ingress. Do not run two consumers. Use the rollback SQL to reassert backend-only security. Keep Ticket 9 columns, unique indexes, and legitimate rows: deleting them would destroy history and retry evidence. Pause the Weekly Report or restore its backed-up workflow if the application workflow is rolled back.

## 18. Remaining risks

- Live n8n error-item shapes and Twilio timeout behavior require sandbox verification; ambiguous results must land as `unknown`.
- The reminder canonical body is operational configuration and must remain byte-for-byte synchronized with the approved Twilio template.
- Full Twilio delivery callbacks are not implemented, so `accepted` is not proof of handset delivery.
- No reliable historical reconstruction exists before cutover.
- Production data may contain duplicate candidates; preflight review is mandatory.

## 19. Explicit follow-ups excluded from Ticket 9

The mixed purchase plus professional-responsibility routing bug remains out of scope, as do human nutritionist upsell, creator marketplace, AI-value objection redesign, broad prompt redesign, new personalization, a portal conversation-history UI, customer-visible delivery receipts, historical reconstruction from AI memory, and a new conversation table. Add a separate compliance issue to define message retention/deletion timing, and a later delivery-callback issue for `sent/delivered/undelivered` reconciliation.
