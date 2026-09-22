# Ticket 51 — Fulfillment timing and notification intent

## Implementation

Current-message extraction now recognizes `fulfillment_timing` and `fulfillment_notification` independently of the model's primary topic. A timing question following payment is represented as fulfillment rather than duplicating the generic `after_payment` topic. Extraction excludes unrelated cooking/support timing and does not establish purchase authorization.

The interpretation parser and deterministic policy both require explicit current-turn reminder language before entering reminder behavior. Historical reminder questions and a model-provided reminder flag cannot authorize it. The Ticket 48 adapter supplies the current customer message to the canonical parser, and its `explicit_current_reminder_intent` assertion detects reminder actions, strategy, date clarification, or scheduled state without current intent.

Current fulfillment questions override stale generic commercial classifications. Existing medical, medication-scope, support, renewal, billing-ambiguity, prepared-food, and authorized purchase branches retain their precedence. Final validation reconstructs recognized fulfillment answers from canonical fact units, including other recognized current questions. This prevents an unrelated renewal response, generated SLA, notification promise, or reminder question from replacing the answer.

The answer units summarize the existing verified-payment → personalization → generated program in the portal sequence. Existing sources are `PRODUCT_FACTS`, `PERSONALIZATION_FACTS`, the sample-generation fact, and `after_payment` in `lib/dietavity-knowledge.js`. No canonical timing commitment or readiness-notification guarantee was found; the answers explicitly leave those unconfirmed. The additional prompt guidance is sales-only. Price, offer, Checkout policy, database, Setup, portal, meal generation, providers, and Recovery Poller source were not changed.

## Validation

- Ticket 51 focused suite: **49 passed**, including timing/notification variants, genuine reminders, renewal, multi-topic preservation, stale classifications, parser flags, precedence, coverage-loss warnings, injected invalid reminder state, and a five-turn canonical harness regression.
- Commercial, safety, Tickets 39, 41/41A, 42/42A, 44–50, and harness regression group: **186 passed**.
- Full serial suite: **563 passed, 1 failed, 0 skipped** (564 tests).
- The sole failure remains the documented Ticket 37A test `generated migration and schema embed the backend function source exactly`, at `test/ticket-37a-logical-reply-recovery.test.js:82`. The schema snapshot does not include `RECOVERY_FUNCTIONS_SQL` verbatim. Those sources and the test were not edited.
- Canonical Sales Engine, Ticket 41A, and Ticket 48 regenerated inactive. Both harness `--check` commands pass. Repeating all three generators produces byte-identical artifacts. The canonical generator also emits the existing Recovery Poller; its generator logic was not modified and repeated output is identical.
- `outputs/ticket-51/scenario-g-fixture.json` records one scenario, five customer turns, no coverage warnings, no safety failures, and no unexpected commercial transitions. It is explicitly marked `MODEL_BOUNDARY_FIXTURES_NOT_LIVE_AI`; its synthetic Judge is not live acceptance evidence.

The initial sandbox HTTP-listener restriction was resolved by running the requested tests with local loopback permission. The initial full-suite shared-knowledge synchronization failures were resolved by keeping the new guidance in sales-only knowledge. No tests were removed or weakened.

Commands (use the bundled Node directory on PATH in this workspace):

```sh
node scripts/refactor-ticket-10-workflow.js
node scripts/generate-ticket-41a-chat-harness.js
node scripts/generate-ticket-48-harness.js
node scripts/generate-ticket-41a-chat-harness.js --check
node scripts/generate-ticket-48-harness.js --check
node --test test/ticket-51-fulfillment.test.js
node --test --test-concurrency=1
```

## Live acceptance and deployment status

No production deployment, activation, import, provider operation, or data mutation occurred. The authorized inactive import and live Scenario G run could not be performed: Computer Use returned `Computer Use permissions are not granted`, and no n8n connector is available.

`outputs/ticket-51/inactive-scenario-g-harness.json` is prepared from the regenerated Ticket 48 artifact. Its only differences are a descriptive workflow name and selection of `context_switching_001` in Load Test Scenario. It remains inactive and retains the generator's credential placeholders and side-effect exclusions.

Once n8n access is available, import that file as a separate inactive harness, map the existing harness-only OpenAI credential, manually run only `context_switching_001`, and retain its Test Report. Inspect final current-question coverage, timing uncertainty, notification uncertainty, reminder intent assertion, and the autonomous Judge. Do not run the eight-scenario live batch before Scenario G passes.

Production Sales Engine deployment remains a separate operation and is not authorized by this ticket. No migration is required.
