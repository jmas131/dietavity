# Ticket75C.2 — Action Runtime Adapters

## Determination

**READY_FOR_T75C_3.** This ticket adds local, injected runtime adapters for the existing Ticket65D action lifecycle. It does not activate a route, make a production connection, or invoke Stripe.

## Ticket65D RPC boundary

`createSupabaseActionReservationStore({ supabase, workerId, signal })` exposes exactly `reserve`, `succeed`, and `fail`. Each calls the existing private RPC through `supabase.rpc(name, { p })`:

| Store method | RPC | Exact payload additions |
| --- | --- | --- |
| `reserve` | `reserve_authorized_action_execution` | `action_id`, `execution_key`, `action_type`, `worker_id` |
| `succeed` | `complete_authorized_action_execution` | `action_id`, `execution_key`, `worker_id`, bounded succeeded `result` |
| `fail` | `fail_authorized_action_execution` | `action_id`, `execution_key`, `worker_id`, `execution_status` |

The adapter has no query, table, generic RPC, or client-export surface. It passes an AbortSignal when the injected Supabase request supports it, checks it before and after the call, and normalizes client/database detail to a typed unavailable error. Reservation remains the mandatory boundary before any provider operation.

## Checkout boundary and mapping

`createCheckoutProvider({ stripeClient, commercialMappings, signal })` accepts an injected client with only `createCheckoutSession({ price_id, idempotency_key, signal })`. It accepts the already-authorized action plus its canonical `execution_key`; no model or customer input is accepted.

The exact server-owned mapping is keyed by `AuthorizedAction.authorizing_rule` and must contain the matching launch action type and a non-empty configured `price_id`. Missing, unknown, or wrong-type mappings are terminal before Stripe is called. There is no active-offer, only-configured-offer, standard-offer, price-text, or GLP-1 fallback.

The provider key is exactly Ticket65D's `execution_key`. The adapter neither creates a second idempotency identity nor retains raw Stripe output; it returns only the validated `{ kind: 'checkout', url }` destination. Ticket65D's destination validator remains the trust boundary before durable completion.

## Lifecycle and ambiguity

The existing executor still owns Ticket65D state transitions:

| Situation | Result |
| --- | --- |
| New/retry reservation | Invoke the selected provider only after reservation. |
| Existing durable success | Reuse the immutable validated ActionResult; no provider call. |
| Existing lease / terminal reservation | Return its established bounded state; no provider call. |
| Definite invalid/config/request error | Persist a typed terminal/retryable failure using the existing RPC. |
| Rate limit, 5xx, non-ambiguous provider unavailability | Persist `failed_retryable`. |
| Timeout/connection ambiguity | Leave the durable reservation unchanged and return `in_progress`; no blind new checkout. |
| Valid provider result, completion RPC unavailable | Leave the reservation unchanged and return `in_progress`. |

Recovery must use the same `execution_key`. The provider transport must preserve that idempotency key on any later recovery attempt; this ticket does not introduce a second Checkout creation or a new durable lifecycle state.

## Holding page

`createHoldingPageProvider({ destination, signal })` validates a server-owned canonical holding-page destination when composed. It has no network/client dependency and returns only that bounded destination for the holding-page AuthorizedAction. The executor reserves first and completes the existing Ticket65D record only after validation. Missing or altered configuration fails closed.

## Shadow

`createShadowActionExecutor()` accepts only a valid AuthorizedAction and returns its bounded `not_executed` state. It does not reserve, complete, fail, invoke Stripe, or materialize a live destination. Current Ticket68 does not accept `not_executed` as a response-eligible execution result, deliberately preventing fake shadow success. T75C.3 must consume this non-executing state explicitly when it composes shadow behavior.

## Abort, diagnostics, and non-capabilities

Adapters check AbortSignal before and after database/provider operations; expired work is discarded. Raw Supabase/Stripe errors, credentials, provider responses, payment/customer identifiers, and customer channel identifiers are not returned in typed results. Checkout error classification is limited to terminal rejection, retryable rate/provider unavailability, and ambiguous timeout/connection outcomes.

This ticket does **not** wire the claimed-turn endpoint, choose Stripe credentials or product values, call Stripe, reserve outbound delivery, send a message, mark an inbound complete, or implement Ticket75D recovery. T75C.3 remains responsible for live/shadow runtime composition; Ticket37A remains **REQUIRED BEFORE T75D**.
