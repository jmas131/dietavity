# Ticket 73 — Production Prerequisite Migration Readiness Review

## Executive conclusion

**Overall status: `READY_FOR_CONTROLLED_DEPLOYMENT`.**

On the exact, catalog-verified production baseline documented by Ticket 70A,
the four migrations are additive and can be applied as four separately
committed, controlled steps without changing the existing WhatsApp ledger or
recovery machinery. No local migration or executable-code change is required
before that later deployment.

This is not authorization to deploy. It is conditional on the preflight and
stop/go gates below, including confirmation that the Ticket 70A absence facts
and migration-history state still hold immediately before each step. It also
does not make the future v2 runtime integration ready: Ticket 69 remains
`INSUFFICIENT_RUNTIME_EVIDENCE`.

The requested sequence **17A → 65D → 71 → 72 is accepted** as the release
sequence. PostgreSQL does not enforce dependencies between those four object
families: 17A depends on existing `public.messages`; 65D, 71, and 72 are
otherwise independent. Thus the order is operationally preferred (and must be
kept for the controlled procedure), not a database dependency except that a
future artifact-producing integration needs 17A and a future action executor
needs 65D.

## Scope and evidence boundaries

This review inspected the current local migrations, `database/schema.sql`,
the Ticket 17A/65D/71/72 documentation and tests, seed generators, Ticket
68/68A and 69 contracts, and the Ticket 70A report. The tests named in
Validation were run locally. No production connection was needed beyond the
authorized Ticket 70A evidence, and none was made for this ticket.

Evidence labels used below:

- **VERIFIED_LOCAL** — direct inspection or local test of the current tree.
- **VERIFIED_FROM_TICKET_70A** — Ticket 70A's authorized live catalog result.
- **NOT_VERIFIABLE_WITH_CURRENT_ACCESS** — would require future authorized
  deployment-role or runtime evidence; it has not been inferred.

No conclusion here authorizes production DDL/DML, workflow import/activation,
application deployment, credentials, service restart, or a Ticket 69 change.

## Verified production baseline

**VERIFIED_FROM_TICKET_70A:** production has the 17 listed public base tables,
including `messages`, `users`, purchases/program/portal tables, and the
canonical sales/recovery support tables. `public.messages` is RLS and FORCE-RLS
protected and has the canonical UUID, inbound/outbound, idempotency, multipart,
lease, processing, and metadata contract. Its `in_reply_to_id` FK is `ON
DELETE SET NULL`; its user FK is `ON DELETE CASCADE`.

**VERIFIED_FROM_TICKET_70A:**
`claim_whatsapp_reply_recovery_part(jsonb)` and
`prepare_whatsapp_reply_recovery(jsonb)` exist, are `postgres`-owned SECURITY
DEFINER functions with `pg_catalog, public` search paths and service-role-only
execution. Their FIFO, lease, multipart, idempotency, provider-evidence, and
guarded reconciliation behavior is live catalog evidence.

**VERIFIED_FROM_TICKET_70A:** every expected 17A, 65D, 71, and 72 relation and
function was absent; no similarly named public relation/function was reported.
The audit database role was `codex_prod_readonly`, read-only, non-superuser,
and had no table or function privileges. Consequently it could not prove
future object ownership, deployment-role capability, backups, live row counts,
or application callers.

## Combined dependency graph and collisions

```text
existing public.messages ──FK/read+row lock──> Ticket 17A
    ├─ conversation_artifacts
    ├─ conversation_artifact_lineage
    ├─ persist_conversation_artifact(jsonb)
    └─ delete_message_with_conversation_artifacts_for_privacy(uuid)

Ticket 65D (independent) ──> authorized_action_executions
    └─ reserve/complete/fail_authorized_action_execution(jsonb)

Ticket 71 (independent) ──> product_fact_authority_sets/records
    └─ validator + activate_product_fact_authority_set(text)

Ticket 72 (independent) ──> reviewed_nutrition_knowledge_sets/records
    └─ activate_reviewed_nutrition_knowledge_set(text)
```

**VERIFIED_LOCAL:** there are no shared object names, function signatures,
indexes, constraints, triggers, enum/domain/type names, RLS policies, or seed
identifiers between the four families. All names are schema-qualified to
`public`; no migration creates a trigger. The only cross-family relationship is
future application architecture described by Tickets 68A/69, not migration
DDL. All use text/JSONB/UUID/built-in types; none creates a custom type.

| Migration | Required existing production object | Objects it creates or replaces | Mandatory order |
| --- | --- | --- | --- |
| 17A | `public.messages(id)` and its canonical outbound metadata conventions | 2 tables, 2 SECURITY DEFINER functions, FKs/checks/keys/RLS/ACLs | Must follow the verified `messages` baseline; otherwise independent. |
| 65D | `public` schema and a migration owner | 1 table, 3 SECURITY DEFINER functions, checks/keys/RLS/ACLs | Independent. |
| 71 | `public` schema and a migration owner | 2 tables, validator and activation functions, partial unique index, checks/FK/RLS/ACLs, seed | Independent. |
| 72 | `public` schema and a migration owner | 2 tables, activation function, partial unique index, checks/FK/RLS/ACLs, seed | Independent. |

The Ticket 71/72 `CREATE ... IF NOT EXISTS` forms are not an implicit
dependency on a prior local install. On the Ticket 70A baseline their names
are absent. A future preflight must refuse to proceed if a same-named object
exists outside the recorded expected earlier step: `IF NOT EXISTS` could
otherwise hide incompatible structure.

## Migration-by-migration impact, transaction, and availability analysis

| Ticket | Existing-object impact | Transaction / replay result | Strongest likely locking and availability impact |
| --- | --- | --- | --- |
| 17A | Creates only new tables and functions. It does not `ALTER public.messages`, its recovery RPCs, portal/purchase/program relations, n8n artifacts, or existing ACL/RLS. The new child FK references `messages`; the runtime RPC later reads/locks an anchor row. | Explicit `BEGIN`/`COMMIT`: any DDL/function/ACL failure rolls back the whole migration; disconnect before commit also rolls it back. It is **not re-runnable after successful commit** because both `CREATE TABLE` statements lack `IF NOT EXISTS`. A retry after rollback is safe on the absent baseline. | Creating a new child FK can take a brief lock compatible with ordinary reads/writes on `messages` (normally `SHARE ROW EXCLUSIVE` on the new child and `ROW SHARE` on referenced parent); it has no child rows to validate and no scan/rewrite of existing `messages`. No index is built on an existing high-traffic table. Function definition does not affect the recovery functions. |
| 65D | New private table/functions only; no action is reserved, provider called, Checkout created, holding URL used, message written, or recovery behavior changed by installation. | One explicit transaction; rollback/drop connection leaves no partial install. It is **not re-runnable after commit** because `CREATE TABLE` has no guard. It is safe to retry after rollback on the absent baseline. | New-relation creation, RLS/ACL metadata, and function creation only. No existing table is read, locked, scanned, rewritten, indexed, or validated. |
| 71 | New authority tables/index/functions plus two configuration sets and 14 records. It does not modify existing sales, portal, program, purchase, or WhatsApp objects. | One explicit transaction. Seed, index, RLS, ACL, and functions roll back together on error/disconnect. A completed re-run converges only for the expected same schema/seed (`IF NOT EXISTS`, `OR REPLACE`, and `ON CONFLICT DO NOTHING`); it is **not proof of full idempotency** if an object or seeded ID exists with different definition/data. The preflight must reject such drift. | New-table operations and partial index creation contain no pre-existing rows under this baseline; no concurrent index is necessary. `CREATE OR REPLACE` would replace same-signature functions only if they existed, but Ticket 70A says they are absent. |
| 72 | New authority tables/index/function plus one configuration set and two records. No existing business/ledger relation or behavior is changed. | Same all-or-nothing behavior. Expected completed re-run converges, but incompatible pre-existing same-named schema/data is not safely repaired or proven; preflight must reject it. | New-table metadata and small seed only; no existing-table scan/rewrite/blocking. |

`CREATE INDEX` in 71/72 is intentionally inside the migration transaction and
is not `CONCURRENTLY`. That is safe here because each index is on an empty new
table before its seed is inserted. It would need reassessment if the absent
baseline changed and the target relation already contained rows. No row count
has been invented.

Within a transaction, DDL and grants/revokes are not externally visible until
commit. Therefore a table/function is not externally exposed between its
`CREATE` and subsequent `REVOKE`/`GRANT` statements. `CREATE FUNCTION` can
receive default PUBLIC execute initially, but the revoke occurs before commit;
the same is true of any default relation privilege. The migration executor can
use the objects inside its own transaction, but other sessions cannot observe
or call the uncommitted objects.

## Existing WhatsApp ledger and recovery preservation

**VERIFIED_LOCAL and VERIFIED_FROM_TICKET_70A:** none of the four files alters
`public.messages`, `claim_whatsapp_reply_recovery_part(jsonb)`, or
`prepare_whatsapp_reply_recovery(jsonb)`. None creates a trigger on messages,
changes its RLS/ACL/constraint/index set, selects customer rows during
installation, or changes n8n-visible current behavior.

17A deliberately adds an `ON DELETE RESTRICT` child FK from a *new, empty*
table to `messages`. It only changes future deletion behavior after a future
artifact row is persisted: an anchored message cannot be directly deleted
until the deliberately ungranted privacy RPC deletes its artifact graph and
anchor atomically. Legacy messages receive no row; old application behavior
is unchanged while old code neither calls the new RPC nor writes artifacts.

Old production application code remains compatible after every successful
intermediate step: it neither requires these new objects nor is its existing
schema contract altered. Conversely, no new v2 wiring is implied or allowed
by this migration set. Ticket 69's required lease-checked atomic outbound
reservation/artifact boundary remains absent.

## Security, ACL, RLS, and mutation boundaries

The migration executor becomes the owner of newly created objects; the exact
production owner is **NOT_VERIFIABLE_WITH_CURRENT_ACCESS** and must be the
approved controlled migration role, not the read-only audit role. No migration
changes ownership or grants on an existing object.

| Family | Table boundary | Function boundary |
| --- | --- | --- |
| 17A | Both tables enable and FORCE RLS; all table privileges are revoked from PUBLIC, `anon`, `authenticated`, and `service_role`. No policies are created. | Both are SECURITY DEFINER with `search_path TO pg_catalog, public`. `persist...` is service-role executable only; privacy deletion is executable by none of those runtime roles. The persist RPC is the only intended runtime mutation path. |
| 65D | Table enables and FORCEs RLS; all table privileges are revoked from PUBLIC, `anon`, `authenticated`, and `service_role`; no policies. | All three are SECURITY DEFINER with `pg_catalog, public` search path. PUBLIC/anon/authenticated execute is revoked; only service_role receives execute. Reservation is required before a future provider call; completion/failure require matching current lease owner and unexpired lease. |
| 71 | Both tables enable and FORCE RLS; PUBLIC/anon/authenticated are revoked. Service_role receives `SELECT, INSERT`, not UPDATE/DELETE. No policies. | Validator is service-role executable. Activation is SECURITY DEFINER, service-role executable, and performs its retire/activate pair in one transaction. Its search path is `public`; all relation references are explicitly schema-qualified. This is safe from the currently shown static SQL, but post-install verification must capture the exact definition/ACL/owner. |
| 72 | Same table boundary as 71. | Activation is SECURITY DEFINER, service-role executable, with static schema-qualified relations and `search_path = public`; post-install verification must capture it exactly. |

The 71/72 service role is intentionally a trusted backend authority writer:
its INSERT grant can create a reviewed-active set, while activation provides
the normal no-direct-update lifecycle. This is not a public/anon/authenticated
privilege widening, and it is not an installation-time behavior change. It is
an operational trust assumption that the later deployment must preserve:
application/runtime credentials must not be exposed to clients and must not
write unreviewed authority data.

## Ticket-specific findings

### Ticket 17A

`conversation_artifacts` is one-to-one with a canonical first outbound message
through unique `anchor_message_id`, unique logical reply key, and unique
generation task. `persist_conversation_artifact(jsonb)` validates an exact
closed input shape; outbound direction, canonical key/metadata, first part,
multipart siblings, ordered/deduplicated lineage, source existence, identity
conflicts, and transitive cycles. It locks the anchor row and inserts artifact
and lineage atomically. It neither copies message text nor changes delivery or
acceptance evidence.

The artifact/generation-task identities are prospective assumptions enforced
by the checks and unique keys (`ca-*`, `cgt-*`, one artifact per logical
reply). The migration itself writes no artifacts and therefore neither makes a
legacy message typed nor requires old messages to meet new metadata shapes.
The privacy function locks the requested canonical message, recursively removes
only its dependent descendants, then deletes that anchor; it is intentionally
ungranted. This preserves unrelated graphs and the ledger's normal authority.

### Ticket 65D

`authorized_action_executions` uses stable `act-<sha256>` action IDs and
`aek-<sha256>` execution keys, a unique action ID, bounded two-action type,
and lease/result state check. Reserve inserts an acquired 60-second lease or
row-locks/reuses existing state. Complete/fail require the same action/key,
worker, and unexpired reservation. Success stores an immutable result because
neither completion nor failure can update a `succeeded` row. A lease expiry
allows `retry_acquired`; this is intentional but means a future provider
adapter must set its provider timeout below 60 seconds and correctly handle
ambiguous provider acceptance before attempting again. This operational
provider guarantee is a future Ticket 69/integration prerequisite, not an
installation side effect.

No migration statement calls these RPCs or any provider. Installing 65D alone
cannot create Checkout/holding actions, URLs, messages, or external effects.

### Ticket 71 seed and lifecycle

The generated seed exactly matches
`config/sales-engine-v2/product-fact-authority.json` under the local parity
test. It inserts two deterministic reviewed-active sets:

- `standard-28d-149-v1`, scope `offer_version: 28d-149-v1`, version `1`, with
  11 facts: price MXN 149, 28 days, one-time/no subscription/no auto-renewal,
  meals, post-payment personalization, portal, WhatsApp support, payment
  methods, and explicitly unknown refund policy.
- `dietavity-provider-boundaries-v1`, provider scope, version `1`, with three
  known-false GLP-1 provider-boundary facts (sale, delivery, prescription).

No GLP-1 product fact set and no Quelites authority is seeded. Unknown facts
remain unknown. Offer-version and provider scopes are structurally distinct;
campaign does not select fact scope. The partial unique index permits only one
reviewed-active set per exact JSONB scope. The activation function first
retires the existing active exact scope, then activates the requested draft;
if the second update raises, the surrounding function statement transaction
rolls the first update back, so it cannot leave zero active sets from that
failure. The migration seed is already reviewed-active and does not call
activation.

### Ticket 72 seed and lifecycle

The generated seed exactly matches
`config/sales-engine-v2/reviewed-nutrition-knowledge.json`: one deterministic
`nutrition-practical-es-mx-v1` reviewed-active `es-MX` set, version `1`, with
two records only: `rk-food-storage-basics` and
`rk-meal-preparation-basics`. Each is `nutrition_practical`, a closed approved
topic, `knowledge_question` only, has no applicable input types, and carries
the minimal architectural-seed provenance. No GLP-1 nutrition content is
invented.

The partial unique index permits one reviewed-active set per locale. Activation
has the same atomic retire-then-activate semantics and is not invoked by the
seed. Structural eligibility does not classify prose. No regex/keyword
semantic-safety classifier is added: Tickets 64/64B remain responsible for
semantic guidance safety.

## Pre-deployment checklist

1. Obtain explicit deployment authorization and use the approved production
   migration role. Do not use `dietavity-audit`/`codex_prod_readonly`; it is
   intentionally incapable of this work. Do not obtain or expose credentials
   as part of this review.
2. Establish an approved, tested backup/restore and incident-owner posture.
   **NOT_VERIFIABLE_WITH_CURRENT_ACCESS:** this ticket has no backup evidence.
3. In a read-only preflight, revalidate Ticket 70A's `messages` contract,
   recovery-RPC identities/ACLs, and absence of all four target families. Also
   verify the migration-history mechanism has no entries for these filenames.
   Stop on any drift; do not rely on `IF NOT EXISTS` to merge unknown state.
4. Verify the migration role can create/own objects in `public`, create
   SECURITY DEFINER functions, alter FORCE RLS on its new tables, and grant to
   `service_role`; verify it is not the application role.
5. Use an approved low-traffic controlled window with a lock-timeout and
   statement-timeout policy suitable for metadata DDL. Exact live traffic and
   timeout values are **NOT_VERIFIABLE_WITH_CURRENT_ACCESS**; do not invent
   them. No table rewrite or large scan is expected on the verified baseline.
6. Run each exact reviewed file as one standalone transaction. Do not wrap all
   four in an opaque outer batch, do not edit the file during deployment, and
   record its checksum and deployment result in the established migration log.
7. Keep current application/n8n versions running during this schema-only
   rollout. Do not wire Node/n8n, activate a workflow, call new RPCs, seed
   additional content, or change routing in this procedure.

## Later staged deployment procedure — design only

Each post-step verification is catalog-only/read-only. Stop after each step.

| Step | Preflight and migration | Expected result and immediate verification | Go / stop and failure response |
| --- | --- | --- | --- |
| 1 | Reconfirm Ticket 70A baseline and 17A family absence; apply `database/migrations/20260923_ticket_17a_typed_conversational_output_metadata.sql`. | Two relations; keys/FKs/checks; RLS + FORCE RLS; exact two function signatures, owner, SECURITY DEFINER, search path, and ACLs. Confirm `messages` and both recovery function definitions/ACLs are unchanged. | Go only if every expected 17A object matches and existing ledger/recovery catalog fingerprints match. On SQL error, transaction rollback; investigate. After a committed mismatch, leave additive objects unused and make a corrective forward migration—do not rerun blindly or drop live objects. |
| 2 | Confirm 17A remains correct and 65D family remains absent; apply `database/migrations/20260924_ticket_65d_authorized_action_execution.sql`. | New private table; PK/unique/checks; RLS + FORCE RLS; exact reserve/complete/fail signatures, owner, SECURITY DEFINER/search path, and service-role-only execute. Confirm no rows/actions were created and existing ledger/recovery catalog remains unchanged. | Go only on exact catalog/ACL match. Before commit, rollback on failure; after commit, leave it unused and correct forward if needed. Never execute a provider merely to test installation. |
| 3 | Confirm steps 1–2 and 71 family absence; apply `database/migrations/20260925_ticket_71_product_fact_authority.sql`. | Tables, FK/checks, partial active-scope index, validator/activation functions, RLS/FORCE RLS, ACLs, and exactly two non-customer configuration sets/14 records matching approved seed metadata. | Go only if one active row exists for each seed scope and all catalog/ACL checks match. Any failure rolls back all of step 3. After commit mismatch, freeze use and corrective-forward; do not alter/delete a reviewed set ad hoc. |
| 4 | Confirm prior steps and 72 family absence; apply `database/migrations/20260925_ticket_72_reviewed_nutrition_knowledge_authority.sql`. | Tables, FK/checks, partial active-locale index, activation function, RLS/FORCE RLS, ACLs, and exactly one approved `es-MX` set/two record metadata entries. | Go only if the locale has exactly one approved active set and all catalog/ACL checks match. On failure rollback before commit; after commit use a corrective forward migration, keeping existing application behavior unchanged. |

## Rollback and intermediate-state strategy

| Outcome | Classification and required response |
| --- | --- |
| Any statement fails before its migration commit or connection drops before commit | **Transaction rollback before commit.** PostgreSQL rolls back the migration transaction; correct the cause, re-run only after preflight again. |
| 17A committed; 65D fails | **Leave additive schema installed but unused.** Current application remains compatible. Fix 65D forward/retry from its absent baseline; do not remove 17A merely to restore the old app. |
| 17A + 65D committed; 71 fails | **Leave additive schema installed but unused.** Do not wire actions/artifacts. Correct/retry 71 only after its absence/transaction state is confirmed. |
| 71 committed; 72 fails | **Leave additive schema installed but unused.** Existing app remains compatible; correct/retry 72 only. No fact/knowledge runtime reader is introduced by these migrations. |
| A committed object/ACL/seed mismatch | **Corrective forward migration.** Do not casually issue destructive DOWN DDL: FK/authority history and future audit evidence make removal risky. Explicit safe removal is theoretically possible only before any runtime use and only with separately approved, dependency-checked procedure; it is not recommended here. |

The seed activation functions cannot leave a zero-active scope/locale from an
activation-function error because their pair of updates and exception execute
atomically. A migration failure likewise rolls back seed status. Future
activation outside the migration requires its own controlled transaction and
read-only postcheck; it is not part of this rollout.

## Post-deployment read-only verification categories

Use approved catalog queries only; do not select customer/business rows or
call business/recovery RPCs.

1. `pg_class`/`pg_namespace` for exact relation kind and absence of unexpected
   same-name objects; `pg_attribute`, `pg_constraint`, and `pg_indexes` for
   columns, generated scope key, checks, FKs, PK/unique, and partial predicates.
2. `pg_class.relrowsecurity`/`relforcerowsecurity`, `pg_policy`, and ACL
   predicates for each new table. Verify no PUBLIC/anon/authenticated
   privileges, and the precise intended service-role privileges.
3. `pg_proc`, `pg_get_function_identity_arguments`, `pg_get_functiondef`,
   `pg_get_userbyid(proowner)`, function configuration, and function ACLs for
   all new functions. Verify SECURITY DEFINER, search path, and exact execute
   grants; distinguish the ungranted privacy function.
4. Configuration-only seed checks, where the authorized role may read them:
   deterministic IDs, versions, statuses, scopes/locales, counts, uniqueness,
   and approved non-customer fact/knowledge metadata. Do not read any customer
   table.
5. Re-fingerprint `public.messages`, its RLS/ACL/constraints/indexes, and both
   named recovery function definitions/ACLs from the Ticket 70A categories.
   They must be structurally unchanged.

## Remaining blockers and Ticket 69 separation

There is **no migration-source change blocker** for the verified baseline.
The required deployment gates are the fresh absence/migration-history check,
approved migration role, backup/recovery approval, controlled window, and the
post-step catalog checks. These are deployment prerequisites, not permission to
change production under Ticket 73.

Separately, v2 integration remains blocked by Ticket 69's missing
lease-checked atomic outbound/artifact reservation boundary, integration work,
and runtime timeout evidence. **Ticket 69 status remains
`INSUFFICIENT_RUNTIME_EVIDENCE`.** The 15-minute reference lease and expected
25–75 second path do not prove current n8n, proxy, Node, or worker timeout
compatibility; schema readiness does not resolve sync vs async.

## Validation and repository state

**VERIFIED_LOCAL:**

```text
node --test test/ticket-17a-typed-conversational-output-metadata.test.js \
  test/ticket-65d-action-execution.test.js \
  test/ticket-71-product-fact-authority.test.js \
  test/ticket-72-reviewed-nutrition-knowledge-authority.test.js
```

Result: 24 passed, 0 failed. The optional Ticket 17A PostgreSQL integration
test was not run because no local `LOCAL_SUPABASE_DB_URL` was supplied; this
review did not use a production URL. Documentation whitespace/diff validation
is recorded with this ticket's final checks.

No production mutation occurred; no migration was applied; no deployment or
push/commit occurred; no production configuration changed; no service
restarted; no secret was read or exposed; and no customer/business rows were
inspected.
