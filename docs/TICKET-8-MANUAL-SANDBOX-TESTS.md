# Ticket 8 manual sandbox tests

Use an isolated n8n development import, Stripe test mode, a test Supabase project restored from a scrubbed schema, a Twilio WhatsApp sandbox/test sender, and fake lead numbers. Do not activate the production workflow or send a real reminder.

## Prerequisites

1. Apply `database/migrations/20260811_ticket_8_sales_engine_v3.sql` to the test database.
2. Deploy the Ticket 8 application build to a sandbox URL.
3. Import `n8n/Dietavity Sales Engine v3 (Ticket 8).json`; leave it inactive until credentials and test triggers are isolated.
4. Configure Stripe test credentials and verify that the configured Price represents MXN 149.00, one-time payment.
5. Configure a Twilio Messaging Service containing the WhatsApp test sender and an approved test reminder template. Set `TWILIO_ACCOUNT_SID`, `TWILIO_MESSAGING_SERVICE_SID`, and `TWILIO_SALES_REMINDER_CONTENT_SID` in the n8n sandbox.
6. Record an inbound Twilio CTWA payload from the actual test integration before deciding whether attribution fields can be retained. Do not synthesize campaign fields.

## Sales matrix

| Case | Lead message/context | Expected result |
|---|---|---|
| Generic lead | `Hola, quiero más información.` | Discovery with one goal question; no Checkout; `lead_started`; no `meaningful_engagement` yet. |
| Goal supplied | `Quiero comer más saludable.` | Relevance response; do not ask the goal again; offer one illustrative example. |
| Example context | Reply `Sí.` after `show_example` | One illustrative breakfast/lunch/dinner/snack day; marked non-personalized; no Checkout. |
| Offer context | Reply `Sí.` after a current purchase confirmation | One Stripe test Checkout; explicit contextual evidence; no question in link message. |
| Weak acknowledgement | Reply `Ok.` or `Perfecto.` after purchase confirmation | No Checkout; one clarification question. |
| Expired context | Reply `Sí.` more than 30 minutes after purchase confirmation | No Checkout; safe clarification. |
| Explicit purchase | `Mándame el enlace para pagar.` | One Stripe test Checkout without redundant discovery. |
| Material question + intent | `Sí quiero comprarlo, pero ¿aceptan OXXO?` | Accepted-method answer first; no Checkout this turn; at most one confirmation question. |
| Price | `¿Cuánto cuesta?` | `$149 MXN`, one payment, direct answer. |
| Unsupported provider | `¿Aceptan PayPal?` | State only credit card, debit card, OXXO, and Apple Pay; do not maintain a rejection list. |
| Sensitive health | `Tengo diabetes, ¿me sirve?` | Accurate scope/Setup explanation, no diagnosis, no forced purchase CTA. |
| AI identity | `¿Usan IA? ¿Un nutriólogo hace mi plan?` | Clearly disclose AI support; do not imply individual human-nutritionist authorship. |
| Price objection | `Se me hace caro.` | Direct factual response; no invented discount, urgency, guarantee, or required CTA. |
| Deferred | `Estoy de viaje, regreso en dos semanas.` | Natural timing response; no proactive reminder. |
| Think | `Déjame pensarlo.` | No pressure, no question required, no reminder. |
| Explicit reminder | `Recuérdame en dos semanas.` | Exactly one Twilio scheduled Message using the approved Content SID; one `reminder_requested` event. |
| Unclear reminder | `Recuérdame después.` | One date clarification question; no scheduled Message. |
| Duplicate reminder | Repeat explicit request while one is active | Do not create a second active reminder. |
| Rejection | `No gracias.` | Graceful close, no question, CTA, Checkout, or reminder. |
| Gratitude | `Gracias.` | Short acknowledgement; no side effect. |

## Post-purchase and funnel verification

1. Complete one Stripe test Checkout and replay the same verified webhook. Confirm one purchase and one `purchase_completed:<checkout_session_id>` event.
2. Confirm the pre-purchase `session_id` is present on the purchase milestone and that prior session events receive the resolved `user_id`.
3. Complete Setup with consent. Confirm one `setup_completed:<user_id>:2026-08-11` event and no profile, allergy, medical, prompt, response, or portal-token data in funnel metadata.
4. Let Week 1 reach the existing Ticket 3 ready condition. Confirm one `program_ready:<program_id>:<week_id>` event.
5. In the portal, accept today and day 30; reject yesterday and day 31.
6. Verify a known paid user still routes to portal/program/recipe/meal/restaurants/advice handling and cannot enter Sales Engine v3.
7. Verify a one-time purchaser cannot reach Stripe subscription cancellation; verify the Ticket 6 legacy test account can use its persisted-ID cancellation gate without deleting history.

## Failure tests

- Force AI interpretation to return invalid JSON: no Checkout or reminder.
- Force Stripe session creation failure: no link and no `checkout_pending` transition.
- Force Twilio Checkout message failure: retain session evidence but do not emit `checkout_sent` or mark `checkout_pending`.
- Remove the reminder Content SID or Messaging Service SID: scheduling fails and the user is not told it succeeded.
- Force funnel persistence failure at purchase/Setup/readiness milestones and confirm the execution fails visibly through the Global Error Handler.
