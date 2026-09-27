# Ticket75G.3A — Durable assertion replay and runtime assembly

`20260927_ticket_75g3a_assertion_replay.sql` adds the backend-only
`public.sales_engine_v2_assertion_replays` table plus two fixed-search-path
`SECURITY DEFINER` functions:

- `consume_sales_engine_v2_assertion_replay(jsonb)` accepts only the closed
  `ticket-75g3a-v1` tuple `{ issuer, client_id, jti, expires_at }`. It stores
  no JWT, assertion body, customer data, or business data. Its primary key
  makes concurrent consumes across PM2 workers and hosts atomic: one result is
  `consumed`; all later identical tuples return `replayed`.
- `cleanup_sales_engine_v2_assertion_replays()` is an explicit backend/operator
  lifecycle operation. It deletes only rows whose assertion expiry has passed.
  Authentication never depends on cleanup succeeding.

The replay table has RLS and FORCE RLS, no direct public/client/service table
access, and service-role-only execution for the two RPCs. The Node adapter
turns any RPC ambiguity into a bounded unavailable error; production assembly
never selects Ticket75A's in-memory test guard.

`production-runtime-config.js` is a closed environment parser. It defaults to
`disabled`; an enabled shadow configuration requires an opaque route generation,
nonempty UUID allowlist, issuer, exact Ticket75A audience, `kid`→public-key and
client map, 1–120 second deadline, pseudonymization key, all six configured
model identifiers, an explicit `supabase_service_role` backend adapter, enabled
durable diagnostics, and explicit durable replay mode. Invalid values return the
disabled fail-closed handler and are never reported with their supplied values.

`production-runtime.js` composes injected Supabase canonical readers, Ticket75B
claim/input adapters, Ticket75C hardened model adapters, shadow no-op action
executor, Ticket75F best-effort diagnostics, exact route authorization, and the
durable replay adapter. It deliberately constructs only the shadow-safe path.
Live assembly, response scrubbing/error continuation, n8n RS256 signing, and a
production workflow merge remain outside this ticket. `server.js` mounts this
assembly seam but supplies no model client itself, so a normal deployment stays
disabled until a controlled deployment injects the audited adapters.

No secret, key, configured URL, or cohort identity belongs in source, logs, or
workflow artifacts. The replay cleanup cadence and diagnostic retention remain
operator-approved production controls.
