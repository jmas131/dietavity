# Ticket75C.0 — Production Runtime Adapter Discovery

## Determination

**DISCOVERY_COMPLETE_READY_FOR_T75C_1.** The repository contains the v2 domain pipeline and Ticket65D durable action lifecycle, but no checked-in production model adapters, Ticket65D Supabase RPC composition, or Ticket68 invocation in the claimed-turn endpoint. This document is static repository evidence only; no production service, secret, model, payment provider, or database was read.

## Executable call graph

`server.js` mounts `createClaimedTurnRuntime()` at `/internal/sales-engine-v2/claimed-turn`. Its executable path is: authenticate → route authorize → `createCanonicalClaimVerifier` → `createCanonicalInputAdapter.build` → intentional `runtime_not_configured` failure. T75C.3 replaces only that final seam.

The injected Ticket68 path is `runSalesEngineV2Turn({conversationContext, dependencies, runContext})`:

```text
interpreterAdapter → resolveObligations(factResolver, policyResolver)
→ knowledgeStore / boundedReasoningAdapter → semanticGuidanceAssessor
→ ResponsePlan → artifactReproductionAssessor → Ticket65D executor
→ FinalComposerInput → composerAdapter → finalResponseAssessor
→ eligible TurnResult → createPostGateDeliveryManifest (Ticket68A)
```

Ticket68 owns no database, provider, or delivery write. Ticket68A receives only an eligible in-memory result/companion and creates the delivery manifest; it does not reserve/send/complete.

## Runtime dependency inventory

| Dependency | Caller / signature | Runtime nature and missing adapter |
| --- | --- | --- |
| Interpreter | `interpretConversation({context, model})`; `model(request)` | Async-capable model adapter; structured obligations validated by Ticket61 validator. No Node production adapter. |
| Bounded reasoning | `resolvePracticalGuidance(... reasoningModel, modelRunId)` | Model only for non-reviewed practical tasks; must return Ticket63 bounded guidance shape. No adapter. |
| Semantic guidance assessor | `assessSemanticGuidance(... semanticAssessor, assessorRunId)` | Structured Ticket64 gate; no adapter. |
| Artifact assessor | `assessArtifactReproduction(... artifactAssessor, assessorRunId)` | Structured Ticket64A gate; no adapter. |
| Composer | `composeResponse({finalComposerInput, composerAdapter, modelRunId})` | Current adapter is synchronous by contract and returns `{segments}`; T75C.1 must make the surrounding/composer contract async only with a deliberate domain-compatible change, or provide a bounded synchronous façade is not feasible for network I/O. This is the sole concrete implementation prerequisite discovered. |
| Final assessor | `assessFinalCustomerResponse(... semanticAssessor, assessorRunId)` | Structured Ticket67 gate; no adapter. |
| Fact/knowledge/policy | Ticket75B snapshot/store; existing deterministic policy resolver | No external model/provider authority. T75C.3 injects these existing components. |
| Action store | `createPostgresActionReservationStore({rpc, workerId})` | Existing adapter shape; needs injected service-role RPC function only. |
| Checkout provider | `providers.createCheckoutDestination({execution_key})` | Missing server adapter. Existing legacy `server.js` uses Axios to Stripe Checkout with a configured fixed price and Stripe idempotency header, but it is not safely reusable as-is because it lacks the v2 authorized-action binding. |
| Holding provider | `action-executor.js` currently returns `config/sales-engine-v2/action-destinations.json` directly | No external side effect. T75C.2 must validate server-owned configured canonical URL; never model/customer supplied. |

All model/provider calls must accept an AbortSignal and remaining claimed-turn budget, have no tools/web access, and map raw errors to their owning domain availability failure. No stage may establish facts, policy, action authorization, or delivery authority.

## Model-provider findings and recommendation

`package.json` has Axios but no OpenAI Node SDK. Legacy n8n workflow JSON calls OpenAI Chat Completions directly; it is workflow-driven legacy behavior, not a v2 authority source. The legacy workflow must not contribute prompts, model choice, fallback prose, customer history, or unstructured output to v2.

Use one hardened injected HTTP model transport, with five stage-specific adapters owning fixed server prompts, request/response schemas, output caps, and domain conversion. This avoids five credential/retry implementations while preventing a generic caller from selecting prompts, models, tools, or arbitrary context. Model identifiers/credentials are configuration, not discovered values.

Run IDs already have distinct Ticket68 `runContext` fields: `boundedReasoningRunId`, `semanticGuidanceAssessorRunId`, `artifactReproductionAssessorRunId`, `composerModelRunId`, and `finalResponseAssessorRunId`. Derive a stable invocation-scoped base from Ticket75A `invocationIdentity`, stage name, and prompt/version; retries retain the model run ID and add an internal non-provenance attempt counter. It is audit correlation, not provider idempotency.

## Retry/deadline policy

Each call must stop when the Ticket75A AbortSignal fires. No number is selected here. Schema-invalid/malformed/refusal results are terminal stage failures; timeout/abort maps to deadline; connection/429/5xx can have a small same-invocation retry only while remaining budget exists. Unknown provider errors fail closed. No retry may create a new action or outlive the claim. Provider raw bodies are never returned/logged.

## Ticket65D and provider lifecycle

`authorized_action_executions` and migration `20260924_ticket_65d_authorized_action_execution.sql` supply private RPCs: `reserve_authorized_action_execution`, `complete_authorized_action_execution`, `fail_authorized_action_execution`. The existing store passes `{action_id, execution_key, action_type, worker_id}` and preserves `acquired`, `retry_acquired`, `already_succeeded`, `in_progress`, and terminal states.

T75C.2 must inject a narrow Supabase RPC caller and worker ID. It must reserve before a provider call, reuse an immutable prior success, and never blindly recreate a checkout after provider timeout or completion-persistence failure. Ambiguous Stripe outcome stays reserved/in-progress for reconciliation; recovery ownership is Ticket65D/operator design, not a second provider call. A duplicate claimed-turn invocation uses the same execution key.

The legacy server creates Stripe Checkout with Axios, a fixed server price, validates a `https://checkout.stripe.com/` URL, and sends an Idempotency-Key. T75C.2 may reuse that transport pattern only after it derives the key from Ticket65D `execution_key`, validates the server-owned offer/price mapping, and binds result to the authorized action. Unresolved offer scope forbids checkout. Holding-page execution is deterministic local destination return after reservation, with no provider call.

## Claimed-turn composition and shadow

T75C.3 injects the Ticket68 dependency bundle after canonical input construction, calls Ticket68, and on eligible output calls Ticket68A to return a manifest. It keeps outbound reservation, Twilio, and completion absent.

Shadow mode uses the same model/gate/composer path but a non-executing action executor: it may derive plan/action identity, but must not call Ticket65D reservation, Stripe, holding mutation, outbound reservation, send, or completion. The current Ticket68 `authorizedActionExecutor` injection supports this directly.

## Configuration and minimization

Required startup secrets: model credential, Stripe credential, service-role RPC capability. Required non-secrets: fixed stage model IDs/prompt versions, bounded time budget, worker ID, server-owned checkout offer/price map, holding URL, route state/generation. Missing required configuration fails closed; shadow omits action-provider requirements.

External model input is only each stage’s existing bounded request: interpreter receives Ticket61 context projection; reasoning receives Ticket63 bounded task input; gates receive their narrow assessment inputs; composer receives `compositionInput`. Never send phone/WhatsApp IDs, email, portal token, credentials, Stripe/provider IDs, raw full history, or unrelated database IDs. Opaque context/run IDs are permitted only where existing contract binds them.

## Implementation split

| Ticket | Scope / tests / non-goals |
| --- | --- |
| **T75C.1** | Create hardened transport plus stage adapters, schemas, run-ID factory, Abort/deadline/error tests. Prerequisite: resolve async composer seam by making the pure composer/orchestrator await adapter without weakening validation. No actions, server wiring, or production calls. |
| **T75C.2** | Implement narrow Ticket65D RPC client, checkout adapter, deterministic holding adapter, ambiguity/idempotency tests. Prerequisite: server-owned offer→price configuration contract. No Ticket68 route activation or outbound writes. |
| **T75C.3** | Compose Ticket75A/B → Ticket68 → Ticket68A with live/shadow dependency selection and fail-closed config; endpoint tests. No outbound reservation/send/completion; T75D remains required. |

## Remaining blockers / known limits

T75C.1 must deliberately address the current synchronous `composeResponse` adapter invocation before any network model call can be legal. Production model IDs, prompt deployment choices, server-owned checkout price mapping, and holding URL values are intentionally not present in repository evidence and must be supplied as configuration. T75B remains a bounded multi-read view; Ticket75D still owns atomic claim/lease/no-reply/reservation revalidation. Ticket37A remains **REQUIRED BEFORE T75D**.
