# Ticket 73A — Production Deployment Safety Preflight

## Status

**`NOT_READY_TO_AUTHORIZE_TICKET_74`**

Ticket 73's schema conclusion remains `READY_FOR_CONTROLLED_DEPLOYMENT` for
the four exact files and sequence `17A → 65D → 71 → 72`. Ticket 74 is not yet
authorized to make its first production write because these minimum
prerequisites remain unresolved:

1. **OPERATOR_CONFIRMATION_REQUIRED:** identify and approve the established
   administrative database execution identity/path, including confirmation it
   can own the new objects and make the required grants. `codex_prod_readonly`
   cannot do this, and `service_role` is not an appropriate DDL owner.
2. **OPERATOR_CONFIRMATION_REQUIRED:** choose and approve a durable
   migration-history method that records each exact file/checksum without
   falsely marking a migration as applied. The current established `psql`
   examples do not do so, and this repository is not presently a tracked
   Supabase CLI migration project.
3. **OPERATOR_CONFIRMATION_REQUIRED:** provide non-secret evidence from the
   Supabase project administrator that backup/PITR recovery is available for
   this project, identify its recovery window/last available point, identify
   the responsible incident owner, and state whether a restoration has been
   tested or is only available.
4. **OPERATOR_CONFIRMATION_REQUIRED:** restore a working, catalog-only,
   read-only preflight route and perform the fresh baseline checks immediately
   before any write. Ticket 70A is valid historical evidence, not a substitute
   for a just-before-write check. The new audit attempts in this ticket reached
   SSH but could not establish the server-side PostgreSQL connection settings;
   no catalog query ran.
5. **OPERATOR_CONFIRMATION_REQUIRED:** confirm that production application and
   n8n routing remain on the pre-v2 integration path during this schema-only
   rollout. This is runtime/deployment state, not derivable from the database
   catalog inspected by Ticket 70A.

No migration is defective on the Ticket 70A baseline. These are authorization
and operational-control blockers, deliberately not guessed around.

## Scope and non-actions

This is a preflight design only. It inspected tracked repository deployment
material, migration files, Ticket 70A and Ticket 73, and official Supabase
documentation. It made no production write and did not link Supabase locally,
run `supabase db push`, run a migration, invoke an RPC, create/alter a role,
inspect customer/business rows, read credentials, `.pgpass`, or `/root/.env`,
or start a backup/restore.

Evidence labels:

- **VERIFIED_LOCAL** — direct inspection of the current tracked repository.
- **VERIFIED_FROM_TICKET_70A** / **VERIFIED_FROM_TICKET_73** — accepted prior
  authorized evidence.
- **VERIFIED_LIVE** — a fresh live result from this ticket. There is none for
  the database, because the attempted catalog connection did not establish.
- **NOT_VERIFIABLE_WITH_CURRENT_ACCESS** — not safely available here.
- **OPERATOR_CONFIRMATION_REQUIRED** — prerequisite before Ticket 74 may
  write.

## Existing migration mechanism and history

### Repository evidence

**VERIFIED_LOCAL:** the tracked repository stores SQL files in
`database/migrations/`; it has no tracked `supabase/` directory, no
`supabase/migrations/` tree, no Supabase CLI configuration, no CI migration
job, and no `package.json` migration script. The pre-existing untracked
`supabase/` directory was not read or modified: it is not acceptable evidence
of a reviewed production linkage or execution mechanism.

**VERIFIED_LOCAL:** `docs/DEPLOYMENT.md` gives a generic sequence — back up,
execute a migration, verify affected tables — but names neither an executor nor
a migration ledger. The concrete historic database-migration examples in
`docs/TICKET-37A-HISTORICAL-REOPEN.md` use an approved backend operator's
libpq-managed credentials and:

```text
psql -X -v ON_ERROR_STOP=1 -f database/migrations/<file>.sql
```

This establishes **administrative `psql` as the only documented repository
execution pattern**, not as a standing authorization to use it and not as proof
of the production credential/owner used then.

**VERIFIED_LOCAL:** plain `psql -f` runs a file but does not automatically add
an application migration-history row. It would therefore bypass a Supabase CLI
history record if `supabase_migrations.schema_migrations` is the project’s
chosen ledger. Do not infer history from filenames, Git commits, or a schema
snapshot.

The local `database/schema.sql` contains `auth.schema_migrations` and
`realtime.schema_migrations`, which are Supabase subsystem relations and are
not evidence of an application-migration history or authorization to use them.

### Supabase CLI assessment

**VERIFIED_FROM_OFFICIAL_DOCUMENTATION:** Supabase CLI migration tracking uses
`supabase_migrations.schema_migrations`; `supabase db push` compares that
remote history with local files under `supabase/migrations/`, and migration
repair changes history rather than applying SQL. See [Supabase Database
Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
and the [CLI migration reference](https://supabase.com/docs/reference/cli/supabase-db-schema-declarative).

**VERIFIED_LOCAL:** the four approved files are in `database/migrations/`, not
that expected CLI tree, and no reviewed project link/configuration exists in
Git. Their current filenames also use repository date prefixes rather than a
verified locally-installed Supabase CLI migration convention. This ticket did
not inspect an untracked CLI installation or execute a CLI command.

Therefore **do not introduce `supabase link`, `supabase migration repair`, or
`supabase db push` in Ticket 74** merely to obtain history. Linking would bind
the local workspace to production and `db push` could evaluate an unreviewed
file set/history divergence. A future administrator may select a reviewed CLI
path only after separately establishing a clean, tracked migration project and
proving its remote-history behavior. That is not needed to execute the four
SQL files, but it is required before treating CLI history as authoritative.

### Recommended future path

The least-expansive candidate is the existing **approved administrative direct
PostgreSQL/`psql` path**, using secret-managed administrative credentials,
because it can run the reviewed files without locally linking Supabase. It is
only a candidate until the project administrator confirms the identity,
ownership, connection procedure, and durable recording mechanism.

If the organization’s established administrative mechanism is the Supabase
Dashboard SQL Editor or a managed migration facility instead, use that
existing mechanism rather than creating a new migration role or credential.
It must still satisfy every requirement in this document: exact source
checksum, one file/transaction, explicit error stop, catalog verification, and
a durable migration record. The future mechanism must not be an application
Supabase client or an n8n credential.

## Future executor requirements

| Requirement | Finding |
| --- | --- |
| `codex_prod_readonly` | **VERIFIED_FROM_TICKET_70A:** read-only, non-superuser, no public-table/function privileges. It is impossible by design as a migration executor. |
| Required capabilities | **VERIFIED_LOCAL:** executor must have `CREATE` on `public`; own each created table/function (or otherwise be permitted to alter it); be able to enable/FORCE RLS on its new tables; create indexes/constraints/FKs; create SECURITY DEFINER functions; revoke/grant the specified ACLs, including grants to `service_role`; and commit the file's transaction. Ticket 17A additionally needs referenced `public.messages(id)` visible for the new FK. |
| Ownership | **VERIFIED_FROM_TICKET_73:** created tables/functions are owned by the migration executor. The owner must be an approved administrative identity; otherwise future ownership and SECURITY DEFINER behavior is unsuitable. |
| `service_role` | **VERIFIED_LOCAL:** inappropriate as executor. It is a backend runtime principal that receives narrow runtime grants from these migrations; it is not established as a schema owner/migration principal. Using it would blur the runtime/administrative boundary and could leave new objects owned by a broad application role. |
| Existing administrative mechanism/owner | **NOT_VERIFIABLE_WITH_CURRENT_ACCESS:** the accepted records do not identify the actual historic migration role or prove SQL Editor identity behavior for this project. |
| New dedicated role | **NOT_REQUIRED_BY_CURRENT_EVIDENCE.** Prefer the existing approved administrator/migration mechanism if it meets the requirements. Do not create a role merely to satisfy this ticket. A new role needs a separate security design and authorization only if the established path demonstrably cannot satisfy them. |

## Backup and recovery posture

**VERIFIED_LOCAL:** the repository deployment checklist requires a database
backup before a schema change but supplies no project backup status, recovery
window, restore test, or accountable owner. Ticket 73 correctly left this
unverified.

**VERIFIED_FROM_OFFICIAL_DOCUMENTATION:** Supabase documents daily backups for
paid plans and optional PITR for eligible paid projects; restore makes the
project inaccessible while it runs. It also distinguishes availability of a
backup from a tested restoration. See [Database
Backups](https://supabase.com/docs/guides/platform/backups). This is platform
capability, **not evidence that this production project has a usable backup or
PITR enabled**.

**NOT_VERIFIABLE_WITH_CURRENT_ACCESS:** plan/tier, daily-backup availability,
PITR enablement/retention, earliest/latest recovery point, last backup health,
whether restoration was tested, and any project-specific RPO/RTO. Do not infer
these from the existence of Supabase in application configuration.

Before Ticket 74, a project administrator must inspect the Supabase Dashboard's
Database Backups/PITR view or equivalent approved non-secret administrative
status and record, outside this repository if it contains operationally
sensitive detail:

1. project identity/environment confirmation;
2. backup type (daily or PITR), retention and latest recoverable point;
3. time/date of the evidence and the owner authorized to initiate recovery;
4. whether restoration has been tested, when, and the result — or explicit
   acceptance that only recovery availability, not a tested restore, is known;
5. acceptance that whole-project restore entails availability impact and may
   discard post-restore-point writes.

The four migrations are each explicit, additive transactions. This reduces the
likely recovery need but does **not** remove it. On SQL error or connection
loss before `COMMIT`, PostgreSQL rolls back that migration; no backup restore is
indicated. After a committed migration whose postcheck fails, preserve the
additive schema unused, stop later steps, and use a reviewed corrective-forward
migration. Do not use a destructive DOWN migration or whole-project restore as
the default response. Backup/PITR remains the incident escape hatch for a
separate, material failure, with the administrator deciding restoration from
the verified recovery point.

## Fresh Ticket 74 baseline — read-only design

Run these checks through the restored authorized audit route immediately before
the first migration, using only catalogs/settings and no customer/business-row
selection or RPC invocation. Save only non-sensitive result fingerprints in
the deployment record.

1. Verify session identity, `transaction_read_only = on`, and
   `default_transaction_read_only = on` for the audit preflight.
2. Recreate Ticket 70A's `public.messages` catalog fingerprint: relation kind,
   owner, columns/types/nullability/defaults, constraints, indexes/partial
   predicates, RLS/FORCE-RLS flag, policies, and ACL predicates. Do not select
   `messages` rows.
3. Recreate both recovery-RPC fingerprints using `pg_proc`, identity arguments,
   owner, volatility/security configuration, ACL predicates, and
   `pg_get_functiondef` hashes for
   `claim_whatsapp_reply_recovery_part(jsonb)` and
   `prepare_whatsapp_reply_recovery(jsonb)`. Require Ticket 70A-compatible
   security/ACL/search-path properties; stop on drift.
4. Use `pg_class`, `pg_namespace`, `pg_proc`, `pg_type`, `pg_constraint`, and
   `pg_indexes` to prove the 17A/65D/71/72 expected relations, functions,
   named indexes/constraints, types, and schemas are absent. Include a
   same-name search across relation kinds, not only tables.
5. If the administrator identifies a real migration ledger, query only its
   metadata/history rows needed to prove the four exact migration versions are
   absent. For Supabase CLI this is expected to be
   `supabase_migrations.schema_migrations`, but its presence and accessibility
   must first be verified. Do not alter/repair history in preflight.
6. Have the application/n8n owner attest that no Ticket 69/v2 routing, Node
   integration, artifact writer, action executor, or fact/knowledge database
   adapter has been deployed/activated. A catalog query cannot prove this.

Any difference is `STOP`: do not use `IF NOT EXISTS`, manual history repair,
or altered SQL to force the expected baseline.

## Future execution safety parameters

| Control | Ticket 74 requirement |
| --- | --- |
| Exact bytes | Fix the four committed file paths and SHA-256 values below before opening a write session. Compare the operator copy byte-for-byte and record the results. |
| Client behavior | Use `psql -X -v ON_ERROR_STOP=1` or an established mechanism with equivalent fail-fast behavior. `-X` avoids user startup-file behavior. |
| Transaction scope | Run exactly one reviewed file at a time. Each file already contains `BEGIN`/`COMMIT`; do not wrap the four in an outer opaque transaction or split/edit a file. |
| Lock / statement timeout | Set explicit session safety values before the file. **OPERATOR_CONFIRMATION_REQUIRED:** choose the exact values from current production workload/maintenance-window evidence. Ticket 37A's 5-second lock/30-second statement settings were incident-CLI-specific and are not evidence for these DDL migrations. No number is invented here. |
| History | Use only an approved ledger mechanism. It must record the exact version, filename, checksum, executor, timestamp, and successful result in a durable audit/change record, and must never mark a file applied before its successful commit. If it is database history, its transaction interaction with a file that contains `COMMIT` must be designed and reviewed. |
| Stop/go | Disconnect the write procedure after every committed migration and perform the Ticket 73 catalog postcheck through a read-only path. Obtain an explicit go from the designated operator before opening the next write session. |
| Loss/error | Treat client disconnect, SQL error, timeout, unexpected output, or catalog drift as STOP. Determine commit state through the independent read-only postcheck; never blindly rerun 17A/65D or execute history repair. |

Approved source checksums at this review commit:

| File | SHA-256 |
| --- | --- |
| `database/migrations/20260923_ticket_17a_typed_conversational_output_metadata.sql` | `92d5618a1f522374763117b3992ff57b11a3a3d6f7ad5cc0feb208d83e6526d4` |
| `database/migrations/20260924_ticket_65d_authorized_action_execution.sql` | `88bf37e0c1a264f43a83cfc31c54878386455828e6e383da0057480bf04e912d` |
| `database/migrations/20260925_ticket_71_product_fact_authority.sql` | `d591e1f75d1aed0074259ae2c27759a2324b24d2094eff9816aa65b7b96dce4b` |
| `database/migrations/20260925_ticket_72_reviewed_nutrition_knowledge_authority.sql` | `949530622ff4a3898de1f3ad177fa6583d38672105934954cb2573dd763c4c8a` |

## Exact future path — conditional design

This is the required shape once all blockers are closed. It is not a command
sequence to run now.

```text
designated operator / incident owner
  → approved administrative DB mechanism (not audit role; no local Supabase link)
  → independent read-only fresh baseline + approved history preflight
  → fix source checksums, session controls, and change record
  → run Ticket 17A as its own transaction
  → independent read-only postcheck → explicit STOP / GO
  → run Ticket 65D as its own transaction
  → independent read-only postcheck → explicit STOP / GO
  → run Ticket 71 as its own transaction
  → independent read-only postcheck including approved configuration metadata
     → explicit STOP / GO
  → run Ticket 72 as its own transaction
  → independent final read-only postcheck → close controlled change
```

The postchecks and failure behavior are those in Ticket 73: relation/function
existence and signatures; constraints/indexes; RLS/FORCE RLS and ACLs;
non-customer authority seed metadata for 71/72; and unchanged `messages` plus
recovery-RPC fingerprints. No application/workflow deployment belongs in this
path.

## Failure model

| Condition | Required response |
| --- | --- |
| Authentication failure before migration | No write occurred. Stop; administrator fixes only the approved access path. Do not substitute `service_role`, audit credentials, or a new role. |
| Baseline/catalog drift | Stop before write; preserve evidence; re-review the exact production state. Do not force create, repair history, or edit a migration. |
| Lock timeout / statement timeout | The current file transaction aborts. Stop and inspect lock/workload conditions through approved operations; revise only the operator-approved session control, then repeat preflight. |
| SQL failure before commit | PostgreSQL rolls back the file transaction. Confirm absence through independent catalog check before a corrected/retried step. |
| Connection loss before commit | Treat commit state as unknown. Do not rerun. First determine actual state through independent read-only catalog/history verification. |
| Commit succeeds but catalog verification mismatches | Stop later migrations. Leave additive objects unused; investigate and prepare a reviewed corrective-forward migration. No casual DROP/DOWN migration and no default restore. |
| Migration-history mismatch | Stop. Determine whether schema or history is authoritative using catalog evidence. Do not use `supabase migration repair` or manually insert history without separately approved reconciliation. |
| Partial operator procedure | Treat the last confirmed commit as the boundary. Re-run the independent postcheck and update the durable change record before deciding whether the next step is permitted. |
| 17A succeeds, 65D fails | Keep 17A additive schema installed but unused; current application remains compatible. Resolve 65D independently. |
| 17A + 65D succeed, 71 fails | Keep the first two additive schemas installed but unused; resolve 71 independently. |
| 71 succeeds, 72 fails | Keep 71 installed but unused; resolve 72 independently. |

## Ticket 74 authorization checklist

Every item must be true before the first production write:

- [ ] Ticket 73 remains valid and the exact four source checksums are fixed.
- [ ] A fresh, independent, read-only Ticket 70A-compatible baseline is clean.
- [ ] The target-family absence/same-name/object and recovery fingerprints are clean.
- [ ] The real migration-history mechanism and its current state are understood and clean.
- [ ] The administrative execution mechanism and named accountable operator are approved.
- [ ] The executor has the required DDL/ownership/ACL capabilities and is neither `codex_prod_readonly` nor `service_role`.
- [ ] Backup/PITR status, recovery window, incident owner, and restore-tested-versus-available status are accepted.
- [ ] Lock/statement timeouts and low-traffic window are explicitly selected by the operator.
- [ ] One-file transactions, `ON_ERROR_STOP`, checksum recording, read-only postchecks, and four stop/go boundaries are ready.
- [ ] Production remains on the pre-v2 integration path; no application/workflow routing changes are bundled.
- [ ] The operator explicitly authorizes the first production write for Ticket 74.

## Validation and state

This document is documentation-only. The Ticket 73A validation is whitespace
and diff validation; no executable migration/code test was warranted.

No production mutation, migration, role/privilege change, deployment, restart,
secret access, customer/business-row inspection, commit, or push occurred.

## Deployment-preflight conclusion

**`NOT_READY_TO_AUTHORIZE_TICKET_74`** — the minimum unresolved prerequisites
are the approved administrative executor/path, durable migration-history
behavior, verified and accepted backup/recovery posture, a working fresh
catalog-only baseline route, and pre-v2 runtime-routing confirmation.
