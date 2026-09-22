# Ticket 37 — WhatsApp message-length handling and controlled recovery

> Superseded operational guidance: Ticket 37A now supplies the atomic recovery
> operation and fixes multipart completion in normal, stale, and error paths.
> Use `docs/TICKET-37A-ATOMIC-RECOVERY.md` for all deployment and recovery actions.
> The procedure below records the original design, not an executable recovery.
> In particular, Ticket 37A requires re-importing the Global Error Handler.

## Result and transport boundary

The final paid-assistant body is produced by `Parse Assistant Response` for AI
answers or `Build Deterministic Customer Response` for deterministic answers.
Both now converge on `Prepare Paid WhatsApp Message Parts`, before
`Reserve Paid Assistant Reply` and before Twilio. The formatter therefore sees
the fully rendered customer-visible text, and Twilio only receives canonical
reserved `messages.body` values.

The application safe limit is **1,500 UTF-16 code units per part**. Twilio's
documented outgoing `Body` limit is 1,600 characters and error `21617` means
that limit was exceeded. The 100-character margin covers deterministic part
labels and is conservative for emoji and other astral characters, which
JavaScript counts as two UTF-16 code units. This does not increase or attempt
to work around the provider limit.

At or below 1,500, the response is returned unchanged. Above 1,500, the
formatter normalizes CRLF to LF, collapses repeated spaces/tabs within each
line, trims line edges, reduces three or more newlines to two, and trims the
whole response. If that is then safe, it sends the compacted single body. If
not, it splits without truncation, preferring paragraph, line, sentence,
semicolon/colon, comma, then word boundaries; only an indivisible span uses a
hard character boundary. Parts are labeled `Parte i/n`, and every labeled part
is checked against 1,500 before it can be returned.

## Canonical multipart design

One database statement renews the Ticket 17 lease and reserves every part. All
rows retain the same `in_reply_to_id`. Part 1 reuses the historical logical key
`reply:<inbound SID>:paid`; subsequent parts use
`reply:<inbound SID>:paid:part:002`, `:003`, and so on. The existing partial
unique index on `messages.idempotency_key` makes the keys retry-safe. The SQL
returns rows in `part_index` order, and only returned reservations reach the
existing Twilio node. A later-part failure therefore cannot cause an accepted
earlier part to be reserved or sent again.

Each row's `body` is exactly its final customer-visible part. Its
`assistant_response` retains the complete logical response for paid-assistant
memory without copying that content into metadata. Metadata contains:

- `original_character_count`
- `final_character_count` (sum of final transmitted part lengths, including
  labels)
- `was_compacted`
- `was_split`
- `part_count`
- `part_index`
- `logical_reply_key`

The Ticket 36 delivery update runs for every part. The paid assertion evaluates
all returned rows. `Mark Session Inbound Complete` retains its negative check:
it can complete only when no linked outbound remains outside
`accepted`/`scheduled`/`sent`/`delivered`. A failed or unknown part leaves the
inbound unresolved in reconciliation, blocks FIFO advancement, and reaches the
existing Global Error Handler. Successful compaction/splitting is ordinary
processing and produces no fatal error.

Twilio `21617` is explicitly extracted even from n8n's string-valued continued
error and classified `failed`. It is deterministic and non-retryable. Other
HTTP 4xx responses remain failed; 5xx, timeouts, no-SID results, and unfamiliar
error strings remain `unknown`. Explicit `failed`, `undelivered`, or `canceled`
still outranks a SID, preserving Ticket 36.

## Controlled recovery for the existing incident

Nothing in this change automatically resends or mutates the production
incident. The ticket states that Twilio rejected it with `21617` and that no
outbound SID was persisted, so the stored reservation—not a rerun of the AI
path—is the recovery source.

1. Keep the Sales Engine paused for this one inbound and preserve the failed
   n8n execution. Run `database/preflight-ticket-37.sql` through the trusted
   backend connection. Verify the exact base idempotency key, outbound and
   inbound IDs, `failed`/`unknown` status, absent provider SID, body length and
   hash, `stored_reply_available`, and unresolved inbound state.
2. Search Twilio's narrow incident window one final time by sender, recipient,
   timestamp, and body hash/length evidence. A second operator must confirm
   there is no accepted/queued/sending/sent/delivered Message resource. If one
   exists or evidence is ambiguous, reconcile or leave unresolved; do not send.
3. In a reviewed transaction, lock the exact inbound and base outbound rows
   with `FOR UPDATE`. Recheck their IDs, key, absent SID, unresolved inbound,
   and deterministic `21617` evidence. Retrieve the stored
   `assistant_response` under the existing protected backend access.
4. Run that stored response through the deployed Ticket 37 formatter. Do not
   call OpenAI and do not create a semantically different response. If the
   stored response is absent, stop: regeneration requires a separately reviewed
   decision and written explanation because the original answer cannot be
   reused.
5. Reuse the existing base row for part 1 by replacing its rejected oversized
   `body` with the formatter's first final part, clearing only obsolete
   provider-attempt fields needed for the reviewed resend, setting it to
   `pending`, and merging the length/part metadata. Insert parts 2..n with the
   deterministic suffix keys, same `in_reply_to_id`, logical response, message
   kind, and metadata. The unique index must remain the conflict authority.
   Commit only if the complete part set is present exactly once.
6. A reviewed recovery execution selects only `pending` rows for that exact
   logical reply in `part_index` order, sends each canonical `body` once, and
   immediately applies the normal Ticket 36 response normalization and delivery
   update. It must never select an already accepted part.
7. If any later part fails or is unknown, stop with accepted earlier parts
   untouched; keep the inbound unresolved and alert open. Resume only with
   verified provider evidence and only the still-unresolved canonical row.
8. Complete the inbound only after every part has durable acceptance evidence.
   Confirm the next Ticket 17 item then becomes claimable in FIFO order.

Repository evidence cannot read production state, so it cannot assert today
that `stored_reply_available` is true. The pre-incident reservation SQL wrote
the same generated answer to both `body` and `assistant_response`, so the
original reply is expected to be reusable unless production evidence shows the
row is incomplete. Regeneration is not the default recovery path.

## Deployment boundary

No migration is required: the existing one-to-many `in_reply_to_id` relation,
JSON metadata, and unique idempotency index support multipart replies. Import
the regenerated inactive Sales Engine, bind its existing credentials, and run
sandbox cases for unchanged, compacted, multipart, later-part failure, `21617`,
unknown response, and FIFO completion before controlled activation. The Global
Error Handler was not changed and does not require re-import. Production
incident recovery is a separate, two-person reviewed operation after adoption;
this repository change does not perform it.
