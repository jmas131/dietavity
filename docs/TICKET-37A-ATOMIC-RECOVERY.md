# Ticket 37A — atomic recovery and multipart completion

This supersedes Ticket 37's operational recovery/deployment guidance. Nothing
in this ticket deploys workflows, applies production SQL, or sends WhatsApp.

For the historical incident with a non-null reconciliation completion timestamp,
use [the historical reopen procedure](TICKET-37A-HISTORICAL-REOPEN.md). It requires
the follow-up migration and explicit timestamp-checked atomic preparation;
do not clear the timestamp manually. The null-completion prerequisite below
applies to ordinary recovery without that explicit historical option.

## Completion audit and canonical predicate

The repository-wide audit covered `lib/`, `scripts/`, all `n8n/*.json`, all
migrations and `database/schema.sql`, tests, and the Ticket 17/28A/36/37 docs.
Operational transport completion exists at these locations:

| Path | Previous behavior | Ticket 37A |
| --- | --- | --- |
| `Mark Session Inbound Complete` / `COMPLETE_INBOUND_SQL` | No unresolved existing row; missing expected parts could pass | Canonical predicate |
| `Claim Next Session Inbound` stale reconciliation | Any accepted row could complete | Canonical predicate |
| Global Error Handler `Insert Error Log (Error Handler)` | Any accepted row could complete | Canonical predicate; durable logging/email branches retained |
| Operator recovery `completionSql()` | Did not exist | Canonical predicate plus recovery hash checks |

Other audited paths are not transport completion decisions: inbound reservation
queues work; outbound reservations renew ownership; `Find Verified WhatsApp
Sessions` is read-only; Ticket 28A linking clears completion to resume an
existing inbound; Ticket 17's migration labels historical rows once. The
`Assert … Accepted` nodes gate individual provider results, including Checkout,
reminders, media, legacy cancellation, Setup, welcome, customer error, and
portal-recovery sends. They do not independently complete an inbound. The
Ticket 9 source and archived artifacts are not deployment targets. Historical
single-message queue simulations are tests, not production completion logic.

`lib/logical-reply.js` owns `fullyAcceptedSql(inboundIdSql)` and its testable
JavaScript counterpart. Completion requires at least one outbound and every
logical group to satisfy all of the following:

- Nonempty logical key; declared metadata has numeric integer indices/counts.
- Count between 1 and 999; identical count across the group.
- Exactly indices `1..part_count`, without duplicates or missing parts.
- Part 1 has the base key; later parts have the matching `:part:002` etc. key.
- Same inbound and session relationship; malformed numbering/keys fail closed.
- Every status is `accepted`, `scheduled`, `sent`, or `delivered` and has a
  valid provider SID or durable Ticket 36 `provider_acceptance_evidence =
  'message_sid'` evidence. NULL evidence/status cannot pass.

Legacy rows with no multipart metadata are single-part groups keyed by their
existing idempotency key. Distinct legacy logical groups, such as a scheduled
reminder and its confirmation, must **both** resolve; one cannot mask the
other. A row with a `:part:` suffix cannot masquerade as a legacy singleton.
The exact SQL is generated from the helper; it is not separately maintained in
workflow JSON. Structural tests check all operational generated completion
queries and reject independent acceptance shortcuts.

## Normal replies

The existing multipart reservation remains one SQL statement. It now refuses
to append parts if the inbound already has an outbound. Part 1 keeps the base
key, later parts receive deterministic suffixes, and all rows are reserved
before sending. The new `Loop Paid WhatsApp Parts` node has batch size 1:

`reserve → loop → Twilio → persist result → assert → loop`

Only the loop's done output reaches paid memory and normal inbound completion.
A failed/unknown part stops before another part is sent. No node retries were
enabled. Ticket 36 JSON/string-error normalization and `21617` classification
are unchanged. Successful formatting is not a workflow error.

## Atomic recovery design

Chosen: two narrowly scoped backend-only Postgres functions plus an explicit
operator CLI. A migration and synchronized schema snapshot are required; no
table, index, status enum, or general messaging framework is added.

An RPC is preferable to disconnected n8n lock/update nodes because its locks
and mutations share one transaction. A single anonymous transactional SQL
block was possible, but a named backend-only function provides a smaller,
reviewable installed interface. A persistent service/queue was unnecessary.
The CLI uses existing Axios and the operator's `psql` client, not a new runtime
application dependency. PostgreSQL integration tests use an ephemeral PGlite
installation outside the repository and never production credentials.

### Phase A: `prepare_whatsapp_reply_recovery(jsonb)`

The CLI reads the stored `assistant_response`, checks the expected UTF-8 SHA-256
hash, and uses the same `formatWhatsAppMessage()` helper embedded in the n8n
formatter. It does not call OpenAI or accept operator-supplied replacement text.
Formatting occurs before the RPC; the RPC rechecks the stored hash under lock,
so an intervening change aborts the whole operation.

The function takes the Ticket 17 session advisory transaction lock, locks the
inbound, base outbound, and linked outbound rows, and validates IDs, directions,
session, canonical key, current state, absence of a provider SID, stored hash,
and absence of conflicting siblings/attempts. It requires explicit verified
`21617` evidence and a non-content evidence reference.

It changes only the base row's transport body, delivery state, and metadata;
the original UUID, key, logical `assistant_response`, identity, and linkage
remain. Part 2+ inserts occur in the same transaction. A unique-key conflict,
including a conflict discovered after updating Part 1, rolls everything back.
Original rejection status/code/message and body hash are preserved as evidence.
Length flags/counts, logical key, index/count, original-response hash, and each
final body hash are persisted without putting response content into metadata.

An identical repeat returns existing prepared rows without writes, including
already accepted rows. Different hashes, evidence references, bodies, numbering,
or invalid transport state fail closed. It never resets an accepted part or
overwrites a provider SID. The inbound remains unresolved/reconciliation.

### Phase B: `claim_whatsapp_reply_recovery_part(jsonb)` and CLI

Each explicitly authorized `send-next` command sends **at most one part**.
The claim RPC validates the complete prepared set, hashes, FIFO position, and
window evidence, then atomically records a unique `recovery_send_token` on the
earliest eligible pending part. Accepted parts are skipped; failed/unknown
parts and previously claimed pending parts block further sending.

The CLI sends exactly that canonical row's `body` to its verified session from
`TWILIO_WHATSAPP_FROM`, then persists the individual result using Ticket 36's
delivery SQL, guarded by the claim token. Completion uses the canonical
predicate and updates paid memory only after all parts resolve.

The durable claim is intentionally not auto-expiring. A crash before a POST or
between provider acceptance and persistence is ambiguous operationally. It must
not become a second POST merely because an operator repeats the command.
`verify` shows the claim and provider evidence; uncertain/failed states require
explicit provider reconciliation, not a generic reset or retry command.

The CLI does not run an n8n workflow. Genuine normal-path transport failures
still flow through the existing Global Error Handler. Operator failures exit
nonzero and preserve the durable claim/result for inspection; they do not
silently report success or fabricate n8n error emails.

## Messaging-window safety

`send-next` requires an operator-selected recent **real inbound SID**, fetches
that Message resource from Twilio, and verifies account, direction, sender,
recipient, SID, and creation time. It requires an age below 23h55m (a five-minute
margin), plus a matching recent canonical inbound in Postgres. The DB rejects
stale verification timestamps. Both checks occur before a send claim/POST.

The original incident's old SID is not an indefinite permission to send.
Outside the window, stop and obtain the required customer/operator action.
The tool does not send or invent templates. This conservative 24-hour rule is
documented in [Twilio's WhatsApp quickstart](https://www.twilio.com/docs/whatsapp/quickstart).

## Incident-specific procedure (separate production authorization required)

Do not rerun an old execution or call the normal insert-only reservation node.
The stored production response remains the sole content source.

### Prerequisites

1. Verify Twilio's original rejection and preserve its `21617` evidence. A
   second operator must confirm there was no accepted resource for the attempt.
2. Install the reviewed migration, then import the updated inactive Sales
   Engine and Global Error Handler. Validate in staging before separately
   authorized activation. Both workflow changes are required before recovery.
3. Use a trusted backend database role with function privileges. Configure
   `PGSERVICE`/libpq credentials using secret management; never put passwords
   into commands or this repository. The CLI uses `psql -X` and bounds lock
   waits to 5 seconds and statements to 30 seconds. Set `DIETAVITY_PSQL_BIN`
   only when a non-default binary path is needed.
4. Run `database/preflight-ticket-37a.sql`. It is read-only and returns the
   exact IDs, canonical session, hash, state, function availability, and sibling
   summaries. Expect the supplied original UUIDs/key and 1,889 PostgreSQL
   characters. Confirm `processing_completed_at IS NULL`, no live claim,
   `unknown`/`failed`, no provider SID, and no conflicting siblings.

Exact read-only command from the repository root, using the configured libpq
service (no password in the command):

```bash
psql -X -v ON_ERROR_STOP=1 -f database/preflight-ticket-37a.sql
```

### Private input file

Create a private operator file outside the repository, for example
`/secure/ticket-37a-incident.json`, using the actual preflight values:

```json
{
  "inbound_id": "b97863b2-611c-4ffc-91d0-13202cbfb298",
  "outbound_id": "349000f3-1c94-4efe-97f2-03637584c671",
  "expected_key": "reply:SMf79859ae7c0c371d57060f58334c6bce:paid",
  "expected_session_id": "REPLACE_WITH_VERIFIED_CANONICAL_E164_SESSION",
  "expected_hash": "REPLACE_WITH_PREFLIGHT_SHA256",
  "confirmed_error_code": "21617",
  "evidence_reference": "REPLACE_WITH_REVIEWED_EVIDENCE_REFERENCE"
}
```

The placeholders are deliberately invalid: the CLI will not proceed with them.
No recipe text belongs in this file. PostgreSQL character count and JavaScript
UTF-16 length may differ for supplementary Unicode characters; the SHA-256 is
the stable cross-runtime integrity check.

### Read-only checks and preparation

From the repository root, with the operator's supported Node runtime:

```bash
node scripts/ticket-37a-recovery.js preflight /secure/ticket-37a-incident.json
node scripts/ticket-37a-recovery.js preview /secure/ticket-37a-incident.json
```

`preview` prints only counts, flags, part lengths and hashes—not message bodies.
Do not assume the production response creates the same parts as a test fixture.
After separate approval for the exact incident:

```bash
node scripts/ticket-37a-recovery.js prepare /secure/ticket-37a-incident.json --execute
node scripts/ticket-37a-recovery.js verify /secure/ticket-37a-incident.json
```

Verify Part 1 retains UUID `349000f3-1c94-4efe-97f2-03637584c671` and the base
key; additional keys end `:part:002`, etc. Compare every body hash/length to
preview, original-response hash, numbering/counts, pending statuses, absent
provider SIDs, and the still-incomplete inbound. If content inspection is
needed, query the exact rows' `body` inside authorized database access, not
shared logs. **Preparing does not send anything.**

### Explicitly send one part

Configure secret-managed `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and
`TWILIO_WHATSAPP_FROM` (bare verified E.164 sender). Add `window_inbound_sid` to
the private input file with a currently valid real inbound SID for that exact
recipient/sender. Do not substitute an invented SID or assume the old incident
is still inside the window.

After reviewing and explicitly authorizing the irreversible send:

```bash
node scripts/ticket-37a-recovery.js send-next /secure/ticket-37a-incident.json --execute
node scripts/ticket-37a-recovery.js verify /secure/ticket-37a-incident.json
```

Inspect the one returned part and its persisted SID/status. Only after durable
acceptance, repeat these two commands for the next part. No batch resend is
performed. After the final acceptance, verify the inbound completion timestamp
and paid memory. If sending completed but the final completion write failed,
this separate action cannot send anything and still requires the full predicate:

```bash
node scripts/ticket-37a-recovery.js complete /secure/ticket-37a-incident.json --execute
```

Each send is one real Twilio `POST /2010-04-01/Accounts/{accountSid}/Messages.json`
with only `From=whatsapp:{configured sender}`, `To=whatsapp:{canonical session}`,
and `Body={the claimed row's exact prepared body}`. No AI generation, template,
media, or mock is involved. The precise production text/part count is determined
from the stored response, not from its 1,889-character count alone.

The normal Ticket 17 claim path can then advance to the next unfinished session
message. The CLI does not process a later inbound or regenerate its answer.

### Read-only verification SQL

```sql
SELECT id, in_reply_to_id, idempotency_key, delivery_status,
       provider_message_sid, metadata->>'part_index' AS part_index,
       metadata->>'part_count' AS part_count,
       metadata->>'recovery_source_hash' AS original_hash,
       metadata->>'recovery_body_hash' AS final_body_hash,
       metadata ? 'recovery_send_token' AS send_claimed
FROM public.messages
WHERE direction = 'outbound'
  AND in_reply_to_id = 'b97863b2-611c-4ffc-91d0-13202cbfb298'
ORDER BY (metadata->>'part_index')::integer;

SELECT processing_completed_at, processing_outcome,
       processing_owner, processing_lease_until
FROM public.messages
WHERE id = 'b97863b2-611c-4ffc-91d0-13202cbfb298';
```

### Stop conditions and rollback

Any mismatch, missing/extra part, live owner, closed/unverified window, failed
or unknown result, or claimed pending part stops the procedure. Do not clear
claims or reset statuses to continue. Inspect the exact Twilio attempt first.
A preparation exception rolls back every database change automatically. After
preparation commits, inspect rather than delete historical rows. After a POST,
database rollback cannot unsend a message. Accepted parts and their SIDs must
remain unchanged. A provider reconciliation/reset for an ambiguous or failed
new attempt is a separate reviewed operation; this tool does not automate it.

## Validation and limitations

Unit/structural tests cover completion integrity, generated-source equality,
legacy compatibility, window verification, formatter reuse, and loop topology.
`test-support/run-ticket-37a-postgres.js` executes real PostgreSQL SQL/PLpgSQL in
an in-memory PGlite engine with the repository messages table and unique indexes.
It tests preparation, idempotency, post-update rollback, denied public roles,
all completion paths, normal reservation, send claims, and mocked provider
failure/persistence-loss cases. It does not connect to production or send.

Run with a separately installed test runtime:

```bash
DIETAVITY_PGLITE_PATH=/absolute/path/to/node_modules/@electric-sql/pglite node --test test-support/run-ticket-37a-postgres.js
node --test test/ticket-37a-logical-reply-recovery.test.js
npm test
```

Live n8n loop/item-linking behavior and the target self-hosted PostgreSQL/Twilio
configuration still require a staging acceptance test before production import
and recovery. An in-memory PostgreSQL engine does not validate deployment
credentials, real parallel server connections, or provider behavior.

### Results (2026-09-03)

- Ticket 37A focused unit/structural and PostgreSQL integration: **42/42 pass**,
  no skips (22 unit/structural plus 20 PostgreSQL tests).
- Ticket 17/28A/36/37 historical regressions: **39/39 pass**, no skips.
- Full `node --test` suite (the `npm test` script): **364/365 pass**, no skips.
  The remaining failure is the untouched Ticket 25 purchase-page assertion:
  it expects `Hablar por WhatsApp`, while the page says `Escribe en WhatsApp`.
  Neither the page nor that test was changed for this ticket.
- One earlier full run also reported a Ticket 28 test-file failure; its isolated
  rerun passed 6/6 and the subsequent full run passed those tests. This transient
  result was not treated as a reason to weaken or skip tests.
- Regenerating the migration, schema, Global Error Handler, Sales Engine, and
  derived Stripe sandbox produced byte-identical files. All three generated
  workflow artifacts remain inactive.
- No production connection, migration, workflow import/activation, or message
  send was performed. Deployment remains gated on staging validation and the
  outstanding full-suite discrepancy.

## File inventory

New implementation sources:

- `lib/logical-reply.js`
- `lib/global-error-handler.js`
- `lib/reply-recovery.js`
- `lib/reply-recovery-sql.js`
- `scripts/generate-global-error-handler.js`
- `scripts/generate-ticket-37a-sql.js`
- `scripts/ticket-37a-recovery.js`

Updated implementation sources: `lib/session-ordering.js`,
`lib/whatsapp-message.js`, `scripts/refactor-ticket-10-workflow.js`.

Database artifacts: new
`database/migrations/20260903_ticket_37a_reply_recovery.sql`, new
`database/preflight-ticket-37a.sql`, and synchronized `database/schema.sql`.

Regenerated workflows: `n8n/Dietavity Sales Engine (Ticket 10).json`,
`n8n/Global Error Handler.json`, and derived
`n8n/Dietavity Stripe Checkout Sandbox.json`. The sandbox was regenerated for
consistency, not to alter Stripe behavior or authorize importing it to production.

New tests: `test/ticket-37a-logical-reply-recovery.test.js`,
`test-support/ticket-37a-fixture.js`, `test-support/run-ticket-37a-postgres.js`.
Updated historical tests: Ticket 9 canonical ledger, Ticket 17 session ordering,
Ticket 30 node references, Ticket 36 reconciliation, and Ticket 37 length tests.
Documentation: this runbook and the supersession notice in
`docs/TICKET-37-WHATSAPP-MESSAGE-LENGTH.md`.
