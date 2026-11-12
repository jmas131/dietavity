# Ticket 90B — Read-only Twilio-to-Ledger Audit Runbook

## Safety boundary

`scripts/reconcile-twilio-ledger.js` is a read-only diagnostic. It makes only
Twilio `GET` requests and Supabase `SELECT` requests through a dedicated audit
view. It has no Twilio create/send API, no database mutation, no n8n client,
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
2. `SUPABASE_AUDIT_URL` and `SUPABASE_AUDIT_READ_ONLY_KEY` for a dedicated
   audit role. This role needs `SELECT` only on the security-reviewed view
   `public.twilio_ledger_audit_rows`; it needs no access to `public.messages`,
   `users`, profiles, logs, write RPCs, or service role.
3. `TWILIO_AUDIT_WHATSAPP_SENDER`, supplied by the operator but never emitted
   by the tool, and `TWILIO_LEDGER_AUDIT_HMAC_SECRET` (at least 16 characters)
   plus an optional nonsecret `TWILIO_LEDGER_AUDIT_HMAC_ROTATION` label.
4. An operator-approved local report directory and retention period. The CLI
   deletes only its own `twilio-ledger-audit-*.json` files older than the
   required `--retention-days`; it uses directory mode 0700 and report mode
   0600. Do not use a shared or synchronized directory without an approved
   retention policy.

The view must expose only this non-content projection:

```text
ledger_id, recorded_at, direction, provider_message_sid, idempotency_key,
in_reply_to_id, delivery_status, provider_status, provider_error_code,
processing_order, processing_lease_until, processing_completed_at,
processing_outcome, turn_anchor_id, turn_position, turn_member_count,
reconciliation_state, delivery_suppressed, is_historical, is_synthetic,
is_canonical, logical_reply_key, part_index, part_count
```

The database owner must implement and review the view so `is_historical`,
`is_synthetic`, and `is_canonical` reflect the approved cutover/exclusion
policy without exposing message bodies, phone numbers, session identifiers,
medical data, full metadata, or workflow execution identifiers. Grant only
the audit role `SELECT` on that view. Creating the role/view is a separately
approved production change and is not part of Ticket 90B.

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

Supabase uses the view's `(recorded_at, ledger_id)` unique keyset cursor rather
than offsets, rejects non-monotonic/duplicate page members, and requests exact
counts on every page. The first page establishes the total; each later,
keyset-filtered page must satisfy `collected rows + remaining exact count =
initial total`. A changing count or cursor anomaly is `coverage_incomplete`,
not a partial-success report.

These are independently paginated HTTP requests, not one PostgreSQL snapshot.
The invariant detects ordinary concurrent insert/delete/count changes but cannot
prove a snapshot if concurrent changes preserve a count or occur before the
first page. The default CLI window is already the last seven **completed** UTC
days, which reduces normal concurrent-write exposure. Operators should use
completed-day explicit ranges for baselines; an audit of a current/open day is
allowed only as an explicitly limited, potentially `coverage_incomplete`
investigation.

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
