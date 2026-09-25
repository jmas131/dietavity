# Ticket 65E.1 — Withholding customer-expression semantics

Ticket 65E.1 completes the customer-expression boundary for three mandatory
coverage outcomes that intentionally omit their underlying material:

- `guidance_cannot_be_provided_safely`
- `requested_content_cannot_be_reproduced`
- `requested_content_cannot_be_reproduced_now`

Each uses the closed `ticket-65e1-v1` withholding-expression contract. The
directive and exact allowed/prohibited claim arrays are canonicalized by the
Ticket 65E builder and enforced again by its standalone validator and central
schema. No customer-facing prose, withheld guidance, artifact body, gate
finding, raw safety status, assessment detail, or policy reason crosses this
boundary.

Withholding semantics authorize only communication of the bounded inability to
provide/reproduce content in the current response. They do not explain the
cause and do not establish permanent or future capability.

`blocked` ≠ `indeterminate`: blocked permits only the current-response
reproduction boundary; indeterminate is separately expressed as unavailable
*now* and never asserts that content was unsafe, false, noncompliant, or
permanently unavailable. Absence of withheld content is deliberate and must
never be reconstructed.

These semantics establish no product/provider fact, diagnosis, medication
advice, action authorization, execution, delivery, escalation, retry, or
future availability. Ticket 65E.1 changes neither Ticket 64/64A decisions nor
the practical-guidance, commercial, or policy lifecycles. It supplies only the
missing bounded authority needed for a future Composer to cover these outcomes.

The schema validates the closed expression shape and exact
directive-to-claims mapping. The executable validator additionally determines
which outcome variant requires which directive; upstream gate matching and the
deliberate omission of artifact bodies remain Ticket 65E builder invariants.
