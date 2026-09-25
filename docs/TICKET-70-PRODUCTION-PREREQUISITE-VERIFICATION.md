# Ticket 70 — Sales Engine v2 production prerequisite verification

## 1. Executive status

**Overall status: `NO_PRODUCTION_READ_ACCESS`.**

Repository and the dated n8n production-reference exports were inspected at
base commit `fe96bd11514c1f5793611d489bbce503707a56e0`. A configured SSH
target was reachable but rejected the available authentication. No configured
PostgreSQL service or other legitimate production database read path was
available locally. Consequently this ticket made **no production database,
n8n, PM2, nginx, provider, workflow, or configuration mutation**, and it does
not claim that either September 2026 migration is installed in production.

The Ticket 69 integration design remains plausible against the **September 21
production reference**, but live installation, lease, privilege, timeout, and
topology facts require an authorized read-only production inspection before
implementation or a production migration decision.

Status vocabulary in this document is deliberately literal:

| Status | Meaning here |
| --- | --- |
| **VERIFIED IN PRODUCTION** | Direct live metadata/configuration inspection. None obtained. |
| **VERIFIED FROM CURRENT PRODUCTION REFERENCE** | Read-only repository export explicitly labelled as a production reference, dated 2026-09-21; it is not live-state proof. |
| **VERIFIED LOCALLY ONLY** | Current base-commit migrations, schema snapshot, code, and tests. |
| **NOT VERIFIED / ACCESS UNAVAILABLE** | No safe, authenticated live read path was available. |
| **MISSING IN PRODUCTION** | Would require live evidence of absence. None asserted in this audit. |
| **CONFLICT / STOP** | A material contradiction. No live contradiction was observed; lack of access is a stop for production assertions. |

## 2. Verification methodology and access boundaries

The audit first inspected Ticket 69, Tickets 17/17A, 37/37A, 59B, 65D, and
68; the relevant migrations, `database/schema.sql`, v2 runtime adapters and
tests; `server.js`; deployment documentation; and:

- `n8n/references/production-sales-engine-2026-09-21.json`;
- `n8n/references/production-whatsapp-recovery-pollersales-engine-2026-09-21.json`.

The repository is at the requested base commit. Its untracked `supabase/`
directory was not modified or staged.

For live access, only non-mutating discovery was attempted: local configured
database-service metadata and a bounded SSH connection to the configured
deployment host, requesting only process/configuration metadata. SSH
authentication was denied. No password, token, connection string, customer
row, message body, phone number, profile, payment detail, provider action, RPC,
or DML statement was used or printed. The local Supabase configuration is a
local-development configuration, not a linked production project.

The following read-only live checks remain appropriate only after an operator
provides a legitimate read role/path: `pg_catalog`/`information_schema` table,
constraint, index, function-definition, ACL, and migration-history queries;
n8n workflow/configuration export; PM2 process metadata; and nginx effective
configuration. Do not call persistence, deletion, reservation, completion,
failure, claim, Stripe, Twilio, or OpenAI actions to test them.

## 3. Expected Ticket 17A object manifest

The expected source is migration
`database/migrations/20260923_ticket_17a_typed_conversational_output_metadata.sql`.
The synchronized local schema includes the same objects and ACL intent.

| Expected object / rule | Required contract | Status |
| --- | --- | --- |
| `public.conversation_artifacts` | Backend-only table keyed by `artifact_id`; `contract_version = '1.0'`; closed `artifact_type` (`draft`, `summary`); operation/type compatibility; unique `generation_task_id`, `logical_reply_key`, and `anchor_message_id`; anchor FK to `public.messages(id)` with `ON DELETE RESTRICT`. | VERIFIED LOCALLY ONLY |
| Canonical anchor relationship | Exactly one outbound anchor message per artifact; anchor must have the matching logical reply key and be multipart part 1. The body remains only in `messages`. | VERIFIED LOCALLY ONLY |
| Artifact identity/type/operation | IDs use `ca-...`; task IDs use `cgt-...`; operations are `draft`, `transform`, `summarize`; `show` creates no artifact. | VERIFIED LOCALLY ONLY |
| `public.conversation_artifact_lineage` | Ordered artifact-to-source graph; PK `(artifact_id, position)`, unique `(artifact_id, source_artifact_id)`, positive position, no self edge, cascade on artifact deletion. | VERIFIED LOCALLY ONLY |
| Logical-reply linkage | `logical_reply_key` is unique and must match the anchored canonical outbound part-1 key. | VERIFIED LOCALLY ONLY |
| `public.persist_conversation_artifact(jsonb)` | `SECURITY DEFINER`, `search_path = pg_catalog, public`; sole runtime artifact boundary; closed JSON input; locks/validates outbound part-1 anchor, multipart shape, ordered lineage, idempotency, source presence, and cycle prevention; returns `public.conversation_artifacts`. | VERIFIED LOCALLY ONLY |
| Privacy boundary | `public.delete_message_with_conversation_artifacts_for_privacy(uuid)` is `SECURITY DEFINER`, same search path; deletes dependent graph then anchor; deliberately ungranted to runtime roles. | VERIFIED LOCALLY ONLY |
| RLS and table mutation restriction | Both tables have RLS enabled and forced; all table privileges revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`. | VERIFIED LOCALLY ONLY |
| Function ACLs | All roles, including `service_role`, are revoked from both functions; only `service_role` is granted `EXECUTE` on `persist_conversation_artifact(jsonb)`. Privacy function remains ungranted. | VERIFIED LOCALLY ONLY |
| Runtime expectations | Ticket 69 requires a lease-checked atomic logical-reply/multipart reservation that invokes/reuses this validator. Such an RPC is a later prerequisite; Ticket 17A does not reserve replies itself. | VERIFIED LOCALLY ONLY |

### 4. Actual Ticket 17A production findings

Every expected Ticket 17A object above is **NOT VERIFIED / ACCESS
UNAVAILABLE** in production. There is no evidence from a live catalog for the
tables, FKs, checks, unique constraints, RLS/force-RLS flags, function
signature/definition/search path, or ACLs. Therefore none is reported as
present, matching, drifted, or absent in production. The 2026-09-21 n8n
reference predates the 2026-09-23 Ticket 17A migration and cannot establish its
installation.

## 5. Expected Ticket 65D object manifest

The expected source is migration
`database/migrations/20260924_ticket_65d_authorized_action_execution.sql`.

| Expected object / rule | Required contract | Status |
| --- | --- | --- |
| `public.authorized_action_executions` | Private backend-only table, PK `execution_key`, unique `action_id`; columns `action_type`, `execution_status`, `lease_owner`, `lease_expires_at`, `result`, `created_at`, `updated_at`. | VERIFIED LOCALLY ONLY |
| Identity and state constraints | `aek-` and `act-` SHA-256-format checks; two launch action types only; states exactly `reserved`, `succeeded`, `failed_retryable`, `failed_terminal`; shape constraint couples reserved lease/no result, succeeded/no lease/result, and failure/no lease/no result. | VERIFIED LOCALLY ONLY |
| Index/uniqueness reliance | The primary key on `execution_key` and unique constraint on `action_id` are the installed indexes/uniqueness boundary; no separate migration-created lease index exists. | VERIFIED LOCALLY ONLY |
| Bounded success result | A JSONB `result` is permitted only for `succeeded`. Runtime `ActionResult` validation enforces closed `ticket-65d-v1` structure and customer-usable destination constraints before completion; the SQL function validates identity/status but not the complete payload schema itself. | VERIFIED LOCALLY ONLY |
| `reserve_authorized_action_execution(jsonb)` | `SECURITY DEFINER`, `search_path = pg_catalog, public`; closed four-field input; locks the row; returns `acquired`, `retry_acquired`, `in_progress`, `already_succeeded`, or `terminal_failure`; initial/retry reservation sets `now() + interval '60 seconds'`. | VERIFIED LOCALLY ONLY |
| `complete_authorized_action_execution(jsonb)` | `SECURITY DEFINER`, same search path; exact four-field input; only current owner can change an unexpired reservation to immutable succeeded result. | VERIFIED LOCALLY ONLY |
| `fail_authorized_action_execution(jsonb)` | `SECURITY DEFINER`, same search path; exact four-field input; only current owner can end an unexpired reservation in retryable/terminal failure. | VERIFIED LOCALLY ONLY |
| RLS and table/function ACLs | RLS enabled and forced; table privileges revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`; functions revoked from `PUBLIC`, `anon`, and `authenticated`, then `EXECUTE` granted to `service_role`. | VERIFIED LOCALLY ONLY |

### 6. Actual Ticket 65D production findings

Every expected Ticket 65D object above is **NOT VERIFIED / ACCESS
UNAVAILABLE** in production. The migration date (2026-09-24) is after the
dated n8n production reference (2026-09-21), so that export provides no
installation evidence. In particular, the 60-second lease is only **VERIFIED
LOCALLY ONLY**, not verified installed production behavior. No reserve,
complete, or fail RPC was called.

## 7. Migration and schema drift findings

| Comparison | Finding | Status |
| --- | --- | --- |
| Repository migrations vs local schema snapshot | The current snapshot contains the Ticket 17A and 65D tables/functions/ACL statements represented by their migrations. | VERIFIED LOCALLY ONLY |
| Repository migration history vs production migration history | Production migration history was not readable. | NOT VERIFIED / ACCESS UNAVAILABLE |
| Local schema vs production catalog | No live `pg_catalog`/ACL/function definition query could run. | NOT VERIFIED / ACCESS UNAVAILABLE |
| Missing/partial/later replacement/signature/grant drift | Cannot be determined safely without both production migration history and live catalog inspection. | NOT VERIFIED / ACCESS UNAVAILABLE |

No **MISSING IN PRODUCTION** or **CONFLICT / STOP** database object is asserted:
absence from a live catalog was never observed.

## 8. Ticket 17 claim and session-lease findings

The September 21 production reference contains the actual SQL text used by its
`Claim Next Session Inbound` node. It is **VERIFIED FROM CURRENT PRODUCTION
REFERENCE**, not live verification:

| Property | Reference finding | Status |
| --- | --- | --- |
| Mechanism/name | PostgreSQL query in `Claim Next Session Inbound`; not a database RPC/function. | VERIFIED FROM CURRENT PRODUCTION REFERENCE |
| Eligibility and FIFO | Same `session_id`, inbound, non-null `processing_order`, unfinished; selects lowest `(processing_order, id)`. | VERIFIED FROM CURRENT PRODUCTION REFERENCE |
| Lease owner | n8n `$execution.id` is passed as `processing_owner`; it is diagnostic lease identity, not provider identity. | VERIFIED FROM CURRENT PRODUCTION REFERENCE |
| Lease duration | Claim sets `processing_lease_until = NOW() + INTERVAL '15 minutes'`. | VERIFIED FROM CURRENT PRODUCTION REFERENCE |
| Busy/stale handling | Existing unexpired other-owner claim returns `busy`; stale claims with fully resolved outbound logical replies reconcile and clear commercial state; stale/no-outbound or same-owner work can be acquired. | VERIFIED FROM CURRENT PRODUCTION REFERENCE |
| Completion predicate | Completion is gated by complete accepted/scheduled/sent/delivered logical reply groups with provider SID/evidence, then clears owner/lease. | VERIFIED FROM CURRENT PRODUCTION REFERENCE |
| Reservation renewal | `Reserve Sales Reply` and `Reserve Checkout Reply` first update the claimed inbound lease to `NOW() + INTERVAL '15 minutes'`, guarded by inbound ID, direction, unfinished state, and matching owner, before insert. | VERIFIED FROM CURRENT PRODUCTION REFERENCE |
| Renewal beyond reference path | There is no separately installed renewal RPC visible in the reference; the proposed new canonical reservation RPC must retain this guard/renewal behavior. | NOT VERIFIED / ACCESS UNAVAILABLE for live production |

Thus the Ticket 69 15-minute and reservation-renewal assumptions are supported
by the dated reference, but neither is **VERIFIED IN PRODUCTION**. No claim,
lease renewal, completion, or recovery mutation was attempted.

## 9. n8n seam and topology findings

The active 183-node Sales Engine export dated 2026-09-21 has the exact
connection:

```text
Claim Next Session Inbound
  -> Route Session Claim State
       acquired output -> Get User from Supabase
       busy output     -> Wait Before Session Claim Retry -> Claim Next Session Inbound
```

This is **VERIFIED FROM CURRENT PRODUCTION REFERENCE**. It matches Ticket 69's
proposed replacement seam immediately after acquired claim routing and before
legacy intelligence begins at `Get User from Supabase`. It is **NOT VERIFIED /
ACCESS UNAVAILABLE** against the live n8n instance; a later workflow edit could
have changed active topology.

The companion reference is active and has a one-minute `Resume Verified
WhatsApp Requests` schedule, then `Find Verified WhatsApp Sessions` and a
wait-for-subworkflow `Execute Dietavity Sales Engine`. Those recovery-poller
semantics are **VERIFIED FROM CURRENT PRODUCTION REFERENCE** and remain
architecturally compatible with Ticket 69's queue-wake-up/transport-recovery
role, subject to live verification.

## 10. n8n timeout findings

| Item | Finding | Status / consequence |
| --- | --- | --- |
| Workflow execution timeout | No timeout appears in the dated workflow export settings. Server/worker environment configuration was unavailable. | NOT VERIFIED / ACCESS UNAVAILABLE |
| Webhook timeout | Not established from live n8n or proxy configuration. The reference's Twilio trigger acknowledgement behavior is not a measurement of deployment timeout. | NOT VERIFIED / ACCESS UNAVAILABLE |
| HTTP Request node timeouts | The relevant legacy HTTP Request nodes in the reference carry no explicit `options.timeout`; default/runtime behavior was not inferred. | VERIFIED FROM CURRENT PRODUCTION REFERENCE for absence of explicit node values; runtime compatibility NOT VERIFIED / ACCESS UNAVAILABLE |
| Worker/task-runner/queue timeout and pruning | No live environment or n8n configuration access. | NOT VERIFIED / ACCESS UNAVAILABLE |
| 25–75 second v2 call | Cannot be declared safe synchronously. | NOT VERIFIED / ACCESS UNAVAILABLE; verify or select an async durable boundary before wiring |

## 11. Node, PM2, and nginx timeout findings

| Item | Finding | Status |
| --- | --- | --- |
| Node topology | `server.js` runs Express directly on port 3000 when executed as the main module. Deployment documentation names a PM2 process `dietavity`, but no ecosystem/PM2 file is tracked. | VERIFIED LOCALLY ONLY |
| Body limits | Express JSON and URL-encoded parsers each use a 32 KB limit; URL-encoded parameters are capped at 100. A bounded internal context needs a deliberately smaller documented contract/budget. | VERIFIED LOCALLY ONLY |
| Application request timeout | No global Express/Node incoming request timeout is configured in repository code. The existing portal-only deadline defaults to 8 seconds and is bounded to 100–30,000 ms; it must not be assumed to govern a new v2 endpoint. | VERIFIED LOCALLY ONLY |
| Existing outbound HTTP calls | Several legacy Axios calls explicitly use 30 seconds; this does not prove ingress/proxy timeout capacity. | VERIFIED LOCALLY ONLY |
| PM2 process configuration and graceful restart | Deployment documentation mentions `pm2 restart dietavity`, but live PM2 metadata/configuration was inaccessible. | NOT VERIFIED / ACCESS UNAVAILABLE |
| nginx proxy/read/send/connect timeouts | No tracked nginx configuration and no live effective configuration access. | NOT VERIFIED / ACCESS UNAVAILABLE |
| Synchronous Node boundary viability | Not established: the 25–75 second Ticket 69 planning budget exceeds the local portal deadline and has no verified n8n/PM2/nginx envelope. | NOT VERIFIED / ACCESS UNAVAILABLE |
| Async worker necessity | Not proven, but it is the safe fallback if verified limits cannot cover the bounded leased turn with cancellation/deadline handling. | CONDITIONAL DESIGN CONSEQUENCE |

## 12. Ticket 69 assumption audit matrix

| # | Assumption | Status | Evidence | Confidence | Implementation consequence |
| --- | --- | --- | --- | --- | --- |
| 1 | Ticket 17A objects exist in production. | NOT VERIFIED / ACCESS UNAVAILABLE | Local migration/schema only; dated reference predates migration. | None for production | Do not build production artifact path or claim compatibility; inspect catalog/ACLs first. |
| 2 | Ticket 65D objects exist in production. | NOT VERIFIED / ACCESS UNAVAILABLE | Local migration/schema only; dated reference predates migration. | None for production | Do not wire reservation store; inspect catalog/ACLs first. |
| 3 | Ticket 65D lease is 60 seconds. | VERIFIED LOCALLY ONLY | Migration uses `interval '60 seconds'`. | High locally; none live | Provider deadlines must remain below installed lease; confirm live definition. |
| 4 | Ticket 17 inbound lease is 15 minutes. | VERIFIED FROM CURRENT PRODUCTION REFERENCE | Dated claim SQL uses `interval '15 minutes'`. | High for export; medium/low for current live | Re-read active SQL/config before relying on 25–75 seconds. |
| 5 | Reply reservation renews inbound lease. | VERIFIED FROM CURRENT PRODUCTION REFERENCE | Dated sales and checkout reservation SQL renews 15 minutes with owner guard. | High for export; medium/low for current live | New atomic reservation must preserve guard/renewal; confirm active workflow. |
| 6 | Current n8n seam matches Ticket 69. | VERIFIED FROM CURRENT PRODUCTION REFERENCE | Exact 2026-09-21 node names/connections match. | Medium for current production due staleness | Re-export/read active workflow before integration; update Ticket 69 if changed. |
| 7 | n8n can safely wait for proposed Node request. | NOT VERIFIED / ACCESS UNAVAILABLE | No execution/webhook/worker timeout config. | None | Do not choose synchronous call until verified; otherwise design async durable job. |
| 8 | Node/nginx can safely serve proposed request. | NOT VERIFIED / ACCESS UNAVAILABLE | Local Express facts only; no live PM2/nginx config. | None | Verify effective proxy and process/restart limits or use async boundary. |
| 9 | Recovery Poller semantics remain compatible. | VERIFIED FROM CURRENT PRODUCTION REFERENCE | Active dated one-minute poller wakes verified unfinished sessions and waits for subworkflow. | Medium for current production | Preserve queue-wake-up role; live-check before routing/canary. |
| 10 | No current production component requires legacy classifier output for transport correctness. | NOT VERIFIED / ACCESS UNAVAILABLE | Reference shows legacy fields feed legacy response/reservation metadata, but active/live dependencies and downstream assumptions were not exhaustively executable-verified. | Low/medium | Perform a field/dataflow audit of active workflow before removing legacy segment; do not assume transport is classifier-independent. |

## 13. Confirmed prerequisites

Confirmed only at the stated evidence level:

- **VERIFIED LOCALLY ONLY:** Ticket 17A and 65D are fully specified in current
  migrations and synchronized local schema; Ticket 65D's source lease is 60
  seconds; the v2 runtime expects the private service-role RPC names shown
  above.
- **VERIFIED FROM CURRENT PRODUCTION REFERENCE:** the September 21 workflow
  exposes the Ticket 69 seam, has a 15-minute claim and reservation renewal
  pattern, uses the described canonical completion predicate, and has a
  one-minute recovery poller.

No prerequisite is **VERIFIED IN PRODUCTION**.

## 14. Missing prerequisites

No item is classified **MISSING IN PRODUCTION** because live absence was not
observed. The implementation work still lacks these designed prerequisites in
the current repository:

1. Ticket 68A post-gate delivery-manifest contract for artifact-producing
   replies.
2. One lease-checked canonical atomic reservation RPC that can reserve the
   logical reply/multipart rows and invoke/reuse Ticket 17A validation in the
   same transaction. Ticket 17A's existing RPC is intentionally not that
   reservation boundary.
3. Production fact/knowledge authority, bounded context adapter, Node
   provider/model adapters, endpoint authentication, and operational retry/
   failure-record design described by Ticket 69.

These are repository implementation prerequisites, not claims about production
installation state.

## 15. Unverifiable prerequisites

Before implementation or deployment planning, authorized read-only production
access must establish:

- migration history plus live catalog definitions/constraints/indexes/ACLs/RLS
  for Ticket 17A and 65D;
- actual installed 15-minute inbound and 60-second action leases;
- active workflow node graph, active version, and dataflow dependencies;
- n8n execution/webhook/HTTP/worker/pruning/queue timeouts;
- actual PM2 topology, graceful-restart behavior, and effective nginx timeout
  directives; and
- an active-workflow dataflow audit proving which legacy classifier fields are
  transport requirements rather than legacy intelligence metadata.

## 16. STOP conditions

**CONFLICT / STOP:** none observed.

**Operational stop:** do not implement, migrate, or wire the Ticket 69
production boundary on the basis of local migrations or dated exports. Stop
and obtain authorized read-only production catalog/configuration access first.
If live catalog results show Ticket 17A or 65D absent, signature/definition
drift, missing service-role `EXECUTE`, weakened RLS/ACLs, or different lease
semantics, stop the integration and create a narrowly scoped migration/remedy
decision; do not repair during verification.

## 17. Exact recommended next-ticket sequence

1. **Ticket 70A — authorized read-only production catalog and runtime
   verification.** Supply an authenticated read-only database/n8n/host path;
   verify the manifests, migration history, active workflow export, timeout
   envelope, and live field dataflow without reading customer content or
   invoking mutating functions.
2. **Conditional production migration deployment/verification ticket.** Only
   if 70A proves Ticket 17A and/or 65D absent or drifted, prepare and separately
   authorize the exact migration/remediation and then re-verify catalog/ACLs.
   Do not recreate compatible installed objects.
3. **Ticket 68A — post-gate delivery-manifest contract**, followed by the
   lease-checked atomic canonical outbound reservation boundary required for
   artifacts.
4. **Production authority/context/adapters:** canonical fact and reviewed
   knowledge authority; bounded canonical context adapter; Node model/provider
   adapters with stage deadlines and private Ticket 65D store.
5. **Boundary choice from 70A:** if n8n, Node, PM2, and nginx limits safely
   cover the bounded leased request, implement the authenticated synchronous
   Node endpoint; otherwise implement a durable asynchronous job/poll boundary
   before any n8n routing change.
6. **Routing/canary integration:** only after the above, update the active
   workflow design, preserve transport/recovery ownership, and validate using
   staging/harness tests before separately authorized production work.

