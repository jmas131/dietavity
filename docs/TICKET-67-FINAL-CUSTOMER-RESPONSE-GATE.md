# Ticket 67 — Final Customer Response Gate

Ticket 67 is the final semantic safety/truth/action gate for a Ticket 66
candidate response. **Final prose must not create authority that did not exist
before composition.** It accepts only a validated `FinalComposerInput` and a
matching validated `ComposerResult`; it does not receive conversation context,
customer text/history, plans, actions, executor/provider output, fact stores,
reviewed knowledge, or workflow state.

## Assessment and isolation

An injected semantic assessor receives a bounded projection of the semantic
envelope plus the exact candidate text, coverage, and destination evidence.
Outcome `source` provenance and composer model provenance are excluded because
they are audit data, not linguistic authority. All remaining supplied values,
including artifacts, facts, guidance, expressions, destinations, and candidate
text, are data and cannot override fixed instructions.

The closed, versioned taxonomy covers unsupported product/commercial/guidance
claims, medical content, action/payment/delivery/future claims, uncertainty,
withholding/support/clarification drift, destination claims, reconstruction,
authority escalation, and other semantic risk. Runtime maps every finding to
`blocking`; the assessor cannot set severity or gate status. No findings clear;
one or more findings block. The normalized unavailable assessor failure yields
`indeterminate`; malformed completed output fails closed as a validation error,
and programming errors propagate.

The complete response is assessed against the complete envelope: an outcome
may authorize a compatible claim anywhere in the response, but no combination
can broaden authority. Ticket 67 never rewrites a candidate or fabricates a
fallback.

## Exact binding and eligibility

The gate binds SHA-256 to Ticket 66 version, context, locale, response text,
coverage, destination evidence, and composer model provenance. Changes to any
of those values invalidate a clearance. `customerResponseEligible()` returns
true only when the input/result/gate contracts validate, context matches, the
gate is `cleared`, and the exact binding recomputes.

A cleared Ticket 67 gate means the assessed candidate is semantically faithful
to the supplied authoritative envelope. It does not establish new product
truth, medical truth, execution, delivery, or action authority. Sending,
fallback behavior, and persistence remain orchestration responsibilities.
