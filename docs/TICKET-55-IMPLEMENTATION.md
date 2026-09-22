# Ticket 55 — current conversational task preservation

## Final change

The existing interpretation boundary now supplies a grounded `current_task` with an operation (`draft`, `transform`, `summarize`, or `show`) and a verbatim current-message request. This is semantic classification, not one matcher per requested phrase. Current tasks suppress stale goals, commercial questions and classifier topics, never authorize provider actions, and remain downstream of deterministic current-message medication safety. The response prompt requests the actual draft/summary using established context and canonical product facts.

`lib/sales-conversational-task.js` separates task content and related how-to questions from independently identifiable product questions. A task-related question with no product topic is no longer assumed to be an unknown service capability. Existing product-topic extraction and provider-subject evidence retain separate canonical and unknown product questions, including SLAs and unconfirmed capabilities. No product-fact taxonomy or product capability was added.

Task validation keeps the existing informational repair and final safety checks. Offending sentences are removed or replaced with bounded uncertainty before the whole-response validator runs. Valid draft/list content survives unsupported promises, obsolete pricing, unsupported personalization, generated medication advice, and internal identifiers. Excess generated questions are removed while retaining one question at the end. Separate product answers are composed with the task instead of replacing it.

The deterministic harness reports task completion separately from factual coverage. The independent Judge evaluates every current task and related question against the final transcript; generic uncertainty is not successful task completion. The local completion marker is a structural check, not semantic entailment. Unsupported-claim assertions and medical checks remain enabled. Fresh autonomous review remains required.

Changed sources: `lib/sales-conversational-task.js`, `lib/sales-engine-v3.js`, `lib/ticket-48-harness.js`, `scripts/ticket-55-workflow.js`, `scripts/refactor-ticket-10-workflow.js`, and `scripts/generate-ticket-48-harness.js`. Reproduction scripts, frozen runtimes, supplied transcripts and focused tests live under `scripts/run-ticket-55*`, `test-support/ticket-55/`, and `test/ticket-55*.test.js`.

## Exact acceptance follow-up: Scenario F run 40266

The attached `scenario-f-output-ticket-55.json` is retained as a synthetic fixture with its SHA-256. The frozen acceptance baseline embeds artifact hash `9469dad74ce9afef40051e12d8aa4c1ff0ff7591768d6ca702d182a3e1918408`, matching the execution's recorded artifact. All **6/6** original final replies reproduce exactly before the follow-up fix.

### Turn 4

- Customer requests the prior 90-minute preparation outline and asks how to scale it from one to three people.
- Recorded interpretation extracts `show`, with only the first request in its task span. The remaining how-to clause has no product topic.
- The generated response already supplies both the outline and practical scaling guidance.
- Before: `currentQuestionDetails` treats the remaining clause as an unknown service detail; final validation prepends “No tengo información confirmada...” to the valid answer, creating a contradiction.
- After: the remaining task-related clause is not a product-fact request. The **entire recorded generated response is preserved**, with no uncertainty prefix or medical escalation.

### Turn 6

- Customer requests the consolidated shopping list for one and three people.
- Recorded interpretation correctly identifies the entire request as `show`; there is no separate factual question.
- The generated response supplies the list, but appends two optional follow-up questions.
- Before: the maximum-one-question validator replaces the entire list with the generic support fallback. This particular recorded failure was a question-count violation, **not an unsupported-claim violation**.
- After: only the extra question is removed; **every recorded ingredient line is retained verbatim**, one question remains at the end, and task coverage passes.

`outputs/ticket-55/acceptance-followup-trace.json` records the complete requested chain for each saved turn: customer message, extracted task/questions, product-detail classification before/after, generated response, validation/fallback, and final customer-visible response. The corrected six-turn replay uses the original interpretation, state, timestamp and generated response without new annotations. It has zero execution/assertion failures. Original Judge results are provenance, not reused as verdicts on changed replies.

Mutation regressions exercise alternate draft/rewrite/show requests, related questions, independent unknown provider questions, canonical price answers, excess follow-ups, and claim-local repair. Current medical requests still receive deterministic referral and safe accompanying canonical facts.

## Original Ticket 54 evidence

The attached three-scenario file preserves F run 39474, H run 39480 and A run 39483. The pre-Ticket-55 frozen runtime matches **27/27** original replies, including the requested F turns 10–12 failures. For these older turns, the new task field is explicitly locally annotated; the saved classifier output predates that field. The original generated drafts then survive validation, all three tasks pass, and the replay has zero execution/assertion failures. This annotation is not fresh classifier evidence.

The additional historical 79-turn recorded-model replay also has zero execution/assertion failures. Neither recorded replay is autonomous acceptance.

## Validation

Final local results:

- Focused Ticket 55: **32 passed**, zero failures/skips.
- Ticket 54 focused: **13 passed**, zero failures/skips.
- Tickets 41–55 historical serial suite: **258 passed**, zero failures/skips.
- Full serial repository suite: **645 tests, 644 passed, one failure**, zero skips. The sole failure is the pre-existing Ticket 37A migration/schema-source equality assertion at `test/ticket-37a-logical-reply-recovery.test.js:82`. No database files were changed.
- Ticket 41A and Ticket 48 generation checks pass.
- Exact acceptance replay: **6/6 baseline matches**, zero corrected execution/assertion failures.
- Earlier three-scenario replay: **27/27 baseline matches**, three completed annotated task turns, zero corrected execution/assertion failures.
- Historical recorded replay: **79 turns**, zero execution/assertion failures.

The bundled Node v24 runtime was used because `node`/`npm` are not on PATH. The full serial command is the package's `node --test` with `--test-concurrency=1`. Local HTTP tests required a sandbox escalation to bind localhost; final results above come from the completed runs with that permission. No tests were weakened or skipped.

```bash
node scripts/refactor-ticket-10-workflow.js
node scripts/generate-ticket-41a-chat-harness.js
node scripts/generate-ticket-48-harness.js
node --test test/ticket-55*.test.js
node --test test/ticket-54-clause-precedence.test.js
node --test --test-concurrency=1 test/ticket-4[1-9]*.test.js test/ticket-5[0-5]*.test.js
node --test --test-concurrency=1
node scripts/run-ticket-55-replay.js
node scripts/run-ticket-55-acceptance-replay.js
node scripts/generate-ticket-41a-chat-harness.js --check
node scripts/generate-ticket-48-harness.js --check
```

## Generated artifacts and remaining acceptance

The canonical Sales Engine, Ticket 41A harness and Ticket 48 autonomous harness are regenerated and inactive. The delivery artifact is **`outputs/ticket-55/inactive-scenario-f-harness.json`**, containing only `busy_customer_001`, a manual trigger, in-memory synthetic state and the embedded Sales Engine. It has no production trigger/error-workflow connection, database, Twilio, Stripe, email or other customer action nodes. The canonical generator also rewrites its existing local Recovery Poller artifact; its source was not changed or deployed.

Before the acceptance follow-up arrived, this task imported the then-current F-only artifact as a NEW inactive workflow at `https://n8n.dietavity.com/workflow/MNO1eP5Ca10DHEEz`. It was **not executed by this task**. Its existing OpenAI credential was verified against the prior Ticket 48 harness. The attached run 40266 came from the user. That imported workflow is now an older revision; use the regenerated local artifact for the next run. No updated import or fresh run was performed after the user requested local validation and delivery only.

Import inspection found that n8n removed the pre-existing `options.responseFormat: json_object` from the four Customer/Judge model nodes. The harness still validates model output strictly. This existing runtime import discrepancy is recorded in `outputs/ticket-55/import-verification.json`; no node upgrades or production configuration changes were made to address it.

Fresh autonomous acceptance is **pending**. Follow the requested gate: **F → A → H if safety composition changed → full eight scenarios**. Because task-only repair now removes generated invalid medical clauses before the existing whole-response guard, include H after F and A to verify that safety-adjacent response handling; the deterministic medical-request composer itself is unchanged. Inspect final transcripts and task coverage, not just aggregate status. Do not run the eight-scenario batch until preceding gates pass.

No production workflow was modified, activated, deactivated or executed. No database migration, customer message, payment, email or production data mutation was performed. Production deployment remains unauthorized.
