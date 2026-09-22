# Ticket 49 — Multi-topic preservation and harness hardening

Implemented and locally validated. All three generated workflow artifacts remain **inactive**. Nothing was imported, deployed, activated or executed against production. No migration, package installation or production data change is required.

**Synthetic outcome - not market evidence**

## Root cause and reproduced paths

The original canonical validator treated the classifier's primary topic as the complete current intent:

1. `repairInformationalResponse` could remove an entire sentence containing both a supported answer and an unsupported clause.
2. `deterministicTopic[decision.topic]` could replace the remainder with a primary-topic answer.
3. The whole-response question-count, unsupported-personalization and contract checks could discard a substantive answer and select `deterministicTopic[decision.topic] || fallback.answer_question`. An unknown deterministic topic such as credentials produced the generic support fallback.
4. Ticket 46's final `preserveBusinessLocationResponse` rejected wording about payment or personalization even when those subjects were explicitly asked alongside location, then selected `same_topic:business_location`.
5. A canonical `decision.deterministic_response` covering only commercial subquestions could also replace a broader draft before validation.

Eight semantic variants covering the four supplied defect classes failed against a saved copy of the original canonical artifact. The exact execution-37748 transcript was not supplied; the regressions are sanitized semantic equivalents, not a claim of exact stochastic replay. `outputs/ticket-49/before-regressions.log` and `before-after-examples.json` retain the evidence.

| Case | Before | After |
| --- | --- | --- |
| A: location, authorship, personalization, trial | Only the digital-service answer survived. | All four requested subjects are answered; the trial/promotion remains explicitly unconfirmed. |
| B: credentials, allergies, promotion, payments, refund, support | An unsupported portion triggered the generic support-email fallback. | Known facts remain; refund and promotion uncertainty applies only to those subjects. |
| C: numbered product questions with numbered answer headings | Multiple question marks in the draft triggered generic inclusion-only content. | Inclusion, authorship, personalization and trial are each answered without repeating question headings. |
| D: personalization plus commercial questions | Only the personalization fallback survived. | Personalization, price, refund uncertainty and trial uncertainty remain present. |

The expanded tests also exposed three existing policy constants absent from the generated policy node: `POST_28_DAY_RESPONSE`, `PREPARED_FOOD_DELIVERY_RESPONSE`, and `REPEATED_BILLING_CLARIFICATION`. Prepared-food handling raised `ReferenceError`. The generator now embeds their existing exported values. The source commercial-policy module, including Checkout/GLP-1 authorization, is byte-for-byte unchanged. This fixes executable generation, not the underlying policy.

## Validation approach and boundaries

The **single-primary-topic model is retained**. `explicitProductQuestions` separately extracts known subjects from explicit current questions, without reading conversation history or trusting the classifier's primary topic. The response prompt receives that topic list as additional current-turn context.

For eligible multi-topic `answer_question` / `respond` turns, `canonicalMultiTopicResponse` reconstructs the answer from narrowly scoped `MULTI_TOPIC_ANSWERS` in the canonical knowledge module. Reliable free-form clause entailment cannot be established with the current deterministic validator, so the implementation takes the ticket's approved deterministic reconstruction option. It preserves supported **semantic coverage**, not arbitrary model wording. Raw generated text is never returned merely because it mentions several topics.

Only requested fact units are included. They cover the existing price, payment methods, billing, prepared-food scope, AI/human involvement, personalization and consent, refunds, support, digital modality, inclusions, start date and other supported product facts. Trials/promotions, testimonials, international pricing and response-time promises are explicitly unconfirmed rather than invented. Recognized additional unsupported-feature questions receive an uncertainty statement alongside the known answers. No claim from the model draft is needed to assemble these responses.

The numbered answer contains no new actionable question, no unsolicited purchase CTA and no new payment URL. The final question state is cleared to avoid persisting a purchase-confirmation question that was not actually asked. Checkout authorization and routing are not broadened. Single-topic validation remains on the existing path. Medical/urgent decisions, medication-management boundaries, GLP-1 holding behavior and side-effect branches are excluded from the multi-topic answer path; their existing policy behavior remains authoritative.

The extraction and coverage checks are deliberately conservative lexical diagnostics, not a complete language-understanding system. An unrecognized paraphrase can still need a future regression. The independent Judge remains necessary for substantive coverage evaluation. Coverage metrics measure topic mention/coverage, **not truthfulness**; truthfulness in the new repair path comes from the approved fact units.

## Customer and Judge hardening

Customer, Customer repair, Judge and Judge repair use the already-established n8n OpenAI model-node `responseFormat: json_object` option, with exact required-key/type validation in Code. This preserves the existing node versions. It does not claim provider-native JSON Schema enforcement: the compatible JSON-object transport is combined with strict local contracts. Sales classifier/response model settings are unchanged.

Both structured-output boundaries now follow this sequence:

1. Validate the expected object.
2. Normalize only unambiguous representations: an object-valued output, a complete JSON fence, one complete JSON object inside surrounding prose, Customer outcome whitespace/case, Judge boolean strings and evidence turn-number strings.
3. Reject duplicate JSON keys, multiple candidate objects, truncated JSON, arrays, extra/missing fields, invalid outcomes and invalid evidence instead of guessing.
4. If still invalid, make **one** separate repair call, validate its output, and either continue or report the appropriate output failure. There is no retry edge from a repair validator back to the repair model.

Customer repair receives the original allowlisted Customer context and bounded invalid synthetic output. It never receives Sales prompts, decisions, drafts, diagnostics, expected answers or session state. Judge repair receives the original scenario/facts/termination payload and **complete valid customer-visible transcript**, not internal evidence. Provider error bodies are excluded from repair prompts/reports.

The `brief_whatsapp` prompt strongly prefers one or two short sentences, normally one primary question and occasionally two closely related questions. It prohibits accumulating unresolved questions into a questionnaire and treats objectives as motivations rather than a checklist. Frustration should be expressed conversationally in response to the latest reply. This is scoped to the persona; stress-test personas are not clipped to a tiny global limit. A sentence/question-count warning makes obvious style drift observable without truncating a valid customer message or altering Sales behavior.

## Termination, evidence and reporting

Conversation termination is one of:

- `purchase_intent`
- `customer_rejection`
- `conversation_resolved`
- `safety_escalation`
- `max_turns`
- `sales_engine_failure`
- `customer_output_failure`

`judge_output_failure` is an evaluation status, **never** a rewritten conversation termination. A Customer failure occurs after the last completed valid turn; it adds no fabricated Sales reply and does not invalidate earlier turns.

Reports now separate:

| Field | Meaning |
| --- | --- |
| `conversation_execution_status` | PASS for completed bounded execution; FAIL for Customer/Sales execution failure. |
| `termination_reason` | The conversation reason above, preserved through Judge repair/failure. |
| `customer_agent_status` | PASS or `customer_output_failure`. |
| `sales_engine_status` | PASS, `sales_engine_failure`, or NOT_RUN when no Sales call occurred. |
| `judge_status` | PASS for a valid Judge contract, or `judge_output_failure`. PASS is not an endorsement of sales quality. |
| `evaluation_failure` | Null or `judge_output_failure`; separate from conversation termination. |
| `deterministic_status` | PASS/FAIL/NOT_RUN for deterministic assertions. |
| `repairs` | Normalization/model-repair method, role, turn where applicable, and result. |
| `warnings` | Coverage/style warnings, separate from deterministic hard failures. |

The overall `status` may be FAIL because evaluation infrastructure failed while `conversation_execution_status`, `sales_engine_status` and deterministic evidence remain PASS. The transcript, raw Sales draft, final reply, primary topic, interpretation, fallback identity, state/timestamps, assertions, model calls, isolation fields and reproducibility metadata are retained.

Every captured turn also includes:

- `explicit_current_questions_present`
- `explicit_current_question_topics`
- `multi_topic_turn`
- `generated_answer_coverage`
- `final_answer_coverage`
- `coverage_warnings`

`POSSIBLE_MULTI_TOPIC_COVERAGE_LOSS` is emitted when the draft covers at least two requested topics and final validation loses one or more of them. It is initially a warning, not an automatic hard failure. A regression injects an intentionally narrow validator and verifies this warning even when all other deterministic assertions pass. Ticket 41A's inspector exposes the same available coverage fields.

The Judge prompt explicitly requires `current_questions_answered: false` and turn evidence when substantial current questions are ignored. Such a valid finding appears in `potential_defects`; it does not masquerade as a Sales infrastructure failure. Missing/invalid Judge evidence goes through the bounded repair path.

## Cost and isolation

Limits remain 1–8 scenarios and at most 12 completed customer turns. A Customer output can incur at most one repair per turn; the Judge can incur one repair per scenario. The worst-case logical call budget is now `4 × max_customer_turns + 2`: **50 per scenario, 400 per eight-scenario batch**. The tests exercise the full 50-call bound. Available token usage includes repair calls; unavailable provider usage is still marked incomplete. Canonical provider transport retries, if any, are not individually counted.

The workflow remains manual-only and inactive, with one-iteration model agents, disabled node retries, no recursive workflow execution and the existing execution timeout. A host cancellation or whole-workflow timeout can still interrupt report completion; these are not converted into successful runs.

**Zero application database writes and zero external customer side effects.** The repair branches add only pure Code, IF, and tool-free model calls. There are still no Twilio, Stripe, email, database, portal/program/user/fulfillment, production analytics, scheduled trigger or production error-workflow paths. Models retain unresolved harness-only credential names. Customer-visible replies remain separate from internal diagnostics, including during repair.

`outputs/ticket-49/change-audit.json` confirms that the canonical connection graph, commercial-policy source and Recovery Poller are unchanged, and all three workflow artifacts are inactive. The only changed canonical nodes are the response prompt builder, final validator and the missing-constant embedding in the policy node.

## Validation and saved results

- **28 new Ticket 49 tests pass**: 16 Sales/multi-topic regressions and 12 harness-hardening regressions.
- **17 Ticket 48 tests pass**, updated only where Ticket 49 explicitly changes failure/repair semantics; none were removed or skipped.
- Combined Ticket 49, Ticket 48 and Ticket 23 focused run: **51 passed, 0 failed, 0 skipped**.
- Tickets 45–47: **20 passed, 0 failed, 0 skipped**.
- Checkout/commercial/safety, Ticket 42, Ticket 44 and Ticket 41A focused group: **65 passed, 0 failed, 0 skipped**. Ticket 42A's loopback HTTP tests also pass in the full suite. There is no separately named Ticket 43 test file in this snapshot.
- Full canonical suite, serial execution with the required loopback-server permission: **482 passed, 1 failed, 0 skipped** out of 483. The sole remaining failure is the unchanged Ticket 37A `generated migration and schema embed the backend function source exactly` assertion at `test/ticket-37a-logical-reply-recovery.test.js:82`. No schema/recovery source or historical assertion was weakened to hide it.
- Generator synchronization checks for Ticket 41A and Ticket 48 pass. The actual generated Code/IF graph is exercised with fixtures, including both repair branches; this is not an installed-n8n integration test.

Scenario G (`context_switching_001`) local fixture report: **5 completed turns, conversation_resolved, PASS**, 16 simulated model calls, complete Judge-contract execution, no unauthorized commercial transition or side effects. It contains a current digital-service/authorship question with coverage retained in the final answer. See `outputs/ticket-49/context-switching-final-fixture.json`.

All eight scenarios: **8 fixture PASS**, 36 completed turns, 115 simulated model calls, two synthetic purchase-intent outcomes, one rejection, one safety escalation, no Customer/Judge/Sales execution failures or unexpected commercial transitions. See `outputs/ticket-49/all-scenarios-final-fixture.json`.

**Live acceptance is still pending.** These are deterministic model-boundary fixtures, explicitly labeled `MODEL_BOUNDARY_FIXTURES_NOT_LIVE_AI`; their Judge findings are not independent AI evidence and they cannot establish live `brief_whatsapp` adherence. No isolated n8n runtime or harness model connection was available during implementation. An isolated test-instance request was raised; no production import was attempted. The actual live Scenario G run and then all eight live scenarios remain the runtime acceptance step.

## Files and functions

| File | Change |
| --- | --- |
| `lib/sales-response-contract.js` | Current-topic extraction, coverage diagnostics and canonical multi-topic reconstruction. |
| `lib/dietavity-knowledge.js` | `MULTI_TOPIC_ANSWERS`: confirmed fact units and scoped uncertainty. |
| `scripts/ticket-49-workflow.js` | Embeds the new response contract and current-question prompt context. |
| `scripts/refactor-ticket-10-workflow.js` | Applies Ticket 49 and embeds the existing missing policy constants. |
| `lib/ticket-48-harness.js` | Safe structured-output normalization, one-shot repairs, style contract, statuses, budgets and diagnostics. |
| `scripts/generate-ticket-48-harness.js` | Pure repair branches, scoped JSON-object model options, metadata and shared diagnostic helpers. |
| `scripts/generate-ticket-41a-chat-harness.js` | Inspector coverage fields; canonical nodes remain generator copies. |
| `test-support/ticket-48/runner.js` | Same bounded repair orchestration in local tests; context-switch fixture includes a mixed current question. |
| `scripts/run-ticket-48-fixtures.js` | Optional `--scenario` selection for Scenario G. |
| `test-support/ticket-49-multi-topic-fixtures.js` | Four incident classes and semantic variants. |
| `test/ticket-49-multi-topic.test.js` | Positive, variant, safety, unsupported-claim, coverage and generation regressions. |
| `test/ticket-49-harness-hardening.test.js` | Normalization, repair success/failure, history isolation, status, style, call-budget and generated-graph tests. |
| `test/ticket-48-autonomous-harness.test.js` | Updated expectations for the explicitly changed Ticket 49 semantics. |
| Three generated `n8n/` artifacts | Canonical Sales Engine, Ticket 41A and Ticket 48, synchronized and inactive. |
| `docs/` and `outputs/ticket-49/` | Runbook, before/after examples, checks and labeled fixture reports. |

The `lib/sales-engine-v3.js` policy source, database schema/migrations, website, Stripe/Twilio paths, Setup, portal, meal generation and Recovery Poller were not modified.

## Reproduction, import and rollback

With Node available on PATH, from the repository root:

```sh
node scripts/refactor-ticket-10-workflow.js
node scripts/generate-ticket-41a-chat-harness.js
node scripts/generate-ticket-48-harness.js
node scripts/generate-ticket-41a-chat-harness.js --check
node scripts/generate-ticket-48-harness.js --check
node --test test/ticket-49-multi-topic.test.js test/ticket-49-harness-hardening.test.js test/ticket-48-autonomous-harness.test.js
node scripts/run-ticket-48-fixtures.js --scenario context_switching_001 --output /tmp/ticket49-new-context.json
node scripts/run-ticket-48-fixtures.js --all --output /tmp/ticket49-new-batch.json
npm test
# Equivalent full-suite command with serialized test processes:
node --test --test-concurrency=1
```

The workspace has no Node/npm on its normal PATH; validation used `/Users/juanmalegria/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`. `node --test` is the package.json test command. The standalone loopback HTTP tests needed sandbox permission to listen locally; no production endpoint was contacted.

For separately authorized live acceptance, import the regenerated Ticket 48 artifact into an **isolated test n8n instance**, keep it inactive, and map only `Dietavity Autonomous Harness OpenAI` on the six model nodes (Customer, Customer repair, Sales interpretation, Sales response, Judge, Judge repair). Do not attach a production error workflow, tools or delivery/database credentials. Select `context_switching_001` in **Load Test Scenario**, execute manually, and export **Test Report**. Check at least three autonomous turns, actual final-response reactions, ordinary brief messaging, topic switching, multi-topic coverage, unsupported-claim exclusion, separate repair/failure status and zero side effects. Then manually run all eight scenarios and preserve the reports with their artifact/prompt/model metadata. Do not force a purchase or lengthen an already resolved conversation merely to satisfy a scripted outcome.

Ticket 41A can be reviewed/imported separately under its existing isolated-test procedure. Updating the production canonical Sales workflow is a **separate explicitly authorized deployment** after review and acceptance; do not automatically replace or activate it from this ticket. Export the currently deployed workflow before any future change.

Rollback consists of restoring the prior source/generator files and corresponding workflow artifacts as a synchronized set. If a future deployment occurs, restore the saved previous workflow through the approved deployment process. For test-only removal, delete the inactive harness copy and its synthetic execution/report data as desired. There is no migration to roll back and no customer database cleanup is required.

**Nothing was deployed or activated.**
