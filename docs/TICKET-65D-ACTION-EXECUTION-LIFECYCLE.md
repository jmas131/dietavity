# Ticket 65D — Authorized Action Execution Lifecycle

Ticket 65D creates the bounded boundary between a deterministic `AuthorizedAction`, an attempted execution, a typed `ActionResult`, and the future Composer. Authorization is not execution; execution is not delivery.

## Launch inventory and lifecycle

| Action type | Lifecycle | Customer-usable result | Notes |
| --- | --- | --- | --- |
| `provide_checkout_destination` | pre-composition | executed Stripe Checkout destination | The adapter must call the provider only after a durable reservation using the concrete `aek-...` execution key. |
| `provide_holding_page_destination` | pre-composition | configured canonical holding-page destination | The configured URL is validated outside the Composer; it is not generated or inferred. |
| `create_checkout`, `schedule_reminder`, `persist_commercial_transition`, `update_conversation_state` | outside v2 launch execution | none | They are not launch `AuthorizedAction`s. Reminder scheduling remains intentionally unavailable. |

The policy and response-plan contracts may describe a commercial next step before an action executes. They never claim that a destination has been created, sent, or delivered.

## Durable reservation and retry

`authorized_action_executions` is private and RLS-protected. The three service-role RPCs atomically reserve, complete, or record a bounded failure for one `execution_key`. A lease prevents concurrent attempts; a completed result is immutable and is reused on retries. The table stores only action identity/type, reservation state, and a validated bounded success payload—never raw provider responses, exception text, tokens, or workflow state.

The execution key (`aek-...`) is the durable side-effect deduplication key introduced by Ticket 59B. `action_id` (`act-...`) is the logical-action correlation key. A retry after composition or send failure reuses the same reservation/result and must not create a second Checkout Session. A response rejection or delivery failure does not turn a successful execution into delivery evidence.

If provider execution, destination validation, or completion fails, the executor returns only `failed_retryable` or `failed_terminal` with `payload: null`. If another worker holds the active reservation, no execution has failed: the executor returns the separate bounded `in_progress` state, not an ActionResult. The pre-Composer envelope preserves that state without a destination. A future Composer therefore cannot invent a URL or report success.

## ActionResult

`ActionResult` version `ticket-65d-v1` is closed:

```js
{
  action_result_version: 'ticket-65d-v1',
  action_id: 'act-...',
  execution_key: 'aek-...',
  action_type: 'provide_checkout_destination',
  execution_status: 'succeeded',
  provenance: { type: 'authorized_action_execution', version: 'ticket-65d-v1' },
  payload: { destination: { kind: 'checkout', url: 'https://checkout.stripe.com/...' } }
}
```

Only successful launch destination actions carry a payload. Checkout URLs must be Stripe Checkout URLs; the holding-page URL must match the canonical local configuration. ActionResult is evidence that a bounded action execution produced its typed result. It is not authorization, product truth, policy, safety clearance, or delivery evidence.

## Pre-Composer envelope

Ticket 65D chooses an immutable separate envelope rather than mutating `ResponsePlan`. The `PreComposerEnvelope` contains:

- a customer-expressive projection of the plan, stripped of action objects, action parameters, execution keys, policy decisions, and policy provenance;
- successful customer-usable destinations; and
- one bounded execution state for each authorized launch action.

The future Ticket 66 Composer receives that envelope, not raw `AuthorizedAction`, executor/provider output, reservation records, ConversationContext, or workflow state. It may communicate only an already validated customer-usable destination where the response semantics allow it. It must not treat `not_executed`, a failure state, or an authorization as a destination or delivery claim.

## Side-effect ordering

Pre-composition destinations are executed only after Ticket 65 has established commercial semantics and before Ticket 66 needs their result. Any post-send state transition remains outside this contract; do not persist delivery-dependent state before delivery succeeds. Ticket 67 still provides the final narrow response semantic gate, so a successfully created Checkout destination can remain reserved/reusable if composition or final validation later fails.

Ticket 65D does not call providers, send messages, persist conversation artifacts, or claim delivery. The injected executor interface is deliberately testable without network access; a future orchestration integration must supply the private RPC reservation store and provider adapters.
