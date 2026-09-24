# Ticket 64A — Conversational Artifact Reproduction Safety Gate

Ticket 64A assesses only whether selected bounded conversational material may participate in one `show`, `transform`, or `summarize` operation. It does not establish whether the artifact is true, current, safe medical advice, authorized, executed, delivered, or suitable customer-facing prose.

## Bounded input and binding

The assessor receives only the requested operation, selected `{ artifact_id, text }` pairs, current-turn inputs, current-turn constraints, and locale. It never receives ConversationContext/history, fact or policy stores, actions, execution results, provider data, or policy decisions. All supplied text is structured data and cannot modify the immutable assessor instructions.

Each gate is versioned `ticket-64a-v1` and binds the exact operation, ordered artifact IDs plus SHA-256 text digests, and a SHA-256 digest over ordered current-turn inputs and constraints. `gateMatches()` recomputes those bindings against selected material; an artifact, text, operation, or constraint change cannot reuse a prior clearance.

## Outcomes

`cleared` means only that the exact bound material may later be considered for the exact bound conversational operation. `blocked` has a deterministic blocking finding. `indeterminate` covers an assessor availability failure or a review-required finding. Neither blocked nor indeterminate material may become a reproduction permission.

The injected assessor adapter owns operational-error normalization: timeout, network, model-unavailable, and equivalent transport failures must be thrown with the single code `ARTIFACT_REPRODUCTION_ASSESSOR_UNAVAILABLE`. The gate maps only that code to the bounded unavailable outcome (`indeterminate`, no findings) and never copies exception details. Malformed assessor output remains a validation failure, and unnormalized programming errors deliberately propagate rather than being misrepresented as availability.

The closed finding taxonomy blocks authority crossings such as product/provider, commercial, medical, safety, action/execution, or delivery claims; transformation authority escalation; and prompt injection. It does not check whether a claim happens to be true, repair text, or consult an authority source.

Ticket 65E must consume a cleared gate only after independently matching it to its selected Ticket 65B conversational material. Ticket 64A does not alter Ticket 65B, Ticket 65E, Ticket 66, execution, persistence, or delivery.
