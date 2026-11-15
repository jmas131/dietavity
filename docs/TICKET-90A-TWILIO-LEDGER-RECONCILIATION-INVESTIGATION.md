# Ticket 90A — Twilio-to-Ledger Reconciliation Investigation

**Status:** investigation only; no production access or mutation was performed.

**Scope:** compare the Twilio Programmable Messaging Message records for the
configured WhatsApp sender with the canonical `public.messages` ledger. This
is an observability/audit tool, never a sender, retry worker, or recovery
mechanism.

## Verified correlation model

`public.messages` is the canonical customer-visible WhatsApp ledger from the
Ticket 9 cutover forward. Its relevant columns are `direction`, `timestamp`,
`session_id`, `provider`, `provider_message_sid`, `idempotency_key`,
`in_reply_to_id`, `delivery_status`, `metadata`, `processing_order`,
`processing_owner`, `processing_lease_until`, `processing_completed_at`, and
`processing_outcome`.

### Inbound

1. The Twilio trigger supplies the genuine inbound Message SID.
2. `RESERVE_INBOUND_SQL` writes one `direction = 'inbound'`, `provider =
   'twilio'` row, with that SID in both `provider_message_sid` and the
   inbound idempotency identity. It starts as `delivery_status = 'received'`.
3. A unique partial index on `(provider, provider_message_sid)` protects a
   real SID from appearing in more than one ledger row. A separate unique
   partial index protects `idempotency_key`.
4. `processing_order` gives global arrival order; per-session FIFO, lease, and
   completion fields describe processing state. `processing_owner` is an n8n
   execution lease identity, never a Twilio identifier.

The audit's definitive inbound match is therefore an exact, one-to-one match
between a Twilio inbound Message SID and a canonical inbound `provider_message_sid`.
It must not match phone numbers, bodies, timestamps, execution IDs, or AI
memory.

### Logical turns and outbound replies

Adjacent unresolved inbound rows in the same session with no more than a
10-second receipt gap form one newline-joined logical turn. The first member
is its anchor; all members receive `metadata.turn_anchor_id`, position, and
count when claimed. A later independent turn may supersede an unclaimed older
turn; `processing_outcome = 'superseded'` is terminal evidence, not an
unanswered message.

V4 reserves every outbound WhatsApp part before contacting Twilio. All parts:

- have `direction = 'outbound'`, `provider = 'twilio'`, and a nonempty final
  customer-visible `body`;
- point to the anchor with `in_reply_to_id`;
- share `metadata.logical_reply_key`, and have contiguous
  `metadata.part_index` / `metadata.part_count`;
- use one deterministic base key (`reply:<anchor inbound SID>:v4`) and a
  `:part:NNN` suffix after part one.

Twilio's send response is persisted onto the corresponding outbound row:
`provider_message_sid`, provider status/error metadata, and a local
`delivery_status`. A syntactically valid `SM`/`MM` SID means Twilio accepted
the API submission; it does **not** prove handset delivery. Explicit `failed`,
`undelivered`, or `canceled` status (or an immediate HTTP 4xx/known rejection)
is local failure evidence. The checked-in path completes all logical-turn
members only when every expected outbound part is accepted/scheduled/sent/
delivered with acceptance evidence.

There is no separate delivery/reservation table. The only related table found,
`public.ledger_health_alerts`, reserves and confirms alert emails; it is not a
message queue or delivery ledger. `public.logs` may provide operational context
but is not a correlation source of truth.

## Audit population and exclusions

Default scope is all Twilio Message resources involving the configured
WhatsApp sender and all matching canonical ledger rows whose ledger receipt
timestamp is in the audit window. Select a seven-day UTC window with a small
read overlap at both boundaries; de-duplicate by Twilio SID and ledger UUID
before classification. Record the requested and effective UTC bounds in the
report.

Exclude from *current-production completeness and delivery rates*, but count
separately as excluded, only records with evidence of one of these conditions:

| Exclusion | Reason |
| --- | --- |
| `idempotency_key IS NULL`, no Twilio provider/SID, or `provider <> 'twilio'` | Pre-canonical/partial historical rows cannot support SID correlation. |
| `processing_outcome = 'historical_completed'` or `metadata.session_ordering_state = 'historical_completed'` | Ticket 17 deliberately marked pre-ordering work complete to avoid replay; it is not delivery evidence. |
| Explicit synthetic namespaces (`__sales-conversation-harness__:%`, `__harness48__:%`) or the Ticket 82 local `delivery_suppressed` marker | Local harness/transport-suppression evidence, not production Twilio delivery. |
| Rows outside the selected window, deleted/redacted/unavailable Twilio history, or unparseable legacy shapes | Retain as coverage limitations, never as failures. |

Do not exclude a row merely because it is old, unordered, `unknown`, or has no
delivery SID. In particular, historical unordered rows must be reported as
legacy/inconclusive unless their explicit evidence satisfies a defined
discrepancy category. Do not exclude current production rows by `message_kind`:
valid current and legacy operational messages can use different kinds.

## Reconciliation rules

The implementation should first build SID-indexed, privacy-safe in-memory
projections. It should compare exact SID sets before attempting any temporal
inference.

| Classification | Evidence threshold | Result |
| --- | --- | --- |
| `inbound_unmatched_ledger` | In-scope Twilio inbound SID has no eligible canonical inbound row | Confirmed ingestion discrepancy, subject to a short eventual-consistency grace period. |
| `inbound_unmatched_twilio` | Eligible canonical inbound SID has no Twilio resource after the read overlap and successful full pagination | Inconclusive until account/sender/date coverage is verified; do not call it a lost message automatically. |
| `outbound_unmatched_ledger` | In-scope Twilio outbound SID has no eligible canonical outbound row | Confirmed provider-to-ledger discrepancy after pagination/identity coverage succeeds. |
| `outbound_unmatched_twilio` | Canonical outbound row has a valid SID absent from Twilio results | Inconclusive/provider-history discrepancy; fetch that SID once before escalation, never resend. |
| `duplicate_provider_sid` | More than one Twilio resource or more than one eligible ledger row has the same SID | Confirmed integrity anomaly; the ledger unique index means an apparent ledger duplicate also warrants extraction/query verification. |
| `missing_logical_reply` | A completed current logical-turn anchor lacks a complete, contiguous outbound reservation set, excluding `superseded` and explicitly reconciliation-required paths | Confirmed ledger-state discrepancy, not proof that Twilio failed delivery. |
| `reply_not_accepted` | A logical reply has a failed/undelivered/canceled part, or a part remains unresolved beyond the grace period | Confirmed only for explicit terminal provider state; `pending`/`unknown`/missing SID remains `outbound_acceptance_inconclusive`. |
| `delivery_failure` | Twilio resource has a terminal failed/undelivered/canceled status | Confirmed provider delivery failure. `accepted`, `queued`, or `sent` is not handset delivery. |
| `ledger_status_divergence` | Exact outbound SID exists on both sides but terminal/provider status conflicts | Confirmed data-state discrepancy; report both normalized states without error text. |
| `processing_delay` | Non-excluded inbound/anchor elapsed time exceeds an approved threshold | Operational signal, not delivery failure. Report stage separately: receipt→claim, receipt→reservation, reservation→Twilio acceptance, and acceptance→completion where timestamps exist. |

Recommended initial thresholds: flag receipt→claim at 15 minutes (the lease
period), receipt→first reservation at 20 minutes, receipt→full acceptance at
25 minutes, and any incomplete FIFO head older than 20 minutes. These are
starting alert thresholds, not SLOs or proof of a customer impact; retain
latency percentiles (p50/p95/max) and revise after the baseline.

Multiple inbound fragments can legitimately have one reply: evaluate reply
completeness once per anchor and mark every member as `batched_member`, never
as individually missing a reply. A multi-part reply can legitimately have
multiple outbound SIDs: success requires the complete contiguous part set, not
one outbound row. Repeated webhook deliveries should collapse through the
inbound idempotency key/SID; the audit must count provider resources and ledger
rows separately and surface actual duplicates rather than infer them from a
retry.

Rows whose metadata says `reconciliation_state = 'operator_required'` are
intentional safety stops. Classify them as `reconciliation_required`, not a
missing reply or confirmed failure. The Recovery Poller only wakes eligible
FIFO heads, and the V4 reconciliation RPC may promote an already-persisted
valid SID or perform one specially proven non-submission redispatch; this audit
must call neither path.

## Proposed architecture

Choose a standalone Node.js CLI for Ticket 90B, not an n8n workflow. It remains
usable when n8n is unavailable—the precise condition in which a ledger audit is
most valuable—and it avoids sharing the processing workflow's execution,
retry, and credential surface.

Suggested shape:

```text
read-only config → bounded Supabase SELECTs + paginated Twilio GETs
                 → normalized in-memory SID/anchor indexes
                 → deterministic classifier
                 → JSON report + concise terminal summary
```

The CLI should use `--from`/`--to` UTC bounds (default: last seven completed
days), `--lookback-days` (optional, explicit cap), `--dry-run` (the only
mode), and an output path. It must have no send/retry command, no mutable SQL,
and no n8n invocation. Use the Twilio Message list endpoint:

```text
GET /2010-04-01/Accounts/{AccountSid}/Messages.json
GET /2010-04-01/Accounts/{AccountSid}/Messages/{MessageSid}.json   # candidates only
```

Request only in-window records involving the configured WhatsApp sender;
validate the exact sender/channel locally and discard message bodies,
addresses, and media fields immediately. Twilio list filtering is date-based;
use an overlap and follow the API-supplied next-page URI/token rather than
constructing page URLs. The Message list is newest-first and supports up to
1,000 records/page; its documentation specifically recommends using the next
page URI to avoid duplicates during active traffic. [Twilio Message resource](https://www.twilio.com/docs/messaging/api/message-resource)

On HTTP 429 or transient 5xx, honor `Retry-After` when present and otherwise
use bounded exponential backoff with jitter and a finite retry budget. Do not
retry authentication/authorization/validation 4xx. A failed page makes the
run `coverage_incomplete`; do not emit negative match conclusions for the
unread range. Fetch individual SIDs only for canonical-outbound rows absent
from an otherwise complete list response, and retain failures as inconclusive.

Use keyset/page-based Supabase/Postgres reads and a stable selected column
list. Do not fetch `body`, `user_message`, `assistant_response`, `transcript`,
`audio_url`, or arbitrary full `metadata`; project only the named correlation,
turn, and provider-status fields (and selected scalar metadata keys).

### Output and privacy

The JSON and terminal summaries must contain only:

- run/version/configuration fingerprints, UTC bounds, pagination/coverage and
  error counters;
- aggregate counts/rates and delay percentiles;
- discrepancy class, confidence (`confirmed`/`inconclusive`), normalized
  statuses, safe error code, and timestamps/durations;
- HMAC-redacted IDs for Twilio SID, ledger UUID, session, logical reply key,
  and any correlation reference.

Use an audit-only HMAC secret supplied at execution time, domain-separate each
identifier type, and include a nonsecret key-rotation label. Never print or
write phone numbers, bodies, media URLs, credentials, full metadata, raw
provider error messages, or health/profile content. The report itself must not
include the configured sender value. Restrict report files to the operator and
set an explicit retention/deletion policy before historical runs.

## Permissions and missing prerequisites

### Required read-only access

1. **Twilio:** Account SID plus a restricted API key SID/secret authorized for
   `twilio/messaging/messages/list` and Message fetch only. No create, update,
   delete, console, webhook, phone-number, or credential-management scope.
   Twilio documents the Messages list/fetch endpoints and restricted-key
   Messages-list permission. [Message resource](https://www.twilio.com/docs/messaging/api/message-resource), [restricted-key permissions](https://www.twilio.com/docs/documents/592/Twilio_Restricted_API_Keys_Permissions_-_Messaging_Permissions.pdf)
2. **Supabase/Postgres:** a new dedicated read-only database role (preferred)
   with `SELECT` on a narrowly scoped audit view, or an equivalently narrow
   read-only RPC/view credential. The current schema grants the application
   table to `service_role` and explicitly denies public/anon/authenticated
   access; do **not** reuse a service-role secret for this CLI.
3. **Configuration:** supplied outside the repository: account identifier,
   WhatsApp sender identity, Supabase connection/project endpoint, audit HMAC
   secret and rotation label, report destination, UTC window/grace/threshold
   policy, and the confirmed V4 cutover timestamp/namespace policy.

The repository does not contain a safe audit credential, an approved
least-privilege Supabase read interface, a committed production sender config,
or a declared report retention policy. Those are blockers to running the
baseline, not reasons to broaden access or inspect production credentials.

## Seven-day baseline and longer history

Run one manually approved seven-day UTC baseline after prerequisites are met.
Capture the CLI version/commit, schema/config fingerprint, start/end time,
pages read, successful/failed page counts, and exclusions. Do not compare a
pre-cutover population to V4 as a single rate; either start at the verified
cutover or partition results into legacy and V4 cohorts.

An optional historical run should be explicit (`--lookback-days N`) and
partitioned by cutover and known schema/runtime eras. It will have weaker
coverage because historical ledger rows are deliberately partial and Twilio
history may be deleted/redacted or outside retention. Its output should be a
trend/inventory, never a retrospective delivery-failure rate.

## Cost and operational estimate

The audit sends no WhatsApp messages, so it creates no message-delivery or
template charges. It makes approximately `ceil(T/P)` Twilio list requests for
`T` in-scope resources at page size `P` (choose a conservative operational
size such as 100–500), plus one fetch only for each unresolved SID candidate.
Supabase cost is two or a small fixed number of bounded read streams. At the
currently documented small-volume validation stage, seven days should normally
be a low request-volume run; actual monetary API/storage/logging charges and
rate limits must be confirmed against the account plan before scheduling. The
primary operational cost is review of confirmed and inconclusive exceptions,
not compute.

## Tests and acceptance criteria for Ticket 90B

Unit tests must cover:

- exact inbound/outbound SID matching and duplicate SIDs;
- one logical turn with several inbound members, independent turns, a
  superseded turn, and one logical reply with several parts;
- accepted/scheduled/sent/delivered versus pending/unknown and explicit
  failed/undelivered/canceled provider statuses;
- missing ledger and missing Twilio records, provider/list pagination overlap,
  429/5xx exhaustion, and individual-fetch inconclusiveness;
- cutover/legacy/harness exclusion rules and the rule that unordered history is
  never automatically a delivery failure;
- HMAC determinism/domain separation and assertions that output contains no
  phone number, body, credential, raw SID, or raw provider error message;
- no HTTP methods other than GET and no SQL other than read-only SELECT/view
  calls, enforced with mocked clients.

Acceptance criteria:

1. A default seven-day run completes with demonstrably complete pagination or
   marks itself `coverage_incomplete` and avoids false negative conclusions.
2. Every result is reproducible from the immutable run bounds/config
   fingerprints and contains only redacted identifiers.
3. Anchor/member and multipart rules yield no false missing-reply findings in
   the supplied V4 fixtures.
4. Explicit terminal Twilio failures are distinguished from accepted/sent and
   unresolved states.
5. The tool has no write, send, replay, recovery-poller, n8n, or production
   activation path; tests prove this.
6. The generated report clearly separates confirmed discrepancies, inconclusive
   cases, exclusions, and coverage limitations.

## Investigation evidence

- `docs/PROJECT-SUMMARY.md` identifies V4 as authoritative and states the
  ledger → ordered logical turn → reservation → delivery model.
- `database/migrations/20260814_ticket_9_canonical_message_ledger.sql` and
  `database/schema.sql` establish the canonical fields, SID/idempotency
  uniqueness, and backend-only access.
- `lib/session-ordering.js` establishes inbound reservation, 10-second turn
  batching, anchors/members, ownership, and multipart reservation; `lib/twilio-delivery.js`
  establishes acceptance/failure classification and persisted provider evidence.
- `n8n/Dietavity Sales Engine (Ticket 10).json` is the generated canonical
  workflow artifact containing the active V4 path; `n8n/Dietavity WhatsApp
  Recovery Poller.json` and `n8n/Dietavity Ledger Health Monitor.json` are
  checked-in import artifacts and not relied upon as activation evidence.
- No production query, credential inspection, workflow import/activation,
  message send, database write, commit, or push was performed for Ticket 90A.

Ticket 90B must not begin until this design, the minimum read credentials, the
cutover/exclusion configuration, output retention, and alert thresholds are
reviewed and approved.
