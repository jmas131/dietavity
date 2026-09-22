# Ticket 42 — GLP-1 purchase-intent holding page

## Implementation

Public route: https://dietavity.com/programa-glp1, rendered by
`views/glp1-holding.ejs`. The body contains only the three approved lines.
The WhatsApp response is exactly:

> Claro 😊 Te comparto el siguiente paso:
> https://dietavity.com/programa-glp1

`glp1PurchaseHoldingResponse` in `lib/sales-engine-v3.js` overrides the
three authorized purchase decisions (explicit purchase and both contextual
confirmation branches), after existing safety/ambiguity checks and before
`Route Authorized Sales Action`. Only `glp1_validation` gets the override:
`pending_action=respond`, `checkout_authorized=false`, and a deterministic
holding-page response. NULL/generic context returns an empty override.

The normal response validator, response-state persistence, canonical outbound
reservation, Twilio delivery, memory and recovery paths handle that response.
The Checkout authorization, Stripe creation and Checkout-sent path are not entered.
No transport, recovery or production-memory behavior changes.

Existing `purchase_intent` evidence uses metadata
`offer_context=glp1_validation`, offer version `28d-149-v1`, and event key
`purchase_intent:<session_id>:glp1_validation:28d-149-v1`.
The existing partial unique event-key index deduplicates both retries and later
purchase requests. Session context persists and session offer version is retained
as `28d-149-v1`. No Checkout timestamp or purchase evidence is manufactured.
This milestone records intent, not proof of holding-page delivery; the messages
ledger remains delivery evidence. Repeated genuine inbound requests can receive
a reply through existing message idempotency rules.

The Ticket 41A harness reports `holding_page_would_be_sent=true` and
`checkout_would_be_created=false` on these turns. Its existing isolated response
state/final-memory path is used, without funnel writes. Generic purchase intent
continues through its existing Checkout interception.

## Files changed

- `lib/sales-engine-v3.js`
- `server.js`
- `views/glp1-holding.ejs`
- `scripts/refactor-ticket-10-workflow.js`
- `scripts/ticket-41-workflow.js`
- `scripts/generate-ticket-41a-chat-harness.js`
- `n8n/Dietavity Sales Engine (Ticket 10).json`
- `n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json`
- `test/ticket-41-glp1-canary.test.js`
- `test/ticket-42-glp1-holding.test.js`
- `test-support/run-ticket-41-postgres.js`
- This document

The canonical generator also rewrites the recovery poller deterministically;
no recovery source changes were made.

## Local validation

Focused policy, generated workflow/validator, harness and website suites:
57 passed, zero failures or skips. Isolated PGlite tests execute generated SQL
against schema-derived tables: 5 passed, including repeated GLP-1 intent,
metadata/context preservation, no Checkout authorization, and no Checkout-sent
or purchase-completed milestone.

Full canonical `node --test` result: 409 passed, 1 failed, zero skips.
The unrelated Ticket 37A snapshot assertion at
`test/ticket-37a-logical-reply-recovery.test.js:82` fails because
`database/schema.sql` does not contain the exact `RECOVERY_FUNCTIONS_SQL`
source string. Neither that schema nor recovery source was changed by this
ticket. This discrepancy remains unresolved; do not treat the full suite as green.
The workspace has no Git metadata, so a baseline Git diff is unavailable.

## Deployment (separate, explicitly authorized operation)

1. Review the change and the outstanding historical schema assertion.
2. Deploy the Express server and holding-page view first; verify GET
   `/programa-glp1` returns the approved copy and no controls.
3. Back up the currently deployed Sales Engine workflow. Regenerate with
   `node scripts/refactor-ticket-10-workflow.js` and
   `node scripts/generate-ticket-41a-chat-harness.js` if needed.
4. Import the canonical Ticket 10 workflow using existing credentials and runtime.
   The committed artifact is inactive; activation requires explicit authorization.
5. Optionally import the inactive Ticket 41A harness with its existing isolated
   test credentials. Validate GLP-1 and generic behavior.
6. This ticket requires no migration, Stripe configuration or fulfillment changes.
   Ticket 41's existing offer-context migration remains a prerequisite.

## Rollback

Restore the saved prior Sales Engine workflow only with explicit authorization.
This re-enables normal Checkout for GLP-1 prospects, so review fulfillment readiness
before doing so. Restore prior server/view/generator sources and regenerate matching
artifacts if reverting code. Keep the holding route available while previously
sent links may still be used. Preserve all intent events and canonical messages;
no data deletion or reverse migration is needed.

Nothing was deployed, imported, activated, or sent to customers automatically.
