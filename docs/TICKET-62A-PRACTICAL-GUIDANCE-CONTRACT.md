# Ticket 62A — Practical Guidance Contract Completion

## Completed contract gaps

Before this ticket, `practical_guidance` was only a deferred category: it had no closed task semantics, no typed customer material available to a future bounded-reasoning stage, and no terminal structured guidance payload. Ticket 62 therefore correctly deferred it but Ticket 63 could not safely consume it.

This ticket changes only contracts and validators. It adds no knowledge corpus, retrieval, model interface, generation, response plan, semantic gate implementation, workflow, database, or production integration.

## Practical task and bounded inputs

Every `practical_guidance` obligation now requires:

```js
practical_task: {
  task_kind: 'knowledge_question' | 'transformation' | 'organization',
  bounded_inputs: [{ id: 'bi-1', input_type, value, origin: 'current_turn' }]
}
```

`knowledge_question` is for substantive reviewed-information needs, such as food-storage safety or nutrition education. `transformation` and `organization` are limited to restructuring current-turn supplied material and require at least one bounded input. The closed input vocabulary is `meal_name`, `ingredient`, `preparation_step`, `meal_component`, `schedule_constraint`, `time_constraint`, and `user_preference`; arbitrary text fragments are intentionally excluded.

Ticket 61 validates every bounded value as an exact substring of the current customer turn, then deterministically assigns `bi-1`, `bi-2`, and so on across the complete structured obligation output. This prevents a sibling obligation from sharing an input ID. Semantic evidence remains separate in `current_turn_evidence`. History cannot be copied into bounded inputs in this contract.

## Terminal guidance payload

Future terminal practical resolution uses `guidance_payload`:

```js
{
  semantic_safety_validation_required: true,
  units: [{ unit_type, content, reviewed_knowledge_reference_ids? , bounded_input_ids? }]
}
```

Closed unit types are `reviewed_information`, `practical_instruction`, `transformation`, and `organization`. Knowledge-dependent units require reviewed knowledge IDs and cannot carry bounded input IDs. Transformation/organization units require bounded input IDs and cannot carry knowledge IDs. Natural-language `content` is permitted as an explicit future output surface, but `semantic_safety_validation_required: true` makes clear that structural grounding alone cannot prove absence of unsafe medical, product, or policy claims. A later semantic safety gate remains required before production use; this ticket does not implement one.

`source` identifies the terminal resolver/result artifact. `retrieved_knowledge_references` identifies every approved knowledge item used; their IDs must support the knowledge-unit references. This permits one result artifact to cite multiple reviewed items without falsely treating one item as the sole authority.

`normativeResolvedValid` remains context-free: it validates a terminal result's self-contained shape and reviewed-reference membership. Ticket 61 establishes globally unique IDs across the complete `Obligation[]` output. `practicalGuidanceTerminalValid(originatingObligation, terminalResult)` is the required context-aware companion for a future practical resolver: it checks only the supplied originating obligation's valid, unique current-turn bounded inputs, exact ownership of every transformation/organization input ID, the same obligation ID, and the closed mapping `knowledge_question` → reviewed-information/practical-instruction, `transformation` → transformation, `organization` → organization. A sibling-only bounded ID is therefore rejected even when it has valid `bi-N` syntax; the pair validator does not independently re-establish global sibling uniqueness.

## Authority and lifecycle semantics

`llm_reasoning_permitted` means: **an LLM performed substantive reasoning to produce this terminal resolution.** It is `true` only for `generated_guidance`, and `false` for canonical facts, policy, unknown, clarification, failures, direct reviewed knowledge, and deferred routing. It does not mean a deferred result itself may be passed to a model.

Terminal direct reviewed knowledge is `resolved` / `reviewed_knowledge`, uses reviewed-knowledge source provenance, has `llm_reasoning_permitted: false`, and requires a guidance payload plus reviewed references. Generated guidance is `resolved` / `generated_guidance`, uses bounded-reasoning generated provenance with model-run ID, has `llm_reasoning_permitted: true`, and has a guidance payload. Knowledge-dependent generated units also require supplied reviewed references. A missing future knowledge result remains `unknown` / `bounded_unknown` / source null; operational knowledge/model failure remains `failed` / `resolver_failure` / source null.

Ticket 62 continues to return `deferred` / `authority:null` / `next_stage:reviewed_knowledge_or_reasoning` for practical guidance, with no terminal payload. A future stage replaces it with the same obligation ID.

## Validator architecture and boundaries

`lib/sales-engine-v2/resolved-obligation-validator.js` is a shared executable mirror of every normative `ResolvedObligation` variant, including reviewed and generated guidance. Ticket 62 continues to use its narrower validator: it accepts only Ticket 62’s authority/stage subset and rejects terminal knowledge/guidance fields. This preserves the distinction between the normative contract and a specific stage producer.

Ticket 61 only emits semantics and bounded customer inputs. Direct medication requests stay `medication_management`; a provider capability question stays `provider_service_fact`; a supplied-dinners cooking-order task may be `practical_guidance` / `organization`. Neither Ticket 61 nor Ticket 62 establishes knowledge truth, generated safety, product truth, policy, or action authority.
