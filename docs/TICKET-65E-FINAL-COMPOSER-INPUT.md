# Ticket 65E — Final Composer Input

`FinalComposerInput` (`ticket-65e-v1`) is the immutable, deterministic
semantic envelope for the future Ticket 66 Composer. It is built from a
validated final `ResponsePlan`, Ticket 64A reproduction gates, and the bounded
Ticket 65D execution-result envelope. The Composer receives this contract only;
it does not receive conversation history, current customer text, obligations,
resolutions, gates, actions, action results, provider output, or executor state.

Each `obligation_outcomes` entry is in canonical obligation order and has one
closed primary outcome. Canonical facts retain their authoritative payload and
provenance. Cleared practical guidance retains only its already-cleared bounded
payload. Uncertainty reasons remain distinct, and clarification remains bounded
by `question_budget`.

For conversational tasks, drafts carry only validated current-turn inputs and
constraints. Show, transform, and summarize require an exact Ticket 64A
`gateMatches` binding. Cleared tasks include only their selected artifact text;
blocked and indeterminate tasks carry an explicit reproduction safety outcome
and no artifact body.

Ticket 59 policy decisions are converted by a closed, versioned mapping
(`ticket-65e-policy-v1`) into directives such as clinician referral and
reminder scheduling unavailable. Raw policy decisions and reason codes never
cross the boundary. `support_unresolved` becomes the closed
`support_request_unresolved` directive: it means only that this customer
request remains unresolved, not that support, account capability, escalation,
or future resolution is unavailable. `social_acknowledgement` is likewise a
closed non-substantive directive; neither contains raw customer text or permits
the Composer to invent support status, actions, or facts.

Commercial entries use the Ticket 65C.1 expression for exactly one currently
matching launch action. A destination is included only for a succeeded,
validated Ticket 65D customer result and only where the expression explicitly
permits it. `unavailable_now` never asserts product/provider unavailability,
execution cause, permanence, timing, delivery, or a future destination.

The executable builder enforces cross-stage alignment: exact reproduction-gate
binding, closed policy mapping, commercial action/result alignment, and one
outcome per obligation. The standalone validator uses that same closed,
versioned policy-expression definition to enforce exact directives and exact
ordered allowed/prohibited claims, alongside final shape, order, versions, and
the locally checkable commercial destination rule. JSON
Schema mirrors structural shape; it cannot independently reconstruct upstream
gates, actions, or policy inputs, which are intentionally absent from this
Composer boundary.
