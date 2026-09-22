# Ticket 6 — Legacy Subscription Cancellation Safety

## Outcome and scope

The development workflow now preserves the `users` identity root and all related history after a verified legacy Stripe subscription is canceled. The current one-time 28-day Checkout/purchase flow, schema, RLS/grants, portal API, program lifecycle, scheduler, and Global Error Handler were not changed.

Changed artifacts:

- `n8n/Dietavity live 2.4.3.json` — development workflow renamed internally to `Development - Dietavity live 2.5.1 (Ticket 6)`.
- `scripts/refactor-ticket-6-workflow.js` — reproducible, idempotent workflow transformation.
- `test/ticket-6-legacy-cancellation-safety.test.js` — controlled Ticket 6 coverage.
- `test/ticket-s2-workflow.test.js` — legacy-branch regression expectation updated for the safe nodes.
- `archive/Dietavity live 2.4.3 pre-ticket-6.json` — exact pre-change rollback export.

No production n8n import or activation was performed, and no live Stripe subscription was canceled.

## Resulting flow

```text
Ticket 5 persisted-state gate
  -> Stripe DELETE for resolved users.stripe_subscription_id
  -> validate status=canceled, object=subscription, and matching ID
  -> atomic local state + metrics statement
  -> verify local_state_canceled=true
  -> send fixed cancellation confirmation
```

One-time-only customers continue through Ticket 5's false branch to the deterministic explanation that their 28-day program is a one-time purchase. They cannot reach the Stripe DELETE node.

## Nodes removed, added, and modified

Removed:

- `Delete User`.
- `Create Unsubscribe Metrics Row`; its insert is now part of the atomic persistence statement.

Added:

- `Persist Legacy Cancellation` (Postgres).
- `If Local Cancellation Persisted`.

Modified:

- `If Stripe Unsubscribe ` now requires all of:
  - Stripe `status = canceled`;
  - Stripe `object = subscription`;
  - Stripe response `id` equals the resolved user's persisted `stripe_subscription_id`.
- `Send Unsubscribe Message` now contains fixed, outcome-based copy.
- `Send Unsubscribe Delay Message` was renamed to `Send Unsubscribe Unconfirmed Message` and isolated to unconfirmed Stripe responses or a non-matching local persistence result.

There are no dangling cancellation connections. The workflow retains the configured Global Error Handler ID `sa10JQEAbxNYvCGG`.

## Exact local state update

After the validated Stripe response, one PostgreSQL statement performs the following atomically:

```sql
UPDATE public.users
SET subscription_status = 'canceled',
    updated_at = NOW()
WHERE id = <resolved user id>
  AND stripe_subscription_id = <validated Stripe response id>;

UPDATE public.subscriptions
SET status = 'canceled'
WHERE user_id = <resolved user id>
  AND provider = 'stripe'
  AND stripe_subscription_id = <validated Stripe response id>;
```

The actual workflow uses data-modifying CTEs in a single statement, not two independent transactions. It returns `local_state_canceled`; confirmation is reachable only when the user matched, `users.subscription_status` is canceled, and no matching active/trialing/past-due mirrored subscription remains.

Field handling:

- `is_active`: unchanged. Repository portal/API code does not currently use this field, and its legacy semantics are ambiguous. Changing it could disable identity, support, portal history, or future one-time purchases.
- `plan_type`: unchanged, preserving historical legacy classification. Active cancellation eligibility is status-based, so it does not leave the customer cancellable after both mirrored statuses become canceled.
- `stripe_subscription_id`: preserved.
- `stripe_customer_id`: preserved.
- No purchases, programs, profiles, weeks, meal plans, messages, onboarding memory, or onboarding sessions are updated or deleted.

## Metrics and idempotency

`unsubscribed_metrics` is inserted in the same atomic statement, only when `users.subscription_status` transitions from a non-canceled value to `canceled`. A repeated successful execution therefore does not insert another metric. The existing schema has no `user_id`, subscription ID, or unique cancellation key on this table, so this transition guard is the safest available idempotency mechanism without a schema change.

After a successful local update, Ticket 5's gate sees neither `users.subscription_status` nor the matching `subscriptions.status` in `active`, `trialing`, or `past_due`. A repeated WhatsApp cancellation message is routed to the one-time/no-active-recurring-subscription response and does not call Stripe.

## Failure and reconciliation behavior

- Stripe HTTP failure: the HTTP node raises through the existing workflow error path. No local cancellation update, metric, deletion, or success confirmation runs.
- Unconfirmed Stripe 2xx payload: the result check rejects it and sends the safe unconfirmed message. Local state is not changed.
- Database error after Stripe success: the single PostgreSQL statement rolls back its local updates and metric together, raises through the existing Global Error Handler, and cannot reach the success confirmation. It does not try to recreate the Stripe subscription.
- Retry after Stripe success/local DB failure: local state still satisfies the Ticket 5 gate. The same resolved subscription ID is used. Stripe documents API v1 DELETE as idempotent and safe to retry; once Stripe again returns the canceled subscription object, the local atomic statement reconciles both status mirrors and inserts one metric.
- Local record mismatch/race: the SQL returns `local_state_canceled = false`, so the workflow sends the unconfirmed message instead of a false success confirmation.

Unconfirmed copy:

> No pudimos confirmar la cancelación en este momento. No marcaremos tu suscripción como cancelada hasta verificarla. Por favor, inténtalo de nuevo o escríbenos a soporte@dietavity.com.

Success copy:

> Tu suscripción ha sido cancelada correctamente. No se realizarán más cargos recurrentes por esa suscripción.

## Verification

Controlled/static tests cover:

- active legacy success graph and exact resolved Stripe ID source;
- Stripe response status/object/ID validation;
- `users` and mirrored `subscriptions` canceled updates;
- absence of `DELETE FROM users` and removal of `Delete User`;
- preservation of purchases, programs, profiles, weeks, meal plans, messages, and onboarding data;
- metrics transition guard;
- Stripe failure/unconfirmed response routing;
- database failure graph (success confirmation is downstream of successful persistence only);
- duplicate cancellation gating;
- one-time purchase protection;
- cross-user ID safety;
- all workflow connection targets.

Full command:

```text
node --test
```

Result: **63 passed, 0 failed**.

The transformation script was also run repeatedly; the workflow SHA-256 remained unchanged, confirming migration idempotence. Live n8n execution against mocked Stripe/Postgres endpoints was not available in this workspace and must be completed before production import.

## Rollback

Exact rollback artifact:

```text
archive/Dietavity live 2.4.3 pre-ticket-6.json
SHA-256: 4724a0f2e4486fff9fecdb1b2bf2c1493d0fad58742ab2fae2117a0569a17dcc
```

Restore that export as the development workflow only if rollback is required. Because it contains the unsafe legacy `Delete User` branch, production rollback should be a last resort and should immediately disable cancellation traffic or be followed by a hotfix.

## Remaining risks and deployment checks

- The legacy cancellation state is duplicated between `users` and `subscriptions`; the atomic statement reconciles this request path, but no separate Stripe webhook reconciliation was added under this ticket's scope.
- `unsubscribed_metrics` lacks a durable customer/subscription key, so the transition guard prevents workflow retries but cannot prove historical uniqueness across unrelated/manual database edits.
- `is_active` remains semantically ambiguous and intentionally unchanged.
- The retained legacy AI confirmation prelude (`Unsubscribe Agent`) was not redesigned; Stripe eligibility remains enforced independently by persisted state.
- Before production import: use a development n8n copy, mock the Stripe DELETE response and Postgres success/failure, verify the Global Error Handler execution log, test a duplicate message, and confirm table row counts before/after. Do not use the remaining real subscriber.

Stripe references:

- <https://docs.stripe.com/api/subscriptions/cancel>
- <https://docs.stripe.com/api/idempotent_requests>
