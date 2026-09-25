# Ticket 65B.1 — Conversational Artifact Output Identity Contract

## Decision

**IMPLEMENTED.** Ticket 17A supports prospective deterministic IDs. Its
`persist_conversation_artifact(jsonb)` accepts `ca-*` and `cgt-*` as supplied
metadata and enforces exact idempotent equality; it does not create either ID
from the persisted anchor or `logical_reply_key`. No Ticket 17A migration or
namespace change is needed.

Ticket 65B.1 therefore establishes identity before composition, while Ticket
68A remains responsible for binding an eligible response to its canonical
logical reply and outbound anchor. This contract does not persist an artifact,
reserve a message, or imply provider acceptance or delivery.

## Contract and authority boundary

`ConversationalArtifactOutputIntent` is an immutable, exact-key,
`ticket-65b1-v1` application contract:

```js
{
  contract_version,
  artifact_id,
  generation_task_id,
  artifact_type,
  generation_operation,
  ordered_lineage_artifact_ids,
  identity_binding
}
```

It contains no output prose, source text, prompt, model/provider/run ID,
clock, delivery state, or persistence result. It is integrity metadata only:

```text
pre-composition identity != generated content
pre-composition identity != persistence
pre-composition identity != delivery
```

## Deterministic derivation

The identity basis is the contract version, `context_id`, lower-cased canonical
inbound message UUID, and the fully typed Ticket 65B task projection:
`obligation_id`, operation, ordered current-turn inputs, ordered current-turn
constraints, and ordered selected source artifact IDs. Source text is excluded.

- `generation_task_id = cgt-` + SHA-256 of the domain-separated
  `conversational-artifact-generation-task-v1` basis.
- `artifact_id = ca-` + SHA-256 of domain-separated
  `conversational-artifact-output-v1` and that generation task ID.
- `identity_binding = caob-` + SHA-256 of domain-separated
  `conversational-artifact-output-binding-v1`, the complete basis, and both
  IDs.

Consequently, model/composer retries, Ticket 67 reassessment, n8n execution
IDs, model run IDs, and provider/Twilio IDs do not affect identity. A different
canonical inbound message, task specification, operation, obligation, or
ordered lineage does.

## Operations and lineage

| Operation | Output intent | Artifact type | Lineage |
| --- | --- | --- | --- |
| `draft` | yes | `draft` | exact empty Ticket 17A lineage |
| `transform` | yes | `draft` | one selected source, in order |
| `summarize` | yes | `summary` | all selected sources, in order |
| `show` | no | n/a | no new artifact |

The validator preserves Ticket 17A's current source-ID syntax, enforces source
order, rejects duplicates, malformed IDs, self-lineage, and operation/type
mismatches. A generated output has a canonical hash suffix, but an existing
Ticket 17A source can retain its valid broader `ca-*` syntax.

## Lifecycle placement

Ticket 68 derives intents immediately after the validated `ResponsePlan` has
fully typed each conversational generation task, before artifact safety,
`FinalComposerInput`, Ticket 66 composition, or Ticket 67 assessment. Ticket
66 and Ticket 67 do not receive or mutate the intent; the model prompt sees no
persistence IDs.

For an eligible Ticket 68 result, the exact immutable intents are retained in a
private in-memory companion (`artifactOutputIntentCompanion(result)`). They are
not a `TurnResult` field and cannot appear on ineligible results. This makes a
future Ticket 68A handoff possible without granting customer-language,
persistence, or delivery authority today.

## Identity relationships and non-goals

`generation_task_id` identifies the typed producing task; `artifact_id`
identifies its intended Ticket 17A artifact. Neither is a canonical message
UUID or `logical_reply_key`. Ticket 68A must later bind the already established
intent to an eligible logical reply/anchor inside its separately designed
reservation transaction.

This ticket does not implement Ticket 68A, derive identities from prose,
create artifacts, alter Ticket 17A persistence semantics, reserve/send
messages, or claim semantic correctness, safety clearance, persistence, or
delivery. Ticket 17A still permits only one artifact per logical reply/anchor;
if a future eligible response contains multiple producing tasks, Ticket 68A
must explicitly reject or provide a compatible persistence design before any
write.
