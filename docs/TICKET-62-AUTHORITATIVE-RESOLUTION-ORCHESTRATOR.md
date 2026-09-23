# Ticket 62 — Authoritative Resolution Orchestrator

## Boundary and API

`resolveObligations({ context, obligations, factResolver, policyResolver, asOf, reminderContexts? })` is a synchronous, pure v2 coordinator. It validates the Ticket 60 `ConversationContext`, Ticket 61 obligations, unique IDs, injected resolver interfaces, and injected `asOf` before calling either resolver. It returns:

```js
{ resolved_obligations: ResolvedObligation[], authorized_actions: AuthorizedAction[] }
```

It imports no model, network, provider, persistence, workflow, or runtime clock dependency. It does not inspect raw language or history, generate wording, retrieve knowledge, execute an action, or write state.

Its validator is intentionally stage-specific. The shared normative `ResolvedObligation` validator also recognizes future `reviewed_knowledge` and `generated_guidance` terminal variants, but Ticket 62 rejects them because it only produces authoritative/deferred outcomes.

`reminderContexts` is optional injected server-normalized per-obligation reminder metadata, keyed by obligation ID. It is only passed to Ticket 59; the orchestrator does not parse `requested_timing_text`. Without a supplied normalized time, the existing Ticket 59 clarification rule applies.

## Closed routing matrix

| Obligation category | Resolution |
| --- | --- |
| `product_fact`, `provider_service_fact` | Ticket 58 Fact Resolver, through reviewed subject mapping below |
| `medication_management`, `safety_sensitive_nutrition` | Ticket 59 Policy Resolver |
| `commercial_purchase_intent` | Ticket 59 Policy Resolver with current-turn derived safety gate |
| `reminder_request` | Ticket 59 Policy Resolver |
| `practical_guidance` | deferred: `reviewed_knowledge_or_reasoning` |
| `conversational_task` | deferred: `conversational_generation` |
| `support_account` | deferred: `support_resolution` |
| `social_acknowledgement` | deferred: `response_composition` |
| `clarification` | source-less `clarification_required` |

There is no default/fuzzy fact path. An unmapped fact subject, including `video_calls` and `automatic_meal_prep_adaptation`, becomes source-null `bounded_unknown`; it is not changed into practical guidance, a clarification, or a resolver failure.

## Fact subject mapping

`config/sales-engine-v2/resolution-routing.js` maps: `price` → `offer.price`; `duration` → `offer.duration_days`; `billing_model`, `subscription`, `automatic_renewal`, `meals`, `personalization_after_verified_payment`, `start_date`, `portal_delivery`, `whatsapp_support`, `prepared_food_delivery`, `in_person_service`/`in_person_location`, and `refund_policy` to their identically reviewed Ticket 58 canonical keys. `medication_sale`, `medication_delivery`, `medication_prescription`, and their `glp1_` forms map to the provider-level GLP-1 fact keys.

`payment_method` maps to `payment.supported_methods` with Ticket 58 `{ operation: 'contains', candidate }`; Ticket 58 owns candidate normalization, complete-set membership, and true/false factual payloads. It is not a router decision.

## Projection and safety

Ticket 58 known facts project to canonical-fact `resolved`; reviewed and unreviewed unknowns project to `bounded_unknown` while retaining canonical source only for the reviewed case. Canonical `not_applicable` projects as a canonical-fact `resolved` with no asserted payload. Ticket 59 `no_applicable_policy` projects to source-null bounded unknown. Its `unsupported` outcome preserves deterministic-policy provenance and exact `policy_decision` under the nearest normative status, `resolved`, rather than being mislabeled unknown, failure, or clarification. Policy reasons remain in Ticket 59's existing `policy_decision.reason_code`; no Ticket 62 top-level reason field is emitted.

Safety obligations are resolved before commercial obligations, but results are returned in original input order. The gate uses only current safety obligations: no safety obligation is `clear`; any failed, unknown/no-applicable, or clarification safety outcome is `indeterminate`; otherwise any policy `prohibited` outcome is `blocked`; all remaining resolved safety outcomes are `clear`. Thus indeterminate takes precedence over blocked and Ticket 59 receives the semantically explicit gate. Ticket 59 then permits action only for `clear`; its blocked and indeterminate policies prohibit commercial action.

## Failure, actions, and invariants

Only `FACT_STORE_UNAVAILABLE` and `POLICY_STORE_UNAVAILABLE` are localized as `failed` / `resolver_failure`. Invalid requests, malformed resolver results, ambiguous stores, unsupported resolver operations, or any other programming/contract error fail the whole call. A failed safety result still causes the commercial policy to run with `indeterminate` when the injected resolver can do so.

Top-level actions are copied only from schema-valid Ticket 59 `action_authorization.status === 'authorized'` values, in corresponding resolved-obligation order. No action is manufactured, deduplicated, or executed. The corresponding `ResolvedObligation.action_authorization` is the traceability link; no new action field was needed.

After resolution, the orchestrator checks count, exact IDs/order, deferred lifecycle, authority/source compatibility, action validity, and that every returned action is exactly the authorized action on one resolved obligation. Identical inputs and resolver snapshots produce deeply equal output.

Production routes, workflows, migrations, external providers, and customer traffic are unchanged.
