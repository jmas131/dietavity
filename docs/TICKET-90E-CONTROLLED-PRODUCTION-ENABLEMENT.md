# Ticket 90E — Controlled Production Enablement Checklist

This is an operator checklist, not authorization to alter production. Ticket
90D's original direct-PostgreSQL implementation is commit
`d3afa987808f7a7bcb351dc889189f44e4f982aa`. Its original production attempt
rolled back and must not be applied. The Supabase-compatible replacement
migration is commit `b4c56c8cb1045ba8fcca1872642ef1b7cea8c6fa`; use that
revision of `20261111_ticket_90d_direct_postgres_audit_access.sql` for any
future authorized attempt. Do not run the production-changing section until
the named approvers authorize it. Do not run the reconciliation CLI until the
post-migration verification section passes.

The CLI is diagnostic only: Twilio `GET`, PostgreSQL `SELECT`, private JSON
report. It has no send, replay, recovery, n8n, or database mutation path.

## A. Read-only production readiness (authorized catalog access only)

Record the date, project reference (outside this repository), operator, and
the following pass/fail results. Do not return customer data, connection URLs,
passwords, phone numbers, message bodies, or function definitions in the
evidence.

1. Confirm the approved Ticket 90D preflight was run from the runbook and
   returned zero rows. This has already been reported for the current
   production catalog. Repeat it immediately before migration approval if the
   function or schema ACL catalog has changed since that result. A non-empty
   result blocks the migration: each function requires its own application
   compatibility review; do not revoke `PUBLIC` globally.
2. Confirm the source assumptions and reserve Ticket 90D names. Run this
   read-only catalog query. **Every returned row is a blocker**: the migration
   either assumes the source differs from the reviewed model or could alter an
   unrelated existing Ticket 90D-named object.

   ```sql
   BEGIN READ ONLY;
   SET LOCAL statement_timeout = '15s';

   SELECT 'missing_messages_source' AS finding
   WHERE NOT EXISTS (
     SELECT 1
     FROM pg_class AS relation
     JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname = 'messages'
       AND relation.relkind IN ('r', 'p')
   )
   UNION ALL
   SELECT 'missing_or_not_forced_messages_rls'
   WHERE NOT EXISTS (
     SELECT 1
     FROM pg_class AS relation
     JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public' AND relation.relname = 'messages'
       AND relation.relrowsecurity AND relation.relforcerowsecurity
   )
   UNION ALL
   SELECT 'missing_required_messages_column:' || required.column_name
   FROM (VALUES
     ('id'), ('timestamp'), ('direction'), ('session_id'), ('provider'),
     ('provider_message_sid'), ('idempotency_key'), ('in_reply_to_id'),
     ('delivery_status'), ('metadata'), ('processing_order'),
     ('processing_lease_until'), ('processing_completed_at'),
     ('processing_outcome')
   ) AS required(column_name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns AS column_info
     WHERE column_info.table_schema = 'public'
       AND column_info.table_name = 'messages'
       AND column_info.column_name = required.column_name
   )
   UNION ALL
   SELECT 'name_already_exists:' || name
   FROM (VALUES
     ('role:twilio_ledger_auditor'),
     ('role:twilio_ledger_audit_view_owner'),
     ('schema:twilio_audit'),
     ('view:twilio_audit.twilio_ledger_audit_rows'),
     ('policy:public.messages.twilio_ledger_audit_view_owner_select')
   ) AS expected(name)
   WHERE (name = 'role:twilio_ledger_auditor' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'twilio_ledger_auditor'))
      OR (name = 'role:twilio_ledger_audit_view_owner' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'twilio_ledger_audit_view_owner'))
      OR (name = 'schema:twilio_audit' AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'twilio_audit'))
      OR (name = 'view:twilio_audit.twilio_ledger_audit_rows' AND EXISTS (
        SELECT 1 FROM pg_class AS relation JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'twilio_audit' AND relation.relname = 'twilio_ledger_audit_rows'
      ))
      OR (name = 'policy:public.messages.twilio_ledger_audit_view_owner_select' AND EXISTS (
        SELECT 1 FROM pg_policy AS policy JOIN pg_class AS relation ON relation.oid = policy.polrelid
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public' AND relation.relname = 'messages'
          AND policy.polname = 'twilio_ledger_audit_view_owner_select'
      ));

   COMMIT;
   ```

3. Re-read the exact committed migration
   `database/migrations/20261111_ticket_90d_direct_postgres_audit_access.sql`.
   It is one explicit `BEGIN`/`COMMIT` transaction. A statement failure or
   connection loss before commit rolls back the entire transaction. It is
   idempotent after a successful commit for the Ticket 90D objects: roles are
   conditionally created and then constrained, the schema is conditional, the
   policy is replaced, and the view is replaced. It must not be used to take
   over a pre-existing object, which step 2 prevents.
   The Supabase-compatible revision deliberately has no post-creation
   `ALTER ROLE` statements. It creates roles with their safe attributes,
   configures a fresh view's ACL/comment as the executor before transferring
   ownership. On a re-run it temporarily sets to the existing owner solely to
   replace that view, then revokes the executor's temporary `SET` membership
   and the owner's temporary schema `CREATE` privilege before `COMMIT`. The
   migration fails if either temporary privilege remains.
4. Confirm the migration's dependency boundary: `public.messages` exists with
   FORCE RLS and the listed source columns; the database administrator can
   create/alter roles, create the new schema/view/policy, transfer view
   ownership, and grant/revoke the specified ACLs. It does not scan, rewrite,
   insert into, update, or delete ledger rows.

## B. Connection and operator environment readiness (no credential creation)

1. Select a controlled manual operator host. It needs outbound TCP access only
   to the Dashboard-provided endpoint, a current Node.js runtime, a private
   filesystem location, and access to the approved secret manager. Apply the
   project network allow-list to that host's stable egress CIDR if network
   restrictions are enabled.
2. Prefer the Dashboard **Connect** direct endpoint for an IPv6-capable host
   (or where the project has the IPv4 add-on). If the host is IPv4-only, use
   the Dashboard's **shared Supavisor session pooler** connection string on
   port 5432. Do not use the transaction pooler. Copy host, port, database,
   and custom-role username exactly from the Dashboard; do not compose them.
   Supabase documents this choice in its [connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).
3. Download the current Supabase database root CA through the Dashboard to an
   operator-only file (for example, mode `0600`). The future URL must include
   `sslmode=verify-full`; the CLI separately supplies this CA and rejects
   missing verification. This verifies both the CA and hostname, as described
   in Supabase's [SSL guidance](https://supabase.com/docs/guides/platform/ssl-enforcement).
4. Create an empty, operator-owned report directory outside the repository,
   e.g. `/approved/private/twilio-ledger-audits`, with mode `0700`. It must not
   be a symbolic link, shared cloud folder, or source-control directory.

## C. Explicit production-change authorization boundary

No SQL below is authorized by this checklist. Require written approval from
the production database owner and security owner after section A passes.

The exact production-changing actions are:

1. Execute the exact reviewed Ticket 90D migration as committed. Its changes
   are: create/constrain the two named roles; create `twilio_audit`; add the
   view-owner-only `SELECT` RLS policy on `public.messages`; grant that owner
   only required source columns; create and transfer ownership of the
   content-free view; revoke/grant access on the new schema/view; and run the
   effective `SECURITY DEFINER` gate. It does not grant the auditor a base-table
   privilege or modify existing application/service-role grants.
2. After the migration has committed and post-migration checks pass, create the
   password and short expiry **out of band** using a parameterized/admin secret
   workflow equivalent to:

   ```sql
   ALTER ROLE twilio_ledger_auditor PASSWORD :generated_secret;
   ALTER ROLE twilio_ledger_auditor VALID UNTIL :approved_expiry_utc;
   ```

   Do not put the secret in SQL Editor history, this document, shell history,
   CI logs, git, a report, or a chat. Store the URL only in the approved secret
   manager. The account remains `LOGIN`, `NOINHERIT`, `NOBYPASSRLS`, connection
   limit 1; do not grant it membership, `BYPASSRLS`, base-table access, or any
   write/function privilege.
3. Provision a separate Twilio Restricted API Key with only Messaging Message
   list/fetch read permission. Record its owner, scope, expiry/rotation and
   revocation procedure in the credential inventory, never its value. Do not
   grant sending, messaging configuration, sender, webhook, console, or
   account-administration permission.

## D. Post-migration privilege verification (read-only)

Run this before provisioning the password if the administrator can inspect the
role; repeat the effective checks after provisioning through the actual audit
connection. Any failure blocks the CLI.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

SELECT rolname, rolcanlogin, rolinherit, rolbypassrls, rolsuper,
       rolcreaterole, rolcreatedb, rolreplication, rolconnlimit
FROM pg_roles
WHERE rolname IN ('twilio_ledger_auditor', 'twilio_ledger_audit_view_owner')
ORDER BY rolname;

SELECT relation_namespace.nspname AS schema_name, relation.relname,
       relation.relkind, owner.rolname AS owner
FROM pg_class AS relation
JOIN pg_namespace AS relation_namespace ON relation_namespace.oid = relation.relnamespace
JOIN pg_roles AS owner ON owner.oid = relation.relowner
WHERE relation_namespace.nspname = 'twilio_audit'
  AND relation.relname = 'twilio_ledger_audit_rows';

SELECT policy.polname, policy.polcmd, roles.rolname AS applies_to
FROM pg_policy AS policy
JOIN pg_class AS relation ON relation.oid = policy.polrelid
JOIN pg_namespace AS relation_namespace ON relation_namespace.oid = relation.relnamespace
JOIN pg_roles AS roles ON roles.oid = ANY(policy.polroles)
WHERE relation_namespace.nspname = 'public' AND relation.relname = 'messages'
  AND policy.polname = 'twilio_ledger_audit_view_owner_select';

SELECT has_table_privilege('twilio_ledger_auditor', 'twilio_audit.twilio_ledger_audit_rows', 'SELECT') AS auditor_can_read_view,
       has_table_privilege('twilio_ledger_auditor', 'public.messages', 'SELECT') AS auditor_can_read_messages,
       has_schema_privilege('twilio_ledger_auditor', 'twilio_audit', 'USAGE') AS auditor_can_use_audit_schema,
       has_schema_privilege('twilio_ledger_auditor', 'public', 'CREATE') AS auditor_can_create_public;

SELECT EXISTS (
  SELECT 1 FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE procedure.prosecdef AND namespace.nspname !~ '^pg_'
    AND namespace.nspname <> 'information_schema'
    AND has_schema_privilege('twilio_ledger_auditor', namespace.oid, 'USAGE')
    AND has_function_privilege('twilio_ledger_auditor', procedure.oid, 'EXECUTE')
) AS unsafe_security_definer_effective;
COMMIT;
```

Expected: exactly the two roles with auditor `LOGIN`, both `NOINHERIT` and
`NOBYPASSRLS`; one `twilio_audit` view owned by the non-login owner; one policy
applying only to that owner; view `SELECT=true`, base-table `SELECT=false`,
public-schema `CREATE=false`, and unsafe function result `false`.

With the real auditor connection, run only this test transaction (no customer
rows are selected):

```sql
BEGIN READ ONLY;
SELECT current_user, current_setting('transaction_read_only'),
       has_table_privilege(current_user, 'twilio_audit.twilio_ledger_audit_rows', 'SELECT') AS view_select,
       has_table_privilege(current_user, 'public.messages', 'SELECT') AS messages_select;
ROLLBACK;
```

Expected: `current_user=twilio_ledger_auditor`, `transaction_read_only=on`,
`view_select=true`, `messages_select=false`. Separately attempt a deliberately
invalid `INSERT` into the audit view only in an explicit `BEGIN READ ONLY`
transaction and verify PostgreSQL rejects it; immediately `ROLLBACK`. Do not
test mutations against `public.messages` or any application relation in
production.

## E. Baseline audit readiness and manual run

1. Inject values only at execution time from the secret manager. Required names
   (not values) are:

   ```text
   TWILIO_AUDIT_ACCOUNT_SID
   TWILIO_AUDIT_API_KEY_SID
   TWILIO_AUDIT_API_KEY_SECRET
   TWILIO_AUDIT_WHATSAPP_SENDER
   SUPABASE_AUDIT_DATABASE_URL
   SUPABASE_AUDIT_SSL_ROOT_CERT
   TWILIO_LEDGER_AUDIT_HMAC_SECRET
   TWILIO_LEDGER_AUDIT_HMAC_ROTATION   # optional, non-secret label
   ```

   The URL uses only the dedicated audit login and `sslmode=verify-full`; it
   must never contain `postgres`, service-role, project API-key, or application
   credentials. The HMAC secret is at least 16 characters and is not reused for
   an unrelated purpose.
2. For the current date (2026-11-12 UTC), the first baseline is the seven
   completed UTC days **[2026-11-05T00:00:00Z, 2026-11-12T00:00:00Z)**. The CLI
   reads a one-day correlation overlap on either side while classifying only
   the selected half-open interval. If executed later, recalculate as the
   midnight UTC before the run minus seven days through that midnight; never
   include the current partial UTC day.
3. After sections A–D and credential approval, manually run:

   ```bash
   node scripts/reconcile-twilio-ledger.js \
     --from 2026-11-05T00:00:00Z \
     --to 2026-11-12T00:00:00Z \
     --report-dir /approved/private/twilio-ledger-audits \
     --retention-days 30
   ```

   The CLI creates a private 0600 JSON report and retains only its own report
   filenames for 30 days in that 0700 directory. Do not copy it into tickets,
   logs, source control, chat, or shared storage. Record only aggregate counts,
   coverage state, redaction-rotation label, UTC window, and report filename in
   the operational record.
4. Acceptance: both Twilio and ledger coverage are complete; no confirmed
   inbound ingestion gap, duplicate SID, terminal provider failure, or missing
   outbound acceptance requires incident review. `inconclusive` findings are
   triaged as evidence gaps, not failures. Any `coverage_incomplete` result
   invalidates negative-match conclusions and requires a fresh complete run.
   `excluded` is approved historical/synthetic/noncanonical evidence, not a
   delivery failure. Keep delivery reliability distinct from reply-quality
   assessment.

## F. Rollback and stop conditions

Stop without a change if any preflight returns a row, connection/TLS validation
fails, a privilege check differs from expected, Twilio read scope cannot be
proved, or credentials cannot be injected without exposure.

If a committed Ticket 90D installation must be removed, obtain separate
authorization. First stop audit use and expire/disable the audit credential;
wait for active auditor sessions to end; revoke auditor `SELECT` on the view;
drop the view; drop only the named view-owner policy; revoke the named owner's
column grant; revoke schema access; then drop the two named roles and the empty
`twilio_audit` schema. Do not touch `public.messages` data, application roles,
application policies, `service_role` grants, Twilio settings, n8n, or running
services. Use a reviewed forward/rollback migration rather than ad-hoc SQL.

## Approval gates remaining

- Database/security approval to run the exact Ticket 90D migration.
- Confirmation that the immediately-preceding production catalog preflight and
  name-reservation query return zero rows.
- Network allow-list/route and CA-certificate verification for the selected
  operator host.
- Approval to create the short-lived audit password and restricted Twilio key
  through the secret-management process.
- Database-role post-migration verification and audit execution approval.
