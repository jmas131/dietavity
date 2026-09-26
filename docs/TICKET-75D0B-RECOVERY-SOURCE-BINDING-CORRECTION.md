# Ticket75D.0B — Recovery-Source Binding Contract Correction

## Determination

**RECOVERY_SOURCE_CONTRACT_CORRECTED_READY_FOR_T75D_1.** Ticket75D.0A bound
the final approved-response digest but omitted the exact source text required
by Ticket37A recovery. The correction adds one closed request field:
`approved_response_text`.

## Exact recovery requirement

Ticket37A's `prepare_whatsapp_reply_recovery(jsonb)` selects the base outbound
row and computes:

```
encode(sha256(convert_to(base.assistant_response, 'UTF8')), 'hex')
```

It requires a nonempty `assistant_response`, compares this source hash with
its request evidence, and preserves that exact source on every multipart row.
`claim_whatsapp_reply_recovery_part(jsonb)` repeats the same UTF-8 SHA-256
check for every physical part. Recovery uses persisted rows for transport and
integrity/reconciliation; it does not regenerate semantics. No trimming,
Unicode normalization, newline normalization, or whitespace rewriting occurs.
The existing representation stores the same full source in every physical row,
while `body` holds each individual transport part.

## Canonical source provenance

The sole source is Ticket68's response-eligible
`turnResult.customer_response.text`: Ticket66 composes it, Ticket67 clears its
candidate semantics, Ticket68 records it only when `status` is
`response_eligible`, and Ticket68A validates that same result before producing
the manifest. The future closed reservation request calls this value
`approved_response_text`; it is not a composer draft, context/history field,
or reconstructed transport value.

## Digest and binding chain

`approvedResponseDigest` in
`lib/sales-engine-v2/approved-reply-reservation-binding.js` is exactly:

```
SHA-256(UTF-8(approved_response_text)).hex
```

There is no JSON encoding, trim, newline conversion, Unicode conversion, or
multipart reconstruction. The binding remains **unchanged**:

```
Ticket67-cleared exact text
  -> SHA-256 UTF-8 approved_response_digest
  -> existing reservation_binding input
  -> rrb-SHA-256 persistence identity
```

SQL independently verifies text-to-digest before inserting. It then
independently recomputes the existing binding from that digest and the bounded
parts/artifact tuple. Thus text, digest, and parts cannot be substituted
independently, while physical part concatenation is never treated as semantic
source reconstruction.

## Future T75D.1 request and persistence rule

The versioned request adds only `approved_response_text` to the Ticket75D.0A
closed shape. Before any lock-protected insert, SQL must require a nonempty
string; calculate `encode(sha256(convert_to(text, 'UTF8')), 'hex')`; require
equality with `approved_response_digest`; and reject mismatch. It persists
the exact verified text, unchanged, as `assistant_response` on each reserved
multipart row. Physical `body` remains the separately bound exact part.

This minimal addition is necessary because the customer-facing text is already
required in the canonical outbound/recovery representation. It adds no
history, prompts, drafts, authority, profile, provider evidence, or arbitrary
metadata.

## Evidence

The T75D.0B tests prove ASCII, Spanish accents, emoji, CR/LF, spaces,
punctuation, and other multibyte text hash exact UTF-8 bytes; a single text,
space, or newline mutation changes the digest. They also prove a hypothetical
multipart recovery fixture has the same verified source/hash on every row and
that physical parts need not concatenate to the approved response. The
reservation-input builder accepts only Ticket68A-eligible results and emits a
closed request with the exact source field.

Disposable loopback PostgreSQL uses the same
`encode(sha256(convert_to(value, 'UTF8')), 'hex')` expression. T75D.1 must
retain that expression and add migration-level parity coverage.

The repository proof ran against disposable PostgreSQL **18.6**, bound only to
`127.0.0.1`, with ASCII, accents, emoji, LF, CRLF, leading/trailing and
multiple spaces, punctuation, and multibyte vectors. Each Node digest matched
the SQL bytea digest; text/space/newline mutations did not.
