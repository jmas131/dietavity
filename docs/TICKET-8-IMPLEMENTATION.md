# Ticket 8 implementation report

## Status and scope

Sales Engine v3 is implemented as an inactive canonical n8n import plus development database/application artifacts. Production was not modified or activated. The replacement begins at the unknown-user output of `If Identify User State` and ends at the existing one-time Stripe Checkout boundary. Known users still enter the Ticket 5 assistant. Verified Stripe fulfillment, purchases, Setup/consent, program initialization, portal readiness, and Ticket 6 cancellation remain the surrounding contracts.

The repository implementation revealed one product discrepancy: the portal and `start_program_week_one` function allowed only today through day 7. Ticket 8 requires today through day 30. `server.js`, the checked-in schema, and the Ticket 8 migration now explicitly enforce day 30; day 31 is rejected.

## Architecture

The final lead path is:

```text
Twilio ingress → known/unknown routing → load/create v3 session
→ AI buyer-signal interpretation → strict JSON parser
→ deterministic commercial policy → one strategy/action
→ response generation OR authorized Checkout OR authorized reminder
→ infrastructure result validation → operational state/funnel persistence
```

Durable conversation stages are `new`, `evaluating`, `offer`, `checkout_pending`, and `closed`. Per-turn buyer signals are `information_request`, `positive_interest`, `question`, `objection_price`, `objection_trust`, `objection_timing`, `deferred_interest`, `explicit_purchase`, `contextual_affirmation`, `ambiguous_acknowledgement`, `gratitude`, `rejection`, `support_issue`, and `other`. They are funnel/event data, not durable session states.

Response strategies are `direct_purchase`, `purchase_confirmation`, `clarify`, `answer_question`, `handle_objection`, `discovery`, `show_example`, `explain_offer`, `deferred`, `reminder`, `graceful_close`, `acknowledgement`, and `conversational`. Consequential pending actions are restricted to `send_checkout`, `schedule_requested_reminder`, and `close`; ordinary turns use `respond`.

Removed/replaced lead nodes include `Build Welcome Prompt`, `Build Pitch Prompt`, all subscription-decision/short-closing/payment-pending sales prompt builders, generic affirmative/negative/thank-you detectors, the exact CTA detector, the `ask_subscription`/`subscription_deferred` writers, and `Set Payment Pending`. The LLM no longer drives a state change by emitting CTA text.

### Checkout authorization

Only the `send_checkout` output of `Route Authorized Sales Action` can reach `Persist Checkout Authorization v3` and then `Add whatsapp_id`/Stripe. Authorization requires either:

- `direct_purchase`: AI classification plus a separate deterministic phrase check for a present unambiguous buy/pay/link request; or
- `purchase_confirmation`: a strong `sí`, `sí quiero`, `claro`, or `adelante` answering `last_question_type=purchase_confirmation`, using `28d-149-v1`, within both the persisted expiry and 30 minutes.

`ok`, `okay`, `perfecto`, `vale`, and `listo` never authorize Checkout. `show_example + sí` shows an example; `explain_offer + sí` explains the offer. A material payment, price, start, refund, health, privacy, or product-scope question overrides purchase intent and is answered first. Invalid AI output, unknown strategy, missing/expired context, or conversational fallback cannot reach Checkout.

Ordering is authorization persistence → Stripe Session → Session-ID evidence → Checkout URL send → `checkout_pending`/`checkout_sent`. A failed Stripe creation cannot produce link copy; a failed send cannot claim `checkout_pending`.

### Reminder authorization

No deferred-interest message schedules contact. Scheduling requires `explicit_reminder_request=true`, a resolvable ISO time between Twilio's supported 15-minute and 35-day bounds, and no active future reminder. The workflow creates exactly one scheduled Twilio Message using `ScheduleType=fixed`, `MessagingServiceSid`, `SendAt`, and an approved `ContentSid`; it sends no proactive free-form Body. It acknowledges success only after Twilio returns `status=scheduled` and a valid Message SID. No second follow-up is created.

Deployment must provide an approved template in `TWILIO_SALES_REMINDER_CONTENT_SID` and a WhatsApp-enabled `TWILIO_MESSAGING_SERVICE_SID`. Twilio documents the scheduling requirements and approved-template behavior in [Message Scheduling](https://www.twilio.com/docs/messaging/features/message-scheduling).

## Database

`onboarding_sessions` gains current v3 operational fields: `conversation_stage`, optional short `goal`, question type/time, offer/expiry, Checkout authorization/session/send evidence, and reminder request/schedule/Message SID. The historical `onboarding_state` is renamed to `legacy_onboarding_state`, not discarded.

Production preflight found 287 `lead`, 48 `ask_subscription`, 8 `subscription_deferred`, and 49 of 50 `payment_pending` sessions without matching users. Those anonymous historical rows all map to `evaluating`, with question/offer/commercial-context and Checkout authorization/session/send fields explicitly cleared. Anonymous `closed` remains `closed`; an anomalous anonymous `subscriber` remains null for review. Every session with a matching `users.whatsapp_id` remains null regardless of legacy state, so known-user routing—not historical onboarding state—stays authoritative. This includes the matched historical `payment_pending` and `subscriber` rows. `legacy_onboarding_state` is always retained, and unknown historical values abort the migration.

`database/preflight-ticket-8.sql` records the reviewed production counts and reports `STOP_AND_REVIEW` for any mismatch or additional state before migration. The migration must not be applied unless every snapshot row matches or a changed distribution receives a new review.

`sales_funnel_events` is append-oriented with UUID ID, optional lead `session_id`, optional resolved `user_id`, constrained event type/buyer signal/strategy, topic, offer version, JSON metadata, timestamp, and a partial unique `event_key`. Indexes support event-key idempotency and session/user/type timelines. RLS is enabled and forced; PUBLIC, anon, and authenticated receive no access; service role retains backend access.

The migration preserves Ticket 2 security and redefines the security-definer start RPC with the same service-role-only execution grant. Funnel metadata is structured business telemetry only.

## Canonical prompts and facts

`lib/dietavity-knowledge.js` is the repository source for Role & Identity, the `$149 MXN` one-time 28-day offer, payment methods, 30-day start rule, food philosophy, meal rules, medical/scope boundaries, and deterministic commercial facts. `Build Canonical Dietavity Knowledge` injects it into sales response generation. The workflow generator applies the same canonical identity/philosophy/rules to the paid-user nutrition model, ad-hoc recipes/ideas, meal regeneration, Week 1/week updates, and meal swaps.

Task-specific roles remain intentional: sales interpretation classifies only; the paid assistant treats the portal as source of truth; meal generators retain their JSON/schema/nutritional task constraints. None redefines Dietavity as a human nutritionist. Meal prompts explicitly allow Mexican/Latin American, Mediterranean, Japanese, Nordic, and general compatible meals while neither forcing foreign cuisine nor artificially Mexicanizing everything.

The repository contains no finalized public refund policy. The response contract forbids invention and directs uncertain cases to support. No discount, guarantee, medical, legal, payment-provider, or sales policy was added.

## Funnel definitions and emission points

| Event | Definition and emitter | Idempotency key |
|---|---|---|
| `lead_started` | First genuinely new unknown session; `Initialize Sales Lead v3`. | `lead_started:<session_id>` |
| `meaningful_engagement` | First substantive turn beyond generic/prefilled inquiry; response/action persistence. | `meaningful_engagement:<session_id>` |
| `offer_presented` | Canonical priced offer was actually sent. | `offer_presented:<session_id>:28d-149-v1` |
| `purchase_intent` | Valid explicit/contextual authorization persisted before Stripe. | `purchase_intent:<session_id>:<Twilio message SID>` |
| `checkout_sent` | Stripe Session exists and Twilio accepted the URL message. | `checkout_sent:<checkout_session_id>` |
| `purchase_completed` | Verified paid purchase transaction. | `purchase_completed:<checkout_session_id>` |
| `setup_completed` | Required profile/consent persisted and Setup reaches success. | `setup_completed:<user_id>:<privacy version>` |
| `program_ready` | Existing Ticket 3 semantics: personalization program, planned Week 1, persisted meal plan. | `program_ready:<program_id>:<week_id>` |

Limited secondary events cover price/payment questions, objections, health question, deferral, reminder request, and rejection. Gratitude/food words are not events. Purchase persistence links all prior same-session funnel rows to the resolved `user_id`, while keeping `session_id`, so the pre/post-purchase journey does not rely on mutable onboarding state.

## Meta / CTWA attribution finding

The canonical Twilio trigger and repository code demonstrably consume `data.from`, `data.body`, and `data.numMedia`; the ticket audit/repository contains no captured real CTWA trigger payload and no verified referral, campaign, ad-set, ad, click-ID, source URL, or equivalent mapping. Therefore Ticket 8 stores no speculative Meta fields. Capture and review a real sandbox/production-equivalent CTWA payload before adding a small verified metadata mapping in a later controlled change.

## Verification and manual work

Automated coverage includes all required authorization acceptance/rejection cases, conversation strategies, reminder isolation/deduplication, funnel milestones/linkage/privacy, shared identity/localization contracts, 30-day start boundaries, workflow parsing/connections/reachability, backend-only security, the linkage-aware legacy migration, and Tickets 1–7C regressions. The complete canonical `node --test` run passed 108 tests with 0 failures. The final structural audit parsed the inactive workflow, compiled every Code node, verified 133 unique nodes and 111 connection sources, found no dangling connections or missing required v3 nodes, and confirmed the rollback artifact hash exactly matches the Ticket 6 canonical workflow.

Manual sandbox execution remains mandatory for real n8n node semantics, OpenAI phrasing, Stripe test Checkout, Twilio scheduled-template acceptance, webhook retry, actual CTWA payload capture, credentials/environment, and end-to-end lead → ready linkage. Use `docs/TICKET-8-MANUAL-SANDBOX-TESTS.md`.

## Deployment order

1. Export and retain the currently deployed n8n workflow and database backup.
2. Run `database/preflight-ticket-8.sql`; review state counts and user linkage. Stop if unexpected states exist.
3. Create/approve the WhatsApp reminder template and configure sandbox/production secrets without committing SIDs or tokens.
4. Apply `database/migrations/20260811_ticket_8_sales_engine_v3.sql`.
5. Deploy the application build containing the 30-day rule and Setup funnel emission.
6. Import `n8n/Dietavity Sales Engine v3 (Ticket 8).json` as inactive; bind existing Supabase/Postgres/OpenAI/Stripe/Twilio credentials and verify the Global Error Handler.
7. Run the complete manual sandbox matrix with Stripe test mode and fake leads.
8. In a controlled window, deactivate the old lead workflow, activate v3, run smoke tests, and monitor errors/funnel keys. Never run both ingress workflows simultaneously.

## Rollback

1. Deactivate v3 immediately; do not delete its execution history or funnel records.
2. Import/activate `archive/Dietavity live 2.5.1 pre-ticket-8.json` using the prior credentials.
3. Deploy the prior application build.
4. Apply `database/rollback/20260811_ticket_8_rollback.sql` to restore the old `onboarding_state` contract and 7-day RPC while intentionally retaining v3 telemetry/columns for audit and recovery.
5. Smoke-test known-user routing, old lead response, verified payment, Setup, and Ticket 6 cancellation.

The rollback maps new unpaid sessions conservatively to legacy `lead`, v3 Checkout sessions to `payment_pending`, closed sessions to `closed`, and sessions with verified users to `subscriber`. This is a recovery mapping, not a claim that old conversation meaning can be reconstructed exactly.

## Remaining risks and assumptions

- The 2026-08-12 live onboarding-state distribution is encoded in the preflight as a hard deployment gate; any subsequent drift requires review before migration.
- Actual CTWA attribution availability is unknown until a real payload is captured.
- Reminder template approval, Messaging Service sender-pool membership, environment SIDs, scheduling entitlements, and send-time template validation require manual Twilio verification.
- Accepted payment method copy follows Ticket 8. The repository proves the Stripe Price/amount and one-time mode, but dynamic payment-method availability (OXXO/Apple Pay by device/account/session) requires a Stripe sandbox/Console check before launch.
- Refund policy remains unresolved/unpublished in canonical repository artifacts; the system does not invent one.
- Generated Spanish remains probabilistic. A validator limits questions and blocks obsolete subscription/price claims; manual sensitive/multi-intent phrasing review is still required.
