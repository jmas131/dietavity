# Ticket 61 — Structured LLM Interpreter

## Scope

This ticket adds the disconnected v2 semantic boundary:

```text
ConversationContext -> injected structured model -> validated Obligation[]
```

`interpretConversation({ context, model })` in `lib/sales-engine-v2/interpreter.js` accepts only the canonical Ticket 60 context and an injected async model function. It returns `Obligation[]`; it does not expose a model SDK, credentials, a network client, customer prose, actions, persistence, fact lookup, or policy resolution. The versioned prompt is `config/sales-engine-v2/interpreter-prompt.js` (`ticket-61-v1`). The model receives a narrowly projected `{ current_message, history }` input, preserving the current/history distinction.

## Legacy inventory

| Legacy concept | Classification | v2 disposition |
| --- | --- | --- |
| buyer_signal | REPLACE_WITH_V2_CATEGORY | Decompose its current-turn meaning; it is not a retained whole-turn label. |
| explicit_purchase, contextual_affirmation | REPLACE_WITH_V2_CATEGORY | commercial_purchase_intent only when the current turn has that meaning. |
| ambiguous_acknowledgement, gratitude, rejection, other | REPLACE_WITH_V2_CATEGORY | Usually social_acknowledgement, zero obligations, or clarification only for genuine semantic uncertainty. |
| strategy, sales CTA/response strategy | RESPONSE_STRATEGY_NOT_INTERPRETATION | Composer/response planning concern; never emitted by the Interpreter. |
| objection_price, objection_trust, objection_timing, deferred_interest, ai_value_objection, human_preference | RESPONSE_STRATEGY_NOT_INTERPRETATION | Preserve any concrete fact/practical obligation without recreating objection taxonomy. |
| support_issue | KEEP_AS_OBLIGATION_SIGNAL | support_account when the current turn asks for account/support handling. |
| information_request, broad_information_request, question | REPLACE_WITH_V2_CATEGORY | Product/provider fact, practical guidance, conversational task, or another concrete category. |
| material_question | LEGACY_ONLY | Boolean collapse loses independent obligations. |
| topic (price, payment, inclusions, how-it-works, etc.) | KEEP_AS_OBLIGATION_SIGNAL | Normalized subject/attribute of an independent fact obligation; it is not an answer. |
| practical-guidance classifications | KEEP_AS_OBLIGATION_SIGNAL | practical_guidance. |
| unknown-capability/product-scope classifications | REPLACE_WITH_V2_CATEGORY | provider_service_fact; unknown truth belongs to resolution. |
| medication-sale/product-scope classification | KEEP_AS_OBLIGATION_SIGNAL | provider_service_fact. |
| GLP-1 health scope/dose/start/stop/timing classifications | KEEP_AS_OBLIGATION_SIGNAL | medication_management or safety_sensitive_nutrition, by current semantic request. |
| goal, goal_supplied | NEEDS_DECISION | A later bounded-reasoning/profile boundary may decide whether a nonsensitive goal is needed; Ticket 61 does not emit it. |
| timing_iso | RESOLUTION_CONCERN_NOT_INTERPRETATION | Preserve supplied timing text only; a later authority resolves time. |
| explicit_reminder_request | REPLACE_WITH_V2_CATEGORY | reminder_request, without scheduling. |
| checkout/reminder authorization, safety referral/prohibition, action eligibility | POLICY_CONCERN_NOT_INTERPRETATION | Ticket 59/downstream policy only. |
| session checkout flags, prior confirmation, stale buyer labels | COMMERCIAL_STATE_NOT_INTERPRETATION | Trusted operational context, never historical intent manufacture. |
| raw model drafts, internal execution IDs, legacy classifier repair metadata | LEGACY_ONLY | Excluded from the v2 Interpreter contract. |

## Contract and normalization

The Ticket 57 obligation enum is unchanged. Every emitted obligation has deterministic per-result IDs (`o-1` onward), an exact nonempty substring from `context.current_message.text`, semantic confidence (`high`, `medium`, or `low`), and an ambiguity flag. History can resolve a reference, such as a contextual `Sí` following a purchase-link question, but cannot manufacture a current obligation. Exact duplicate structured obligations are safely collapsed; distinct clauses remain independent.

Attributes are deliberately small interpretation metadata: `requested_fact`, `customer_candidate`, `customer_proposed_value`, `medication_decision`, `direction`, `requested_timing_text`, and `task_operation`. They cannot carry canonical answers, policy outcomes, authorizations, actions, or hidden reasoning. The structural limit is 10 obligations: it protects the boundary from malformed/unbounded model output and fails rather than truncating a customer turn.

Pure acknowledgements can yield `social_acknowledgement`; when a substantive obligation is present, the prompt instructs the model not to add a low-value acknowledgement merely because it appears as conversational filler. `clarification` is reserved for a genuinely unclear intended obligation, not unknown capability or product truth. Empty output is valid for nonsensical/no-actionable turns.

## Failure semantics

The interpreter fails closed with `InterpreterError`: `INTERPRETER_CONTEXT_INVALID`, `INTERPRETER_MODEL_FAILED`, `INTERPRETER_OUTPUT_INVALID`, `INTERPRETER_EVIDENCE_INVALID`, `INTERPRETER_ATTRIBUTES_INVALID`, or `INTERPRETER_OBLIGATION_LIMIT_EXCEEDED`. Output must be exactly a JSON object with an `obligations` array; arbitrary prose, extra fields, unsupported categories, ungrounded evidence, and invalid attributes are rejected. Failures are not converted to clarification and there is no regex or legacy-classifier fallback.

## Validation

`test/ticket-61-interpreter.test.js` uses injected fixed structured outputs, never a network/model call. These are **contract/validator tests**, not evidence that an LLM semantically interprets the fixtures correctly: the fixed model deliberately returns the asserted obligations. The 27-case matrix covers duration, medication sale plus dose, direct/contextual/non-purchase affirmatives, gratitude after purchase history, clear/ambiguous reminders, drafting and embedded medication, direct medication, unknown capability, plan/type questions, practical follow-up, four-way and two-fact decomposition, quoted speech, unclear turns, stale incorrect facts/medication/reminder history, punctuation-free Mexican Spanish, and prompt injection. Separate tests verify malformed output, evidence grounding, deterministic IDs, duplicate normalization, and Fact/Policy/provider isolation.

No safe isolated real-model harness is available in this repository: the existing model configuration is attached to the legacy production-shaped workflow/harness, while this ticket deliberately has no SDK, credentials, or live API dependency. Model-backed semantic evaluation was therefore **not run** and deterministic CI does not depend on it.

Production Sales Engine, n8n workflows, Recovery Poller, database, and customer traffic remain unchanged.
