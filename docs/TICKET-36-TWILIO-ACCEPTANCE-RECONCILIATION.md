# Ticket 36 — Twilio acceptance reconciliation

## Result

The repository does not contain production n8n execution data, Twilio message
logs, or the production `public.messages` rows. It therefore cannot establish
the actual outbound Twilio response or final delivery state for the incident.
The incident is **E: cannot determine safely** until an operator inspects the
failed n8n execution, the canonical rows, and Twilio. No send, deployment, or
production mutation was performed.

The repository did expose two defects worth fixing:

1. n8n 2.36.8's Twilio node emits `{ error: "..." }` on its continued error
   path. The workflow treated `error` as an object, discarded a string error,
   and persisted `unknown` without the useful transport diagnostic.
2. An explicit Twilio `failed`, `undelivered`, or `canceled` status with a valid
   SID was classified as accepted because the SID branch ran first. Ticket 36
   makes definitive failure authoritative.

Ticket 17 also completed any stale/error inbound merely because an outbound
reservation existed. That allowed `unknown` or `failed` paid work to disappear
from the unfinished queue even though no reply was resolved. Ticket 36 only
completes an error/stale inbound when the linked outbound has durable API
acceptance (`accepted`/`scheduled`) or a later positive callback state
(`sent`/`delivered`). An unresolved outbound stays incomplete with
`processing_outcome = 'reconciliation'`; the existing Global Error Handler logs
and emails the actionable error, and the unique outbound key prevents resend.

## Exact incident-path interpretation

The canonical path is:

`Incoming Message -> Canonicalize Inbound WhatsApp -> Reserve Canonical Inbound Message -> Claim Next Session Inbound -> paid routing/assistant/policy -> Reserve Paid Assistant Reply -> Send All Intents Message -> Update Paid Assistant Reply Delivery -> Assert Paid Assistant Reply Accepted -> Update Last Assistant Message -> Mark Session Inbound Complete`

`reply:SMf79859ae7c0c371d57060f58334c6bce:paid:unknown` means:

- `reply`: outbound logical-reply namespace;
- `SMf79859ae7c0c371d57060f58334c6bce`: the **inbound customer** Message SID,
  read by `Canonicalize Inbound WhatsApp` from the Twilio Trigger event and used
  by `Reserve Paid Assistant Reply` to construct the key;
- `paid`: paid-assistant logical purpose;
- `unknown`: `Update Paid Assistant Reply Delivery` found neither definitive
  failure evidence nor a valid **outbound** Message SID in the send node item.

The SM value printed in this error is not the outbound SID and proves nothing
about outbound acceptance or delivery. `Assert Paid Assistant Reply Accepted`
inspects the canonical row's `delivery_status`, not Twilio's raw `status`.

## n8n/Twilio acceptance contract

The official n8n 2.36.8 Twilio v1 node posts to Twilio's `Messages.json`
endpoint and returns the parsed Twilio response directly. On its continued
error path it returns only `{ error: error.message }`. Thus a normal success is
read correctly from `$json.sid` and `$json.status`; there is no demonstrated
n8n output-wrapper mismatch in this version.

Dietavity `accepted` means the Twilio API created a Message resource and
returned a syntactically valid `SM`/`MM` SID. It does not mean sent or delivered.
For a direct `From` sender, Twilio normally returns `queued`; a Messaging
Service may initially return `accepted`, and later states can include `sending`,
`sent`, `delivered`, `undelivered`, or `failed`. Synchronous status absence or
an unfamiliar status does not negate a valid created Message SID. Conversely,
`failed`, `undelivered`, `canceled`, or a definite HTTP 4xx is failure. A
timeout/5xx/no-SID result is ambiguous and stays `unknown`.

## Canonical evidence still required

Run `database/preflight-ticket-36.sql` through the trusted backend connection.
It returns the exact outbound row and linked inbound fields requested by the
ticket without selecting message bodies or changing state. In the failed n8n
execution, export the complete input/output for `Send All Intents Message` and
`Update Paid Assistant Reply Delivery`. This is the only source for the exact
response received by that execution.

If the outbound row has a provider SID, fetch that exact SID in Twilio. If it
does not, search Twilio Messaging Logs in the narrow execution interval using
direction, sender, recipient, and the canonical outbound body. Do not infer
"no send" from the missing ledger SID: the request may have succeeded while the
response was lost.

Under the pre-Ticket-36 workflow, the Global Error Handler likely set the
linked inbound's `processing_completed_at` and `processing_outcome =
'reconciliation'` immediately after the assertion failed because an outbound
reservation existed. No component automatically queried Twilio or retried that
outbound. The unique key stopped duplicate workflow sends, but the customer's
request could remain permanently unanswered without operator action.

## Duplicate-send proof

`Reserve Paid Assistant Reply` creates
`reply:<inbound Twilio SID>:paid` with `ON CONFLICT DO NOTHING`, backed by the
partial unique index on `messages.idempotency_key`. Only the insert winner
reaches Twilio, and send-node retry is disabled. Ticket 17 also refuses to
reprocess an inbound that already has unresolved outbound evidence. Therefore
rerunning blindly cannot be used as recovery: it either stops at an existing
reservation or risks an out-of-band second send if an operator bypasses the
ledger.

## Safest one-request recovery procedure

1. Pause action on this request; do not rerun or resend it.
2. Preserve the failed n8n execution export and run the read-only Ticket 36
   query. Record the inbound ID, outbound ID, body hash/length, timestamps,
   current status, metadata, and any outbound provider SID.
3. Check Twilio using the exact outbound SID when available. Otherwise search
   the narrow time window and match sender, recipient, and body. Have a second
   operator verify the match before any mutation.
4. Classify the result:
   - **A, delivered/sent:** reconcile the canonical outbound to the verified
     SID/status and complete the linked inbound as reconciliation. Do not send.
   - **B, queued/accepted/sending:** persist the verified SID and acceptance
     state, then allow callbacks/manual follow-up to refine delivery. Do not send.
   - **C, failed/undelivered:** preserve the failed SID/error evidence. A resend
     is allowed only through a reviewed one-off recovery using the existing
     canonical body and outbound ID, followed immediately by SID/status
     reconciliation; never rerun the whole workflow.
   - **D, no Twilio Message resource exists:** after two-person verification,
     perform the same controlled one-off send from the existing canonical row
     and reconcile its returned SID. Do not regenerate the answer.
   - **E, evidence remains ambiguous:** leave the row unresolved, keep the alert
     open, and do not resend.
5. Complete the inbound only after the outbound has verified acceptance or a
   terminal operator disposition. Confirm that no duplicate outbound exists and
   that the next Ticket 17 item, if any, remains in order.

The exact production `UPDATE`/send commands are intentionally not embedded:
they must be generated from the inspected row IDs, current values, and verified
Twilio evidence inside a reviewed transaction. Using placeholders for this
incident would make accidental cross-row mutation more likely.

## Files changed and deployment

- `lib/twilio-delivery.js`: testable response normalization and authoritative
  acceptance/failure SQL.
- `lib/session-ordering.js`: unresolved outbounds stay incomplete and block FIFO
  advancement without being resent.
- `scripts/refactor-ticket-10-workflow.js`: applies the Ticket 36 contract to
  every generated Twilio delivery update.
- `n8n/Dietavity Sales Engine (Ticket 10).json`: regenerated inactive artifact.
- `n8n/Dietavity Stripe Checkout Sandbox.json`: regenerated from its existing
  Ticket 24A generator because it shares the production delivery-update node.
- `n8n/Global Error Handler.json`: completes only durably accepted outbound work.
- `database/preflight-ticket-36.sql`: read-only incident evidence query.
- `test/ticket-36-twilio-acceptance-reconciliation.test.js` and updated Ticket
  17 expectations.

No migration is required. Production adoption requires importing the inactive
Sales Engine and updated Global Error Handler, testing normal queued success,
explicit failure, no-SID ambiguity, and same-session ordering against n8n
2.36.8, then performing the normal controlled activation under separate
authorization. The workflow artifacts remain inactive and nothing was deployed.
