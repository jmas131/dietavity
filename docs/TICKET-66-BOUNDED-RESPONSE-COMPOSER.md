# Ticket 66 — Bounded Response Composer

Ticket 66 accepts only a validated `FinalComposerInput` (`ticket-65e-v1`) and
fixed composition instructions. It does not receive conversation context,
customer text, history, obligations, plans, gates, actions, execution/provider
output, fact stores, reviewed knowledge, or unrestricted artifacts.

**Composer fluency is not authority.** The injected model may choose concise,
warm `es-MX` wording, structure, and transitions. It cannot establish facts,
safety, policy, authorization, execution, delivery, product/provider
capabilities, or future behavior.

## Bounded model protocol

The adapter receives a deterministic projection of `FinalComposerInput` and a
fixed system prompt. Provenance IDs are omitted as non-linguistic audit data.
All variable values—facts, guidance, artifacts, constraints, URLs, and
Ticket65E.1 customer expressions—are data, never instructions. Embedded
prompt injection cannot change Composer authority.

The model returns one ordered non-empty text segment per obligation. Ticket 66
derives coverage from this exact alignment; it does not trust model-declared
coverage or destination evidence. It returns a closed `ComposerResult` with
context/locale, concatenated candidate text, derived coverage, exact expressed
destination references, and bounded composer provenance.

## Local deterministic checks

Ticket 66 validates the input before adapter invocation, preserves the input
unchanged, enforces the zero-or-one question budget, permits questions only in
clarification segments, and rejects URLs unless they are the exact eligible
destination for that obligation. It derives each destination reference from
the validated FinalComposerInput, preserving obligation ID, action ID, kind,
and URL. It does not call a provider or claim payment, execution, delivery,
receipt, or opening.

Ticket65E.1 withholding directives are semantic instructions, never literal
customer strings. They permit only the narrow current-response boundary:
guidance cannot be provided safely, content cannot be reproduced, or content
cannot be reproduced now. Blocked and indeterminate remain distinct. Withheld
guidance/artifact bodies, reasons, findings, diagnoses, escalation, retries,
and permanent/future capability claims are absent and must not be restored.

Known adapter/model unavailability becomes a closed `ComposerFailure` with
`COMPOSER_MODEL_UNAVAILABLE` and no raw exception detail. Malformed model
output fails closed as `COMPOSER_MODEL_OUTPUT_INVALID`; unexpected programming
errors propagate.

## Ticket 67 boundary

Ticket66 does not make generated language trustworthy merely because it was
produced from a trustworthy semantic envelope. Ticket67 remains the final
customer-response safety/truth/action gate.

The schema and Ticket 66 runtime validate shape, identity, segment alignment,
question budget, and exact URL evidence. They cannot soundly prove arbitrary
Spanish text semantically entails only supplied facts/guidance, does not add a
medical or product claim, or asks the exact intended clarification without
re-resolving authority or adding an unbounded judge. Those generated-language
checks are intentionally deferred to Ticket 67. The Composer result is a
candidate and is not customer-visible authority on its own.
