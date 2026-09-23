# Ticket 65A — Pre-Composer Contract Integrity

The shared resolved-obligation source validator now mirrors the central source schema for all six source classes. `generated_guidance` requires bounded-reasoning model provenance; `conversational_generation` requires Composer-stage model provenance; canonical fact, deterministic policy, reviewed knowledge, and system sources reject model metadata.

Interpreter practical-task duplicate identity is evaluated before `bi-N` allocation. It includes normalized task kind and ordered bounded-input semantic content (`input_type`, `value`, `origin`) but excludes allocated IDs. Bounded-input order is preserved because the current practical-task contract represents it as an ordered array. Retained practical obligations continue to receive globally unique `bi-N` IDs, and Ticket 62A ownership validation remains unchanged.

Ticket 65 still rejects terminal `conversational_generation` at the ResponsePlan boundary; this correction only makes the future Composer's normative output valid when that stage exists.
