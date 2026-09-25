# Ticket 68A — Post-Gate Delivery Manifest Contract

## Purpose and position

Ticket 68A creates a deterministic, private-application companion for every
Ticket 68 `response_eligible` result:

```text
ConversationContext → Ticket 68 → Ticket 67 cleared eligibility
  → PostGateDeliveryManifest → future reservation boundary → future transport
```

It is not a composer, gate, authorization, execution result, reservation,
transport instruction, receipt, retry decision, or delivery record.
Eligibility permits a future persistence boundary to reserve exactly the
eligible response; the manifest adds integrity metadata only.

The initial Ticket 68A attempt stopped because Ticket 68 had no typed identity
for a newly generated artifact. Ticket 65B.1 closes that gap before composition
with a deterministic `ConversationalArtifactOutputIntent`. Ticket 68A consumes
that intent; it never derives artifact metadata from customer prose.

## Uniform contract

Every eligible result receives one deeply frozen `ticket-68a-v1` manifest:

```text
{
  contract_version, context_id, canonical_inbound_message_id,
  conversation_context_binding, final_composer_input_binding,
  composer_result_binding, ticket67_candidate_binding, final_gate_binding,
  eligible_response_binding, eligible_turn_binding, logical_reply_key,
  artifact_projection
}
```

`artifact_projection` is `null` for ordinary replies and `show`. For one
Ticket 65B.1 producing intent it has exactly `{ artifact_id, artifact_type,
generation_operation, generation_task_id, ordered_lineage_artifact_ids }`.
It contains no generated or source-artifact text. The projection is compatible
with Ticket 17A; the future transaction supplies the canonical anchor UUID.

Ticket 17A currently permits one artifact per logical reply/anchor. Therefore
zero intents maps to `null`, one maps to the projection, and more than one
throws `POST_GATE_DELIVERY_MANIFEST_MULTIPLE_ARTIFACT_INTENTS`. It never picks,
merges, or silently drops intents.

## Private companion and eligibility proof

Ticket 68 stores an eligible-only in-memory `WeakMap` companion, not a
serialized TurnResult field. It contains cloned/deep-frozen validated
ConversationContext, FinalComposerInput, ComposerResult, FinalCustomerResponse
Gate, and Ticket 65B.1 intents. Accessors return clones.

`buildPostGateDeliveryManifest({ turnResult })` retrieves only that companion.
It revalidates context, composer input/result, gate shape, and
`customerResponseEligible(...)`; then it verifies the exact public eligible
TurnResult text and versions against the companion. A copied/fabricated result,
blocked or indeterminate gate, altered candidate, altered response, missing
companion, or mismatch cannot create a manifest.

No model receives persistence metadata.

## Bindings and logical reply identity

Bindings use canonical JSON (sorted object keys; preserved array order) and
domain-separated SHA-256. Prefixes identify the bound object:

- `pgctx-`: ConversationContext
- `pgfci-`: FinalComposerInput
- `pgcr-`: ComposerResult
- `pgfg-`: cleared Ticket 67 gate
- `pgrsp-`: exact TurnResult customer-response projection
- `pgturn-`: exact eligible TurnResult

The manifest also carries the existing Ticket 67 `{ version, digest }`
candidate binding, recomputed and verified rather than replaced. The response
text itself is never copied; its exact bytes influence both response and turn
bindings.

`logical_reply_key` is `lrk-<sha256>` over the canonical inbound UUID and exact
eligible-response binding. It is stable across retries, provider/Twilio or
workflow attempts, and composer model-run IDs when the final eligible response
is unchanged. It is not an artifact ID, generation task ID, canonical message
UUID, reservation, or delivery state.

## Immutability, minimization, and failure

The builder derives every digest, logical key, and projection internally and
returns a deeply frozen value. Runtime validation and the central schema use
closed exact-key shapes. The manifest excludes customer prose, raw messages or
history, source-artifact text, prompts, assessor evidence, drafts, provider
data/errors, credentials, fact/policy/knowledge payloads, acceptance/delivery
state, retries, and promises.

Any malformed or mismatched source/manifest fails deterministically. It does
not send, persist, reserve, retry, or produce fallback wording.

## Future Ticket 69 boundary

Ticket 68A performs no database or transport work. A future persistence
transaction must: validate the eligible TurnResult and manifest; re-check all
bindings; independently verify canonical inbound/session lease ownership;
reserve the exact response with `logical_reply_key`; assign/reuse canonical
outbound message UUIDs; persist the Ticket 17A projection against that anchor
in the same transaction when present; and only then expose persisted content to
transport. That future work remains Ticket 69 integration, not this ticket.

Non-goals include n8n changes, migrations, outbound reservation, Twilio,
Stripe, production access, and any new conversational, factual, policy,
safety, action, execution, persistence, or delivery authority.
