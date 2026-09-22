# Ticket 53 — Current-question preservation and failure diagnosis

## Status

Implemented and validated locally. Production was not changed. Fresh autonomous-model acceptance is still pending an isolated model environment; recorded-turn replay and deterministic model-boundary fixtures are explicitly not substitutes for it. No configured OpenAI API credentials or isolated live runner were available in this workspace.

## Exact Scenario D reproduction

The supplied `eight-scenario-test-output.json` contains eight JSON arrays separated by Scenario headings (F omits the Markdown `#`). The extraction retains the original file SHA-256 in `test-support/ticket-53/eight-scenario-incidents.json`; the source file was not modified.

Run `39062`, Scenario D, turn 4 did **not** throw an exception. `Capture Final Customer-Visible Response` completed the canonical validator, then its `no_known_unsupported_claims` assertion matched the substring `entregamos comida preparada` inside the truthful negative statement `No entregamos comida preparada`. The harness mapped that assertion failure to `sales_engine_failure`. The report's exception/failure array is empty.

The frozen baseline runtime embeds the original canonical artifact and original harness implementation. Its embedded artifact SHA-256 is `432a9358383d3d525a4840fbd52709c227dcb75f5674d3bd239ee79823b8db2c`, matching the supplied run. All **60 recorded final replies** reproduce exactly. Each turn uses its recorded timestamp, `session_before`, preceding final-only transcript, parsed interpretation re-enveloped through the canonical parser, and saved generated draft. Earlier corrected replies cannot alter later replay inputs.

Before changing implementation, the exact-turn regression failed against the current artifact. Evidence: `outputs/ticket-53/before-fix.log` and `scenario-d-baseline.json`. The first correction only changed the harness assertion and made that exact test pass. It removes an explicitly negated, complete delivery predicate before detecting positive unsupported claims. Positive claims in other clauses, qualified delivery offers and medication advice still fail. Missing model responses and genuine engine failures remain observable failures.

Scenario E's recorded `JUDGE_OUTPUT_FAILURE` remains a separate evaluation failure; it is not treated as an engine exception or as a verdict on corrected responses.

## Implementation

- The shared response contract extracts current request units independently of the classifier's single topic. It compares request details against confirmed fact vocabulary and established canonical aliases. A known topic is not enough to discard an unmatched modifier or a second question.
- Policy gives uncertain current questions an answer-only path ahead of old price, sample, goal and continuation fallbacks. Genuine medical intent, current AI-value objections, support routing and explicit reminders retain precedence. Unknown material details do not authorize Checkout or advance confirmation state.
- The validator retains requested known fact units and identifies unconfirmed details using the customer's subject. It does not reuse an unrelated draft or infer a feature's price from the base product price. A generic sample is withheld when it cannot satisfy requested restrictions. Quoted requests are treated as data and stripped of actionable question marks, links, markup and recognized internal identifiers.
- The bounded lexical check is a conservative fallback, not a semantic entailment engine. It may decline an unfamiliar paraphrase rather than claim a fact. Tests exercise previously unseen subjects and altered classifier/history states, beyond the incident vocabulary. No new model, database, queue or messaging path was added.
- Confirmed Setup/consent, shopping-list and support-contact facts were added to the existing fact registry. Sources are `server.js`'s profile/Setup and shopping-list routes, `views/setup.ejs`, `views/plan.ejs`, and the existing canonical support email. PDF export, batch-preparation durations, delivery partners, local restaurant targeting, special demo pricing and other unconfirmed details receive no invented promises.
- The cooking phrase “puedo dejar todo listo” no longer matches medication management merely because it contains “puedo dejar”. Actual treatment objects, current medication context and unqualified treatment-action questions retain conservative safety routing.
- Both harnesses expose whether unknown current details were preserved and their count. Existing topic-coverage diagnostics remain separate: lexical topic coverage is not a claim of factual correctness or full question resolution.
- Policy/contract/knowledge sources and both generated harnesses are synchronized. Import-ready workflows remain inactive.

## Validation and evidence

- Ticket 53 focused regressions: **18 passed**, zero failures/skips.
- Tickets 41–53 historical suite: **229 passed**, zero failures/skips; see `outputs/ticket-53/historical-41-53.log`.
- Full serial canonical suite: **600 tests, 599 passed, 1 pre-existing failure, zero skips**; see `outputs/ticket-53/full-suite.log`. The pre-existing Ticket 37A assertion at `test/ticket-37a-logical-reply-recovery.test.js:82` remains the only failure: `database/schema.sql` does not contain the recovery function source exactly. No database file or historical test was modified to conceal it.
- Exact eight-scenario replay: **60/60 baseline replies reproduced**, zero corrected execution failures and zero corrected harness assertion failures. Targeted regressions separately inspect A/Setup, C/PDF/contact, D/restaurants/extra cost, F/preparation/shopping/batch prep and G/restricted samples/payment subjects. See `exact-replay-comparison.json`.
- The existing isolated deterministic eight-scenario fixture batch passes all eight with zero safety or unexpected commercial-transition assertions. Its output is labeled `MODEL_BOUNDARY_FIXTURES_NOT_LIVE_AI`; its fixture Judge is not independent acceptance evidence.
- Both generated harness `--check` commands pass.

Reproduction commands (use the available Node runtime):

```bash
node --test test/ticket-53-current-question.test.js
node --test --test-concurrency=1 test/ticket-4*.test.js test/ticket-5*.test.js
node --test --test-concurrency=1
node scripts/run-ticket-53-replay.js
node scripts/generate-ticket-41a-chat-harness.js --check
node scripts/generate-ticket-48-harness.js --check
```

The package's `npm test` invokes `node --test`; serial execution avoids the test-runner serialization issue observed in the baseline. Local HTTP tests require loopback permission in the desktop sandbox.

## Remaining acceptance and deployment

`outputs/ticket-53/inactive-eight-scenario-harness.json` is generated by `scripts/run-ticket-53-replay.js` from the existing Ticket 48 isolated architecture, configured with all eight scenarios. It is ready for a fresh manual run in an isolated n8n test environment with the existing `Dietavity Autonomous Harness OpenAI` credential. No workflow was imported, activated or executed remotely.

After that run, review actual transcripts for execution failures, safety boundaries, unrelated substitutions, unsupported claims and preserved current questions. Report customer-agent and Judge failures separately. Do not accept merely because the Judge says PASS.

Production import/deployment remains a separate operation. There is no migration, external customer message, payment operation or production data change in this ticket.
