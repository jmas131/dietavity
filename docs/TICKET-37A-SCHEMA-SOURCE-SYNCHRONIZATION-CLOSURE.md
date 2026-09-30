# Ticket37A — Schema-Source Synchronization Closure

## Determination

**TICKET37A_CLOSED.** No recovery behavior, migration, schema snapshot, production system, or workflow was changed.

## Root cause

The failing assertion in `test/ticket-37a-logical-reply-recovery.test.js` required `database/schema.sql` to contain the entire `RECOVERY_FUNCTIONS_SQL` generator string as a literal substring. The canonical source is `lib/reply-recovery-sql.js`; the historical-reopen migration embeds it unchanged.

`database/schema.sql` is a pg_dump-style snapshot. For both recovery functions it uses `CREATE FUNCTION` rather than `CREATE OR REPLACE FUNCTION`, line-broken attributes, `SET search_path TO 'pg_catalog', 'public'`, and `$_$` dollar quoting rather than the source's one-line attributes and `$function$`. The bodies and their recovery conditions are aligned. This was declaration/dollar-quote/formatting drift, not semantic drift.

## Chosen invariant

The new local helper extracts exactly these two function definitions from each source:

- `prepare_whatsapp_reply_recovery(jsonb)`
- `claim_whatsapp_reply_recovery_part(jsonb)`

It compares normalized function attributes and bodies. It requires `LANGUAGE plpgsql SECURITY DEFINER` and the `pg_catalog, public` search path, while normalizing harmless pg_dump whitespace, declaration form, dollar-quote tag, and quoted search-path formatting.

Literal embedding was rejected because it produces false failures for pg_dump representation. Name-only checks were rejected because they cannot detect behavioral drift. A generated schema was unnecessary and would broaden this repository-only repair. Function-scoped normalization is deterministic, small, and compares the actual executable body.

## Drift evidence

The focused test includes mutation fixtures that fail if either:

- the advisory-lock key changes; or
- the FIFO condition changes from `<` to `<=`.

The comparison also covers all lease, multipart, idempotency, recovery-eligibility, reconciliation, and provider-evidence conditions contained in both full function bodies. It does not use production MD5 fingerprints.

## Ticket10 relationship

The recovery-source synchronization assertion formerly reported in the broader Ticket10-era suite was the same Ticket37A literal-schema-source defect and is now fixed. The separate remaining Ticket10 failure, `Ticket 10 artifact is byte-for-byte synchronized and inactive`, still fails unchanged; it concerns a workflow artifact and is outside this recovery/schema-source repair. No Ticket10 business behavior changed.

## Validation and safety

The focused Ticket37A suite passes, including format-tolerance and meaningful-drift tests. Real PostgreSQL was not needed: this ticket compares checked-in repository source representations and does not depend on parser or introspection behavior.

The Ticket72 migration remains byte-identical. Production impact is none.
