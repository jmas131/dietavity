# Ticket75D.1 — Atomic V2 Reply Reservation

T75D.1 adds `database/migrations/20260926_ticket_75d1_atomic_v2_reply_reservation.sql` and the synchronized `public.reserve_v2_approved_logical_reply(jsonb)` snapshot. The RPC accepts only the closed `ticket-75d1-v1` payload prepared after Ticket68A, independently verifies the exact UTF-8 response digest and the T75D.0A reservation binding, then uses Ticket17's session advisory lock, inbound row lock, owner/lease/FIFO checks, and sibling lock.

The function derives `reply:<inbound provider SID>:paid`, writes ordered pending Ticket37A-compatible rows atomically, preserves the exact approved source in `assistant_response` for every part, and stores recovery hashes. It calls Ticket17A's sole artifact persistence boundary inside the same transaction; an artifact failure rolls back every inserted part. Exact replays return the reserved group; changes to source, binding, parts, metadata identity, or artifact conflict fail closed.

`lib/sales-engine-v2/approved-reply-reservation-adapter.js` is the sole Node-side adapter. It validates the closed request and calls the RPC. It has no Twilio, workflow, provider, or completion behavior. n8n remains transport-only for returned reserved rows.

The migration is forward-only, has no production action, and grants execution only to `service_role`; it grants no table mutation.

## Ticket75D.2 composition closure

For a configured **live** claimed turn, `claimed-turn-composition` builds the Ticket68A manifest, uses the existing WhatsApp formatter to prepare explicit physical parts, builds the existing closed D.0A/D.0B request, and invokes the narrow Node reservation adapter. Semantic `response_eligible` remains a Ticket68 result; `delivery.reservation` is a separate durable handoff and is present only after the RPC returns `reserved_new` or `reserved_existing`.

The exact Ticket67-cleared response is passed unchanged as `approved_response_text`; physical parts never reconstruct or replace it. An unavailable reservation retains the prepared immutable request by invocation identity for an exact retry and does not authorize transport, fallback prose, or semantic regeneration. Shadow and ineligible turns never call reservation. The handoff is deliberately bounded to reservation state, physical logical key, and RPC-returned ordered `{ id, body, idempotency_key, part_index, part_count }` rows. T75E alone will make an inactive n8n artifact consume those already-reserved rows for transport.
