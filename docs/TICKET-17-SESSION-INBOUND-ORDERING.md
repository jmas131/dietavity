# Ticket 17 — Per-session WhatsApp inbound ordering

## Root cause

The repository contains no production n8n execution records, so it cannot prove
the two execution IDs or inspect their node timings. The production timestamps
and the executable workflow nevertheless establish the failure mechanism:

1. `Reserve Canonical Inbound Message` deduplicated only the same logical
   inbound key (`inbound:<Twilio Message SID>`).
2. Distinct SIDs from the same WhatsApp session both inserted successfully and
   immediately continued to user lookup, conversation-state reads, AI work,
   deterministic policy, outbound reservation, and Twilio.
3. There was no per-session lock, lease, ordered claim, queue, sequence, or
   advisory-lock mechanism on that path. The workflow settings also contained
   no execution configuration that serialized by session.
4. Therefore both executions could read the same prior `onboarding_sessions`
   state and `onboarding_chat_memory` before either execution persisted its
   response/state. Model or branch latency then determined which execution
   reached outbound reservation and Twilio first.

For the observed fixture, the price branch completed before the illustrative
example branch. The semantic interpretation of each message was individually
correct; the inversion occurred because independent executions reached
outbound reservation/send in completion order rather than inbound reservation
order. Without the production execution records, the repository cannot narrow
the latency difference to a specific OpenAI call versus deterministic response
construction, but neither outbound reservation nor Twilio had an ordering gate
that could correct an earlier latency inversion.

The race covered every branch downstream of the shared inbound trigger:
ordinary sales, purchase-confirmation/Checkout, requested reminders, paid-user
assistant traffic, media clarification, and legacy cancellation.

## Selected mechanism

Ticket 17 uses PostgreSQL-native serialization in the canonical `messages`
ledger.

- The inbound reservation transaction takes a transaction-scoped advisory lock
  derived from `session_id` and assigns `processing_order` from a PostgreSQL
  sequence. The lock exists only while reserving; it never spans model or
  provider calls.
- The next execution atomically claims only the lowest unfinished
  `processing_order` for that session with a 15-minute lease.
- A busy same-session execution waits five seconds and retries. A different
  session hashes to a different advisory-lock key and claims independently.
- A worker may drain the next queued message for its session. All downstream
  nodes consume `Claim Next Session Inbound`, not that execution's raw trigger,
  so crash recovery and burst draining cannot process the wrong body or SID.
- Every inbound customer-outbound reservation renews and verifies the current
  lease owner before inserting. Existing provider-SID and outbound logical-key
  uniqueness remain independent and unchanged.

The ordering source of truth is canonical database reservation order, recorded
as `processing_order`. `provider_event_timestamp` is retained only as safe
diagnostic metadata because the actual Twilio trigger payload may omit it and it
is not a safe unique tie-breaker. `processing_order`, then canonical message
`id`, provides deterministic ties. n8n execution IDs are lease-owner metadata,
never provider or message-order identifiers.

### Alternatives

- **PostgreSQL (selected):** already deployed, coordinates separate n8n
  processes, provides durable queued rows, atomic claims, leases, and recovery,
  and preserves per-session rather than global concurrency.
- **n8n-native execution concurrency:** the current artifact has no such
  setting. n8n's production concurrency control limits production executions
  globally; it does not key FIFO ordering by `session_id`, so it would either
  fail to order a session or unnecessarily serialize different customers.
- **Redis/external queue:** not required. PostgreSQL and the canonical ledger
  provide the needed durability and coordination without another service,
  operational failure mode, or deployment dependency.

## Safe completion boundary

Normal work advances the session only after the branch reaches all of these:

1. the final customer-visible body is reserved in `messages` with the correct
   `in_reply_to_id`;
2. Twilio returns the current architecture's accepted/scheduled outcome and the
   delivery row is updated;
3. branch-dependent state persistence completes (sales question/context and
   funnel events, Checkout sent evidence, reminder state and confirmation,
   paid-user state, media log, or legacy-cancellation result);
4. no linked outbound remains `pending` when the inbound is marked complete.

The workflow does not wait for final WhatsApp `delivered` status.

If an execution fails before reserving an outbound, the error handler releases
the claim back to the queue. If an outbound reservation already exists, its
unique key prevents blind resend; the inbound reaches a durable
`reconciliation` outcome and commercial question/Checkout context is cleared
fail-closed before later messages proceed. A hard process failure that cannot
run the error workflow is recovered after lease expiry with the same rules.

## Twilio acknowledgement

The workflow uses `n8n-nodes-base.twilioTrigger`. The node declares
`responseMode: 'onReceived'`, so n8n acknowledges the Event Streams webhook
when the event is accepted, before downstream processing. The five-second
contention wait therefore does not hold the Twilio request open or induce
provider retries. See the official
[Twilio Trigger implementation](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Twilio/TwilioTrigger.node.ts)
and [n8n concurrency control documentation](https://docs.n8n.io/hosting/scaling/concurrency-control/).

## State and memory scope

The claim sits before the known/unknown-user split, so it covers Sales Engine,
paid-user assistant, and active legacy-cancellation routing. Sales policy reads
and writes occur only for the current claimed inbound. The Postgres chat-memory
session key and paid-user prompt now consume the claimed canonical row, so
`onboarding_chat_memory` follows processing order while remaining context-only.
The `messages` ledger remains authoritative.

Reminder scheduling and its confirmation both finish before completion.
Checkout keeps its existing deterministic authorization and Stripe/Twilio
idempotency. A stale ambiguous claim clears commercial context rather than
allowing a short affirmation to inherit potentially stale purchase state.

## Performance and observability

Same-session bursts are serialized. Different sessions remain concurrent.
Advisory locks are held only for short reservation/claim transactions, not AI
or provider latency. Only contended executions poll, at five-second intervals.

Safe metadata records `queued`, `processing`, `completed`, or
`reconciliation`, claim time/owner, and stale recovery time. It does not add
message bodies to logs or introduce a new observability system.

## Deployment boundary

Repository preparation does not deploy or activate anything. A later authorized
production change should:

1. take a database backup and run the Ticket 17 migration;
2. import the inactive generated Sales Engine and updated Global Error Handler;
3. validate credentials and node compatibility on the self-hosted n8n version;
4. run an isolated two-session smoke test and inspect canonical linkage/status;
5. only then publish/activate the workflows under explicit production
   authorization.

The migration must precede the workflow because the generated workflow depends
on the new sequence and processing columns.
