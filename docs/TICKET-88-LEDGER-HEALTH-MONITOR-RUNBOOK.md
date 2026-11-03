# Ticket 88 — Ledger Health Monitor Runbook

The import-ready `Dietavity Ledger Health Monitor` workflow runs every five minutes after it is manually imported and activated. It is independent of the Sales Engine and the WhatsApp Recovery Poller. It only reads `public.messages`; its only database writes are private alert-reservation records in `public.ledger_health_alerts`.

## Alert meaning

- `operator_required`: a FIFO-head inbound is awaiting human/provider-evidence reconciliation. Its later unfinished inbound messages are blocked deliberately.
- `missing_lease_expiration`: a FIFO-head has a processing owner but no lease deadline. This is an invalid state and is alerted immediately.
- `expired_lease`: the FIFO-head lease expired more than five minutes ago and has still not recovered.
- `stale_unclaimed_head`: a FIFO-head inbound has no owner and has been unfinished for at least 20 minutes. This is the 15-minute lease boundary plus one five-minute monitor interval.

The email includes the internal inbound UUID, timestamps, condition age, and affected-session/message counts. It intentionally excludes phone numbers, session identifiers, customer text, and credentials.

## Investigation

In Supabase SQL Editor, use the UUID from the alert and inspect state without selecting message bodies:

```sql
SELECT id, direction, "timestamp", processing_order, processing_owner,
       processing_lease_until, processing_completed_at, processing_outcome,
       metadata->>'reconciliation_state' AS reconciliation_state
FROM public.messages
WHERE id = '<inbound-message-id>'::uuid
   OR (session_id = (SELECT session_id FROM public.messages WHERE id = '<inbound-message-id>'::uuid)
       AND direction = 'inbound')
ORDER BY processing_order, id;
```

In n8n, locate the related Sales Engine or Recovery Poller execution by the timestamps and inspect the failure path. Do not re-run a workflow blindly or clear a lease manually. For `operator_required`, inspect the persisted outbound reservation and provider evidence before any action.

In Twilio Monitor, search for the outbound SID only when the canonical outbound ledger row contains one. A missing SID is not proof that Twilio did not accept a send.

## Alert delivery and retry behavior

An email is reserved for ten minutes before sending. The 60-minute deduplication clock starts only after the email node completes and the workflow records confirmation. If the email node or workflow fails before confirmation, the reservation naturally expires and a later monitor run retries it. Concurrent monitor executions cannot reserve the same alert simultaneously.

## Manual deployment and verification

1. Apply `database/migrations/20261102_ticket_88_ledger_health_monitor.sql` through the normal controlled migration process and verify the schema snapshot matches the deployed schema.
2. Import `n8n/Dietavity Ledger Health Monitor.json`; keep it inactive until configuration review is complete.
3. Bind its placeholder `Dietavity Postgres` credential to the existing backend Postgres credential. The monitor uses the same fixed operations recipient as `Global Error Handler` and production's SMTP credential named `Error`. The canonical Global Error Handler currently serializes a different SMTP credential (`SMTP Hostinger`), so its `Error` credential ID cannot be established from the repository; verify and bind `Error` by name during controlled import.
4. Confirm the workflow error workflow points to `Global Error Handler`; then activate only this new monitor.
5. In a non-production environment, create a controlled stale FIFO head and confirm one privacy-safe email, an entry in `ledger_health_alerts`, no writes to `public.messages`, and no Sales Engine/Recovery Poller invocation. Confirm repeated monitor executions do not email again for 60 minutes.

Ticket 88 does not detect a total n8n/database/email infrastructure outage; that is explicitly outside this Phase 1 monitor's scope.
