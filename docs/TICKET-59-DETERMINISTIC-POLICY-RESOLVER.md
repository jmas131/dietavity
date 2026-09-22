# Ticket 59 — Deterministic Policy Resolver

## Purpose and boundary

Ticket 59 adds a pure, versioned policy layer beside production. It receives a validated structured obligation and a small allowlisted authoritative context, then returns handling requirements and action authorization. It has no raw customer text input, LLM, fact lookup, database access, network access, Stripe, Twilio, reminder scheduler, state mutation, or response composition.

Product truth remains in Ticket 58's Fact Resolver. The Policy Resolver therefore does not resolve price, duration, payment methods, subscription, delivery, portal, or GLP-1 product-scope facts. It returns machine-readable codes only; customer wording remains a future Composer responsibility.

## Evidence inventory and reconciliation

| Candidate evidence | Classification | Ticket 59 disposition |
| --- | --- | --- |
| `sales-engine-v3.js` medication dose/start/stop/timing branches and Tickets 41/44/47 | SAFETY_POLICY | Structured medication-management obligations prohibit advice and require clinician referral. |
| Ticket 44 GLP-1 sale/delivery/prescription wording | PRODUCT_FACT_NOT_POLICY | Left exclusively to Ticket 58 facts. |
| `sales-engine-v3.js` purchase confirmation and explicit-purchase regexes | INTERPRETATION_NOT_POLICY | Future Interpreter emits an obligation; Policy consumes no text or regex result. |
| Standard checkout eligibility after a current, safety-clear purchase request | COMMERCIAL_POLICY / ACTION_AUTHORIZATION | Authorizes only `provide_checkout_destination`, never execution. |
| Tickets 41/42 GLP-1 campaign holding route | COMMERCIAL_POLICY / ACTION_AUTHORIZATION | Structured `glp1_validation` campaign authorizes only `provide_holding_page_destination`. |
| Existing reminder parsing/time normalization and scheduling | INTERPRETATION_NOT_POLICY / ACTION_AUTHORIZATION | Interpreter/time adapter supplies structured time; Policy authorizes, clarifies, or marks unsupported without scheduling. |
| Sales funnel events, state persistence, checkout creation, provider delivery/recovery | ORCHESTRATION | Deferred; existing operational protections remain unchanged. |
| Food philosophy, practical meal advice, GLP-1 education | KNOWLEDGE_NOT_POLICY | Deferred to reviewed knowledge/bounded reasoning. |
| Nutrition diagnosis/treatment triage beyond medication management | NEEDS_DECISION | No rule is implemented; it yields `NO_APPLICABLE_POLICY`. |
| Support/account routing | NEEDS_DECISION | No authoritative normalized routing contract was found; deferred. |

No materially conflicting authority was found for the implemented medication boundary, standard checkout, or GLP-1 holding boundary. Historic prompt wording and regexes were used only as evidence of the separation, never copied as canonical policy.

## Implemented policies

`config/sales-engine-v2/policies.json` contains reviewed active rules:

- `safety.medication_management`: dose change, stopping, starting, timing, prescription decisions, and other medication management require `refer_to_clinician` and prohibit `medication_management_advice`.
- `commercial.checkout.standard`: a non-ambiguous structured current request, authoritative offer/channel/commercial state, and `standard` campaign authorize `provide_checkout_destination`.
- `commercial.checkout.glp1_canary`: the same structured request with `glp1_validation` authorizes only `provide_holding_page_destination`; asking for normal checkout is prohibited.
- `reminder.explicit_complete`, `.explicit_incomplete`, and `.unsupported`: authorize only a complete explicit reminder, require clarification when its time is absent, and represent unsupported requests separately. `when.reminder_scheduled_for: "missing"` means the `reminder` object is absent, its `scheduled_for` property is absent, or that property is explicitly `null`. A present `scheduled_for` must be an ISO timestamp; any other present value, malformed reminder object, unknown reminder field, or invalid boolean remains `POLICY_REQUEST_INVALID`. The complete rule requires a present timestamp, so complete and incomplete rules cannot both match.

Authoritative context fields are deliberately allowlisted: `offer_version`, `channel`, `campaign`, `commercial_state.current_purchase_request`, `commercial_state.safety_gate`, and structured reminder fields. The gate is one of `clear`, `blocked`, or `indeterminate`; only `clear` matches a commercial authorization rule, while `blocked` and `indeterminate` produce deterministic commercial prohibitions. It is derived by a future resolution boundary from current deterministic safety outcomes, not memory, raw language, or Interpreter confidence. Any unexpected or malformed field is `POLICY_REQUEST_INVALID`, never authorization evidence. `create_checkout` is never authorized by this resolver; it is an execution concern requiring later operational safeguards.

## API and result semantics

`createPolicyResolver({ policies })` returns immutable `resolvePolicy(request)` and `resolvePolicies(requests)` methods. `resolvePolicyFromPolicies(policies, request)` supports isolated tests. A request has `{ obligation: { id, category, subtype, ambiguous }, context, requested_action_type? }` and contains no text field.

Positive results carry Ticket 57-compatible provenance:

```js
{ authority: 'commercial_authorization', source: { type: 'deterministic_policy', id: 'commercial.checkout.standard', version: '1' } }
```

Safety policies use `deterministic_policy`; commercial authorization uses `commercial_authorization` with the same deterministic-policy source. All policy outcomes set `llm_reasoning_permitted: false`.

`policy_decision` retains the policy ID/version, outcome, reason code, and handling requirements. `action_authorization` is present only for a policy-authorized action and is the canonical Ticket 57 `AuthorizedAction`: it contains no duplicate decision, policy ID/version, or reason-code fields. `no_applicable_policy` with `NO_APPLICABLE_POLICY` is distinct from `prohibited`, `clarification_required`, `unsupported`, and resolver errors. Future action executors must fail closed unless an `action_authorization` with `status === 'authorized'` exists. Malformed input/store failures throw `PolicyResolverError`; two matching policies throw `POLICY_AMBIGUOUS`, so file order never decides authority.

## Integration requirements

A future Interpreter must produce structured obligations and an adapter must populate only documented server-derived context. A future orchestrator may translate authorized actions into existing reservation/idempotency/payment/reminder mechanisms, but must not treat this module as execution authorization for Stripe, Twilio, database writes, or scheduling. A future Composer must turn required handling into Spanish without adding facts or actions.

## Tests and isolation

`test/ticket-59-deterministic-policy-resolver.test.js` covers medication safety, fact separation, standard and GLP-1 authorization, reminder outcomes, invalid input, malformed stores, conflict detection, provenance, and static absence of side-effect clients. Ticket 58 remains unmodified and continues to own fact truth. Production Sales Engine and Recovery Poller are untouched.
