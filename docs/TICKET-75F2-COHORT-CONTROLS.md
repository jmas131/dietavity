# Ticket75F.2 — Deterministic Cohort Controls

The generated inactive workflow selects a route once after Ticket17 acquisition. `SALES_ENGINE_V2_CONTROL` defaults to `disabled`; `legacy` also produces legacy behavior. Only canonical inbound UUIDs in the explicitly configured shadow/live cohort variables can select `v2_shadow` or `v2_live`. There is no percentage or random routing. `SALES_ENGINE_V2_ROUTE_GENERATION` is carried with the claim and sent to Node.

Node validates mode, route generation, and configured canonical cohort after claim verification before semantic work. A changed configuration applies only to a new claim; the already-selected route object is passed through the execution. Shadow continues through legacy with no v2 transport. Live retains the existing no-fallback durable handoff path.

F.2 adds no production cohort, secret, n8n remote change, or activation. F.1 diagnostics remain best effort and observational; their failure cannot alter routing, response, action, reservation, transport, completion, or recovery. Shadow comparison remains structural only: stage/gate/action/eligibility projections may be correlated, while response prose and incomparable legacy/v2 taxonomies are deliberately not equated.

T75G still requires approved retention/access controls, managed RS256 signing and shared replay storage, network restriction, timeout/lease verification, production topology confirmation, shadow/canary drills, and activation authorization.
