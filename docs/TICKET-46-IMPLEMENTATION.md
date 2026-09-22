# Ticket 46 — current-turn intent and business-modality fallback

Implemented locally; no production operation was performed. No migration was added.

## Evidence and root causes

The ticket supplies observed generated price/payment copy and the final generic opener, but no live classifier JSON, persisted session snapshot, prompt, model memory, or execution export. The reproductions below execute the repository's policy and generated validator with explicitly supplied classifier/model outputs. They are not a replay of the production LLM and do not establish its actual classification values.

Two defects were reproduced before editing:

1. **Missing current business-topic recognition.** There was no business/location topic in the parser allowlist, material-topic taxonomy, deterministic current-message recognition, or topic fallback map. Supplying stale `buyer_signal=question, topic=price, material_question=true` for the location question produced `answer_question / price` and a final price answer. The response-builder contract repeated that erroneous topic to the generator. Existing knowledge described portal delivery and WhatsApp assistance but did not explicitly explain digital versus in-person service. These are reproducible ways for stale commercial classification to dominate a new location question. They do not prove why the live model chose payment copy.
2. **Unconditional discovery replacement.** Supplying `buyer_signal=information_request, topic=null` for the location turn after the canonical opening and price turn produced `strategy=discovery, next_last_question_type=primary_goal`. The existing late `information_request && !goal && !session.goal` policy branch did not distinguish a specific unrecognized question from discovery. `Validate Sales Response Contract` then unconditionally selected `fallback.discovery` for discovery without a deterministic response. This reproduces the ticket's exact generic opener, even with otherwise valid generated text: it is a strategy replacement, not necessarily a validation rejection. The location guard now prevents this wrong strategy for recognized location questions without deleting legitimate initial discovery.

**Ticket 45:** Its answer-question same-topic fallback was bypassed in the reproduced discovery path. In the stale-price path the validator did run its answer-question handling, but the topic was price, so it could not repair to location. Whether either exact path occurred in production remains unknown without the execution export.

**Message and memory:** `Generate Sales Response v3.text` already reads `Set Session Id.chatInput`, so the repository does not demonstrate a lost/replaced current input. Postgres chat memory remains attached. It could bias LLM interpretation/generation, but its live contents and causal role are unavailable. Recent accepted assistant text does not independently turn the exact location phrase into price/payment in deterministic policy. A preceding price turn is not necessary: standalone questions and generic-context conversations exhibit the same missing-topic vulnerability. Stale purchase-confirmation state is also unnecessary, though it is covered by the new regressions.

## Reproduced decision trace

The pre-change sequential fixtures used:

| Current input | Supplied interpretation | Policy strategy/topic | Final response/state |
| --- | --- | --- | --- |
| `¡Hola! Quiero saber más.` | valid `information_request`, null topic | `discovery`, null | Ticket 43 campaign introduction; next question null |
| `¿Cuánto cuesta?` | valid `question`, `price`, material=true | `answer_question`, `price` | $149 one-time answer; next question null |
| `En donde están ubicados ?` (case A) | valid `question`, `price`, material=true | `answer_question`, `price` | Price response, no location answer |
| Same third input (case B) | valid `information_request`, null topic | `discovery`, null | Exact generic goal-discovery opener; next question `primary_goal` |

The sequence retained `offer_context=glp1_validation`, advanced from `new` to `evaluating`, and did not authorize Checkout. These are local fixture values, not inferred production values. The injected generated text described $149, portal, card/OXXO/Apple Pay and asked for a payment preference.

After the change, both third-turn cases and invalid interpretation resolve to:

```text
current input: En donde están ubicados ?
parsed interpretation: retained for inspection (including stale price, if supplied)
resolved buyer_signal: question
resolved topic: business_location
material_question: true
strategy: answer_question
pending_action: respond
allow_purchase_cta: false
checkout_authorized: false
next_last_question_type: null
purchase_intent event: absent
holding-page interception: absent
Checkout interception: absent
fallback_identity for injected payment copy: same_topic:business_location
```

The generator receives the current input both in its existing user-message expression and explicitly in the response contract. Its instructions make clear that history resolves ambiguous references rather than replacing a clear current question. The validator preserves a relevant supported natural response, otherwise returns:

> Dietavity es un servicio digital 😊 El programa se consulta en nuestro portal y el apoyo durante el programa es por WhatsApp.

The final validated body follows the existing response-state/ledger/delivery path. The Ticket 41A harness returns that body through `Return Chat Response` (last-node Chat response mode). No new downstream response generator, message transport, or conversation store was introduced.

## Implementation and boundaries

- Added `business_location` to the existing classifier/parser/material-topic contract, with semantic instructions and deterministic structural recognition of business location, premises and service modality. The detector excludes customer-location statements, recipe location and payment-location questions. Broader paraphrases can use the classifier topic.
- Current recognized location questions override stale price/payment, broad-information, purchase-positive or invalid classification and stale commercial question state. They clear discovery goals/next-question state for this answer and do not create purchase authorization.
- Added a canonical digital-service answer and sales-only modality knowledge. Existing product facts already establish portal delivery and WhatsApp assistance. The implemented offering has no in-person appointment/service path; the new wording describes the digital service and does not assert an organization's physical address or geographic availability. Existing prepared-food scope is preserved. No address was derived from billing, infrastructure or personal data.
- Added a topic relevance/factual boundary after existing safety checks. It preserves natural digital-service answers, rejects unrelated price/discovery copy and unsupported premises/coverage/delivery claims, and uses a factual same-topic fallback. Existing Ticket 44 medication safeguards retain precedence; Ticket 45 informational preservation remains intact.
- Mixed location/payment questions reuse the existing commercial response composer to answer both subjects. They remain informational. Standalone genuine purchase requests retain generic Checkout and GLP-1 holding-page behavior.
- Ambiguous `¿Y cómo funciona eso?` retains classifier/history interpretation. Memory was not removed or reset. This is tested with payment context; live LLM interpretation is not claimed as locally verified.
- Harness reports include current input, parsed interpretation, resolved topic/material question, strategy, generated/final responses, authorization, next-question state, interception evidence and fallback identity. No raw prompt was added to production analytics.

## Files

Sources:

- `lib/sales-engine-v3.js`
- `lib/dietavity-knowledge.js`
- `lib/sales-response-contract.js`
- `scripts/refactor-ticket-10-workflow.js`
- `scripts/ticket-46-workflow.js`
- `scripts/generate-ticket-41a-chat-harness.js`

Generated artifacts:

- `n8n/Dietavity Sales Engine (Ticket 10).json`
- `n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json`

Verification and report:

- `test/ticket-46-current-turn-location.test.js`
- `docs/TICKET-46-IMPLEMENTATION.md`

The canonical generator also writes the recovery-poller artifact as part of its normal execution; no recovery-poller logic was edited. This workspace has no `.git` directory, so a Git diff/status was unavailable.

## Validation

- Ticket 46: **7/7 tests passed**, including the exact sequential fixture in canonical and harness nodes, generic/campaign contexts, eight variants across stale/invalid interpretations, factual preservation/fallback, parser paraphrase support, mixed intent, contextual follow-ups and safety precedence.
- Tickets 41/41A/42/43/44/45 plus Ticket 46: **45/45 passed**. This includes genuine `Quiero comprarlo`, `¿Cómo pago?`, `Mándame el enlace`, weak acknowledgements and medication regressions.
- Historical Sales Engine suites (8, 8D, 10B, 32, 39): **57/57 passed**.
- Final full canonical suite, run serially with `node --test --test-concurrency=1`: **434 tests, 433 passed, 1 failed, 0 skipped**. This directly runs the `node --test` runner from `package.json`; `npm` and `node` were not initially on PATH, so the bundled Node executable was used.
- Sole remaining failure: `test/ticket-37a-logical-reply-recovery.test.js:80`, assertion that `database/schema.sql` includes the exact `RECOVERY_FUNCTIONS_SQL`. It is the known historical discrepancy identified by the ticket. Neither schema nor recovery SQL was changed.
- An initial run could not bind the Ticket 42A localhost HTTP test server (`EPERM`). The rerun with local-server permission passed that test. This was an environment restriction, not an application regression.
- Initial shared-product-knowledge edits revealed auditor artifact synchronization coupling. The added modality knowledge was scoped to sales knowledge; auditor artifacts and analytics behavior were preserved, and their synchronization tests pass.
- Workflow regeneration and harness synchronization tests pass; both import-ready artifacts remain inactive.

No production n8n/LLM, database, Stripe or Twilio execution was performed. Local fixture tests validate policy/validator wiring and injected model outputs, not live model quality.

## Deployment and rollback (not executed)

1. Preserve/export the currently deployed Sales Engine and its workflow ID, credentials, connections and activation state before making any production change.
2. Regenerate locally using `node scripts/refactor-ticket-10-workflow.js` followed by `node scripts/generate-ticket-41a-chat-harness.js`; verify the synchronized inactive artifacts and review the known Ticket 37A discrepancy separately.
3. Import the inactive Ticket 41A harness into an authorized nonproduction environment, using its dedicated test credentials and fake identities. Run the exact three-turn sequence, standalone variants, payment-to-location switch, ambiguous follow-up and genuine purchases. Inspect the added fields and verify that Checkout/holding outcomes match the intended context. The harness writes test session/memory state, so do not point it at production casually.
4. Only after explicit authorization for production import/activation, apply the reviewed canonical Sales Engine artifact using the existing deployment procedure and verify environment-specific workflow/credential references. No migration or website/server deployment is required for this change. Do not activate the recovery poller as part of this ticket.
5. Verify one controlled conversation with the expected current topic, final canonical outbound body and no unintended Checkout/holding action. Preserve existing error handling and delivery reconciliation.
6. If rollback is needed, restore the pre-deployment Sales Engine export and its original activation/configuration through an explicitly authorized operation. Preserve canonical messages, session history and provider evidence; no database rollback or data deletion is needed.
