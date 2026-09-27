# Ticket75F.1 — Durable Diagnostic and Offline Replay Spine

`public.v2_lifecycle_diagnostic_events` is an append-only, backend-only observational record. Its sole writer is `public.record_v2_lifecycle_diagnostic(jsonb)`, which accepts only the closed `ticket-75f1-v1` payload. The table is not an authority for facts, policy, action authorization, outbound reservation, provider acceptance, completion, or recovery.

## Correlation and privacy

The closed payload may contain a diagnostic event key, Ticket75A invocation/turn/claim/workflow identities, a canonical inbound UUID for restricted operational correlation, an injected HMAC-derived session pseudonym, route generation/mode, closed lifecycle/failure/retry classifications, latency, bounded stage/gate projection, Ticket65D typed action identities/states, and Ticket75D reservation identities/counts. The recorder rejects unknown fields.

It rejects customer or assistant text, conversation history, phone/session identifiers, names/email/profile/health data, prompts, raw model output, provider SID/payload/error bodies, destinations, credentials, tokens, keys, arbitrary execution state, and generic response/customer digests. No retention period is encoded: retention, deletion linkage, and authorized operational access remain an explicit T75G policy/deployment decision.

RLS is enabled and forced. Direct table access is revoked from public, anon, authenticated, and service roles; only `service_role` may execute the fixed-search-path `SECURITY DEFINER` recorder. A repeated identical event key returns `recorded_existing`; any changed reuse fails closed with `V2_DIAGNOSTIC_EVENT_CONFLICT`. There are no update/delete interfaces.

## Node observer

`diagnostic-observer.js` projects only allow-listed typed fields before invoking the recorder. `claimed-turn-runtime` emits bounded eligible/rejected observations, while composition projects Ticket68 trace, private typed Ticket65D action identities, and Ticket75D reservation handoff. The observer is fire-and-forget and redacts recorder failures to a bounded operational log. A diagnostic failure cannot change a turn result, action, claim, reservation, transport, completion, reconciliation, or retry behavior.

## Offline replay

`scripts/run-ticket-75f1-offline-replay.js` consumes only sanitized structural fixtures. It does not include or compare customer prose. Its adapters deliberately reject action execution, Ticket65D mutation, reservation, transport, completion, claim mutation, recovery, and network activity. The oracle is obligation categories/count, authority classes, gate statuses, typed action projection, eligibility/terminal outcome, stage trace, and `reservation_state: not_executed`.

## Deferred work

Ticket75F.2 remains responsible for generated n8n lifecycle events, deterministic cohort controls, and shadow-versus-legacy production comparison. Ticket75G remains responsible for retention/access approval, shared assertion replay storage, network and timeout/lease verification, production topology checks, operational drills, and activation authorization.
