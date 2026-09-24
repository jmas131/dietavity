# Ticket 65C.1 — Commercial Execution Expression Semantics

Ticket 65C.1 derives a closed, non-generative expression from one Ticket 65C commercial semantic entry, its matching Ticket 65D execution state, and, only on success, its validated Ticket 65D customer action result. It never receives policy reasons, action parameters, provider errors, raw history, or customer text.

The expression is versioned `ticket-65c1-v1` and contains its obligation, commercial intent, stable `action_id`, execution status, next-step status, destination permission, and closed allowed/prohibited semantic claims. It deliberately references the successful destination by `action_id`; it does not copy a URL or become a second execution-evidence object. A future Ticket 65E must align that reference against the same validated `customer_action_results` collection before exposing a destination to a Composer.

`available` is emitted only for `succeeded` with the exact action-type-compatible validated destination. `not_executed`, `in_progress`, `failed_retryable`, and `failed_terminal` each emit only `unavailable_now` with no destination. Here, `unavailable_now` narrowly means that this response cannot supply the requested commercial next step. It says nothing about product, checkout/provider capability, cause, permanence, retry timing, future links, execution, or delivery. In particular, `in_progress` is neither success nor failure, and `not_executed` is not an attempted failure.

Commercial intent remains authorization semantics; execution expression is what may be communicated about the bounded result; neither is execution or delivery proof. No customer prose is produced by this ticket.
