# Ticket 44 — GLP-1 medication product scope

## Root cause and change

The canonical `glp1SafetyResponse` treated medication nouns, injection words, and an AI `health_scope` topic as sufficient for the medication-management fallback. `Generate Sales Response v3` uses the constrained prompt, but the final validator prioritizes the deterministic policy response over generated text. Thus even a correct generated answer could be replaced. The current repository places the source of that replacement in the policy, not in a separate medication classifier inside the validator.

`glp1ProductScopeResponse` now recognizes complete product-scope questions using the existing normalization. The matcher is anchored to the whole message: extra clinical clauses cannot obtain the exemption. Urgent symptom handling remains first. Only recognized pure scope questions are exempted from the broad medication/topic fallback. In `glp1_validation`, the existing deterministic policy returns the exact scope response with `topic: product_scope`, no purchase authorization, no purchase CTA, and no stored goal. The existing validator preserves that response and retains its output safety guard. No separate validator or model architecture was added.

Contextual clinical wording such as “¿Cuánto debo usar?” and “¿Cada cuánto me lo pongo?” explicitly receives the existing prescriber referral, including when AI interpretation is missing. Mixed requests such as “¿Ustedes dan Ozempic y cuánto debería usar?” receive that referral without dosing advice or a claim that Dietavity provides medication.

Exact final response to `Dan el medicamento glp1?`:

> No. Dietavity no vende, entrega ni receta medicamentos GLP-1. Somos un programa de alimentación personalizado de 28 días que te ayuda a organizar qué comer cada día. ¿Qué te gustaría saber sobre el programa?

## Files

- `lib/sales-engine-v3.js`: narrow scope matcher, deterministic response, contextual clinical detection.
- `scripts/refactor-ticket-10-workflow.js`: embeds the shared matcher in generated policy.
- `n8n/Dietavity Sales Engine (Ticket 10).json`: regenerated canonical artifact, inactive.
- `n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json`: regenerated from canonical artifact, inactive.
- `test/ticket-44-glp1-product-scope.test.js`: production wording, variants, invalid/stale interpretation, clinical and mixed requests, urgent symptoms, generic purchase behavior; executes generated policy and final validator.
- `test/ticket-41a-chat-harness.test.js`: product question and `¿Debo bajar mi dosis?` in the sequential conversation; verifies final `assistant_response`.
- `docs/TICKET-41A-CHAT-HARNESS.md`: manual sequence and current holding-page expectations.
- This report.

The canonical generator also writes the existing recovery poller artifact; no recovery source or behavior was changed.

## Validation

- Ticket 44: 3/3 tests passed, covering multiple variants per test.
- Tickets 41/41A/42/43 plus Ticket 44: 28/28 passed. Ticket 43 assertions live in the Ticket 41 and 41A files.
- Historical Tickets 8/10/39: 58/58 passed.
- Ticket 42A HTTP/presentation: 2/2 passed with localhost binding permitted.
- Full suite, `node --test --test-concurrency=1`: 417 tests, 416 passed, 1 failed, 0 skipped.
- Sole substantive failure: existing Ticket 37A assertion that `database/schema.sql` contains `RECOVERY_FUNCTIONS_SQL` exactly. Ticket 37A and schema were not modified.
- Environment: `npm` is unavailable, so the package's exact test command (`node --test`) was invoked with bundled Node. The sandbox initially denied localhost binding for Ticket 42A. An unsandboxed concurrent run encountered a Node child-test deserialization error; the serial run resolved that runner issue.

## Deployment (operator action; not performed)

1. Export and retain the currently deployed Sales Engine workflow and its activation/credential configuration for rollback.
2. Import the regenerated Ticket 41A harness inactive into the intended test environment, map its existing test credentials, and run the documented sequence. Inspect final `assistant_response`, including product scope and dose referral, with no Stripe or Twilio actions.
3. In the separately authorized production deployment window, import the regenerated canonical Ticket 10 workflow using the established deployment process. Preserve existing credentials, webhook configuration and error handler. Avoid simultaneous active copies of the sales webhook workflow.
4. Activate only with explicit authorization. Verify final validated/ledger responses and existing operational evidence for scope, clinical and mixed turns using authorized traffic.

No database migration, website deployment, Stripe/Twilio configuration change, or new environment variable is required.

## Rollback

Restore the saved pre-deployment workflow and its prior activation/credential configuration, ensuring only the intended sales workflow handles incoming traffic. Restore the previous policy/generator files and regenerate both canonical and harness artifacts if reverting the local implementation. No schema or data rollback is required. No production import, activation, message, or deployment was performed for this ticket.
