# Ticket 34: verified WhatsApp recovery diagnosis

No production behavior change is recommended. The current Ticket 28A recovery
path is already eventually consistent for a transient failure in `Find Verified
WhatsApp Sessions`: the query is read-only, runs every minute, and executes
before Ticket 17 claims or any customer-visible side effect. A failed lookup
therefore leaves the verified canonical inbound eligible for the next successful
run.

This repository review does not deploy, import, activate, migrate, or change any
production system.

## Inspected sources

- `scripts/refactor-ticket-10-workflow.js`, the generator for the current Sales
  Engine artifact.
- `n8n/Dietavity Sales Engine (Ticket 10).json`, especially `Resume Verified
  WhatsApp Requests`, `Find Verified WhatsApp Sessions`, `Claim Next Session
  Inbound`, `Reserve Paid Assistant Reply`, and `Mark Session Inbound Complete`.
- `database/migrations/20260827_ticket_28a_pending_whatsapp_linking.sql` and the
  matching definitions in `database/schema.sql`.
- `lib/session-ordering.js` and
  `database/migrations/20260818_ticket_17_session_inbound_ordering.sql`.
- `n8n/Global Error Handler.json` and the Ticket 9, 13, 17, and 28A regression
  tests.

## Exact trigger, cadence, and query

`Resume Verified WhatsApp Requests` is an n8n Schedule Trigger with a one-minute
interval. It is a recovery wake-up inside the canonical Sales Engine workflow,
not the normal Twilio inbound path and not the Global Error Handler. It invokes
`Find Verified WhatsApp Sessions`, whose output goes directly to `Claim Next
Session Inbound`.

The generated workflow currently contains this query:

```sql
SELECT DISTINCT message.session_id
FROM public.messages AS message
JOIN public.users AS app_user ON app_user.whatsapp_id = message.session_id
WHERE message.direction = 'inbound'
  AND message.processing_order IS NOT NULL
  AND message.processing_completed_at IS NULL
  AND message.metadata->>'identity_verification_purpose' = 'link_whatsapp'
  AND message.metadata->>'identity_verification_state' = 'verified'
ORDER BY message.session_id;
```

There is no node retry/backoff configuration: `retryOnFail`, `maxTries`, and
`waitBetweenTries` are absent, and the Postgres node options are empty. The next
scheduled execution is the retry boundary, so recovery normally retries within
one minute after connectivity returns. Runs can overlap if an earlier execution
is still active, but Ticket 17 serializes and leases the session work.

## Failure and recovery trace

When verification succeeds, `redeem_portal_recovery` links the verified user and
updates matching canonical inbound rows. It sets `user_id`, clears
`processing_owner` and `processing_lease_until`, explicitly keeps
`processing_completed_at` null, clears `processing_outcome`, and changes only
the verification state from `pending` to `verified` (while adding the verification
timestamp).

If the subsequent finder query cannot connect, it performs no mutation. The
message remains in `public.messages`, is still verified, and is still unfinished.
The next successful finder query selects its session again. Consequently, one
transient lookup failure cannot permanently strand the original message. It can
remain pending indefinitely only while every later recovery lookup also fails or
the workflow is inactive/misconfigured; those are continuing operational
failures, not loss of queue state.

After discovery, `Claim Next Session Inbound` takes a Postgres advisory lock,
chooses the earliest unfinished row by `processing_order, id`, and grants a
15-minute owner lease. Every paid reply reservation must renew that exact owned
claim. Its deterministic key is `reply:<Twilio inbound SID>:paid`, protected by
the partial unique index on `messages.idempotency_key`; only the execution that
inserts the reservation may call Twilio. An overlapping schedule therefore
cannot produce a second paid-assistant reply for the same inbound. If a lease
expires after an outbound is durable, Ticket 17 marks the inbound as
`reconciliation` instead of sending blindly again.

## Failure classification

| Observed failure | Classification | Reason |
| --- | --- | --- |
| `getaddrinfo EAI_AGAIN aws-0-us-east-2.pooler.supabase.com` | A: transient DNS/network failure | Name resolution temporarily failed before SQL execution. |
| `Connection timed out 3.139.14.59:6543` | B: Supabase pooler connection failure | The TCP connection to the resolved Supabase pooler address/port timed out. It is not evidence of a Postgres statement timeout. |

The supplied evidence does not show C (query timeout), D (workflow defect), or E
(credential/configuration failure). Persistent authentication, permission, or
host-name failures would require reclassification; the four intermittent events
alone do not support it.

## Retry options

| Option | Assessment |
| --- | --- |
| A — no runtime change | Recommended. The next one-minute execution is a bounded, durable-queue retry and preserves current failure visibility. Expected added latency after service recovery is less than one schedule interval, plus normal processing time. |
| B — n8n node retry | Not recommended now. Standard node retry is not restricted to transient connection errors, so it would also retry syntax, missing-relation, invalid-column, and permission failures contrary to the ticket's fail-fast requirement. |
| C — workflow-level retry | Technically allows explicit error classification, but adds branches and state to an already safe recovery loop for little latency benefit. Reconsider only if measured one-minute latency is unacceptable. |
| D — infrastructure/DNS change | Not supported by repository evidence. Investigate host DNS/pooler telemetry first if failures become sustained or widespread. |

If operational requirements later justify Option C, use at most three total
attempts (initial plus two retries), delays of 5 and 15 seconds, and retry only
`EAI_AGAIN`, `ECONNRESET`, `ETIMEDOUT`, `connection timed out`, or an explicitly
identified temporary connection failure. Syntax errors, missing relations,
permission errors, invalid columns, and other SQL/configuration defects must fail
immediately. Worst-case retry delay would be 20 seconds plus the duration of the
three connection attempts. The retry must remain before `Claim Next Session
Inbound`; moving it after claiming would need a new duplicate-side-effect review.

## Error handling and indexing

The Sales Engine declares `n8n/Global Error Handler.json` by its workflow ID. A
terminal finder failure therefore invokes the handler, which independently
attempts to insert `global_workflow_error` into `public.logs` and send an email.
The database log is durable when that insert succeeds. It is not guaranteed
during the same Supabase connectivity outage because it uses Postgres too; the
independent email branch remains the secondary alert path. With no internal node
retries there is one handler invocation per failed scheduled execution. No alert
suppression or deduplication change is warranted from the supplied four events.

The lookup can use the existing pending inbound queue index for queue narrowing
and the indexed/unique `users.whatsapp_id` lookup, although the JSON metadata
predicates are not separately indexed. At one execution per minute and without
an `EXPLAIN (ANALYZE, BUFFERS)` or observed query-load evidence, a new metadata
index would be speculative and is intentionally not added.

## Deployment conclusion

No migration is required. No n8n workflow re-import is required. The only added
artifact is regression/documentation coverage of the existing recovery contract,
so there are no production steps for Ticket 34. If future telemetry supports
workflow-level retry, that should be a separate reviewed generator change,
followed by regeneration, full tests, controlled inactive import, and explicit
activation authorization.
