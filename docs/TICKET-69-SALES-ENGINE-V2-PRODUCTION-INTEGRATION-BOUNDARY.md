# Ticket 69 — Sales Engine v2 production integration boundary

## Decision

**DESIGNED, not implemented.** Replace the production conversational-intelligence segment only. Keep the verified WhatsApp ingress, canonical `public.messages` ledger, Ticket 17 claim/lease/FIFO discipline, multipart reservation and sending, Twilio acceptance evidence, reconciliation, Recovery Poller, and completion predicate.

The narrow integration seam is immediately after `Claim Next Session Inbound` returns `claim_state = acquired` (via `Route Session Claim State`) and before the current acquired branch begins at `Get User from Supabase`. A new Node application endpoint/service receives only a lease-bound inbound identity, builds context from canonical state, runs Ticket 68, and returns either a delivery-ready immutable response package or a bounded ineligible result. n8n remains the owner of the existing outbound physical transport. Ticket 68 ends at `response_eligible`; it neither reserves a WhatsApp reply nor makes a delivery claim.

This is viable only after the prerequisites below. In particular, no production reference, workflow, schema, migration, or runtime was changed by this ticket.

## Evidence and current production map

The read-only reference `n8n/references/production-sales-engine-2026-09-21.json` is active (`Dietavity Sales Engine (Ticket 10)`, 183 nodes). Its companion active poller has `Resume Verified WhatsApp Requests` → `Find Verified WhatsApp Sessions` → `Execute Dietavity Sales Engine`; the latter invokes `Receive Verified WhatsApp Sessions` → `Claim Next Session Inbound`.

| Actual stage and node(s) | Disposition | Reason |
| --- | --- | --- |
| `Incoming Message` → `Canonicalize Inbound WhatsApp` | KEEP | Requires a real Twilio SID, normalizes `session_id`, body, provider timestamp, and derives `inbound:<SID>`. |
| `Reserve Canonical Inbound Message` | KEEP | Atomic inbound ledger reservation and duplicate gate; a conflict returns zero rows before AI, Stripe, or Twilio work. |
| `Claim Next Session Inbound` → `Route Session Claim State` → `Wait Before Session Claim Retry` | KEEP | Claims earliest unfinished `(processing_order, id)` item with a 15-minute lease; stale accepted replies reconcile instead of resending. |
| `Get User from Supabase`, `Normalize User Data`, `Set Session Id`, `Get Onboarding Session`, `Postgres Chat Memory`, `Initialize Sales Lead v3`, `Get Recent Sales Clarification Context` | ADAPT / MOVE | Replace their legacy conversational projection with one canonical source-read adapter. Preserve only operational/session facts that are allowlisted into v2. |
| `Build Canonical Dietavity Knowledge`, `Interpret Sales Buyer Signal`, `Sales Interpretation Model`, `Parse Sales Interpretation`, `Apply Deterministic Commercial Policy` | REPLACE WITH V2 | Ticket 58/59/61/62 authority pipeline replaces embedded knowledge, classifier output, and v3 policy. Legacy labels do not enter v2 as truth. |
| `Route Authorized Sales Action`, `Persist Checkout Authorization v3`, `LIVE Stripe Checkout Session Payment`, `Persist Checkout Session Evidence v3`, reminder branches | REPLACE / MOVE | Ticket 65D executes at most one launch destination before composition. Existing delivery-dependent transitions remain downstream; launch-v1 does not schedule reminders. |
| `Build Constrained Sales Response`, `Generate Sales Response v3`, `Sales Response Model`, `Validate Sales Response Contract` | REPLACE WITH V2 | Tickets 63–67 and 68 provide bounded reasoning, composition, and the final semantic gate. |
| `Prepare Paid WhatsApp Message Parts` → `Reserve Sales Reply` / `Reserve Checkout Reply` → Twilio → `Update … Delivery` → `Assert … Accepted` | KEEP, ADAPT input | Preserve reservation-before-send, multipart and acceptance evidence. Replace only the source response package and reservation interface. |
| `Persist Sales Response State and Events`, `Mark Checkout Sent v3` | ADAPT | Commit only state/event transitions whose exact v2 mapping is defined and only after provider acceptance. Do not retain v3 strategy as authority. |
| `Mark Session Inbound Complete` → next `Claim Next Session Inbound` | KEEP | Completion still requires every logical reply part to be accepted/scheduled/sent/delivered with provider evidence. |
| Recovery Poller and Global Error Handler | KEEP, ADAPT classification | They retain queue/transport recovery; they must distinguish v2 failure records from transport recovery. |
| Legacy cancellation, payment webhook, setup, meal-plan routes | KEEP / OUT OF SCOPE | They are not Sales Engine v2 paths. |

The actual normal path is therefore: `Incoming Message` → `Canonicalize Inbound WhatsApp` → `Reserve Canonical Inbound Message` → `Claim Next Session Inbound` → `Route Session Claim State` → legacy intelligence/action/response nodes → reservation → Twilio → acceptance update/assertion → state/event persistence → `Mark Session Inbound Complete`. The target replaces precisely the middle legacy intelligence/action/response nodes after an acquired claim.

## Target sequence and inbound contract

1. Existing n8n ingress verifies/normalizes the Twilio event and inserts the canonical inbound row.
2. Existing `Claim Next Session Inbound` acquires the first eligible row and lease. Only its `acquired` branch calls Node v2.
3. Node reads canonical, bounded state while the lease is valid, builds `ConversationContext`, and calls `runSalesEngineV2Turn` with private dependencies.
4. For `response_eligible`, Node returns an immutable delivery package bound to the claimed inbound ID, session ID, lease owner, response text, action summary, and an artifact projection if one applies. n8n invokes one canonical reply-reservation RPC, then retains existing formatter, one-part-at-a-time Twilio loop, acceptance persistence, and completion.
5. For `response_ineligible`, Node durably records only bounded operational metadata; n8n does not generate or send fallback prose, reserve an outbound row, or mark the inbound completed. It releases/lets expire the lease according to the classified retry policy.

`ProductionInboundState` is a private Node input, not a prompt and not a customer-visible contract:

```text
{ inbound_message_id, provider_message_sid, session_id, processing_order,
  lease_owner, lease_until, workflow_execution_id? }
  -> ConversationContext + bounded runContext + injected dependencies
```

The Node read adapter must revalidate that the row is inbound, is owned by the supplied lease owner, has no outbound reply, has not completed, and is in the same session before action execution and again in the outbound reservation transaction. Stable identities are the canonical inbound UUID, inbound Twilio SID, session ID, existing n8n execution ID (diagnostic only), Ticket 59B `action_id`, and `aek-…` execution key. The raw Twilio request, legacy buyer signals/strategies, raw model drafts, workflow state, arbitrary `onboarding_chat_memory` metadata, payment/provider payloads, and secrets must not enter v2.

## ConversationContext mapping

| Context field | Source / handling |
| --- | --- |
| `current_message.canonical_message_id` | Claimed `public.messages.id`; mandatory UUID. |
| `current_message.source_id`, text, occurred_at | Claimed inbound `provider_message_sid`, canonical `body`, and canonical timestamp. Missing SID/body/timestamp is `context_invalid`; media-only remains on its existing non-v2 clarification route unless separately designed. |
| `session_state.session_id`, channel, locale | Claimed `session_id`; fixed `whatsapp` and `es-MX`. Locale is not inferred from text. |
| offer/campaign and the two operational commercial booleans | `onboarding_sessions`, read under the claimed session. `offer_context` and configured campaign are allowlisted; `checkout_sent` and valid current confirmation evidence only populate Ticket 60 operational booleans. Expired/malformed evidence fails closed. |
| customer state | Existing user linkage may be used only as necessary server state; no profile, health, payment, or phone data is placed in context/prompt. |
| `history` | A dedicated bounded read adapter normalizes known `onboarding_chat_memory` shapes and, where necessary, final canonical outbound bodies. It uses only `occurred_at`; distinct equal timestamps fail `MEMORY_ORDER_AMBIGUOUS`, not UUID ordering. |
| `conversation_artifacts` | Query Ticket 17A artifact + ordered lineage + complete anchored canonical multipart rows; reconstruct only exact groups. Malformed/missing/non-first anchors, incomplete parts, broken lineage, or timestamp ties fail context construction. |
| facts, policy, knowledge | Empty at context construction. Canonical resolvers supply them later; legacy classifier output never supplies them. |

This can be constructed safely from the repository’s canonical sources, subject to fail-closed reads and the production availability of Ticket 17A schema. It is not safe to silently omit malformed history/artifacts or to turn current production memory into authority.

## Dependencies and execution placement

| Dependency | Proposed production adapter / backing |
| --- | --- |
| fact resolver | Node adapter over a reviewed, versioned canonical fact store. Current v2 resolver fixtures/configuration are not sufficient production authority. |
| policy resolver | Process-local versioned Node policy modules; deterministic input only. |
| reviewed knowledge store | Reviewed/versioned Postgres-backed store and selection adapter. Current static test data is not a production store. |
| action reservation store | `createPostgresActionReservationStore` over the private Ticket 65D RPCs. |
| checkout / holding provider | Server-only Stripe destination adapter keyed by `aek-…`; configured holding-page adapter. Never n8n prompt output. |
| interpreter, bounded-reasoning, guidance/artifact/final assessors, composer | Node-owned structured model adapters with schema validation, versioned prompts, timeouts and bounded run IDs. |
| context/artifact/outbound adapters | New Node/SQL read adapter and a canonical lease-checked reservation RPC. |

Recommendation: **Option B — Node v2 owns all model calls.** Option A (n8n nodes) keeps credentials near the workflow but fragments validation, retries, prompt versions, testability, and failure taxonomy across nodes. Option C adds two boundary formats and makes trace/retry ownership ambiguous. Node already houses v2 contracts; it can validate every model result adjacent to its prompt/version, emit bounded stage metadata, and keep provider credentials server-side. n8n remains a small durable transport orchestrator. This adds one internal HTTP boundary and requires explicit timeout/authentication, but is less complex than duplicating the v2 contract runtime in n8n.

## Ticket 65D action design

The repository already contains migration `20260924_ticket_65d_authorized_action_execution.sql` and synchronized schema for private `authorized_action_executions` plus `reserve_…`, `complete_…`, and `fail_…` RPCs. It stores action ID/type, execution key, 60-second lease, state, and validated bounded success result; it does not store raw provider responses. Thus no new action table design is needed. However, the September 21 production reference cannot establish that the September 24 migration is installed: production installation and RPC privilege verification are a prerequisite.

Ticket 62 derives stable `act-…` and `aek-…` from canonical inbound/policy inputs. Ticket 65D reserves before Stripe, persists the exact validated destination on success, and reuses it after a crash, composition failure, or delivery failure. An unexpired reservation returns `in_progress`; retryable/terminal provider outcomes return no destination. Provider error text never crosses into composer/customer prose. A recovery replay must reuse the same inbound ID and identities; it never creates another checkout merely because Twilio failed.

## Outbound persistence and Ticket 17A

Required order is:

```text
Ticket 68 response_eligible
→ lease-checked logical reply/multipart reservation
→ Ticket 17A artifact persistence when applicable
→ existing per-part Twilio send
→ provider acceptance update
→ existing acceptance assertion
→ delivery evidence / completion predicate
```

The canonical logical reply must be persisted before physical sends. Ticket 17A's existing `persist_conversation_artifact(jsonb)` is the sole artifact boundary and validates the anchor, multipart shape, lineage and idempotency; it does **not** itself reserve the reply and cannot be atomically composed with the existing n8n `Reserve Sales Reply`/`Reserve Checkout Reply` calls. Therefore a generated-artifact reply needs a new single database RPC which holds the claimed-inbound/session guard, reserves all parts, and invokes/reuses the existing Ticket 17A validation in the same transaction. It must not introduce a parallel artifacts table or bypass `persist_conversation_artifact` rules. A normal non-artifact reply may use the existing atomic multipart reservation path.

There is a second prerequisite, explicitly named **Ticket 68A — Post-Gate Delivery Manifest Contract**. It is a deterministic, non-customer-facing companion contract to `TurnResult`, not a “side-channel.” It is produced only after `customerResponseEligible({ finalComposerInput, composerResult, finalGate }) === true` for the exact Ticket 68 outcome. It creates no semantic, factual, policy, action, or delivery authority; it is persistence metadata only.

**Recommendation: a separately validated companion contract, not an extension of `TurnResult`.** `TurnResult` deliberately exposes the minimal delivery-eligibility result. Extending it with non-customer artifact metadata would blur that boundary and force every ordinary caller to receive persistence-only material. Node returns `{ turnResult, postGateDeliveryManifest }` only to the authenticated delivery adapter, which rejects either item unless their bindings match.

`PostGateDeliveryManifest` has a closed shape and canonical JSON/SHA-256 domain-separated bindings: contract/version; `context_id`; canonical inbound UUID; a digest of the exact validated `ConversationContext`; a digest of the exact validated `FinalComposerInput`; the Ticket 67 candidate binding digest for the exact `ComposerResult`; a digest of the exact cleared Ticket 67 eligibility result; and a digest of the exact eligible `TurnResult` customer response. It also carries only the downstream persistence minimum: deterministic logical-reply key/idempotency basis and, when applicable, one closed Ticket 17A projection `{ artifact_id, artifact_type, generation_operation, generation_task_id, ordered_lineage_artifact_ids }`. The reservation transaction supplies the new anchor message UUID and verifies the logical key before invoking the existing Ticket 17A boundary. No artifact field is inferred from customer prose.

The manifest contains no customer prose beyond the response digest, prompt, chain-of-thought, raw model/provider output, unrestricted history, product/policy material, action parameters, provider errors, credentials, or delivery/acceptance claim. A missing, malformed, non-cleared, or binding-mismatched manifest is a deterministic persistence failure: reserve/send nothing. Until Ticket 68A exists, artifact-producing replies are disabled rather than guessed; ordinary non-artifact replies do not need a manifest.

## `response_ineligible` and recovery ownership

| Ticket 68 code | Exclusive retry classification and handling |
| --- | --- |
| `context_invalid` | **Deterministic contract/state failure.** No identical-input automatic replay; durable audit and operator/dead-letter handling. |
| `interpretation_failed` | **Deterministic contract/state failure.** The public code conflates model failure with invalid interpreter output, so it is not safe for the poller to infer transience. The model adapter may perform its one bounded in-attempt repair before this result; once emitted, no identical-input automatic replay. A future finer causal code is required before changing this classification. |
| `resolution_failed` | **Deterministic contract/state failure.** Resolver inputs, fact/policy state, identities, or contract alignment must be repaired; no identical-input replay. |
| `guidance_resolution_failed` | **Deterministic contract/state failure.** This code similarly covers unavailable/malformed knowledge or reasoning results. Without a distinct transient causal result, fail closed to audit/operator handling rather than retrying semantic generation. |
| `guidance_assessment_unavailable` | **Transient application dependency.** Capped automatic replay may be eligible after the assessor/backing dependency is healthy; retain the same canonical inbound/context and never advance to transport. Dead-letter/operator alert after the cap. |
| `artifact_assessment_unavailable` | **Transient application dependency.** Capped automatic replay may be eligible under the same identity and inputs; dead-letter/operator alert after the cap. |
| `planning_failed` | **Deterministic contract/state failure.** No identical-input automatic replay. |
| `action_execution_unavailable` | **Action lifecycle owned by Ticket 65D.** Inspect/reuse the same `action_id` and `aek-…`; Ticket 65D alone controls provider retry after reservation. Node/n8n must not issue a second provider attempt. |
| `final_composer_input_failed` | **Deterministic contract/state failure.** No identical-input automatic replay. |
| `composer_unavailable` | **Transient application dependency.** Capped automatic replay may be eligible with the same finalized input and action identities; no new action or destination is created. Dead-letter/operator alert after the cap. |
| `final_response_assessment_unavailable` | **Transient application dependency.** Capped automatic replay may be eligible against the same exact candidate binding; no outbound persistence before a cleared result. Dead-letter/operator alert after the cap. |
| `final_response_blocked` | **Semantic terminal block.** Never automatically retry semantics; persist bounded stage/version metadata and send no reply. |
| `final_response_binding_invalid` | **Deterministic contract/state failure.** A binding mismatch is not a semantic retry opportunity; durable audit/operator/dead-letter handling, no outbound. |

**Transport recovery** is a separate classification, available only after canonical outbound persistence and outside Ticket 68. Twilio failed/unknown/ambiguous sends keep the exact persisted text and existing Ticket 36/37A reconciliation ownership; they never rerun Ticket 68 or regenerate wording. n8n execution retry covers an invocation/network failure before a classified Node result; Node owns only the four explicitly transient application replays above; Ticket 65D owns action-provider retry; the Recovery Poller is a queue wake-up and existing transport-recovery mechanism. A wake-up never means that every `response_ineligible` result is retryable.

## Leases and latency

`Claim Next Session Inbound` grants 15 minutes. The lease must remain held through context read, Ticket 68, outbound reservation, and the hand-off that durably makes the outbound visible. Existing reservation SQL renews it; the new canonical reservation RPC must do the same. It may be released only after an accepted complete reply and state persistence, or classified failure is durably recorded. Sending stays logically under the held claim because completion and same-session FIFO cannot advance before all parts resolve.

Planning budget (not a promise): context reads 0.5–1.5 s; interpreter 2–8 s; conditional practical reasoning 2–10 s; each conditional semantic/artifact assessment 1–6 s; action 0.2–8 s; composer 2–8 s; final assessor 1–6 s; reservation 0.1–1 s; Twilio 0.3–5 s. A normal no-guidance/action turn is about 6–30 s; a sequential worst reasonable turn is about 25–75 s. Calls whose contracts depend on previous output must not be parallelized. This fits 15 minutes only with per-call deadlines and lease renewal before/after each remote phase; the action RPC’s 60-second lease also requires provider timeout below that window. If an n8n execution timeout is below the bounded worst case, move the entire leased v2 job to an authenticated asynchronous Node worker and have n8n poll its durable result—do not release order early.

## Responsibilities and minimization

| Responsibility | Owner |
| --- | --- |
| webhook, signature/provider intake, normalization, inbound persistence, FIFO lease, multipart, Twilio send/evidence, Recovery Poller | n8n + existing Postgres RPC/SQL |
| context adapter, all model calls, facts/policy/knowledge, safety gates, authorization, Ticket 65D invocation, composition, final gate | Node v2 |
| canonical messages, sessions, leases/idempotency, facts/knowledge once installed, Ticket 17A, Ticket 65D, atomic reservation | Postgres |
| model inference, Stripe destination creation, Twilio acceptance/delivery | external providers |

n8n → Node contains only the claimed IDs/lease identity and diagnostic execution ID. Node → models contains the validated narrow interpreter/composer/assessor projections, bounded history/artifacts and approved knowledge excerpts. It never includes bearer portal tokens, raw Twilio/Stripe payloads, credentials, unrestricted rows, profile/health data, or policy/fact stores. Node → n8n contains `response_eligible` package or bounded failure code, never prompts, model output diagnostics, chain-of-thought, secrets, or provider exception text.

Observability joins the existing inbound UUID and Twilio SID to `context_id`, n8n execution ID, model run IDs (opaque), `action_id`/execution key, logical reply key/anchor message UUID, multipart outbound UUIDs/Twilio SIDs, and recovery attempt ID. Persist only stage, version, elapsed time, attempt number, status and closed failure code; redact text, prompt, provider response, credentials and sensitive profile data from logs.

## Cutover, rollback, and prerequisites

Use an explicit server-controlled routing flag evaluated after the lease claim, scoped initially to an internal deterministic test cohort. Stage 1 is offline replay with actions/providers disabled. Stage 2 is shadow evaluation with no action execution, no outbound reservation, no message, and no state transition; compare eligibility, deterministic action identity, final-gate outcome and bounded latency only. Stage 3 is one-at-a-time canary delivery with v2 routing and normal action execution; never run v3 and v2 for the same claimed inbound. Stage 4 expands by deterministic cohort, then makes v2 default. A hard replacement is not recommended.

Rollback changes the routing flag for **new, not-yet-claimed** inbounds only. Existing v2 action rows and outbound reservations remain canonical; retries inspect them rather than switching engines. An inbound with a v2 persisted reply continues only through existing transport reconciliation. This retains messages, avoids duplicate replies/actions, and does not invalidate leases.

Implementation prerequisites, in order:

1. Verify/apply Ticket 17A and Ticket 65D production migrations and service-role RPC privileges through authorized deployment work; do not infer this from the dated workflow reference.
2. Create reviewed canonical product-fact and reviewed-knowledge production stores plus Node resolvers; seed/reconcile against approved sources.
3. Implement the lease-bound canonical context read adapter, including bounded memory/artifact query and a durable v2 failure/audit record.
4. Implement hardened Node model/provider adapters, auth, deadlines, run IDs, and contract validation.
5. Implement Ticket 68A's separately validated Post-Gate Delivery Manifest Contract for Ticket 17A-applicable composition, or explicitly disable artifacts until it exists.
6. Add one atomic lease-checked outbound reservation + Ticket 17A integration RPC, reusing existing artifact validation and Ticket 37 multipart invariants.
7. Add v2-to-existing session/funnel transition mapping after acceptance; do not map legacy classifier labels as facts.
8. Add route flag, retry ownership, poller classification, metrics, replay/shadow/canary tests, then separately deploy and authorize cutover.

Unresolved production questions are deliberately bounded: actual installed migration/RPC versions, n8n/Node timeout configuration, a reviewed source for facts/knowledge, and the approved v2 event mapping. They require staging/production-readiness verification, not access to remote Supabase in this ticket.
