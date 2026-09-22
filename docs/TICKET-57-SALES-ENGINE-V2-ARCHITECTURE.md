# Ticket 57 — Sales Engine v2 architecture and canonical authority contracts

## Status and decision

This is an architecture contract, not a v2 implementation. It creates no migration, changes no runtime behavior, imports no workflow, and does not modify either production reference. The proposed v2 replaces the conversational decision core beside the existing operational pipeline; it does not replace the WhatsApp ledger, provider identity, ordering, delivery, recovery, payment-webhook, or setup infrastructure.

The central decision is a hard authority boundary:

| Class | Establishes | May never establish |
| --- | --- | --- |
| Canonical facts | current offer/product/provider truth | policy or action permission |
| Deterministic policy | safety handling, commercial and reminder authorization | facts absent from the fact store |
| Reviewed knowledge | eligible evidence for education/practical reasoning | Dietavity capability, policy, or action permission |
| LLM | turn interpretation, bounded reasoning, and Spanish composition | truth, policy, or authorization |

An LLM may classify `payment_method` or `medication_management.dose_change`; it cannot say that PayPal is accepted, determine a medication response policy, or permit Checkout. A retrieved document has the same limitation. `bounded_unknown` is a normal resolution, not an error.

JSON Schema is used for the machine-readable contract because the contracts are nested, versioned exchange documents that need validation at module and harness boundaries. It deliberately models interfaces, not a database migration: [sales-engine-v2-contract.schema.json](contracts/sales-engine-v2-contract.schema.json).

## Evidence inspected and production/development distinction

Inspected: the two immutable production references, current `n8n/Dietavity Sales Engine (Ticket 10).json`, `lib/sales-engine-v3.js`, `lib/dietavity-knowledge.js`, `database/schema.sql`, the Ticket 41A and Ticket 48 harnesses/generators, replay fixtures, and Ticket 41–56 focused tests.

The production reference is active and named `Dietavity Sales Engine (Ticket 10)`. It has 183 nodes. Its active Recovery Poller runs every minute, finds verified unfinished canonical inbound sessions, and executes the Sales Engine. Production already has the key operational path: Twilio normalization; `public.messages` inbound reservation; serialized per-session claim/lease; session/user/memory load; response reservation before Twilio; provider-SID acceptance evidence; reconciliation for ambiguous delivery; and completion only after accepted logical reply parts.

The repository development workflow has the same name but is inactive and differs materially from the reference. It includes accumulated un-deployed Tickets 49–56 conversational changes. It is useful evidence, including its tests and regressions, but neither its prompts nor its embedded constants establish production truth. The reference also shows an older `Postgres Chat Memory` node directly reading `onboarding_chat_memory`; v2 replaces that direct dependency with the adapter below.

## Current-state inventory and disposition

| Current component/location | Current responsibility and authority/problem | v2 disposition and migration implication |
| --- | --- | --- |
| Production canonicalization, `messages`, claims, leases, ordering, multipart reply reservation, Twilio evidence/reconciliation | Durable operational authority; correct side-effect protection | **KEEP**. v2 starts after a claimed inbound has its context loaded and ends before existing final reply reservation/delivery. |
| Recovery Poller reference | Resumes verified WhatsApp work into existing queue | **KEEP**. No conversational decision lives here. |
| Stripe webhook purchase verification and one-time purchase persistence | Payment evidence and post-payment setup path | **KEEP**. v2 may authorize a checkout request; it does not validate payment. |
| `onboarding_sessions` commercial fields | Current stage, last question, offer context, checkout/reminder evidence | **KEEP / MOVE_TO_POLICY**. Read through a session adapter; commercial context becomes deterministic policy input, not prompt text. |
| `onboarding_chat_memory.message` and Postgres memory node | Mutable LLM-oriented history, currently coupled to n8n node semantics | **REPLACE_IN_V2_CORE** with Memory Adapter; retain table initially for compatibility. |
| `lib/dietavity-knowledge.js` `PRODUCT_FACTS`, `MULTI_TOPIC_ANSWERS`, business modality/offer strings | Product truth is duplicated in prompt prose, JS constants and canned answers | **MOVE_TO_FACT_STORE**. Seed only verified facts listed below, versioned by offer. |
| `sales-engine-v3.js` commercial classification, affirmation and checkout/reminder logic | Regexes plus session context decide action; valuable invariants but tightly coupled to current intents | **MOVE_TO_POLICY**. Re-express as small deterministic policies fed by obligations, never parser regex alone. |
| GLP-1 dose/start/stop/change and urgent-response functions | Safety policy encoded partly in regex/prompt and deterministic response | **MOVE_TO_POLICY**. Interpreter recognizes the request; policy selects required handling. |
| Food philosophy, practical meal rules, GLP-1 nutrition education | Prompt material used for generation | **MOVE_TO_KNOWLEDGE** after content review/versioning; it is not product truth. |
| Large interpreter/composer prompts and agent nodes | Mix interpretation, facts, safety, style, and response generation | **REPLACE_IN_V2_CORE** with Interpreter and Composer contracts. |
| Deterministic response strings and broad validator/fallback (`responseViolatesContract`, response-contract helpers) | Enforces some real guarantees, but can replace a valid multi-part output with generic prose | **REPLACE_IN_V2_CORE** with narrow unit-level gate; migrate exact safety/canonical-value checks. |
| Buyer-signal/strategy taxonomy and funnel event mappings | Analytics and current routing are intertwined | **NEEDS_DECISION**. Preserve required event evidence; map v2 decisions to existing event keys during coexistence, then retire implementation-specific labels. |
| Legacy subscription cancellation branches | Separate legacy lifecycle | **LEGACY_OR_RETIRE** only after independent lifecycle review; it is out of v2 scope. |
| Ticket 41A harness | Has production-like nodes and persistent-memory coupling | **LEGACY_OR_RETIRE** as v2 harness implementation; retain as regression source. |
| Ticket 48 harness | Isolated memory/state, intercepted Checkout/reminder, judge and transcript | **KEEP** as design input, then **REPLACE_IN_V2_CORE** invocation with the same v2 contracts. |

## Canonical fact inventory and proposed store

Actual currently embedded facts include: offer `28d-149-v1`; program duration 28 days; $149 MXN; one payment/no subscription/no automatic renewal; breakfast/lunch/dinner/snack; portal delivery; post-verified-payment personalization; start from today through 30 calendar days; on-demand WhatsApp help for recipes, meal ideas, practical guidance and restaurant guidance; credit card, debit card, OXXO and Apple Pay; digital-only/no in-person location/no prepared-food delivery; and Dietavity does not sell, deliver, or prescribe GLP-1 medication. The source also explicitly leaves unknown: public refund policy, international/other-currency pricing, service response SLA, meal-generation time, automatic availability notification, and unlisted capabilities such as video calls or automatic batch-cooking adaptation.

The fact store must represent values, not canned customer prose. Minimum proposed future Postgres table (not created by this ticket):

```sql
product_facts (
  id uuid primary key,
  fact_key text not null,                 -- e.g. offer.price, service.prepared_food_delivery
  offer_version text null,                -- null only for cross-offer service truth
  scope jsonb not null default '{}',      -- provider/channel/locale if materially scoped
  state text not null check (state in ('known_true','known_false','unknown','not_applicable','deprecated')),
  value_type text not null,               -- money, integer, boolean, enum, enum_set, object, text
  value jsonb null,                       -- structured value required for known states as applicable
  valid_from timestamptz not null,
  valid_to timestamptz null,
  version integer not null,
  provenance text not null,               -- approved source/change record, never an LLM
  status text not null check (status in ('active','deprecated','draft')),
  created_at timestamptz not null,
  updated_at timestamptz not null
)
```

Future constraints must prevent overlapping active `(fact_key, offer_version, scope)` validity windows and require one current active version. `unknown` carries no asserted value; `not_applicable` means the fact does not apply in scope; `deprecated` is historical and never resolves a current turn. Candidate initial rows include structured `{amount:149,currency:"MXN"}`, `{days:28}`, `one_time`, payment-method enum set, meals enum set, `{minimum_days:0,maximum_days:30}`, and boolean service facts. A seed/reconciliation ticket must compare every row against a reviewed source before it becomes authoritative.

## Canonical contracts

The normative schemas are in the JSON Schema. Important field semantics and representative examples follow.

### ConversationContext

`ConversationContext` is the only conversational-core input; it has no n8n node name. `current_message` is explicit and has precedence over history except where deterministic policy allows a recent clarification/purchase context to disambiguate a short reply. `authoritative_context` holds normalized server-derived data; `informational_context` holds non-authoritative reviewed/retrieved material.

```json
{
  "contract_version": "2.0", "context_id": "inbound:SM...", "locale": "es-MX",
  "current_message": {"id":"inbound:SM...","role":"customer","text":"¿Cuánto cuesta?","occurred_at":"2026-09-22T12:00:00Z"},
  "history": [{"role":"assistant","text":"Puedo explicarte el programa.","occurred_at":"2026-09-22T11:59:00Z"}],
  "session_state": {"session_id":"whatsapp:+52...","conversation_stage":"evaluating"},
  "offer_context": {"offer_version":"28d-149-v1","context":"standard"},
  "customer_state": {"user_id":null,"paid":false},
  "commercial_state": {"checkout_sent":false,"valid_purchase_confirmation":false},
  "metadata": {"inbound_message_id":"uuid","provider":"twilio"},
  "authoritative_context": {"fact_snapshot_version":"2026-09-22.1"},
  "informational_context": {"knowledge":[]}
}
```

### Obligation and ResolvedObligation

An Interpreter returns one independent `Obligation` per actionable request. Categories are deliberately execution-oriented: `product_fact`, `provider_service_fact`, `practical_guidance`, `conversational_task`, `commercial_purchase_intent`, `reminder_request`, `medication_management`, `safety_sensitive_nutrition`, `clarification`, `support_account`, and `social_acknowledgement`. It supplies normalized subject, current-turn evidence, confidence, and ambiguity; no answer or authorization.

```json
{"id":"o-payment","category":"provider_service_fact","subject":"payment_method.paypal","current_turn_evidence":"aceptan PayPal","confidence":"high","ambiguous":false}
```

Each resolver emits one `ResolvedObligation`, with `resolution_status`, authority class, explicit provenance (`source.type`/ID/version), allowed and prohibited claims, and an explicit action decision when relevant. Provenance types are `canonical_fact`, `deterministic_policy`, `reviewed_knowledge`, `generated_guidance`, `conversational_generation`, and `system`. Generated guidance must carry a bounded-reasoning model-run ID; conversational generation must carry a Composer model-run ID. Neither may use a canonical-fact, policy, reviewed-knowledge, or system provenance type. Allowed authorities are `canonical_fact`, `deterministic_policy`, `commercial_authorization`, `reviewed_knowledge`, `generated_guidance`, `conversational_generation`, `bounded_unknown`, `clarification_required`, `prohibited`, and `resolver_failure`. `resolver_failure` is observable and fail-closed for actions; it is not silently converted to a fact.

`deferred` is a lifecycle state, not an authority. It has `authority: null`, `source: null`, no factual payload, policy decision, or action, and a closed `next_stage` value. It records a valid obligation intentionally reserved for a permitted later resolver: practical guidance is `reviewed_knowledge_or_reasoning`, conversational tasks are `conversational_generation`, support/account is `support_resolution`, and a pure social acknowledgement is `response_composition`. Deferred does not mean Dietavity lacks an answer or capability.

### Authority and source compatibility

The normative schema requires a `source` field, but source absence is explicit rather than a provenance escape hatch. `canonical_fact` requires canonical-fact provenance; `deterministic_policy`, `commercial_authorization`, and policy-established `prohibited` require deterministic-policy provenance; `reviewed_knowledge`, `generated_guidance`, and `conversational_generation` require their matching provenance (including the existing generated model-run/stage requirements). `bounded_unknown` permits either a canonical-fact source for a reviewed unknown or `null` for an absent/unreviewed source. An authority of `clarification_required` is `null` when ambiguity requires clarification before any policy matches; a deterministic policy that itself requires clarification retains `deterministic_policy` authority and provenance. `resolver_failure` is `null`: it records that no authority established a result and must remain observable/fail-closed, rather than claiming invented system provenance. This is intentionally distinct from policy prohibition, which retains its deterministic-policy source.

```json
{"obligation_id":"o-payment","resolution_status":"resolved","authority":"bounded_unknown","source":{"type":"canonical_fact","id":"payment_method.paypal","version":"2026-09-22.1"},"customer_uncertainty_required":true,"allowed_claims":["No tengo un método PayPal confirmado."],"prohibited_claims":["Aceptamos PayPal"]}
```

### AuthorizedAction and ResponsePlan

`AuthorizedAction` is distinct from wording and exists only for an action that deterministic policy has authorized. Action types are `create_checkout`, `provide_checkout_destination`, `provide_holding_page_destination`, `schedule_reminder`, `persist_commercial_transition`, and `update_conversation_state`. It contains the deterministic-policy source, exact `authorizing_rule`, parameters, structured constraints, preconditions, idempotency requirements, and `status: "authorized"`. Policy outcomes such as prohibition, rejection, clarification, and no applicable rule belong in `ResolvedObligation.policy_decision`; they are not contradictory action objects. A later executor derives concrete idempotency keys from authoritative inbound/session identity and performs no reinterpretation of customer text.

Commercial policy consumes a deterministic `commercial_state.safety_gate`: `clear`, `blocked`, or `indeterminate`. The future resolution boundary derives it only from current-turn deterministic safety outcomes: no current relevant blocker is `clear` where policy permits that absence; a blocking policy outcome is `blocked`; a safety resolver failure or unavailable determination is `indeterminate`. History and Interpreter confidence never establish it. Ticket 59 alone defines that only `clear` permits commercial authorization.

```json
{"action_type":"create_checkout","authorization_source":"deterministic_policy","authorizing_rule":"commercial.checkout.explicit_current_request.v1","parameters":{"offer_version":"28d-149-v1"},"preconditions":["current explicit purchase obligation","no safety prohibition"],"idempotency":{"required":true,"key_scope":"inbound_message"},"status":"authorized","expires_at":"2026-09-22T12:15:00Z"}
```

`ResponsePlan` combines resolved obligations without granting the Composer any new authority: required coverage IDs; canonical facts/policy outcomes to communicate; permitted reasoning inputs; approved knowledge references; required safety language; uncertainty; authorized actions; prohibited claims/actions; maximum question count; locale; and a coverage-completion requirement. Composer output is a candidate response plus no action authority.

## Policy and resolver model

Policy code is small, deterministic, unit-testable Node modules with versioned rule identifiers. It is not a generic rules service.

| Policy family | Inputs | Output |
| --- | --- | --- |
| Safety | medication/symptom obligation, current message, allowed context | prohibition/required escalation wording; no medication dose/start/stop/change advice |
| Commercial | purchase obligation, valid current confirmation context, offer, checkout state, material/safety obligations | authorized/rejected Checkout action |
| Reminder | explicit reminder obligation, resolvable time, existing schedule | schedule action or clarification; never proactive |
| Conversation/action | ambiguity, required clarification, current-turn precedence | clarification/no action, question budget |
| Support/account | normalized account state and support request | deterministic support route or bounded unknown |

Infrastructure invariants are not conversational policies: provider SID validation, message reservation, idempotency, session leases/order, Twilio delivery evidence, reconciliation, and ledger persistence remain operational guards.

Resolver order is: safety policy for affected obligations; canonical fact lookup; commercial/reminder authorization; support/account resolver; reviewed-knowledge eligibility; optional bounded reasoning. One resolver failure or unknown remains attached to its obligation and cannot replace a resolved sibling.

## Memory Adapter

Production adapter input is `onboarding_chat_memory` rows for the session, ordered only by `occurred_at`. Equal timestamps cannot be ordered from random UUID identity: distinct equal timestamps fail `MEMORY_ORDER_AMBIGUOUS` rather than inventing chronology. It may use final accepted outbound `messages.body` as the durable correction source where current memory is incomplete. It emits only `{role: customer|assistant, text, occurred_at, source_id, final_visible}`. It drops raw model drafts, hidden prompts, execution IDs, credentials, and arbitrary metadata. It validates JSON/message shape, drops malformed entries with an observable diagnostic, and returns `[]` for empty memory. It uses a bounded recent window defined by a future configuration, preserving the current message separately. Existing rows remain supported through role/content adapters; unknown shapes are not guessed.

The isolated harness uses in-memory synthetic entries passed through the same normalization function and never writes `onboarding_chat_memory`, `messages`, or any production table. Memory is context only—never fact, policy, or authorization evidence.

## Interpreter, knowledge, reasoning, Composer, and gate

**Interpreter.** Input: `ConversationContext`; output: validated `Obligation[]` only. It gives the current turn priority, may use normalized history to interpret a genuinely short/ambiguous reply, and must mark ambiguity instead of forcing an intent. Parse failures get one bounded repair attempt; failure creates an observable `clarification_required`/`resolver_failure` path and no side effects. It cannot emit facts, policy outcomes, or actions.

**Knowledge.** `RetrievedKnowledge` has source ID/version, review status, domain/topic, effective/review dates, relevance metadata, and an excerpt/reference. Only approved reviewed content is eligible for health/nutrition reasoning. Food philosophy, meal-prep rules, GLP-1 education, recipes and substitution guidance are candidates. Price, payments, delivery, subscription, offer eligibility, safety and authorizations are never retrieval queries.

**Future vector RAG.** Do not add pgvector or an external system now. Evaluate Supabase/Postgres `pgvector` first if an approved corpus grows beyond structured/full-text retrieval. It may retrieve reviewed nutrition, recipes, substitutions, practical preparation, or large reviewed FAQ material. Semantic similarity never establishes transactional product truth, medication/safety policy, or Checkout/reminder authorization; all such obligations bypass RAG to deterministic resolvers.

**Bounded reasoning.** The reasoning model receives resolved facts, policy outcomes, approved knowledge, relevant customer-provided data, and explicit permitted/prohibited claims. It may draft practical meal organization, education, a rewrite, summary, or message. Bounded-reasoning output uses only `generated_guidance` provenance with its model-run ID; Composer output uses only `conversational_generation` provenance with its model-run ID. Neither can become a product capability or be relabeled as a canonical fact, policy, reviewed knowledge, or system output. No sensitive profile solicitation is permitted in pre-purchase sales.

**Composer.** Receives only `ResponsePlan` and permitted generated material; returns natural Mexican Spanish candidate text and coverage annotations. It must cover each response-plan obligation, preserve uncertainty/safety wording, and use no more than the plan’s question budget. It cannot add actions or alter source classes.

**Final deterministic gate.** Enforce only: all required obligation coverage; exact canonical values where supplied; mandatory safety outcome; absence of forbidden medication advice/internal IDs/unsupported provider claims; question budget; and response/action consistency. It repairs or removes the smallest offending obligation clause, then rechecks coverage. Whole-response rejection is reserved for empty/unparseable output, an unremovable safety/action contradiction, an inability to preserve required coverage after repair, or a system failure. It is not permitted to infer intent, find new facts, or replace a valid multi-topic answer with a generic fallback.

### Exact boundary answer

Authoritative resolution ends after deterministic resolvers produce `ResolvedObligation[]` and `AuthorizedAction[]`; only those can establish current Dietavity truth, safety result, uncertainty state, or permission. The LLM may interpret what the person means, reason over permitted facts/policy/approved knowledge, and generate wording. Retrieved knowledge may inform education or practical reasoning only. Neither may establish facts, policy, eligibility, Checkout, reminder, or any side effect. The `ResponsePlan` retains provenance type/ID/version (and model-run ID for generated material) plus allowed/prohibited claims through Composer, and the gate validates that those authority distinctions survived output composition.

## Representative traces

| Case | Interpreter obligations → resolution | Plan/composer/gate/actions |
| --- | --- | --- |
| A: “¿Cuánto cuesta?” | `product_fact:offer.price` → canonical fact `{149, MXN}` | Plan requires price coverage; Composer says it naturally; gate verifies `$149 MXN`; no action. |
| B: “¿Cuánto cuesta, aceptan PayPal y puedo cocinar solo dos veces por semana?” | price → canonical fact; PayPal → `bounded_unknown` unless a fact row exists; cooking → `practical_guidance`, optional approved practical knowledge and generated guidance | Plan contains all three with distinct sources. Composer combines price, explicit PayPal uncertainty, and practical two-day suggestion. Gate preserves all three and blocks a claim that Dietavity offers a batch-cooking feature; no action. |
| C: “¿Qué incluye y debería bajar mi dosis de GLP-1 si casi no tengo hambre?” | includes → canonical fact; `medication_management.dose_change` → safety policy prohibition/referral; a nutrition guidance obligation may be eligible only if separately safe | Plan requires inclusion answer plus safety wording. Composer cannot dose-advise. Gate rejects dose-change advice while retaining product answer; no action. |
| D: “Hazme más corto ese mensaje.” | `conversational_task:rewrite` → permitted conversational generation using referenced visible text | Plan requires transformed text; Composer produces concise Spanish. Gate removes prohibited claims without replacing the task with product uncertainty; no action. |

## Production mapping and harness v2

```
Twilio inbound → existing canonical reservation/order/claim → load user/session/memory
→ Memory Adapter + Context Builder → v2 Interpreter → deterministic resolvers
→ reviewed retrieval (eligible obligations only) → bounded reasoning → ResponsePlan
→ Composer → narrow gate → AuthorizedAction execution → existing reply reservation/Twilio/delivery/recovery
```

Existing n8n retains ingress, orchestration, session/database loading, Stripe/Checkout execution, reminder transport, ledger writes, delivery and recovery. The v2 core should be Node modules invoked by a small adapter; n8n no longer owns product prose, safety/commercial rules, or broad validators. Current Sales interpreter/policy/composer/validator nodes eventually disappear or become adapters; no production mapping is implemented here.

Harness v2 calls the same Context Builder/Memory Adapter, Interpreter, resolvers, knowledge boundary, reasoning, Composer, and gate in-process with synthetic identity and isolated state. Checkout/reminder/action executors are interception stubs that verify authorization/idempotency shape and record no external effect. Customer/Judge remain outside v2. Primary evaluation: coverage, canonical exactness, unknown handling, safety, no invented capability, task completion, current-turn precedence, and action authorization—not exact prose.

## Regression corpus migration map

| Acceptance asset | v2 category |
| --- | --- |
| Tickets 8, 16, 20, 42, 44, 46, 51 | product-truth and commercial/context invariants |
| Tickets 41, 47, 54 | safety-policy invariant |
| Tickets 45, 49, 50, 52, 53 | conversation-understanding/current-turn/multi-obligation invariant |
| Ticket 56 | knowledge/reasoning versus capability-boundary invariant |
| Ticket 55 | composition/conversational-task completion invariant |
| Tickets 9, 17, 28, 34, 37A, 40 and production references | infrastructure and commercial-action invariants |
| Tickets 41A and 48 harness artifacts | harness isolation/contract acceptance asset; implementation-specific node-equality assertions become obsolete after adapter replacement |

Do not delete or weaken this corpus. Recast current regex/node-specific assertions only after equivalent v2 invariant tests exist.

## Staged migration, rollback, risks, and next tickets

1. **A — contracts and authority inventory:** approve this schema, fact dictionary, policy vocabulary, reviewed-knowledge governance, and fact-source ownership. No traffic.
2. **B — v2 core beside production:** implement pure modules/adapters and fact-store migration/seed in a separate ticket; no workflow cutover.
3. **C — deterministic and historical tests:** replay Tickets 41–56 plus infrastructure suites against v2 contracts.
4. **D — isolated harness:** replace harness core with v2 and prohibit DB/Twilio/Stripe actions.
5. **E — shadow mode:** evaluate real messages with v2 but execute/send nothing. Require data minimization, access controls, retention policy, redacted observability, and no raw sensitive prompt logs.
6. **F — controlled canary:** explicit eligible traffic slice, independent metrics, durable action correlation, kill switch and per-session rollback to v1.
7. **G — cutover:** only after approved acceptance criteria, replay parity and operational evidence.
8. **H — retirement:** remove old prompts/regex/validators only after stable cutover and rollback window.

Rollback boundaries: before v2 action execution, select v1 for the session; after an authorized action is persisted, retain the canonical ledger/action state and reconcile rather than rerun either core. Never replay a claimed inbound into both action paths. Shadow data must not create customer-visible or funnel side effects.

Open decisions: approved factual provenance/owner and effective-date governance; exact fact key dictionary; reviewed-knowledge approval workflow; support/account resolver scope; retention/redaction and access control for shadow records; whether v2 uses `onboarding_sessions` fields directly through an adapter or a versioned projection; and canary eligibility/metrics. Risks are a stale or incomplete fact seed, policy/fact confusion during migration, data exposure in shadow telemetry, semantic-parser false negatives, and accidentally duplicating an action at a boundary. These are mitigated by explicit unknowns, schema validation, source/version logging, contract replay, and retaining current ledger/idempotency infrastructure.

Recommended next implementation ticket: **Ticket 58 — create the versioned fact dictionary/store migration plus read-only Fact Resolver and seed-verification tests.** It must not route customer traffic, alter the current workflow, or make the LLM authoritative.
