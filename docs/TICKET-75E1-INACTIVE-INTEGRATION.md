# Ticket75E.1 — Inactive Generated v2 Integration

`scripts/refactor-ticket-10-workflow.js` is the only authority for the Ticket10 workflow. It generates an inactive post-acquisition seam between `Route Session Claim State` (acquired) and `Get User from Supabase`; the busy output remains `Wait Before Session Claim Retry → Claim Next Session Inbound` without reaching either v2 or legacy work.

## Claim-lifetime route

`Route Sales Engine V2 Claim` reads `SALES_ENGINE_V2_ROUTE` exactly once for an acquired claim. The default is `legacy`; only `legacy`, `v2_shadow`, and `v2_live` are accepted. There is no random or percentage routing. A future deterministic allowlist/canary can set the configuration before a claim is routed, but must not change the selected route for that claim.

- `legacy`: makes no Node request and enters the existing legacy path unchanged.
- `v2_shadow`: makes one `shadow` request, discards its result, then enters the legacy path. It cannot use a v2 reservation or transport a v2 response.
- `v2_live`: makes one `live` request. It either validates the durable handoff and enters the transport loop, or fails through existing workflow error/recovery handling. It never falls through to legacy.

## Internal request and authentication seam

Both calls use `POST /internal/sales-engine-v2/claimed-turn` and send only the Ticket75A capability fields: `contract_version`, `canonical_inbound_message_id`, `session_id`, `processing_owner`, `claimed_lease_until`, `claim_attempt_id`, `mode`, and `workflow_execution_id`. They are read from the acquired canonical claim and workflow execution; no inbound body, contact identifier, profile/history, policy, provider payload, or credential is placed in the request body.

The generated HTTP nodes reference only the placeholder `httpHeaderAuth` credential identity for an n8n-managed short-lived RS256 service assertion. They contain no private key, token, issuer, client configuration, or timeout claim. Activation must provide managed assertion signing and rotation; this ticket deliberately does not weaken Ticket75A authentication or assert an unverified timeout/lease envelope.

## Live handoff and failure boundary

Node owns semantic eligibility, the exact Ticket67-cleared approved text, deterministic physical preparation, and atomic reservation. n8n accepts a live result only when it is eligible, belongs to the acquired inbound and owner, has state `reserved_new` or `reserved_existing`, and supplies a nonempty, complete ordered multipart group with unique IDs and physical idempotency keys. It preserves only `id`, `body`, `idempotency_key`, `part_index`, and `part_count`.

n8n never reads `delivery.text` for transport and never splits, rewrites, reconstructs, or reserves a v2 reply. Validated rows go directly to `Loop Paid WhatsApp Parts`, then the established provider send/evidence, reconciliation, last-assistant-message, and completion predicates. A timeout, ambiguous outcome, malformed handoff, reservation failure, or invalid claim has no legacy fallback, generated customer text, local reservation, or premature inbound completion. Retry/ambiguity ownership remains Node/PostgreSQL's existing exact reservation identity; n8n makes only its one bounded invocation attempt.

T75F/G must add activation diagnostics/replay controls and freshly verify endpoint network restriction, shared replay storage, credential rotation, timeout/lease compatibility, and deployed topology before any activation.
