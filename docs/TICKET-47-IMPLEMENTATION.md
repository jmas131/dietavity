# Ticket 47 — medication scope, preference, and treatment intent

Implemented and validated locally. No deployment, production messages, migration, activation, or production data changes were performed.

## Evidence and root cause

The ticket provides observed generated/final text and a conversation progression, not production classifier JSON, session snapshots, or execution exports. The following causal explanation is based on the inspected canonical implementation; the tests execute local workflow nodes with explicitly supplied interpretations and generated responses. They do not reproduce live LLM calls or establish historical classifier values.

Both reported messages missed Ticket 44's complete-question matcher. It supported provider supply/sale/prescription and inclusion constructions but not `es con` or medication-free preferences. `glp1SafetyResponse` then matched the bare word `medicamento` and returned a prescriber referral, regardless of whether the supplied topic was `health_scope`. The GLP-1 policy selected this safety response before product handling, set `answer_question / health_scope`, and gave the validator a deterministic response. The validator selects `decision.deterministic_response` ahead of generation, so even correct generated product copy could not survive. This is a policy selection problem exposed at validation, not proof of a live classification error or a new validator defect.

Before-change source trace for either reported input:

1. Current input reaches interpretation; historical classifier values are unavailable.
2. The buyer signal can vary without preventing the GLP-1 safety branch.
3. Ticket 44 scope recognition returns null.
4. The medication lexical check returns the canonical clinical referral (even with null topic).
5. Policy resolves to `answer_question`, `health_scope`, zero questions, and the referral as `deterministic_response`.
6. Generate Sales Response v3 can produce correct product text, as reported in the ticket.
7. Validate Sales Response Contract selects the deterministic referral over generation.
8. Final output remains the referral; Checkout is not authorized.

`health_scope` was an additional route to referral, but was not necessary for these two failures. Stale medication context is likewise unnecessary to explain them. The generic policy did not execute the old GLP-1 lexical branch; however, stale `health_scope` classification could still select its health-topic fallback. The new current-turn scope/preference resolution applies in both generic and GLP-1 contexts.

## Implementation

`medicationIntent` identifies the current speech act using complete product and preference constructions, after checking clinical clauses and urgent symptoms. Medication terminology alone no longer triggers deterministic management handling. Unknown language can still use the existing classifier's conservative `health_scope` handling; classifier instructions now explicitly distinguish product questions and product rejection from medical advice.

- Product scope recognizes supply, sale, inclusion, medication requirement, and whether the program is medication-based. It retains Ticket 44's canonical product answer.
- Preference requires negation or a medication-free product construction. It returns: “Claro. Dietavity no vende ni receta medicamentos; es un programa de alimentación personalizado de 28 días.” It stays in `answer_question / product_scope`, records a rejection buyer signal, and does not close the conversation or authorize purchase.
- Treatment questions and symptom clauses take precedence, including mixed product/dose and rejection/stop-treatment requests. Urgent symptoms retain immediate-care wording. Existing final-output protection against generated dosing advice remains unchanged.
- Product responses clear stale health-topic selection and do not emit a spurious `health_question` event. They do not create a purchase-confirmation question.
- The classifier's current-message instructions complement deterministic handling. No new topic, classifier schema, service, or persistence mechanism was introduced.

Ticket 46's current-turn location handling and Ticket 45's informational validator remain unchanged and pass their regressions. No validator bypass or weakening was necessary. The existing strong-affirmation logic discards stale topic metadata and resolves `Si` against a valid active purchase-confirmation question. This passed with stale `health_scope` supplied in the sequential fixture; stale medication context did not block the final holding-page response.

## Reproduced sequence and categories

The local sequence runs in both the canonical workflow and generated Ticket 41A harness. The opener receives an information-request fixture; the two medication turns receive stale explicit-purchase/health-topic metadata; `Me interesa` receives positive-interest interpretation; `Si` receives stale health metadata again. Session question time, offer version, and expiry are advanced as the persistence path would do. Generated output is deliberately unsafe to verify deterministic selection.

| Current input | Resolved topic / intent | Strategy / deterministic result | Commercial state |
| --- | --- | --- | --- |
| ¡Hola! Quiero saber más. | null | discovery; unchanged Ticket 43 opening | no purchase question |
| Es con medicamento?? | product_scope / product_scope | answer_question; Ticket 44 product answer | no CTA or Checkout |
| No no me interesa con medicamento | product_scope / preference | answer_question; short acknowledgement above | no CTA or Checkout |
| Me interesa | null | explain_offer; existing offer and “¿Quieres comenzar tu programa?” | purchase_confirmation becomes active |
| Si | null | purchase_confirmation; `https://dietavity.com/programa-glp1` | holding_page_would_be_sent=true; checkout_authorized=false |

All scope and preference examples in the ticket are covered, plus requirement/medication-name variation, across stale and invalid interpretations and both offer contexts. Dose, start/stop, change, frequency, mixed scope/dose, mixed rejection/stop, vomiting, and urgent respiratory symptoms retain safety. Bare medication mentions do not independently trigger management. Existing genuine generic purchases retain Checkout; existing GLP-1 purchases retain holding interception. Weak acknowledgements remain nonauthorizing under historical regressions.

Harness reports now expose `health_scope`, `medication_intent`, `deterministic_response`, and `deterministic_reason`, alongside the existing current input, interpretation, topic, strategy, generated output, fallback identity, final output, CTA permission, next-question state, Checkout authorization and holding interception. The full five-turn fixture is in `test/ticket-47-medication-intent.test.js`; it executes the harness reporting node on every turn. No raw prompt or production conversation was added.

## Files

Canonical sources:

- `lib/sales-engine-v3.js`
- `scripts/refactor-ticket-10-workflow.js`
- `scripts/generate-ticket-41a-chat-harness.js`

Generated inactive artifacts:

- `n8n/Dietavity Sales Engine (Ticket 10).json`
- `n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json`

Tests/report:

- `test/ticket-47-medication-intent.test.js`
- `docs/TICKET-47-IMPLEMENTATION.md`

The canonical generator also writes the recovery-poller artifact through its existing generation process; no recovery logic was changed. This workspace has no Git metadata, so Git diff/status was unavailable.

## Validation

- Focused Ticket 47: 4/4 tests passed, with table-driven scope, preference, clinical, mixed, generic/campaign, stale/invalid classification, and sequential harness cases.
- Combined Tickets 41/41A/42/44/45/46/47: 49/49 passed. Ticket 43 opener behavior is covered by the existing canary tests and the new exact sequence (there is no separate Ticket 43 test file).
- Historical Tickets 8/8D/10/10A/10B/32/39: 69/69 passed.
- Final full canonical runner, `node --test --test-concurrency=1`: **438 tests, 437 passed, 1 failed, 0 skipped**. The bundled Node runtime was used because Node/npm were not initially on PATH. Generation synchronization and inactive-artifact checks passed.
- Sole failure: `test/ticket-37a-logical-reply-recovery.test.js:82`, exact `RECOVERY_FUNCTIONS_SQL` inclusion in `database/schema.sql`. This is the known discrepancy explicitly excluded from this ticket; schema, migration, recovery source, and assertion were not modified.
- The initial sandboxed full run also could not bind the local Ticket 42A HTTP server. The final run with localhost permission passed that test.

These tests use injected classifier/generated output; live model quality and production behavior were not exercised.

## Deployment and rollback — prepared, not executed

1. Save the deployed Sales Engine export, workflow ID, credentials, connections, and activation state before an authorized deployment.
2. Regenerate with `node scripts/refactor-ticket-10-workflow.js`, then `node scripts/generate-ticket-41a-chat-harness.js`. Review the inactive artifacts and the known independent Ticket 37A failure.
3. Import the harness into an authorized nonproduction n8n environment using its dedicated test credentials and fake identities. Run the five-turn sequence and product/preference/clinical/mixed cases; inspect all decision fields and final text. The harness persists test session and AI-memory state, so use its documented isolated setup.
4. After explicit authorization for production import/activation, apply the reviewed canonical Sales Engine through the existing deployment procedure. Verify environment-specific IDs and credentials. No migration, server/website deployment, or recovery-poller activation is required.
5. Verify the final canonical outbound body, clinical mixed-message precedence, and holding-page interception using an authorized controlled conversation.
6. To roll back, restore the saved Sales Engine export and original configuration/activation state through an authorized operation. Preserve ledger, session, and provider evidence; no data deletion or database rollback is required.
