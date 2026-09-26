# Ticket 75 — Sales Engine v2 production runtime integration plan

## Status and scope

**READY_FOR_IMPLEMENTATION** — this is an implementation plan, not approval to deploy, route traffic, enable a canary, or change production.  The Ticket 74 prerequisite record is accepted as supplied by the ticket: Ticket 17A, 65D, 71, 72, and the Ticket 74 corrective ACL migration are production-complete and verified.  The plan still has explicit pre-shadow and pre-canary gates below.

Evidence labels used here matter:

- **Repository/reference evidence** is from commit `d363e0481a19817f376b11d888512fc846af696e`, the checked-in schema/tests, and the captured 2026-09-21 workflow exports.
- **Requires fresh production verification** is intentionally not inferred from those exports. In particular, the exports do not establish present-day n8n routing, credentials, proxy/HTTP limits, Node limits, active workflow versions, or current recovery-poller configuration.

No production, n8n artifact, migration, or runtime code is changed by Ticket 75.

## 1. Exact integration seam

### Captured topology

The captured active Sales Engine reference is workflow `9oRFrbGVuK91LaAD`, `Dietavity Sales Engine (Ticket 10)`, 183 nodes. Its exact relevant edges are:

```text
Reserve Canonical Inbound Message / Receive Verified WhatsApp Sessions /
Wait Before Session Claim Retry / Mark Session Inbound Complete
  -> Claim Next Session Inbound
  -> Route Session Claim State
     acquired output (0) -> Get User from Supabase
     busy output (1)     -> Wait Before Session Claim Retry
```

Therefore the integration boundary is **the acquired output (output 0) of `Route Session Claim State`, immediately before `Get User from Supabase`**. The busy/retry edge is not changed. `Claim Next Session Inbound` remains the sole owner of FIFO, the session advisory/row-lock behavior, and the 15-minute lease pattern shown by the reference.

The captured downstream paid transport path is `Prepare Paid WhatsApp Message Parts` -> `Reserve Paid Assistant Reply` -> `Loop Paid WhatsApp Parts` -> `Send All Intents Message` -> `Update Paid Assistant Reply Delivery` -> `Assert Paid Assistant Reply Accepted` -> loop, then `Update Last Assistant Message` -> `Mark Session Inbound Complete`. The reference also has distinct sales/checkout reservation paths that converge through their own acceptance assertions to state/event persistence and `Mark Session Inbound Complete`.

### Target graph

Add a deterministic routing node after the acquired output; it evaluates only server configuration and the already-claimed row, never customer text.

```text
Route Session Claim State (acquired)
  -> Route Sales Engine Version for Claimed Inbound
       legacy/non-eligible -> Get User from Supabase (unchanged legacy graph)
       v2 live            -> Invoke Internal Sales Engine v2 Turn
                              -> Validate v2 Delivery Package
                              -> Prepare v2 WhatsApp Message Parts
                              -> Reserve v2 Logical Reply (new lease-checked RPC)
                              -> Loop Paid WhatsApp Parts (existing transport loop)
       v2 shadow          -> Invoke Internal Sales Engine v2 Shadow -> Record bounded shadow evidence -> do not send
```

`Prepare v2 WhatsApp Message Parts` is an n8n transport formatter, not a conversational decision maker: it splits the returned final text under the already-existing WhatsApp limits and creates the ordered parts passed to reservation. `Reserve v2 Logical Reply` replaces the v2 branch's use of `Reserve Paid Assistant Reply`, because it must atomically reserve multipart rows and, if the manifest has an artifact projection, call Ticket 17A's existing artifact boundary in the same transaction. After reservation, reuse the physical send/update/assert loop. A small adapter may select the existing accepted-reply continuation, but it must not re-compose, re-authorize, or execute an action.

What remains in n8n: verified ingress, canonical inbound reservation, Ticket 17 claim/lease/FIFO, version routing, multipart formatting, outbound reservation invocation, Twilio calls, provider evidence persistence, acceptance assertions, completion invocation, reconciliation, Recovery Poller and Global Error Handler. What moves to Node: canonical context projection, all v2 interpretation/resolution/fact/policy/knowledge stages, model calls/gates/composition, Ticket 65D action execution, and construction of the post-gate delivery package. Legacy portal recovery, legacy cancellation, reminder, payment-webhook, Setup, and program paths remain routed to legacy until each has an independently approved v2 mapping; they are canary exclusions.

There is no Ticket17 lease implementation, session queue, Twilio sender, provider-delivery recorder, or recovery worker inside Node.

### Cross-boundary values and retry ownership

The n8n-to-Node request is only a claim capability: `canonical_inbound_message_id`, `session_id`, `processing_owner`, `claimed_lease_until`, an opaque `claim_attempt_id`, and optional non-authoritative `workflow_execution_id` for correlation. Node re-reads every authoritative fact; n8n does not send body, user/profile, history, policy, facts, actions, or a claimed response.

The successful Node-to-n8n result contains a validated `response_eligible` TurnResult, the final customer text, a post-gate delivery manifest, bounded action summary, and correlation/diagnostic fields. It contains no raw model output, prompt, history, secret, provider payload, or arbitrary state. An ineligible result contains only version, stage, code, trace, retry class, and correlation fields; it never contains fallback prose.

| Boundary | Owner | Retry rule |
| --- | --- | --- |
| Claim/acquire and busy lease | n8n/Ticket17 | Existing wait/poller behavior only. |
| Internal request transport before a classified result | n8n | One bounded invocation retry only if Node cannot prove it received the request; same claim identity. Then release/expire for classified operational recovery. |
| V2 transient model/dependency stage | Node | At most one bounded in-attempt repair where the existing contract permits it; otherwise return a classified transient result. Never let n8n regenerate. |
| Ticket65D action provider execution | Node + Ticket65D | Reuse `action_id`/`aek-*`; Ticket65D reservation is the sole provider-retry authority. |
| Outbound reservation | n8n invokes DB boundary | Idempotent same logical key only; no new wording/action. |
| Twilio/acceptance/reconciliation | n8n + existing recovery architecture | Existing provider-evidence/reconciliation path only; never rerun v2 for a persisted reply. |

## 2. Runtime API / entry point

Implement one private Node entry point, for example `POST /internal/sales-engine-v2/claimed-turn` (or an equivalent in-process function behind the same contract). It is not a public webhook and accepts no customer-originated request.

Authentication is service-to-service mTLS or a short-lived audience-bound signed assertion from the existing trusted workflow gateway, plus network allowlisting. The Node service independently authenticates the caller, validates issuer/audience/expiry, rate-limits by trusted client, and rejects direct Internet access. Database/service credentials, policy selection, provider credentials, routing flags, model names, and authority-set selection are server configuration, not request fields.

Request shape:

```json
{
  "contract_version": "ticket-75-claimed-turn-v1",
  "canonical_inbound_message_id": "uuid",
  "session_id": "opaque canonical session id",
  "processing_owner": "exact Ticket17 owner",
  "claimed_lease_until": "ISO-8601 timestamp",
  "claim_attempt_id": "opaque UUID",
  "mode": "live | shadow",
  "workflow_execution_id": "optional diagnostic opaque id"
}
```

`mode` is accepted only when it matches server-side routing for that claimed row. Node reads the inbound row with a lease/session/direction/not-complete/no-reply guard before context/action work, and the reservation RPC repeats the guard. It derives the idempotency identity from `(canonical_inbound_message_id, processing_owner, route generation)`; actions retain their existing deterministic `(action_id, execution_key)` identity. A caller cannot manufacture facts/actions because it supplies neither facts nor action parameters, and every action must be produced by deterministic policy after a canonical re-read.

Success response is either:

```json
{
  "outcome": "eligible",
  "turn_id": "v2t-opaque",
  "canonical_inbound_message_id": "uuid",
  "session_id": "opaque",
  "processing_owner": "exact owner",
  "turn_result": { "status": "response_eligible" },
  "delivery": {
    "text": "final gated customer response",
    "post_gate_delivery_manifest": { "contract_version": "ticket-68a-v1" }
  },
  "retry_class": "none"
}
```

or `{ outcome: "ineligible", turn_id, canonical_inbound_message_id, processing_owner, failure_stage, failure_code, retry_class }`. The full accepted contract is schema-validated on both sides; n8n rejects an identity/binding/version mismatch before reservation.

Use an end-to-end deadline that is shorter than the verified safe HTTP and lease budgets. Until fresh verification establishes those bounds, implement a configurable server deadline and do not choose its production value. Reserve a small downstream budget for multipart reservation and first transport handoff; cancel model work before that deadline. A timeout has no customer response and no completion. Node must persist/emit whether it reached each irreversible point so n8n can distinguish “not received” from “received but no response”; otherwise it must treat the result as ambiguous and leave the claim for recovery, never issue a second action or reply.

Error taxonomy: `unauthenticated`, `forbidden_route`, `malformed_request`, `claim_not_owned`, `claim_expired`, `already_has_reply`, `context_invalid`, each Ticket68 failure code, `action_lifecycle_unavailable`, `reservation_precondition_failed`, `deadline_exceeded`, and `internal_unclassified`. Only explicitly classified transient dependencies are retryable; malformed/identity/policy/binding/semantic blocks are terminal-to-operator. Unknown errors are fail-closed, no response, no completion.

## 3. Production adapter map

| Dependency | Current repository implementation | Production source and behavior | Failure / additional work |
| --- | --- | --- | --- |
| ConversationContext | `memory-adapter.js`; pure `createConversationContext` | New Node read adapter over claimed `messages`, `onboarding_sessions`, bounded `onboarding_chat_memory`, canonical accepted outbound rows, and Ticket17A artifacts/lineage. Read only. | Fail closed on missing SID/body/time, ownership mismatch, malformed/mixed history/artifact, or timestamp tie. **Required.** |
| Ticket17A artifacts | `projectConversationArtifacts`; `persist_conversation_artifact(jsonb)` migration | Read Ticket17A tables plus complete anchored multipart `messages`; write only through existing persist RPC from the new atomic reservation boundary. | No direct table writes. **Required read adapter and atomic reservation RPC.** |
| Ticket71 facts | `product-fact-authority.js` injected snapshot/resolver | Read active reviewed set/records from Ticket71 tables, map to its closed snapshot, select scope from canonical offer version. | Unknown/ambiguous/malformed => bounded unknown/fail closed according to resolver. **Required Postgres adapter/cache invalidation strategy.** |
| Ticket72 knowledge | `reviewed-knowledge-store.js` injected items | Read active `es-MX` reviewed set/records from Ticket72 tables; project only allowed reviewed fields. | Missing/ambiguous/invalid/unavailable => no guidance or classified failure; no retrieval as fact source. **Required adapter.** |
| Policy | `policy-resolver.js`, validators, policy modules | Versioned process-local Node deterministic policy selected by server configuration. Read-only. | Missing/malformed/version drift => `resolution_failed`; no legacy n8n strategy input. **Production packaging/config required.** |
| Authorized action | `action-executor.js`, `action-reservation-store.js` | Ticket65D private RPCs; server-only Stripe destination adapter and configured holding destination. Read/write only through reservation RPC lifecycle. | Conflict/in-progress/retryable/terminal map to Ticket65D semantics; never create a second checkout. **Provider adapter required.** |
| Interpreter/composer | `interpreter.js`, `response-composer.js` | Node-owned structured model clients, fixed prompt/schema/model version and bounded run ID. | Invalid/unavailable/deadline => existing classified ineligible result. **Required hardened adapter.** |
| Semantic assessors | Ticket64/67 and artifact gate modules | Node-owned structured assessor clients, independent bounded calls and run IDs. | Block/indeterminate/unavailable fails closed; no customer send. **Required hardened adapter.** |
| Delivery manifest | `post-gate-delivery-manifest.js` | Build only in Node memory after exact Ticket68/67 eligibility; pass to reservation RPC/n8n validator. | Binding/version mismatch => no reserve/send. **n8n validation + DB RPC required.** |
| Delivery handoff | Ticket68 result is pure; current n8n reservation/loop are reference behavior | n8n formats parts and invokes the new DB RPC, then existing Twilio/evidence loop. | Reservation failure => no send/no completion. **Required adapter/workflow change later.** |

## 4. Durable state ownership matrix

Exactly one component is authoritative for each durable state; readers may observe it but cannot substitute it.

| State | Sole authoritative owner | Notes |
| --- | --- | --- |
| Inbound canonical message | `public.messages` / existing ingress reservation | n8n writes through current reservation path. |
| Session lease | `public.messages` / Ticket17 claim SQL | Node only verifies supplied lease. |
| ConversationContext | Node in-memory derived object | Not durable authority; inputs remain canonical sources. |
| Conversational artifacts | Ticket17A tables via `persist_conversation_artifact` inside new RPC | Metadata only; canonical outbound body remains content source. |
| AuthorizedAction | Node deterministic policy output | Ephemeral authorization; it is not a DB command supplied by n8n. |
| ActionResult | Ticket65D `authorized_action_executions` via RPC | Durable exact result/idempotency. |
| Logical outbound reply | `public.messages` multipart group via new reservation RPC | `logical_reply_key` binds all parts. |
| Multipart parts | `public.messages` | Existing part metadata/keys and physical transport loop. |
| Provider acceptance | `public.messages` delivery fields/metadata | Existing n8n Twilio update/assert path. |
| Handset delivery | Provider callback/evidence persisted in `public.messages` | Provider is source of delivery signal; n8n persists it. |
| Completion state | `public.messages.processing_*` via existing completion predicate | Never Node reasoning success. |
| Recovery state | existing recovery RPCs + Recovery Poller `bRwE1e4WQz17BV6S` | Fresh verification required before activation. |

## 5. Shadow mode

Shadow is an explicit Node mode selected after claim but before the legacy conversational branch. It receives the same claim tuple and performs canonical context read, interpretation, resolution, eligible knowledge/reasoning, gates, planning, composition, and final gate. It must use a **non-executing action adapter**: it derives action identity/intent for comparison but does not reserve Ticket65D, call Stripe/holding, reserve an outbound message, alter session/commercial state, change completion, renew/release Ticket17 state, or invoke Twilio. n8n then continues the same claimed inbound through legacy for the real customer response; the shadow call is observational and cannot decide the legacy route.

Persist shadow evidence in a new backend-only, retention-bounded diagnostics store keyed by a salted/hash-derived turn correlation ID and canonical inbound UUID only where access-controlled operational correlation requires it. Store version IDs, stage/terminal/gate outcome, action type/identity hash, response-text digest and length, manifest validity, latency buckets, and a coarse comparison category. Do not store raw customer prose, history, prompt, raw model output, provider payload, full phone/session identity, or action destination. Encrypt/restrict the table; define short retention and deletion linkage. An alternative approved telemetry sink must meet the same minimization and access controls.

Shadow receives no lease ownership beyond the existing live claim: it has a strict read deadline and cannot mutate the claim. If it is unavailable or slow, record bounded failure if possible and proceed with legacy; it must never delay, block, or cause retry of real delivery.

## 6. Canary

After shadow acceptance, the smallest live canary is **one configured, deterministic internal test cohort at a time**, selected by a server-managed allowlist of canonical normalized session IDs (or a separately created non-customer test identity), not random percentage. The routing decision is frozen at `Claim Next Session Inbound` acquisition and recorded in bounded diagnostic metadata. Exclude media-only inbound, portal recovery, legacy cancellation/unsubscribe, reminders, post-purchase/program/setup, user-linking/identity verification, an existing outbound for the inbound, reconciliation state, ambiguous lease/claim state, artifact-producing turns until the artifact RPC passes acceptance, and any action type not proven by the canary scope.

Concurrency is one active v2 claimed session/turn globally for the initial cohort. A server-side kill switch removes v2 eligibility for **not-yet-claimed** rows only. Once claimed, a v2 turn keeps v2 ownership: retry uses the same v2 identity and state; if an outbound is reserved, only transport reconciliation continues. It never falls through to legacy, which would split ownership and risk duplicate content/actions.

For the first live canary, allow no checkout/holding execution unless a separately approved action-specific test proves Ticket65D/Stripe idempotency under the same canary guard. A safer initial customer-visible canary permits no launch action and excludes action-authorizing turns. Later action canary requires the same one-at-a-time constraint, confirmed execution key reuse, and no deterministic/semantic drift. Multipart uses the normal existing part splitter, new atomic v2 reservation, and existing loop/evidence predicate. Recovery remains unchanged: it resumes persisted replies; it does not rerun v2 after reservation and it does not transfer claimed v2 work to legacy.

Timeout before reservation: no response/no completion; classify, retain/recover v2 ownership. Timeout after reservation: transport/reconciliation only. Fresh production verification must prove this behavior is compatible with actual proxy/n8n/Node timeouts and the lease budget before any live canary.

## 7. Completion and recovery invariants

A v2 `response_eligible` merely permits reservation. The new reservation RPC must atomically: lock/check the exact claimed inbound (`direction=inbound`, session/owner match, uncompleted, lease valid), reject an existing conflicting outbound, renew the claim as the existing reservation does, insert all validated ordered parts with stable logical key/idempotency keys, and when present persist the manifest's Ticket17A projection through `persist_conversation_artifact` using part 1 as anchor. It returns the existing message rows only on identical idempotent retry.

The existing `Mark Session Inbound Complete` predicate remains unchanged in meaning: it requires at least one outbound reply and one complete logical group whose part counts/indices/idempotency/session all agree and whose every part is `accepted`, `scheduled`, `sent`, or `delivered` with a real provider SID or persisted provider-acceptance evidence. Thus Node success, action success, composition success, reservation success, and even a Twilio call alone cannot complete the inbound.

The existing Recovery Poller (`bRwE1e4WQz17BV6S` in the captured reference) remains a wake-up mechanism into `Receive Verified WhatsApp Sessions`/claim. Its recovery RPCs retain FIFO, provider reconciliation, and historical safeguards. It may recover an already-persisted v2 logical reply by key/part; it must not call Node again to make a different response. The schema gap is the still-unimplemented **lease-checked atomic v2 logical-reply/multipart/artifact reservation RPC** and its n8n invocation. Ticket74 did not provide it. This is a blocker before shadow only if shadow needs artifact/read verification; it is categorically a blocker before a live artifact-capable canary and before v2 delivery.

## 8. Minimum launch observability

Emit structured, access-controlled events at request receipt, each pipeline stage, action lifecycle, reservation handoff, and terminal state. Required fields: `v2_turn_id`, canonical inbound UUID, HMAC/pseudonymous session correlation, route generation/mode, pipeline stage, terminal outcome, failure/retry class, gate outcome/version, action ID and execution key (where applicable), logical reply key, manifest version/binding status, provider outcome/SID-presence flag (not provider body), latency per stage and total, and correlation to workflow execution ID where present.

Canonical business state stays in `messages`, Ticket65D, Ticket17A, and existing funnel/session records. Diagnostics/model evidence stays separate, bounded, access-controlled, and retention-limited. Do not put prompts, raw model/assessor output, full response/history, health data, secrets, or provider error bodies in metrics. Store response digests only when necessary to establish replay/binding comparison.

## 9. Failure matrix

| Failure | Retry / owner | Customer response? | Completion? | Recovery owner |
| --- | --- | --- | --- | --- |
| Node unavailable / pre-receipt network failure | One bounded n8n invocation attempt; then v2 operational recovery | No | No | n8n/Ticket17 claim expiry + operator |
| Node deadline/ambiguous request | No blind replay; same v2 identity after durable classification | No | No | Node diagnostic + Ticket17 |
| Malformed/unauthenticated request | No | No | No | operator; claim expires/released safely |
| Context read/validation failure | No identical replay until state corrected | No | No | operator/dead letter |
| Interpreter/model failure | Existing bounded in-attempt repair only; then no automatic semantic retry | No | No | Node/operator |
| Fact or policy resolver failure | No until canonical/config correction | No | No | operator |
| Knowledge resolver failure | No if malformed/ambiguous; bounded retry only for explicitly unavailable dependency | No | No | Node/operator |
| Semantic gate blocked/indeterminate | Blocked: no retry; unavailable: capped same-input retry | No | No | Node/operator |
| Composer failure | Capped same finalized-input retry only | No | No | Node/operator |
| Final gate blocked/indeterminate | Blocked: no retry; unavailable: capped exact-candidate retry | No | No | Node/operator |
| Action reservation identity conflict/in-progress | Never mint a second action; inspect/reuse Ticket65D | No until valid execution result supports composition | No | Ticket65D/Node |
| Action retryable failure | Ticket65D same execution key only | No (unless policy/plan produces valid non-action response in a later explicitly designed flow) | No | Ticket65D/Node |
| Action terminal failure | No provider retry | Only if a separately validated no-action plan exists; initial canary: no | No | operator |
| Outbound reservation failure | Idempotent same logical key after repair; never regenerate | No | No | n8n/DB/operator |
| Twilio/provider failure/unknown | Existing persisted-reply reconciliation; no v2 rerun | Already-reserved text only, never a new response | No until predicate passes | existing n8n/recovery |
| Persistence failure after possible provider acceptance | Reconcile provider state; never resend blindly | No new response | No until canonical evidence passes | existing reconciliation |

## 10. Cutover phases and measurable gates

| Phase | Entry gate | Exit gate |
| --- | --- | --- |
| A — implementation offline | Approved Ticket75 design; no traffic route | Contract/unit/DB integration tests pass; no active workflow/config change; threat review passes. |
| B — deterministic replay | Phase A pass; sanitized fixed corpus and golden canonical snapshots | 100% schema/identity validation; deterministic adapters match expected facts/policy/action identities; no outbound/action DB mutation; documented semantic differences reviewed. |
| C — production shadow | Fresh runtime timeout/topology verification; diagnostic retention/access approved; shadow kill switch tested | Representative bounded cohort reaches agreed volume/time window with zero shadow-caused delivery impact, zero unauthorized side effects, no lease/recovery interference, and reviewed failure/latency thresholds met. |
| D — one-at-a-time canary | Shadow acceptance; new reservation RPC and transport/recovery rehearsal proven; live approval | Deterministic cohort only, max one active v2 turn, zero duplicate outbound/action, completion/recovery predicate observed for each case, all incidents resolved. |
| E — controlled expansion | Phase D pass and rollback drill | Increment deterministic cohorts with predeclared caps; thresholds for error, gate block, reservation conflict, provider reconciliation, latency, and duplicate rate remain within approved limits for each hold period. |
| F — legacy conversational-path retirement | E stable over agreed observation window; all legacy-only paths mapped/migrated or retained deliberately; data retention/rollback plan approved | Version route defaults v2 only after separate change approval; legacy nodes removed only after no in-flight legacy claims and recovery audit proves no dependent persisted replies. |

Threshold numbers, sample sizes, hold times, and safe HTTP deadline are intentionally not invented; they require release-owner approval based on fresh production measurements.

## 11. Smallest safe implementation-ticket sequence

1. **T75A — claimed-turn contract and secure Node skeleton.** Add request/response schemas, auth middleware, route flag evaluator, deadline/correlation/error taxonomy and unit tests. Expected: `lib/sales-engine-v2/`, new server route/module, config, tests. No production impact; depends on Ticket75.
2. **T75B — canonical context and authority adapters.** Build lease-checked read adapter for messages/session/memory/artifacts plus Ticket71/72 snapshot readers and production policy packaging. Tests: malformed/timestamp/lease/artifact/fact/knowledge cases and disposable Postgres integration. No routing/deployment; depends on T75A and Ticket74.
3. **T75C — model/action runtime adapters.** Wire structured model clients, fixed versions/deadlines, Ticket65D store, Stripe/holding adapters and no-op shadow executor. Tests: adapter schemas, timeout/cancel, idempotency/retry/terminal action behavior. No customer traffic; depends on T75A/B.
4. **T75D — v2 reservation and artifact atomicity.** Add a new migration and synchronized `database/schema.sql` for the lease-checked logical-reply/multipart/manifest/artifact RPC; do not alter existing recovery semantics. Tests: DB concurrency/idempotency/lease/conflict/partial-artifact/recovery compatibility. This is schema preparation only; depends on T75B and Ticket17A.
5. **T75E — n8n integration artifact and transport adapter.** Modify the canonical generator/source, regenerate inactive workflow JSON, add only the post-claim deterministic route, internal invocation, validation, reservation call, and shared transport continuation. Tests: generator synchronization/topology/integration contracts; no activation. Depends on T75A–D.
6. **T75F — diagnostics, replay and shadow controls.** Add minimized diagnostic persistence/telemetry, replay runner, shadow branch, retention/access tests and failure dashboards/runbook. No live shadow activation. Depends on T75A–E.
7. **T75G — production-readiness verification.** Read-only verify active workflow/poller IDs/topology, auth route, proxy/n8n/Node deadlines, lease compatibility, credentials, RPC ACL/version, and rollback drill. No deployment/routing. Depends on T75E/F.
8. **T75H — separately authorized shadow release.** Deploy only after review, keep v2 shadow-only, observe against Phase C criteria. This is a deployment ticket, not combined with implementation.
9. **T75I — separately authorized canary activation.** Configure one deterministic cohort/action policy after Shadow acceptance, execute Phase D, and retain a new-work-only rollback switch. No expansion bundled.

## 12. Open blockers

### Blocker before implementation

- None that changes the Ticket69 architecture, given the user-supplied Ticket74 COMPLETE/VERIFIED/PASS closure. T75A must still select the approved internal auth mechanism and endpoint hosting location; this is a bounded implementation decision, not authorization to expose a public endpoint.

### Blocker before shadow

- Implement and test T75A–F, especially the canonical lease-bound context adapter, fact/knowledge adapters, model safety adapters, and minimized diagnostic store.
- Freshly verify active runtime topology, request-timeout chain, Node deadline, active lease/renewal behavior, and Recovery Poller identity/configuration. Captured exports do not prove them now.
- Approve retention/access controls and explicit shadow comparison criteria.

### Blocker before canary

- New lease-checked atomic v2 reply/multipart/manifest/artifact reservation RPC, schema sync, and transport/recovery compatibility tests.
- Inactive workflow integration review and separately approved deployment; verified credentials/auth/ACLs; successful shadow acceptance; rollback drill.
- Action canary specifically needs tested Ticket65D/Stripe destination idempotency. Initial canary excludes action-authorizing turns until then.

### Post-canary / non-blocking

- Progressive cohort expansion thresholds and legacy conversational-path retirement after the observation period.
- Migration of currently excluded legacy-only paths only after their own authority/action/delivery mappings are approved.

## Validation and non-actions

This document was based on the two required reference files, Ticket69/68A/70A/74 records, relevant v2 modules, schema/migrations, and focused regression checks. It does not claim that a captured workflow proves present production configuration. No production operation, workflow import/activation, migration execution, deployment, push, or customer routing occurred.
