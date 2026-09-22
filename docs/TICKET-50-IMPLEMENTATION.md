# Ticket 50 — Current questions at the purchase boundary

Implemented and locally validated. **Live isolated AI acceptance remains pending.** All three generated workflow artifacts are inactive. Nothing was imported, deployed, activated, or executed against production. No migration is required.

**Synthetic outcome - not market evidence**

## Root causes and changes

1. `explicitProductQuestions` did not recognize sample/menu previews or invoice questions. Sample requests alongside refund fell into `unconfirmed_detail`; invoice questions could disappear entirely from diagnostics. Current-message extraction now recognizes `sample_plan`, `invoice`, `guarantee`, and `after_payment`, plus start-date verb variants and common questions without punctuation. Viewing requests are recognized across meal/day/menu objects, including bare example requests and either question order. Unrelated uses of “ejemplo” are excluded by regression cases.
2. The material-question branch returned before direct purchase and created another purchase-confirmation question. Safe explicit purchase plus recognized current questions now returns the existing `direct_purchase` / `send_checkout` action with `checkout_question_response` built only from canonical fact units. It clears question state and adds no reconfirmation. Purchase intent is not added as a question topic.
3. Short object requests such as “Sí, mándalo porfa” did not resolve the purchase object. They now require the existing valid purchase-confirmation context and offer version. Expired, absent, and example contexts cannot authorize them. Explicit “lo pago” / “sí lo quiero” clauses are recognized with negation, conditional, and deferral guards. Bare weak acknowledgements remain unauthorized.
4. A stale payment primary topic could replace the invoice answer. The validator reconstructs even a single sample/invoice/guarantee answer from its current canonical topic. It preserves the existing single-primary-topic model and does not trust generated invoice claims. Other single-topic validation remains on its existing path.
5. Checkout bypasses generative response validation. Its canonical question answer is therefore prepended to the existing Checkout message in the `Reserve Checkout Reply` payload. The complete body is reserved once and Twilio reads that reserved body. The existing provider identity, inbound claim, idempotency key, Stripe request, connection graph, and delivery reconciliation remain unchanged. No parallel send path was added.

Medical/safety handling, operational routing, unresolved ambiguity, and Ticket 42 GLP-1 holding behavior still precede the new combined route. In particular, GLP-1 mixed-question behavior is unchanged. The existing initial broad-information opening is preserved. No generic repetition heuristic was added.

## Canonical truth and diagnostics

`sample_plan` supplies one fixed illustrative day with breakfast, lunch, dinner, and snack. It explicitly says it is not personalized and that the customer's program is generated after purchase and personalization. It adds no public sample page, URL, PDF, portal function, clinical prescription, or promise of individualized results.

`invoice` remains **unconfirmed**: “No tengo información confirmada sobre la disponibilidad de factura o CFDI.” No RFC/razón social requirements, timing, SAT procedure, or invoicing support workflow is offered. `guarantee` is also explicitly unconfirmed. `after_payment` reuses the existing verified personalization/portal sequence. Sales prompt facts are scoped to sales; shared meal-generation and auditor product facts are unchanged.

Examples of final coverage diagnostics:

```json
{"explicit_current_questions_present":true,"explicit_current_question_topics":["sample_plan","refund"],"multi_topic_turn":true}
{"buyer_signal":"explicit_purchase","explicit_current_questions_present":true,"explicit_current_question_topics":["invoice"],"multi_topic_turn":false}
```

Topic extraction remains a bounded deterministic language recognizer, not unrestricted semantic understanding. Coverage diagnostics do not prove factual truth; canonical reconstruction supplies the truth boundary. Unknown paraphrases still require regression-driven maintenance.

## Interception and Judge contract

The harness carries the canonical accompanying answer as `final_dietavity_response`. Pure Checkout may keep that field null. An authorized intercepted Checkout also exposes:

```json
{"customer_visible_action":{"type":"checkout_link","status":"intercepted","would_execute_in_production":true}}
```

This action is included in the visible transcript and Judge input, alongside the scenario and canonical question facts. Judge prompt version is `ticket50-judge-v3`. It explicitly treats interception as successful isolated routing, not silence, and forbids inferring an actual Session, delivered/opened URL, or payment. Every accompanying question must be assessed independently. Judge repair retains that same context.

The harness authorization assertion now permits a material question alongside valid explicit authorization. A separate `accompanying_question_coverage` assertion detects a missing answer even when the Checkout action is intercepted. A mutation regression removes the invoice answer and verifies failure evidence survives Judge validation and reporting. Judge tests use model-boundary fixtures; they are not claims about a live model's judgment.

## Files and workflows

| Files | Purpose |
| --- | --- |
| `lib/sales-response-contract.js` | Question recognition, single new-topic canonical answers, coverage. |
| `lib/dietavity-knowledge.js` | Canonical answers and sales-scoped truth/policy instructions. |
| `lib/sales-engine-v3.js` | Explicit purchase with current questions and contextual object resolution. |
| `scripts/refactor-ticket-10-workflow.js` | Embed policy dependencies and compose the canonical Checkout reservation body. |
| `lib/ticket-48-harness.js` | Intercepted action, visible answer, assertions and Judge contract. |
| `scripts/generate-ticket-48-harness.js` | Supply canonical question facts to Judge. |
| `test/ticket-50-current-question.test.js` | 32 new positive, variant, negative, generated-artifact and harness regressions. |
| `test/ticket-8-sales-engine-v3.test.js`, `test/ticket-8d-live-sales-context.test.js` | Update two old reconfirmation expectations to Ticket 50's explicitly requested combined behavior. |
| `test/ticket-9-canonical-message-ledger.test.js` | Require the combined reserved Checkout body and delivery from the ledger. |
| `test-support/ticket-50-scenario-g.js` | Reproducible incident-specific model-boundary fixture. |
| `n8n/Dietavity Sales Engine (Ticket 10).json` | Regenerated canonical production-target artifact, inactive. |
| `n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json` | Regenerated canonical node copies, inactive. |
| `n8n/Dietavity Autonomous Conversation Harness (Ticket 48).json` | Regenerated isolated harness, inactive. |
| `outputs/ticket-50/` | Test logs, synthetic fixture reports and change audit. |

The only changed canonical nodes are Build Canonical Dietavity Knowledge, Apply Deterministic Commercial Policy, Build Constrained Sales Response, Validate Sales Response Contract, and Reserve Checkout Reply. No node versions or connections changed. Recovery Poller, Stripe sandbox, Setup, portal, meal-generation logic, database schema and migrations are unchanged. See `outputs/ticket-50/change-audit.json`.

## Validation results

- New tests: **32 passed**. Running the final test file against the saved pre-change canonical artifact produces **28 failures and 4 passes**, reproducing the defects and changed boundaries. This comparison substitutes the canonical artifact only; it is not a full old-repository run.
- Focused Ticket 50 plus commercial and ledger regressions: **80 passed, 0 failed, 0 skipped**.
- Tickets 41/41A, 42/42A, and 44–50: **128 passed, 0 failed, 0 skipped**.
- Full supported suite, serialized: **514 passed, 1 failed, 0 skipped** out of 515. The failure is the pre-existing Ticket 37A schema/source synchronization assertion at `test/ticket-37a-logical-reply-recovery.test.js:82`. The untouched baseline schema also fails inclusion of its baseline `RECOVERY_FUNCTIONS_SQL`. No schema/recovery source or test was changed to conceal it.
- An earlier concurrent full-suite attempt also hit Node's “Unable to deserialize cloned data” test-runner failure on Ticket 28. Serial execution completed those tests. The earlier run is retained in `outputs/ticket-50/full-suite.log`; the final authoritative result is `full-suite-serial.log`.
- Ticket 41A and Ticket 48 generator `--check` commands pass.
- Incident-specific Scenario G fixture: **4 turns, 12 simulated model calls, PASS**, sample/refund and sample/trial coverage, invoice uncertainty and authorized Checkout interception. The ordinary Scenario G fixture also passes with 5 turns and 16 simulated calls. All eight existing scenario fixtures pass (115 simulated calls).
- Fixtures made **zero external model/API calls and zero application database writes**. Existing generated-graph allowlist tests pass. No URL, Stripe Session, payment or message delivery was manufactured.

The environment has no configured isolated n8n executable/container runtime or harness/model environment credentials. Live Scenario G was **not run**, and neither the fixture Judge nor fixture repetition outcomes substitute for live autonomous acceptance.

## Reproduction and handoff

Node/npm is absent from the normal shell PATH. Validation used `/Users/juanmalegria/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`. Use that executable or a supported Node environment for:

```sh
node scripts/refactor-ticket-10-workflow.js
node scripts/generate-ticket-41a-chat-harness.js
node scripts/generate-ticket-48-harness.js
node scripts/generate-ticket-41a-chat-harness.js --check
node scripts/generate-ticket-48-harness.js --check
node --test test/ticket-50-current-question.test.js
npm test
# Full suite with serialized test processes, used to isolate the runner issue:
node --test --test-concurrency=1
node scripts/run-ticket-48-fixtures.js --scenario context_switching_001
node scripts/run-ticket-48-fixtures.js --all
```

The incident-specific model fixture is exported by `test-support/ticket-50-scenario-g.js`; pass `scenarioGModel()` to `run({target:'sales', scenario_ids:['context_switching_001']}, model)` from `test-support/ticket-48/runner.js`. Any report from it must retain `MODEL_BOUNDARY_FIXTURES_NOT_LIVE_AI` and **Synthetic outcome - not market evidence**. Local HTTP tests need permission to listen on loopback.

For live acceptance, use an isolated test n8n instance, import only a new inactive Ticket 48 harness copy, and map its six model nodes to the harness-only OpenAI credential. Keep delivery, Stripe, database, tools, scheduled triggers and production error-workflow paths absent. Select `context_switching_001` in Load Test Scenario, execute manually and export Test Report. Assess actual sample/question completeness, repetition, purchase authorization, invoice uncertainty and interception semantics; do not require identical stochastic wording. No runtime import was performed here.

Production import/deployment remains a separate operation requiring authorization. After review and live acceptance, export the currently deployed canonical workflow, import the regenerated Sales Engine artifact inactive, verify the five changed nodes and retained credentials/runtime versions, and activate only under the approved release procedure. No production migration or data cleanup is required. Address the existing schema-sync discrepancy separately before claiming an entirely green repository suite.

Rollback restores the six changed library/generator sources, the three revised historical tests, and the three generated workflows as a synchronized set; remove the new Ticket 50 test/fixture if rolling the repository back. Regeneration must use the restored sources. If a later authorized deployment occurs, restore its exported previous workflow. There is no migration to reverse.
