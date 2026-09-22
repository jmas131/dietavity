# Ticket 37A — historical reconciliation reopen

## Finding and supported fix

The original preparation RPC rejects every non-null `processing_completed_at`.
That safely blocks this historical record, even though its outcome is
`reconciliation`, not successful completion. A standalone timestamp UPDATE
would separate reopening from reservation and could release work incorrectly.
Do not use one.

The existing `prepare_whatsapp_reply_recovery(jsonb)` now supports explicit
`reopen_historical_reconciliation: true` plus an exact
`expected_processing_completed_at`. Under Ticket 17's session advisory lock
and the inbound/base/sibling row locks, it requires:

- Exact supplied inbound/outbound UUIDs, canonical provider SID-derived key,
  matching direction/provider/session, and stored-response SHA-256.
- Outcome exactly `reconciliation`, timestamp exactly the supplied value,
  non-null FIFO order, and both owner and lease NULL.
- Unknown/failed outbound, no provider SID/acceptance evidence, no multipart
  metadata, conflicting siblings, or previous recovery attempt.
- Explicit confirmed `21617` and nonempty evidence reference.
- No other session inbound with an owner/future lease, or incomplete inbound
  with existing outbound work. Even expired owners require separate review.

Successful completions cannot enter this branch. Already-prepared identical
calls remain read-only and cannot reopen an inbound completed after recovery.
The base UUID/key and stored response are preserved; compliant parts are
reserved and the completion timestamp is cleared in the same transaction.
Any failure rolls back the entire operation.

`metadata.recovery_historical_reopen` preserves the prior completion timestamp
(including microseconds), outcome, previous ordering state, reopen time,
outbound ID, response hash, and evidence reference. Existing inbound metadata,
error logs and outbound rejection evidence are retained. The inbound remains
`reconciliation`; its reserved outbound prevents normal AI reprocessing and
holds FIFO until every expected part is accepted. Previously sent later replies
cannot be undone; operators must review the intervening session history.

## Exact procedure for this incident

These are instructions for a separately authorized operator, not operations
performed during implementation. No n8n execution retry or AI regeneration is
part of this procedure.

1. Verify the Ticket 37A Sales Engine and Global Error Handler fixes are deployed
   and staging-validated. Coordinate so no old execution for this session can
   resume; database leases alone cannot cancel an already-running provider POST.
   Review subsequent session work and preserve Twilio's verified rejection
   evidence. Stop if any attempted outbound may have been accepted.
2. With approved backend credentials configured through libpq secret management,
   install the **new** migration. Do not replay or edit the already-installed
   original migration. This follow-up replaces the recovery functions, retains
   backend-only grants, and does not modify message rows. No additional workflow
   change/re-import is needed for this follow-up itself.

   ```bash
   psql -X -v ON_ERROR_STOP=1 -f database/migrations/20260904_ticket_37a_historical_reopen.sql
   psql -X -v ON_ERROR_STOP=1 -f database/preflight-ticket-37a.sql
   ```

3. Require `historical_reopen_guard_installed = true`. Verify the exact IDs/key,
   timestamp `2026-09-03 02:08:18.094223+00`, outcome `reconciliation`, both owner
   and lease NULL, outbound `unknown`, SID NULL, no multipart metadata/siblings,
   and the 1,889-character stored response/hash. Review the other-session-work
   result. Do not reset any conflicting worker or outbound to pass these checks.
4. Create a private `/secure/ticket-37a-incident.json` outside the repository:

   ```json
   {
     "inbound_id": "b97863b2-611c-4ffc-91d0-13202cbfb298",
     "outbound_id": "349000f3-1c94-4efe-97f2-03637584c671",
     "expected_key": "reply:SMf79859ae7c0c371d57060f58334c6bce:paid",
     "expected_session_id": "REPLACE_WITH_VERIFIED_CANONICAL_E164_SESSION",
     "expected_hash": "REPLACE_WITH_PREFLIGHT_SHA256",
     "confirmed_error_code": "21617",
     "evidence_reference": "REPLACE_WITH_VERIFIED_TWILIO_EVIDENCE_REFERENCE",
     "reopen_historical_reconciliation": true,
     "expected_processing_completed_at": "2026-09-03 02:08:18.094223+00"
   }
   ```

   Use the exact SQL timestamp string; do not round it through JavaScript Date.
   Actual session/hash/evidence were not supplied, so these placeholders must
   be replaced. No response text is an operator input.
5. Preview the stored response's deterministic formatting, then prepare:

   ```bash
   node scripts/ticket-37a-recovery.js preview /secure/ticket-37a-incident.json
   node scripts/ticket-37a-recovery.js prepare /secure/ticket-37a-incident.json --execute
   node scripts/ticket-37a-recovery.js verify /secure/ticket-37a-incident.json
   ```

   Preview is not an eligibility guarantee; the RPC revalidates under lock.
   Preparation sends nothing. Require the same base UUID/key, sequential parts,
   all pending/no SID, unchanged original-response hash, and per-part lengths
   and hashes matching preview. Do not infer the part count from 1,889 alone.
6. Verify the preserved historical evidence and reopened state:

   ```sql
   SELECT id, processing_completed_at, processing_outcome,
          processing_owner, processing_lease_until,
          metadata->'recovery_historical_reopen' AS preserved_history
   FROM public.messages
   WHERE id = 'b97863b2-611c-4ffc-91d0-13202cbfb298';
   ```

   Completion/owner/lease must be NULL, outcome `reconciliation`, and preserved
   history must contain the original timestamp and evidence. Keep the same
   input for any identical preparation repeat; it must not change rows.
7. Only with separate send approval, configure the existing CLI's secret-managed
   `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`. Add a verified
   recent real `window_inbound_sid` for the same sender/customer to the input.
   The CLI checks Twilio and the canonical inbound window before each send.
   If no permitted window exists, stop; no template or automatic retry is used.

   ```bash
   node scripts/ticket-37a-recovery.js send-next /secure/ticket-37a-incident.json --execute
   node scripts/ticket-37a-recovery.js verify /secure/ticket-37a-incident.json
   ```

   Each call sends at most one exact prepared body to real Twilio. Check durable
   SID/acceptance before repeating for the next part. Accepted parts are not
   resent. After the final part, require all expected indices accepted with
   evidence and a new inbound completion timestamp; preserved history remains.
   Use the main runbook's read-only per-part SQL and no-send `complete` command
   if only the final completion write needs retrying.

Any guard failure, hash/timestamp mismatch, unknown/failed send, pending send
claim, or lost persistence means **stop and reconcile**. Do not manually clear
timestamps, claims, statuses or delete rows. A preparation failure rolls back;
after commit use inspection, not an ad-hoc rollback. Sending is irreversible.

## Local validation

- Focused SQL/structural tests: 59/59 passed, no skips. Includes the exact
  historical timestamp/IDs with sanitized 1,889-character content, evidence
  retention, FIFO blocking, idempotence after successful completion, rejection
  guards, concurrent-session state and late-insert rollback.
- Ticket 17/28A/36/37 regressions: 39/39 passed, no skips.
- Full suite: 365/365 passed, no skips. The previously reported unrelated
  purchase-page discrepancy no longer fails in the current workspace; this
  follow-up did not change that page or its test.

Changes: recovery SQL source, generator target, new additive migration,
synchronized schema, preflight SQL, regression tests, and runbooks. The original
migration and n8n workflows are unchanged. PostgreSQL tests use local PGlite,
not production or real simultaneous server connections. No deployment, data
mutation in production, or WhatsApp send was performed.
