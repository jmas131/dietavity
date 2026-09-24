# Ticket 61C — Bounded Customer Generation Inputs

Ticket 61C extends the v2 Interpreter contract only. It selects explicit bounded conversational material for a later generation stage; it does not generate customer prose, persist artifacts, resolve facts or policy, establish safety, or authorize actions.

## Contract

A `conversational_task` obligation carries `conversational_task`:

```js
{
  operation: 'draft' | 'transform' | 'summarize' | 'show',
  artifact_ids: ['ca-...'],
  current_turn_constraints: [{ value: 'más corto', origin: 'current_turn' }],
  current_turn_inputs: [{ input_type: 'draft_specification', value: 'un mensaje para mi hermana', origin: 'current_turn' }]
}
```

`draft` has no artifact IDs and requires at least one `draft_specification` current-turn input. `transform` and `show` require exactly one; `summarize` requires one or more. IDs are references only: artifact bodies stay in the validated Ticket 60A `ConversationContext` and are not copied into an obligation. Constraint text and draft-input values must be exact current-message substrings and receive an explicit `current_turn` origin. Evidence that an obligation exists (`current_turn_evidence`) is not a permitted generation payload: downstream generation consumes only the explicit bounded inputs, constraints, and artifact references.

The Interpreter may select only IDs present in the supplied lineage-closed `conversation_artifacts` collection. It cannot use ordinary history, legacy/untyped outputs, or artifacts omitted by Ticket 60A bounds. An unclear referent must become a clarification obligation. JSON Schema expresses the closed operation and cardinality vocabulary; executable validation enforces membership in the particular `ConversationContext`.

Artifacts remain bounded conversational data. Their selection does not establish product or provider truth, deterministic policy, safety, commercial/action authorization, delivery, execution, or factual correctness. `show` is reuse/display selection only and creates no action authorization or persistence requirement.
