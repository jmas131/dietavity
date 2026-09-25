# Ticket 72 — Reviewed Nutrition Knowledge Authority

Ticket 72 replaces the fixture-shaped reviewed-knowledge source with a small, versioned local authority and exact Node resolver. It is the authority side of Ticket 63, not a RAG system: there is no vector store, embedding, search, chunking, reranking, LLM selection, document ingestion, or web research.

## Boundary and record contract

The sole repository authority is `config/sales-engine-v2/reviewed-nutrition-knowledge.json`. Its closed `ticket-72-v1` contract contains versioned sets with `knowledge_set_id`, `knowledge_version`, `status`, `locale`, and atomic records. A record has `knowledge_id`, a closed `knowledge_domain` (`nutrition_practical` only), closed `topic`, closed `task_kinds`, closed `applicable_input_types`, exact `content`, and minimal non-authority provenance (`source_class`, `reference`). Product, payment, provider, commercial, action, and medication-management capabilities have no domain, topic, or task-kind representation in this authority.

Structural authority eligibility is not semantic safety of natural-language content. Ticket 72 does not inspect or classify record prose: review is the prerequisite for putting content in the manifest. Ticket 64/64B independently assess the exact resulting guidance before it can be expressed to a customer, including medication-management, product/provider, commercial, diagnosis, and other semantic risks.

Only `reviewed_active` sets resolve. `draft` and `retired` sets are historical but ineligible. There can be only one active set per locale; conflict fails closed. Selection is exact by topic, task kind, typed bounded inputs, locale, and optional pinned knowledge version—never by timestamps, insertion order, raw customer prose, history, or model output. A pinned request against the same manifest is reproducible.

`resolveReviewedKnowledge(authority, { topic, task_kind, bounded_inputs, locale, knowledge_version? })` returns either `resolved` / `reviewed_knowledge` with `{ type, id, version }` provenance, `unknown` / `bounded_unknown`, or throws a closed authority error. The injected authority adapter is used by Ticket 63's existing practical resolver; its legacy store remains only a compatibility fixture, not this authority source.

## Scope and lifecycle integration

The seed deliberately contains only the two already-reviewed Ticket 63 units: `food_storage` and `meal_preparation`, both `es-MX` and `knowledge_question`. No qualifying approved GLP-1 practical-nutrition source exists in the repository, so GLP-1 remains intentionally unresolved. Medication dose/stop/start, prescribing, diagnosis, contraindications, and adverse-event interpretation are excluded and remain deterministic policy/safety work. Product truth remains Ticket 71 canonical fact authority.

For `knowledge_question`, Ticket 63 emits the exact reviewed content as `reviewed_knowledge`. Existing `transformation` and `organization` behavior is retained: their bounded model result is `generated_guidance`, never reviewed authority. The exact selected content is committed by Ticket 63A's assessment binding, then still goes through Ticket 64/64B semantic safety assessment and the Ticket 65/67 composition and final-gate lifecycle.

## Storage and rollout

`database/migrations/20260925_ticket_72_reviewed_nutrition_knowledge_authority.sql` is additive, backend-only, RLS-forced, and grants only service-role access. It has explicit transactional activation and an active-locale uniqueness constraint. The generated SQL seed is tested against the authority manifest. No migration was applied; production installation, runtime wiring, data reconciliation, and privilege verification remain unverified prerequisites. Future semantic retrieval may provide candidates behind this same authority/provenance contract, but must not change authority selection or bypass exact lifecycle checks.
