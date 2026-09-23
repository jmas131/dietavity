# Ticket 65 — Deterministic ResponsePlan Builder

`buildResponsePlan` accepts only a validated `ConversationContext`, ordered `Obligation[]`, matching terminal `ResolvedObligation[]`, required `SemanticGuidanceGate[]`, and the ordered authoritative `AuthorizedAction[]` projection from Ticket 62. It performs no reads and no interpretation.

The resulting `ResponsePlan` contains only the minimum composer contract: context ID and locale; obligation order; structured coverage; canonical facts; deterministic policy outcomes; cleared guidance; bounded uncertainties; clarification and deferred requirements; actions; and explicit prohibited claims. It deliberately excludes raw context, resolved obligations, and the former `permitted_reasoning` placeholder, so blocked or indeterminate guidance cannot enter composer-readable expressive material.

Guidance is permitted only for a matching cleared Ticket 64 gate. Blocked guidance becomes `withhold_safety`; indeterminate guidance becomes `withhold_indeterminate` plus `guidance_gate_indeterminate`. Resolver failures and unresolved support are represented as bounded unavailable handling. Deferred conversational, support, social, and practical stages remain explicit and do not acquire authority.

The central schema conditionally couples permitted-guidance authority to source type and requires non-empty reviewed references for reviewed guidance. The executable validator additionally verifies each reviewed guidance unit's reference IDs belong to that entry's reviewed-reference array; JSON Schema cannot safely express that sibling-array membership relationship without non-portable global logic.

`schedule_reminder` actions retain the exact validated `scheduled_for` value. Because the existing action contract has no separate action ID, the builder requires the caller-supplied action array to be the exact ordered Ticket 62 projection of per-resolution `action_authorization`; it does not perform fuzzy matching or action synthesis.
