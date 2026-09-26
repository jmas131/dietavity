# Ticket 70A — Authorized Read-Only Production Prerequisite Verification

## Executive conclusion

**PARTIALLY_VERIFIED.** The dedicated least-privilege production audit path authenticated and established a PostgreSQL session as `codex_prod_readonly` with both `transaction_read_only` and `default_transaction_read_only` set to `on`. Catalog-only inspection verified the live `public.messages` contract and the two recovery RPC definitions. It also established that every required Ticket 17A, 65D, 71, and 72 production table/function is **ABSENT**.

**Ticket 69 boundary conclusion: `INSUFFICIENT_RUNTIME_EVIDENCE`.** The 15-minute claim/renewal and one-minute poller are supported by the dated workflow references, but no live n8n/request/proxy timeout envelope was available. Nginx systemd start/stop limits do not prove request timeout safety. Therefore neither a synchronous boundary nor an async requirement is established by live evidence.

## Access-boundary evidence

| Claim | Status | Evidence |
| --- | --- | --- |
| SSH identity used | VERIFIED_LIVE | The exact forced identity authenticated as `dietavity-audit`. |
| Database identity | VERIFIED_LIVE | `current_user = session_user = codex_prod_readonly`. |
| Read-only transaction settings | VERIFIED_LIVE | `transaction_read_only = on`; `default_transaction_read_only = on`. |
| Role flags | VERIFIED_LIVE | `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, `NOINHERIT`. |
| Public-table data privileges | VERIFIED_LIVE | Privilege predicates returned false for SELECT/INSERT/UPDATE/DELETE/TRUNCATE on all 17 live public tables. |
| Public-function execution privileges | VERIFIED_LIVE | Catalog predicate count was zero. |
| `public` schema use | VERIFIED_LIVE | USAGE predicate was true. |
| No sudo capability | NOT_VERIFIABLE_WITH_CURRENT_ACCESS | This audit did not invoke `sudo`, as prohibited. |
| Customer/business rows, secrets, key material, `.pgpass`, or `/root/.env` read | VERIFIED_LIVE | No table SELECT was performed; only catalogs/settings were queried. The private key and `.pgpass` were used implicitly only. |

No write, DDL, DML, RPC execution, migration, deployment, configuration change, restart, or privilege change was attempted.

## Live production inventory relevant to Ticket 69

**VERIFIED_LIVE:** public base tables are:

`logs`, `meal_plans`, `messages`, `onboarding_chat_memory`, `onboarding_sessions`, `portal_recovery_initiations`, `portal_recovery_requests`, `profiles`, `programs`, `purchases`, `sales_funnel_events`, `shopping_items`, `shopping_lists`, `subscriptions`, `unsubscribed_metrics`, `users`, and `weeks`.

No matching Ticket 17A/65D/71/72 relations were present. The public-function catalog contained only the two WhatsApp recovery functions plus portal-recovery, setup-event, program-week, and update-timestamp functions; no Ticket 17A/65D/71/72 function was present.

## public.messages live contract

**VERIFIED_LIVE:** `public.messages` has these Ticket-69-relevant columns:

| Columns | Type / nullability / default |
| --- | --- |
| `id` | UUID, not null, `gen_random_uuid()` |
| `user_id`, `in_reply_to_id` | UUID, nullable |
| `direction`, `session_id`, `body`, `message_kind`, `provider`, `provider_message_sid`, `idempotency_key`, `delivery_status`, `processing_owner`, `processing_outcome` | text, nullable except `direction` (not null) |
| `timestamp`, `processing_lease_until`, `processing_completed_at` | timestamptz, nullable; `timestamp` defaults to `now()` |
| `metadata` | JSONB, not null, defaults to `'{}'::jsonb` |
| `processing_order` | bigint, nullable |

Legacy content-bearing columns also remain: `user_message`, `audio_url`, `transcript`, `intent`, and `assistant_response`.

**VERIFIED_LIVE constraints:** primary key `messages_pkey`; `in_reply_to_id → messages(id) ON DELETE SET NULL`; `user_id → users(id) ON DELETE CASCADE`; direction/provider/message-kind/delivery-status checks; JSON-object metadata check; canonical-shape and processing-shape checks; lease pairing check; processing-outcome check allowing `historical_completed`, `completed`, or `reconciliation`.

**VERIFIED_LIVE indexes:** partial unique idempotency key; partial unique `(provider, provider_message_sid)`; partial unique `processing_order`; session processing queue index on `(session_id, processing_order)`; partial active lease index; session and user timestamp indexes. These catalog facts support the existence of durable session order, provider identity, reply linkage, idempotency, and lease/completion fields.

**VERIFIED_LIVE RLS/ACL:** RLS and FORCE RLS are enabled; no policies are present; relation ACL grants `postgres` and `service_role`, while the audit role has no public.messages table privilege.

## Relevant recovery RPCs

| Function | Status | Live properties |
| --- | --- | --- |
| `public.claim_whatsapp_reply_recovery_part(jsonb)` | VERIFIED_LIVE | Set-returning `messages`, owned by `postgres`, SECURITY DEFINER, volatile, parallel unsafe, search path `pg_catalog, public`; EXECUTE ACL only for `postgres` and `service_role`. |
| `public.prepare_whatsapp_reply_recovery(jsonb)` | VERIFIED_LIVE | Set-returning `messages`, owned by `postgres`, SECURITY DEFINER, volatile, parallel unsafe, search path `pg_catalog, public`; EXECUTE ACL only for `postgres` and `service_role`. |

**VERIFIED_LIVE definition analysis:** both use per-session transaction advisory locks and row locks. Both verify inbound/outbound/session/key identity. Preparation validates recovery evidence, multipart count/body limits, source hash, logical key, provider state, and idempotent prepared state. Claiming enforces FIFO by rejecting an earlier unfinished inbound, rejects an active inbound lease, verifies a recent inbound provider window, validates every multipart sibling and idempotency key, claims only the first not-accepted part, and requires provider acceptance evidence for already-accepted parts.

**VERIFIED_LIVE historical reconciliation:** `prepare_whatsapp_reply_recovery` contains guarded historical-reconciliation reopen logic. It requires explicit boolean input, `processing_outcome = reconciliation`, compare-and-set completion timestamp, released owner/lease, order presence, no prior reopen marker, and prevents reopening behind a session with active/unfinished side-effect risk. This extends the dated reference assumptions with directly observed live behavior.

**NOT_VERIFIABLE_WITH_CURRENT_ACCESS:** runtime behavior under concurrency, actual provider acceptance outcomes, and whether n8n currently calls these exact RPC definitions. No RPC was executed.

## Ticket prerequisite matrix

| Ticket | Expected local objects | Live status | Exact live evidence | Required next action |
| --- | --- | --- | --- | --- |
| 17A | `conversation_artifacts`, `conversation_artifact_lineage`, `persist_conversation_artifact(jsonb)`, ungranted privacy deletion RPC; related keys/FKs/checks/RLS/ACLs | ABSENT | Expected table and function catalog lookups each returned absent; no similarly named public relation/function appeared. | Prepare and review the Ticket 17A migration before any artifact-producing v2 delivery path. Do not apply in this ticket. |
| 65D | `authorized_action_executions`; reserve/complete/fail authorized-action execution RPCs; PK/unique/checks/RLS/ACLs | ABSENT | Expected table and all three function catalog lookups returned absent; no similarly named public relation/function appeared. | Prepare and review the Ticket 65D migration before wiring Node action execution. Do not apply in this ticket. |
| 71 | `product_fact_authority_sets`, `product_fact_authority_records`, value-validator and activation functions, active-scope unique index, RLS/ACLs | ABSENT | Expected table/function catalog lookups returned absent; no similarly named public relation/function appeared. | Prepare and review the Ticket 71 migration and approved authority-content process. Do not apply in this ticket. |
| 72 | `reviewed_nutrition_knowledge_sets`, `reviewed_nutrition_knowledge_records`, activation function, active-locale unique index, RLS/ACLs | ABSENT | Expected table/function catalog lookups returned absent; no similarly named public relation/function appeared. | Prepare and review the Ticket 72 migration and approved knowledge-content process. Do not apply in this ticket. |

Because each object family is absent, its intended constraints/indexes/RLS/ACLs cannot be compared individually; those sub-checks are **ABSENT**, not inferred as compliant. Authority-row content was not queried and therefore is neither read nor verified.

## Existing Ticket 17/recovery comparison

| Material claim | Status | Evidence |
| --- | --- | --- |
| Live messages processing/order/owner/lease/completed/outcome fields and supporting indexes exist | VERIFIED_LIVE | Catalog columns, constraints, and indexes. |
| Live recovery RPCs use advisory/row locks, FIFO, lease, logical-reply/multipart, idempotency, acceptance-evidence, and guarded reconciliation controls | VERIFIED_LIVE | `pg_get_functiondef` of both named functions. |
| Live historical reconciliation reopen behavior is guarded | VERIFIED_LIVE | Direct definition inspection of `prepare_whatsapp_reply_recovery`. |
| Dated Sep. 21 reference shows the current workflow claim SQL chooses lowest `(processing_order, id)`, grants a 15-minute lease, and reservation renews it | VERIFIED_FROM_REFERENCE_ONLY | Production-reference JSON export dated 2026-09-21. |
| Dated poller has one-minute resume cadence | VERIFIED_FROM_REFERENCE_ONLY | Production poller reference dated 2026-09-21. |
| The live n8n workflow currently retains the Sep. 21 claim/reservation/completion topology or exact 15-minute lease | NOT_VERIFIABLE_WITH_CURRENT_ACCESS | No active n8n workflow/configuration export was readable through the audit path. |
| The recovery RPCs precisely match the Sep. 21 reference | NOT_VERIFIABLE_WITH_CURRENT_ACCESS | The dated workflow export does not provide a comparable definition of these live database functions. The guarded historical-reconciliation reopen behavior is VERIFIED_LIVE from the current function definition, but cannot be labelled a drift from that reference alone. |
| A Ticket 69 lease-checked atomic v2 logical-reply/multipart/artifact reservation RPC exists | ABSENT | Ticket 69 identifies this as a future required boundary; no such expected Ticket 17A/Ticket-69 object appears in the live catalog. |

## Runtime/timeout evidence

| Item | Status | Evidence |
| --- | --- | --- |
| Nginx is running | VERIFIED_LIVE | Process command-name metadata and systemd metadata. |
| Nginx systemd unit start/stop limits | VERIFIED_LIVE | `TimeoutStartUSec=1min 30s`; `TimeoutStopUSec=5s`. These are lifecycle limits, not HTTP request limits. |
| Readable nginx proxy timeout directives | NOT_VERIFIABLE_WITH_CURRENT_ACCESS | No matching directives were readable from standard readable nginx locations. |
| n8n execution/webhook/worker timeout configuration | NOT_VERIFIABLE_WITH_CURRENT_ACCESS | No n8n process metadata or exported timeout-variable names were available to the audit account. |
| Node/PM2 request timeout configuration | NOT_VERIFIABLE_WITH_CURRENT_ACCESS | Process command-name metadata confirmed Node/PM2 presence but no non-secret request-timeout configuration was readable. |
| 15-minute inbound lease/renewal pattern and one-minute poller | VERIFIED_FROM_REFERENCE_ONLY | Sep. 21 production-reference workflow exports; not live configuration proof. |
| Safe 25–75 second synchronous Ticket 68 path | NOT_VERIFIABLE_WITH_CURRENT_ACCESS | Required n8n, proxy, Node, and active-lease runtime bounds are not all established. |

## Blockers and recommended next work

1. **Deploy prerequisite design review (no execution here):** Ticket 17A, then Ticket 65D, Ticket 71, and Ticket 72 migrations/authority processes must be approved and deployed before the v2 integration can use artifacts, durable action execution, product facts, or reviewed knowledge.
2. **Ticket 69 persistence seam:** design, review, test, and deploy the single lease-checked atomic logical-reply/multipart/artifact reservation boundary. It is absent and must preserve the observed ledger/recovery invariants.
3. **Runtime evidence ticket:** obtain a similarly least-privilege, non-secret view of the active n8n workflow settings, proxy request timeouts, Node server timeout, and active claim lease/renewal configuration; then make the sync/async decision.
4. **Only after 1–3:** prepare the authenticated Node/n8n integration and field/dataflow review. Do not replace legacy transport/recovery behavior until it is mapped against the active workflow.

## Sanitized commands/query categories used

- Local read-only inspection of the named commits, migrations, schema snapshot, docs, tests, and Sep. 21 production-reference workflow JSON.
- Dedicated SSH only: `-i ~/.ssh/dietavity_audit -o IdentitiesOnly=yes -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o BatchMode=yes dietavity-audit@217.15.170.103`.
- Server-side `psql -X -v ON_ERROR_STOP=1` via the existing implicit credential mechanism, limited to `pg_roles`, `pg_class`, `pg_attribute`, `pg_attrdef`, `pg_constraint`, `pg_indexes`, `pg_policy`, `pg_proc`, privilege predicates, and `pg_get_functiondef`.
- Bounded non-secret runtime metadata: process command names, nginx systemd timeout fields, readable nginx timeout directives only, and environment-variable names only (not values).

No command selected table rows, called a business/recovery RPC, read secret files, or included credentials.

## Files and validation

- Updated: this document only.
- Checks run: local `git diff --check` and untracked-file whitespace check.
- No repository tests were run: no executable implementation changed.
- No commit or push was made.
- The pre-existing untracked `supabase/` directory remains untouched.
