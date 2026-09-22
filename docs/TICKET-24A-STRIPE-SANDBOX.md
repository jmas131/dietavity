# Ticket 24A: Stripe Sandbox Purchase Flow

`n8n/Dietavity Stripe Checkout Sandbox.json` is an inactive, standalone n8n workflow generated from the current canonical Sales Engine workflow. It copies the existing one-time purchase validation, Ticket 24 WhatsApp/website identity resolution, atomic purchase persistence, retry suppression, onboarding-state transition, and canonical WhatsApp Setup delivery.

The sandbox intentionally excludes the production Twilio inbound trigger, recurring-subscription handling, scheduled jobs, program-generation webhooks, and unrelated Sales Engine branches. Program creation remains in the existing post-purchase Setup flow, exactly as in production.

## Sandbox-only Stripe configuration

- Stripe trigger credential: `Stripe Account Sandbox`.
- Stripe line-item retrieval credential: `Stripe Account Sandbox`.
- Checkout Session authorization: `Bearer {{ $env.STRIPE_TEST_API_KEY }}`.
- Checkout and verified line-item Price: `price_1U1SvtCXkbpCbNJI0sAqDeQF`.
- The Stripe trigger has its own webhook identity and listens only for `checkout.session.completed`.

Credential IDs are intentionally omitted because the repository cannot know the receiving n8n instance's sandbox credential ID. Bind both Stripe nodes to the existing **Stripe Account Sandbox** credential after importing the workflow. Never bind a production Stripe credential or configure live-mode Stripe events for this workflow.

## Controlled sandbox execution

1. Import `Dietavity Stripe Checkout Sandbox.json` as a new, inactive workflow; do not replace or change the production Sales Engine workflow.
2. Verify that `STRIPE_TEST_API_KEY` is available to the n8n runtime and that both Stripe credential bindings use **Stripe Account Sandbox**.
3. Use an isolated test WhatsApp/onboarding session that already has a genuine `explicit` or `contextual` Checkout authorization, offer version `28d-149-v1`, and no existing Checkout Session.
4. Set `session_id` in **Sandbox Configure WhatsApp Checkout** to that normalized test WhatsApp identity. Its default is deliberately empty and fails closed.
5. Run **Sandbox Start Authorized WhatsApp Checkout** manually. The read-only authorization gate prevents unauthenticated, ambiguous, website-only, or already-issued Checkout requests from reaching Stripe.
6. Obtain the test Checkout URL from **Sandbox Message with Stripe Payment URL** and complete payment using Stripe sandbox mode. The manual branch does not send an unreserved WhatsApp message or bypass the canonical outbound ledger.
7. When the separately authorized sandbox Stripe trigger receives `checkout.session.completed`, verify that the purchase reuses the same WhatsApp user, duplicate events do not send another Setup message, and the existing canonical WhatsApp path delivers the Setup link.
8. Website-originated payment events retain Ticket 24's nullable `whatsapp_id` behavior and never reserve or send a WhatsApp Setup message.

Activation, webhook registration, provider configuration, customer-visible WhatsApp delivery, and all production changes require separate explicit operational authorization.

## Regeneration and validation

```bash
node scripts/refactor-ticket-24a-stripe-sandbox-workflow.js
node scripts/refactor-ticket-24a-stripe-sandbox-workflow.js --check
node --test test/ticket-24a-stripe-sandbox-workflow.test.js
npm test
```
