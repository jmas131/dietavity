# Ticket75F.2 — Deterministic Cohort Controls

The generated inactive workflow selects a route once after Ticket17 acquisition. `SALES_ENGINE_V2_CONTROL` defaults to `disabled`; `legacy` also produces legacy behavior. Only canonical inbound UUIDs in the explicitly configured shadow/live cohort variables can select `v2_shadow` or `v2_live`. There is no percentage or random routing. `SALES_ENGINE_V2_ROUTE_GENERATION` is carried with the claim and sent to Node.

Node validates mode, route generation, and configured canonical cohort after claim verification before semantic work. A changed configuration applies only to a new claim; the already-selected route object is passed through the execution. Shadow continues through legacy with no v2 transport. Live retains the existing no-fallback durable handoff path.

F.2 adds no production cohort, secret, n8n remote change, or activation. F.1 diagnostics remain best effort and observational; their failure cannot alter routing, response, action, reservation, transport, completion, or recovery. The generated workflow has detached record-only branches for route selection, the shadow structural projection, live durable-reservation handoff, provider acceptance, and completion. Each calls only `record_v2_lifecycle_diagnostic` with the F.1 closed event shape and uses n8n's continue-on-error behavior; no recorder has an outgoing business connection.

The shadow branch projects only response eligibility, closed stage-status pairs, and the bounded action projection. It records `reservation_projection.state = not_executed`. It deliberately carries neither Node response text nor a legacy response. The workflow therefore provides correlation evidence for a later operational comparison, but does not assert equality between the v2 obligation/gate taxonomy and legacy buyer-signal/strategy taxonomy: those dimensions remain explicitly non-comparable unless a reviewed mapping is approved.

T75G still requires approved retention/access controls, managed RS256 signing and shared replay storage, network restriction, timeout/lease verification, production topology confirmation, shadow/canary drills, and activation authorization.
