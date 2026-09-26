# Ticket75D.0A — SQL-Verifiable Approved Reply Binding

## Decision

T75D.0 correctly required an atomic database check before a v2 reply becomes
durable, but incorrectly required PostgreSQL to recompute Ticket68A's
`logical_reply_key`. That key is a semantic manifest identity: building its
manifest validates Ticket60 context, Ticket65E input, Ticket66 result,
Ticket67 gate, and the Ticket68 eligibility companion. The complete canonical
input does not belong in a bounded reservation RPC payload.

The correction is **Option 1**: a distinct versioned, SQL-verifiable
`reservation_binding`. Ticket68A's `logical_reply_key` stays unchanged. The
new binding is made after Ticket68A approval and deterministic multipart
preparation, and binds only persistence-relevant data.

## Exact Ticket68A identity

`lib/sales-engine-v2/post-gate-delivery-manifest.js` hashes UTF-8 canonical
JSON (object keys lexicographically sorted; arrays retain order) with SHA-256
lowercase hex:

```
eligible_response_binding = pgrsp-SHA256(canonicalJson([
  "post-gate-delivery-response-v1", { context_id, customer_response }
]))
logical_reply_key = lrk-SHA256(canonicalJson([
  "post-gate-delivery-logical-reply-v1",
  [canonical_inbound_message_id.toLowerCase(), eligible_response_binding]
]))
```

`customer_response` contains final Ticket67-cleared `text`,
`composer_result_version`, and `final_gate_version`; final text therefore
participates indirectly. Action results occur in `eligible_turn_binding`, not
this key. Artifact projection occurs in the manifest, not this key. Mode and
diagnostics do not participate. Blocked/indeterminate turns cannot build a
manifest.

## Identity and trust responsibilities

| Identity | Owner | Responsibility |
| --- | --- | --- |
| `logical_reply_key` | Ticket68A | Semantic post-gate manifest identity. |
| `approved_response_digest` | post-gate multipart preparation | SHA-256 of exact UTF-8 Ticket67-cleared text. |
| `reservation_binding` | trusted Node composition | One inbound + approved response + exact parts + artifact persistence identity. |

PostgreSQL can prove closed-payload consistency, claim/session/lease/FIFO,
the exact parts/artifact tuple, and durable conflicts. It cannot rerun
Ticket61/64/67 or independently establish semantic approval. An unkeyed hash
is consistency evidence, not a capability. Therefore future ownership is:

```
Node: Ticket68A -> deterministic multipart preparation -> binding -> RPC
n8n:  transport of the already-reserved returned parts only
```

The future RPC must be executable only by the trusted Node backend role, not
n8n. This is stronger than the former handoff: an n8n principal with RPC access
could construct an otherwise valid unkeyed hash without Ticket68A approval.
T75D.2 will compose this Node-owned call; T75D.1 only implements the DB edge.

## Exact binding grammar

Prototype: `lib/sales-engine-v2/approved-reply-reservation-binding.js`.

```
domain  = ticket-75d0a-approved-reply-reservation-v1
version = ticket-75d0a-reservation-binding-v1
result  = rrb- + SHA-256(UTF-8(preimage)).hex
```

The preimage avoids generic JSON and jsonb formatting differences:

```
string = s + UTF8-byte-length + : + string
null   = z
list   = a + member-count + [ + encoded-members + ]
```

The exact nine-member list is, in order: domain, version, lower-case inbound
UUID, session ID, Ticket68A logical key, eligible-response binding,
approved-response digest, ordered parts (`[index,count,exact body]`), and
artifact projection/null. An artifact is `[id,type,operation,task,ordered
lineage IDs]`. Parts are contiguous one-based indexes and each declares the
array count. No whitespace, Unicode, or newline normalization occurs.

PostgreSQL will implement this grammar with
`octet_length(convert_to(value, 'UTF8'))` and
`encode(digest(convert_to(preimage, 'UTF8'), 'sha256'), 'hex')`. It derives
session ID from the locked inbound row and compares the request value.

This binds both final text digest and physical parts without pretending that
transport-part joining always reconstructs the source text. Provider evidence,
delivery state, and arbitrary metadata are excluded and cannot affect it.

## Artifact and retry behavior

Null artifact is `z`; otherwise exact Ticket68A projection fields and lineage
are bound. T75D.1 will validate the full Ticket17A request, derive the physical
anchor after inserting rows, and persist it in the same transaction. Same
inbound/response/parts/artifact yields the same binding. Any change to inbound,
response digest, part bytes/order/count, or artifact changes it. After an
ambiguous acknowledgement, Node retries the exact prepared request and does
not rerun the model first.

## Alternatives rejected

**Option 2 (signed/MAC capability):** no existing PostgreSQL-verifiable
application signing-key boundary exists; it would add a secret and rotation
authority solely to duplicate Node service-role authorization.

**Option 3 (full canonical Ticket68A manifest input):** it leaks unnecessary
semantic data into SQL, duplicates JS canonicalization/domain validation, and
couples persistence to Ticket61–67 evolution without letting the DB establish
semantic approval.

## Revised T75D.1 payload

The closed versioned request must include the nine inputs above,
`reservation_binding`, and only claim owner plus minimal Ticket17A persistence
fields. SQL recomputes and compares the binding after its locks/claim checks.
It receives no raw context, facts, prompts, model drafts, arbitrary metadata,
delivery/provider evidence, or credentials. It still uses the existing
physical recovery key (`reply:<inbound-SID>:paid` and per-part suffixes), never
repurposing it as Ticket68A's semantic key.

## Cross-runtime proof

`test/ticket-75d0a-approved-reply-reservation-binding.test.js` supplies
deterministic multipart/artifact/null/Spanish-Unicode/newline vectors and
mutation checks. A local PostgreSQL check computes
`encode(digest(convert_to(preimage, 'UTF8'), 'sha256'), 'hex')` for the same
bytes and must equal the Node `rrb-` digest. No production SQL helper, schema,
migration, or reservation RPC is created by this correction.
