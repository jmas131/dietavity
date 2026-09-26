# Ticket 75A — secure claimed-turn runtime

## Decision

Ticket75A adds a disabled-by-default internal Express endpoint: `POST /internal/sales-engine-v2/claimed-turn`. It validates an already-claimed Ticket17 capability and terminates in a non-executing `runtime_not_configured` stub. It does not read or write the database, invoke Ticket68, execute Ticket65D, call Stripe/Twilio, reserve an outbound reply, alter a lease/completion/recovery state, or route customer traffic.

## Authentication and trust boundary

The selected mechanism is an asymmetric **RS256 JWT service assertion** in an `Authorization: Bearer` header. The service accepts only a configured issuer, audience `dietavity.sales-engine-v2.claimed-turn`, `RS256`, configured `kid`/public key/client identity, expiry, not-before, and bounded `jti`. A replay guard consumes `(issuer, client_id, jti)` through expiry before any route or claim work. Tokens carry no customer content and no request body/query credential is accepted.

This is smaller and safer for the current repository than mTLS: Express currently sits behind nginx/PM2, no repository nginx mTLS trust boundary or n8n client-certificate configuration exists, and forwarded client-certificate headers would be unsafe without an independently verified proxy boundary. n8n can later use a managed private signing credential; Node receives only rotating public keys keyed by `kid`. T75E/T75G must establish protected private-key storage/rotation, a shared atomic replay store for multi-process operation, network restriction, active-key overlap/revocation, and the actual n8n credential configuration. The in-memory guard is test/single-process only and is not activation-ready for a horizontally scaled service.

## Contract and routing

`ticket-75-claimed-turn-v1` accepts only UUID canonical inbound ID; bounded opaque session/owner/claim/workflow IDs; exact ISO timestamp; and requested `live|shadow` mode. Unknown fields and message/history/profile/fact/policy/knowledge/action/provider fields are rejected. Server configuration chooses route state `disabled|shadow|live` and generation; request mode must exactly equal the non-disabled state. Default is `disabled`, with no customer-text or percentage routing.

The future invocation identity is SHA-256 of canonical inbound UUID, processing owner, and server route generation. It does not use customer text. Response schemas distinguish future `eligible` delivery packages from bounded `ineligible` responses. T75A returns only ineligible responses with correlation ID, inbound ID, owner, failure stage/code and retry class; never customer prose.

## Claim/deadline/logging

T75B supplies the injected verifier. It must establish canonical inbound existence/direction/session/owner/lease validity/not-complete/no-conflicting-reply. Its absence fails closed. A configurable deadline produces an AbortSignal and `deadline_exceeded`; the production value is intentionally unset pending T75G timeout evidence. Downstream reservation/transport budget is deliberately not implemented here.

Errors are closed and machine-readable: `unauthenticated`, `forbidden_route`, `malformed_request`, claim errors, `context_invalid`, lifecycle/reservation errors, `deadline_exceeded`, `internal_unclassified`, and `runtime_not_configured`. Retry classes are `none`, `transient_same_identity`, `ambiguous_no_blind_retry`, and `operator_required`; none authorizes regeneration. Bounded structured logs include turn/pseudonymous correlation, mode, stage, code, retry class and latency, excluding prose, history, phones, tokens, payloads and secrets.

## Ticket37A finding

The existing Ticket37A failure is **schema synchronization drift**: `test/ticket-37a-logical-reply-recovery.test.js` expects the canonical recovery-function source from `test-support/ticket-37a/recovery-functions.js` as a literal substring of `database/schema.sql`, but the snapshot's pg_dump-style function formatting differs. The migration/source still contains the expected recovery-function behavior and related tests pass. T75A does not change it. Because T75D will alter `database/schema.sql`, resolving or explicitly updating this synchronization contract is a required prerequisite before T75D.
