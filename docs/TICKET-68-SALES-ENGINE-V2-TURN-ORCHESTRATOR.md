# Ticket 68 — Sales Engine v2 turn orchestrator

`runSalesEngineV2Turn` is the application-level coordinator for one canonical
`ConversationContext`. **Ticket68 coordinates existing authorities; it creates
none.** It validates context, calls the interpreter, Ticket 62 resolution,
Ticket 63/63A/64/64B practical-guidance lifecycle, Ticket 65 planning, Ticket
64A reproduction gates, Ticket 65D action execution, Ticket 65E input building,
Ticket 66 composition, and Ticket 67 final assessment in that order.

The dependencies are injected: interpreter, fact and policy resolvers, reviewed
knowledge store, bounded reasoning, semantic/reproduction/final assessors,
action executor (or Ticket 65D's reservation/provider adapters), and composer.
Run IDs and `asOf` are explicit `runContext` inputs. No network, clocks, random
IDs, or raw customer-text decisions are introduced by the coordinator.

Deferred practical guidance is terminally resolved before planning. The exact
reviewed item selected by Ticket 63 is captured for its Ticket 63A binding;
generated and reviewed guidance are gated by Ticket 64. Conversational draft
needs no reproduction gate; show, transform, and summarize receive Ticket 64A
before the Ticket 65E builder can include artifact material. Support and social
deferred states remain the existing bounded ResponsePlan semantics.

Authorized launch actions execute in ResponsePlan order before FinalComposerInput.
Their Ticket 59B IDs and Ticket 65D reservation/execution contracts are passed
through unchanged. Reminder actions are never executed by this launch path.
Tickets 59B, 62, and 65 do not establish a one-action upper bound: Ticket 62
rejects duplicate commercial subjects, but Ticket 65 intentionally preserves
distinct authorized actions. Ticket 68 therefore explicitly supports at most
one launch-executable action per turn. If more than one reaches the plan, it
returns a bounded planning failure before any executor or provider call.
Only canonical FinalComposerInput reaches Ticket 66, and Ticket 67 receives the
same input plus the exact Ticket 66 result. A response is exposed only after
`customerResponseEligible` returns true.

Failures produce a closed, prose-free `TurnResult`; unexpected programming
errors propagate. The result contains only bounded stage status and action
summaries. Replays preserve supplied context, run IDs, stage outputs, and durable
action identity; durable retry behavior remains the responsibility of Ticket 65D
adapters.

`response_eligible` means eligible for downstream delivery, not delivered.
This module does not call Twilio, persist a message, or claim provider acceptance
or handset delivery. It performs no Ticket 17A artifact or logical-reply
persistence. Ticket 66 provenance is available to the later canonical
outbound-persistence layer only after that layer has persisted the logical reply.
