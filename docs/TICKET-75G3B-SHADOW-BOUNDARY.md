# Ticket75G.3B — Shadow-safe response and legacy continuation

Node returns `ticket-75-shadow-v1` only for an authenticated, parsed shadow
request. Its closed fields are a canonical `invocation_identity`, typed turn ID,
`mode: shadow`, completed/failed outcome, eligibility, bounded stage trace,
closed gate/action projections, `reservation_state: not_executed`, bounded
failure/retry classification, and latency. It never returns a customer or
assistant response, delivery object, full turn result, context, prompt, model
output, destination, provider data, credentials, or arbitrary runtime object.

Classified shadow failures are returned as a bounded HTTP-200 structural result
so n8n can distinguish them from HTTP non-2xx, timeout, network ambiguity, and
malformed responses. n8n treats each of the latter as `transport_ambiguous`; it
does not infer a semantic or model outcome from transport failure.

The generated shadow HTTP node has one attempt and no retry. Its error output
and every result enter `Normalize V2 Shadow Outcome`, which drops the raw HTTP
body, retains only an accepted closed projection, then enters `Get User from
Supabase` exactly once. Diagnostics are a detached branch. Projection or
recorder failure cannot affect that legacy continuation. Live remains separate:
it still has no legacy fallback.

Post-invocation shadow diagnostics use Node's exact Ticket75A SHA-256
`invocation_identity`; the prior locally fabricated `cti-`-shaped route value
was removed. No pre-invocation route diagnostic is emitted until an exact
correlation identity is available.

G.3C still owns managed n8n RS256 signing. G.3D still owns the controlled
three-way merge against the active production workflow.
