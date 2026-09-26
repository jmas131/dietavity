# Ticket75C.1 — Hardened Model Runtime Adapters

`hardened-model-runtime.js` is an injected transport boundary: a configured client exposes only `complete`, and receives a stage, configured model identifier, server-owned instruction version/prompt, bounded input, AbortSignal, and attempt number. It has no credentials, facts, policy, action, delivery, or database API. Six narrow callback adapters map to the existing Ticket68 injection names.

Existing domain code remains authoritative for all semantic output validation: Ticket61 interpreter validator, Ticket63 guidance validation, Ticket64/64A assessor validators, Ticket66 candidate validation, and Ticket67 final-gate validation. Transport structured success is never enough. Model failures are redacted into typed availability/deadline errors; only 429, 5xx, reset, and timeout failures get a bounded same-stage retry.

The executable discovery correction is implemented: Ticket63/64/64A/67 preserve synchronous fake behavior but accept Promise-returning adapters; Ticket68 awaits them. Ticket66 similarly accepts a Promise composer adapter and Ticket68 awaits it, while retaining FinalComposerInput-only candidate validation and provenance. Model-run IDs remain caller-owned invocation/stage identities; transport attempts do not alter them.

No provider client, credentials, model name, endpoint wiring, action runtime, or external call is checked in. T75C.2 supplies actions; T75C.3 supplies endpoint composition and per-invocation AbortSignal/run-ID construction.
