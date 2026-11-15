# V4 outbound reservation reconciliation

`operator_required` means the canonical outbound reservation has no sufficient
delivery proof. It is a FIFO safety hold, not permission to resend.

## Evidence and resolution

1. Read the inbound, every related outbound part, the originating n8n
   execution/error record, and the bounded Twilio audit for the relevant
   sender, recipient, time window, and reserved body. Do not use a customer
   non-response or absent Console delivery status as evidence of non-submission.
2. If Twilio proves API acceptance, use an approved audited backend repair to
   persist the genuine Message SID and accepted status for each affected part.
   Remove only the `operator_required` reconciliation marker as part of that
   same transaction; normal completion then releases FIFO.
3. If Twilio proves non-submission, an approved controlled recovery may clear
   the marker and set the exact existing part to the narrowly supported
   evidence-backed redispatch state. It must retain the original body,
   reservation, idempotency key, and one-send token.
4. If evidence is incomplete or contradictory, leave the marker and FIFO hold
   intact. Escalate; do not resend, complete, supersede, or manually replay.

## Polling behavior

The Recovery Poller excludes a whole session when its earliest incomplete
inbound has `reconciliation_state = operator_required`. Independent sessions
continue normally. After an approved resolution transaction removes that
marker and either completes the head or makes it safely recoverable, its queued
successors become eligible on the next scheduled poll.

## Current limitation

The production workflow has no provider-query credential/node that can look up
a no-SID attempt. Operator resolution therefore requires a separately approved
audited backend repair after Twilio evidence is collected. It deliberately does
not automate ambiguous-delivery retries.
