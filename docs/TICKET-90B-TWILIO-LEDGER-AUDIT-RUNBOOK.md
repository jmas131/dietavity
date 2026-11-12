# Ticket 90B — Read-only Twilio-to-Ledger Audit Runbook

## Safety boundary

`scripts/reconcile-twilio-ledger.js` is a read-only diagnostic. It makes only
Twilio `GET` requests and direct PostgreSQL `SELECT` requests through a
dedicated audit view. It has no Twilio create/send API, no database mutation, no n8n client,
and no Recovery Poller integration. Do not point it at application
service-role credentials.

The report measures technical ingestion, outbound acceptance/provider delivery,
and processing latency. It explicitly does **not** judge nutrition quality,
conversation usefulness, safety, or customer satisfaction.

## Required production prerequisites

Provision these outside the repository and do not paste them into a shell
history, report, ticket, or environment file committed to git:

1. `TWILIO_AUDIT_ACCOUNT_SID`, a Twilio restricted API key SID in
   `TWILIO_AUDIT_API_KEY_SID`, and its secret in `TWILIO_AUDIT_API_KEY_SECRET`.
   Grant only Messaging Message list/fetch read access. Do not grant create,
   update, delete, console, webhook, sender, or account administration.
2. `SUPABASE_AUDIT_DATABASE_URL` for the dedicated
   `twilio_ledger_auditor` PostgreSQL login, and `SUPABASE_AUDIT_SSL_ROOT_CERT`
   pointing to the Supabase server root certificate readable only by the audit
   operator. The CLI refuses a non-auditor username or a connection without
   certificate verification. This role needs `SELECT` only on the
   security-reviewed view `twilio_audit.twilio_ledger_audit_rows`; it needs no
   direct grants on `public.messages`, users, profiles, logs, functions,
   sequences, write RPCs, or service role. PostgreSQL `PUBLIC` grants are
   separate: ordinary functions are not universally denied, and the required
   effective-security-definer preflight below must pass. Do not use
   `SUPABASE_SERVICE_ROLE_KEY`, a
   project API key, or the postgres account password.
3. `TWILIO_AUDIT_WHATSAPP_SENDER`, supplied by the operator but never emitted
   by the tool, and `TWILIO_LEDGER_AUDIT_HMAC_SECRET` (at least 16 characters)
   plus an optional nonsecret `TWILIO_LEDGER_AUDIT_HMAC_ROTATION` label.
4. An operator-approved local report directory and retention period. The CLI
   deletes only its own `twilio-ledger-audit-*.json` files older than the
   required `--retention-days`; it uses directory mode 0700 and report mode
   0600. Do not use a shared or synchronized directory without an approved
   retention policy.

The migration `20261111_ticket_90d_direct_postgres_audit_access.sql` creates a
security-definer, security-barrier view in a dedicated `twilio_audit` schema,
owned by a non-login role. Its owner has
only the source `messages` columns needed to derive this projection and an
explicit forced-RLS `SELECT` policy. The audit login has no base-table grant.
Because PostgreSQL `PUBLIC` grants are effective for every role, the migration
fails closed if any invocable non-system `SECURITY DEFINER` function is found
for the auditor. Resolve each finding through a separate application-impact
review; this migration does not globally revoke `PUBLIC` privileges. The view
exposes only this non-content projection:

```text
ledger_id, recorded_at, direction, provider_message_sid, idempotency_key,
in_reply_to_id, delivery_status, provider_status, provider_error_code,
processing_order, processing_lease_until, processing_completed_at,
processing_outcome, turn_anchor_id, turn_position, turn_member_count,
reconciliation_state, delivery_suppressed, is_historical, is_synthetic,
is_canonical, logical_reply_key, part_index, part_count
```

The database owner must review the view so `is_historical`,
`is_synthetic`, and `is_canonical` reflect the approved cutover/exclusion
policy without exposing message bodies, phone numbers, session identifiers,
medical data, full metadata, or workflow execution identifiers. Grant only
the audit role `SELECT` on that view. Creating the role/view and provisioning
a password are separately approved production changes.

## Database connection and credential provisioning

Use the exact connection URI from the Supabase Dashboard **Connect** panel;
never construct a pooler host or role username manually. For this manual,
persistent CLI, prefer the direct database endpoint when the approved operator
network supports IPv6 (or the project has the IPv4 add-on). Otherwise use the
shared Supavisor **session** pooler. A custom audit role through that pooler
uses the role/project-ref username supplied by the dashboard. Do not use the
transaction pooler: it is for short-lived serverless work and does not provide
the session semantics used by this audit.

Download the server root certificate from Supabase Database Settings to a
private operator-controlled path, then inject its path as
`SUPABASE_AUDIT_SSL_ROOT_CERT`. The driver sets TLS certificate verification;
the connection URI must also use `sslmode=verify-full`. Keep the database URI
and certificate outside the repository, shell history, reports, and Docker
images. Set the audit-role password and a short `VALID UNTIL` expiry through an
approved secret-management process; rotate it after each migration window or
on the normal credential-rotation schedule.

The CLI opens at most one connection and starts `REPEATABLE READ READ ONLY`.
All count and keyset pages therefore use one PostgreSQL snapshot. It does not
reuse an application pool or service-role credential. Before reading the view,
it also checks catalog-effective privileges; any invocable non-system
`SECURITY DEFINER` function stops the audit as incomplete rather than allowing
an audit credential to coexist with that capability.

## Running an audit

After loading the dedicated credentials in the operator's secret mechanism:

```bash
node scripts/reconcile-twilio-ledger.js \
  --from 2026-11-01T00:00:00Z \
  --to 2026-11-08T00:00:00Z \
  --report-dir /approved/private/audits \
  --retention-days 30
```

For the default pre- or post-migration baseline, omit the explicit range; it
uses the last seven completed UTC days. An explicit historical inventory is
allowed only after confirming Twilio retention and a cutover partition:

```bash
node scripts/reconcile-twilio-ledger.js --lookback-days 30 \
  --report-dir /approved/private/audits --retention-days 30
```

The reader fetches a one-day overlap before/after the requested range. This
allows a logical turn or multipart reply crossing midnight to correlate without
being counted in the wrong window. Twilio documents its list date filters as
GMT calendar-date expressions (`DateSent>=YYYY-MM-DD` and
`DateSent<=YYYY-MM-DD`), so the CLI deliberately uses those supported filters
only to bound collection and applies the requested exact half-open UTC range
locally. [Twilio Message resource](https://www.twilio.com/docs/messaging/api/message-resource)

Twilio's list pagination is followed only through its supplied next-page URI;
the reader rejects a repeated/cross-account URI and stops at 100 pages. A page
or response-validation error after bounded retry produces
`coverage_incomplete`; do not treat its unmatched records as confirmed losses.
For an otherwise complete list, the CLI makes at most 50 individual `GET`
requests for unmatched eligible outbound ledger SIDs. A missing or failed
individual lookup remains inconclusive and never sends/replays a message.

PostgreSQL uses the view's `(recorded_at, ledger_id)` unique keyset cursor
rather than offsets and rejects non-monotonic/duplicate page members. The
initial count and every page execute in one `REPEATABLE READ READ ONLY`
transaction, so a count mismatch or cursor anomaly is
`coverage_incomplete`, not a partial-success report. The default CLI window is
the last seven **completed** UTC days; operators should retain that boundary for
weekly and migration baselines.

Use the pre-migration and post-migration runs with identical UTC bounds,
thresholds, sender scope, retention, and redaction rotation where possible.
Record the report version, coverage status, count of exclusions, and the known
V4 cutover boundary. Never collapse legacy/historical results into a V4 rate.

## Reading results and limitations

- `confirmed` means the available, fully paginated sources prove an integrity
  or terminal delivery condition. It never initiates recovery.
- `inconclusive` includes ambiguous acceptance and provider-history gaps.
- `coverage_incomplete` means a required source page failed; negative matches
  in that range are intentionally not conclusions.
- `excluded` means approved historical/synthetic/noncanonical evidence, not a
  failed delivery.

The report contains HMAC-redacted identifiers, timestamps, statuses, safe error
codes, and aggregate metrics only. It has no message bodies, phone numbers,
media URLs, credentials, raw SIDs, raw UUIDs, or provider error messages. See
the format at `docs/examples/twilio-ledger-audit.redacted.json`.

Twilio acceptance, queued, sent, and delivered status are distinct. A valid
Twilio SID proves API acceptance, not handset delivery; only a terminal
provider `failed`, `undelivered`, or `canceled` state is a confirmed provider
delivery failure. The report cannot prove messages removed from Twilio history,
cannot assess a customer's reading/comprehension, and must not be used to
replay, resend, or alter ledger state. The terminal prints only a fixed safe
error code, never exception text; report directories reject symbolic links and
non-owner directories, retention removes only single-link CLI-created report
filenames, and reports are created with exclusive mode 0600.

## Production validation and rollback

### Read-only production privilege preflight

Before approving the migration, an authorized database operator must run this
catalog-only query through the approved administrative path. It does not create
the audit role, read application tables, reveal function bodies, or alter any
privilege. A returned row means the migration would fail closed because a new
no-membership audit role would inherit both `PUBLIC` schema `USAGE` and
`PUBLIC` function `EXECUTE`.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

WITH security_definer_functions AS (
  SELECT
    namespace.nspname AS schema_name,
    procedure.oid::regprocedure::text AS function_signature,
    owner.rolname AS function_owner,
    EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))) AS acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'USAGE'
    ) AS public_schema_usage,
    EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ) AS public_function_execute
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  JOIN pg_roles AS owner ON owner.oid = procedure.proowner
  WHERE procedure.prosecdef
    AND namespace.nspname !~ '^pg_'
    AND namespace.nspname <> 'information_schema'
)
SELECT
  schema_name,
  function_signature,
  function_owner,
  'public_schema_usage_and_public_execute' AS privilege_classification,
  'application_compatibility_review_required' AS next_step
FROM security_definer_functions
WHERE public_schema_usage AND public_function_execute
ORDER BY schema_name, function_signature;

COMMIT;
```

An empty result means the migration's effective-function gate can proceed on
the current catalog. Every returned function requires application compatibility
review before any targeted privilege change; do not revoke `PUBLIC` globally.

Before a first audit, a database administrator must verify with the audit role
that `SELECT` from `twilio_audit.twilio_ledger_audit_rows` succeeds, while direct
`SELECT` from `public.messages`, profiles, and logs; and `INSERT`, `UPDATE`,
`DELETE`, or DDL are denied. Verify that no non-system `SECURITY DEFINER`
function is effectively invocable; ordinary invoker functions require separate
capability review rather than an assumption of universal denial. Verify the connection uses
TLS with certificate validation and the expected `twilio_ledger_auditor`
identity. Perform this validation with synthetic/disposable data before any
production credential is issued.

Rollback requires a separately approved migration: revoke view access from the
auditor, disable and rotate its password, drop the view-owner RLS policy and
view, revoke the view owner's column grant, and finally drop both roles after
active sessions are gone. Do not revoke or alter application or `service_role`
grants during this rollback.
