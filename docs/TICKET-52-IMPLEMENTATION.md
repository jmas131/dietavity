# Ticket 52 — Current-turn question precedence

Recognized current product questions now establish the deterministic signal and primary topic before stale commercial interpretation can replace them. Actual current AI-value objections, medical safety, support, reminder requests, billing ambiguity and authorized purchase routing retain their existing precedence. Generic initial discovery and referential questions such as “¿Y cómo funciona eso?” preserve their established behavior.

The final validator retains relevant generated answers and repairs missing recognized question coverage using existing canonical facts. Invoice and fulfillment uncertainty use the existing uncertainty answers. No product facts, provider actions, database changes or purchase authorization mechanisms were added. Ticket 50 combined purchase/question routing and Ticket 42 GLP-1 boundaries remain intact.

## Reproduction and limitation

Before editing, `¿Cómo funciona?` and `¿Quién crea el plan?` with purchase-confirmation/checkout-pending history and a stale `post_purchase` interpretation produced `answer_question` with the stale `post_purchase` topic and no deterministic current answer. The gap spans deterministic topic selection and single-topic final validation; fulfillment already had specific protection.

The initial ticket omitted the exact incident. The subsequently supplied `context_switching_001-output.json` now supplies exact regression evidence; see the live-incident follow-up below. The earlier model-boundary fixture remains separate from that evidence.

## Diagnostics and validation

Both harnesses expose current explicit topics, final covered/missing topics, and `historical_state_used_for_intent`. The latter describes intent resolution, not whether historical state remains available for safety, offer context or idempotency.

- New Ticket 52 suite: 8 tests pass, including a matrix over two generated artifacts, two commercial stages, generic/GLP-1 context and five stale classifier signals.
- Full serial suite: 572 tests, 571 pass, 1 fails, zero skipped. Tickets 42 and 44–51 pass.
- The sole failure is the pre-existing Ticket 37A schema/source synchronization assertion at `test/ticket-37a-logical-reply-recovery.test.js:82`, also documented before this ticket. Database files and that test were not modified.
- Both generated harness consistency checks pass. Sales Engine and both harness artifacts were regenerated and remain inactive.
- `outputs/ticket-52/scenario-g-fixture.json` records the existing Scenario G model-boundary fixture with coverage diagnostics. It is synthetic, not live AI or market evidence. No live runtime acceptance is claimed.

## Deployment

No production operation was performed. Deploying the regenerated canonical Sales Engine is a separate authorized operation. There is no migration. The exact supplied incident is verified by deterministic replay below. No new live run was performed.


## Exact live-incident follow-up

Source: user-provided `context_switching_001-output.json`, run `38782`, recorded September 20, 2026. The source is a live-model synthetic harness run, labeled “Synthetic outcome - not market evidence”; it is not evidence of messages sent to real customers. The export lacks its final outer-array `]`. Only that missing bracket was appended for extraction; the original byte SHA-256 is retained in `test-support/ticket-52/scenario-g-live-incident.json`.

The primary incident is turn 9:

> ¿Cuánto tiempo tardan en generar el plan personalizado después del pago, y hay límite de mensajes/consultas por WhatsApp durante los 28 días?

The preceding visible turn concerns support, allergy substitutions and OXXO/card payment. The actual saved state is `evaluating`, with goal `see an example meal plan`, no last actionable question and no purchase-confirmation timestamps. No purchase-confirmation state was invented. The fixture includes all eight preceding visible exchanges, the complete preceding turn, and exact incident turns 9–12 with generated drafts, final responses, parsed interpretations, diagnostics, assertions, timestamps and `session_before`.

The archived `outputs/ticket-51/inactive-scenario-g-harness.json` embeds the Sales Engine SHA-256 recorded by the live report: `9e7ee97b4f55df72f29d7c20a4964e691f05e7e5050e6cf0131f564887c21caf`. The replay executes that archived harness directly, without rebuilding it using current policy or helpers. Its four replayed final responses match the live output exactly; checked diagnostics include the topic, strategy, generated draft, deterministic response/fallback, final validated response, fallback identity, extracted topics, coverage and warnings.

Current replay uses the current canonical artifact and the same adapter, recorded state, preceding final-only transcript, timestamp and generated draft. The report preserves parsed interpretation, not the raw classifier envelope; that interpretation is re-enveloped and passed through the canonical parser. Each turn is replayed independently from its recorded state so fixed earlier replies cannot change the test input for later turns. No fresh model calls or judge results are fabricated.

### Exact failure and authorized correction

Before further production-source edits, the exact regression yielded **4 baseline reproduction passes and 4 current-artifact failures** (`outputs/ticket-52/exact-incident-before-fix.log`). This satisfied the user's condition allowing logic changes only if the exact regression failed.

The initial Ticket 52 fix did not recognize plural/infinitive fulfillment timing (“tardan”, “suelen tardar”), message/consultation limits, or “tiempo estimado de respuesta”. Existing coverage diagnostics therefore missed omitted questions. The broad post-28-day matcher also interpreted a plan mentioned before “después del pago” as renewal, producing an unrelated deterministic answer even where multi-topic validation later replaced it.

The narrow correction expands timing extraction, recognizes support limits with explicit canonical uncertainty, recognizes estimated response-time wording, and prevents fulfillment timing from entering the renewal branch unless the current turn also explicitly asks about post-program continuation. Existing canonical answers remain authoritative; no timing commitment or unlimited-message claim was added. The policy, shared response contract and knowledge source were updated and the canonical Sales Engine and both harnesses regenerated inactive. The archived baseline was not changed.

### Final results

- Ticket 52 focused: **18 passed, 0 failed, 0 skipped**.
- Full serial suite: **582 tests, 581 passed, 1 failed, 0 skipped**.
- Sole failure: the same pre-existing Ticket 37A schema/source synchronization assertion. Database files and historical tests remain unchanged.
- Both harness `--check` commands pass.
- Baseline: all four exact recorded final responses and selected diagnostics reproduced.
- Current: turns 9–12 cover fulfillment timing and support limits; turns 10–12 also cover response timing. All recognized topics are covered, `historical_state_used_for_intent` is false, and no Checkout, purchase CTA or new confirmation state is introduced.
- Focused tests also cover timing variants, unrelated cooking/support timing, limit negatives, explicit purchase, GLP-1, urgent safety and genuine renewal coexistence.

Evidence: `outputs/ticket-52/exact-incident-comparison.json`, `exact-incident-focused.log`, and `exact-incident-full-serial.log`. The comparison retains recorded, archived and current responses plus diagnostics and artifact hashes. This is deterministic regression evidence from a supplied live run, not a new live execution. The supplied run's separate judge-output failure and non-product support-email drafting behavior are outside this regression.

No import, deployment, activation or external side effect occurred.
