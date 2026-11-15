# Dietavity — Project Summary

**Updated:** 2026-11-03
**Current phase:** WhatsApp-first market validation for a V4 food-decision assistant, initially for people using GLP-1 medication.
**Purpose:** Authoritative handoff for a new ChatGPT/Codex session. The current-product and V4 sections override all historical material below.

### Evidence conventions

- **Production verified** means an observed live deployment, execution, or
  customer-visible result.
- **Repository implementation** means code, generated artifacts, or tests in
  this repository; it is not deployment evidence.
- **Operational assertion / requires confirmation** means a reported live
  state that must not be treated as verified until its stated check is made.

## Current product — authoritative

Dietavity helps a person make a safe, practical food decision in the moment. In WhatsApp, a user can report food eaten, appetite, or available ingredients; Dietavity gives concise, practical nutrition guidance.

| Area | Current state |
| --- | --- |
| Customer interface | WhatsApp; there is no current customer portal experience. |
| Initial audience | People using GLP-1 medication. |
| Acquisition | Meta Click-to-WhatsApp campaigns. |
| Trial | One week free; manually operated while usage is validated. |
| Paid model | Three months prepaid is a future hypothesis only; no subscription or automatic renewal is implemented. |
| Medical boundary | Nutrition support only—never prescribe, sell, supply, or modify medication, dose, or treatment. |
| Market evidence | The campaign has resumed. Early real-user V4 conversations are behaving quite well; no metrics, retention, conversion, willingness-to-pay, or product-market-fit conclusion is established. |

The current job is commercial and product learning, not platform expansion. Freeze discretionary engineering. Change production only for a safety issue, technical failure, material operational risk, or repeated severe defect evidenced in real use.

```text
Meta Click-to-WhatsApp
→ WhatsApp conversation
→ useful food decision
→ one-week manual trial / repeat use
→ evidence of willingness to pay
→ test the future prepaid hypothesis
```

Do not represent a portal, a 28-day plan, PDFs, checkout, a subscription, a medication service, or an automated paid offer as available today.

## V4 production architecture — authoritative

V4 is the production WhatsApp Conversation Engine. It retains the transaction and delivery controls qualified in the earlier Conversation Engine/Direct RAG work, while the food-understanding and response layer is LLM-first.

```text
WhatsApp inbound
→ durable message ledger + inbound deduplication
→ ordered session / atomic claim / logical-turn batching
→ bounded conversation context + authoritative policy
→ V4 LLM reasoning + response validation
→ durable outbound reservation + idempotent delivery + completion
```

### V4 principles

1. **Open culinary world; closed trust boundary.** The model may reason with ordinary foods, appetite, and user-provided ingredients. Product facts, medical scope, policy, turn ownership, validation, and delivery controls are authoritative and closed.
2. **LLM-first, not deterministic food parsing.** Do not reintroduce food-entity extraction, deterministic ingredient aggregation, or legacy parsing from isolated historical observations. Rapid user fragments are already handled by logical-turn batching.
3. **One logical turn, one controlled path.** Atomic claims, ordering, leases, reservations, outbound idempotency, and completion semantics must remain intact. Provider acceptance is not proof of handset delivery.
4. **Human-paced batching is qualified.** Adjacent fragments become one newline-joined logical turn only after the 10-second sliding quiet window. A later, independent message remains independent.
5. **No generic n8n HTTP retry.** It can weaken ownership and delivery guarantees and reintroduce duplicate processing. Any recovery must be specifically bounded and same-owner.
6. **Fail closed.** Do not guess identity, ownership, security state, product facts, or medical scope.
7. **Evidence before engineering.** A conversation, a single report recommendation, or a model interpretation does not automatically justify a ticket.

### Cutover, qualification, and relevant history

- V4 production cutover and qualification completed successfully. PM2/HTTP and WhatsApp food/non-food smoke tests passed under the qualified production configuration.
- The original Node Conversation Engine implementation (WP2.6) was completed at commit `2c1e0c4a4444634a7917a1f3282744456d5d6222`. Authenticated loopback and five-turn real-model qualification passed; the endpoint is authenticated and publicly blocked.
- Tickets 77/77A/77B qualified conversational continuity and the nutrition-only GLP-1 behavior. Tickets 80–82F established activation behavior, open culinary reasoning, and the 10-second batching invariant.
- Ticket 82 qualification proved five human-paced fragments were persisted as one logical turn and submitted as one combined engine request. Do not change that invariant casually.
- Tickets 83/83G addressed the historical competing-execution ownership/idempotency incident; Tickets 86/87 reconciled and qualified the active configuration. The incident is a regression reference, not an open reason to pause the campaign.
- The V3/Direct RAG descriptions and parity evidence are retained as lineage for the transactional guarantees; they are not the current V4 response-design authority.
- Ticket 85 is a review-only bounded Conversation Engine recovery patch and is not a substitute for generic retry or a documented production deployment.

### Recovery and error handling

**Repository qualification:** the Recovery Poller gap is closed and
PostgreSQL-qualified. It remains a bounded, same-owner operational recovery
path; it does not authorize blanket retry behavior. The Recovery Poller and
Global Error Handler remain supported operational workflows.

The historic portal-era multipart recovery was intentionally not executed end-to-end. Its definitions and normal-path canary do not prove historic recovery. Keep that limitation documented, but prioritize it only if it affects active users or safety.

### Ticket 89 — permanent Docker-to-V4 network stability

Ticket 89 was implemented, committed, pushed, and deployed successfully on
2026-11-03 at commit `35ed4e25235f274b1c931726e4a133c747ac14dc`. The Compose
project `root` now makes the existing `root_default` bridge deterministic:

- subnet `172.18.0.0/16`, gateway `172.18.0.1`, and dynamic pool `172.18.128.0/25`;
- n8n `172.18.0.2` and Gotenberg `172.18.0.3` are static addresses;
- the private Nginx listener remains `172.18.0.1:12751` and permits only n8n
  (`172.18.0.2`) for the private V1/V4 routes;
- Conversation Engine V4 remains PM2-hosted on `127.0.0.1:3000`.

The deployed Compose file is `/root/docker-compose.yml`. Preserve the static
addresses, IPAM settings, external `n8n_data` volume, bind mount, and n8n
encryption-key configuration in future Compose changes. Never broaden the
private Nginx allowlist. IPAM changes require bridge recreation during a
controlled maintenance window; follow
[`deployment/TICKET-89-STATIC-IP-DEPLOYMENT.md`](../deployment/TICKET-89-STATIC-IP-DEPLOYMENT.md)
for deployment, verification, and rollback.

Production verification after deployment confirmed the original container image
IDs, `n8n_data` volume, and `/local-files` bind mount were retained. n8n reached
V4 without credentials with the expected `401`; Gotenberg was denied with the
expected `403`; n8n reached Gotenberg with `200`. The Recovery Poller was
reactivated and completed its scheduled run successfully, and the Ledger Health
Monitor remained active and completed its scheduled run successfully. Twilio
logs showed no unanswered inbound messages during maintenance.

**Production verified:** a legitimate WhatsApp inbound was processed
successfully after migration. `Call V4 Conversation Engine` returned
`contract_version: conversation-engine-v4-response-v1`,
`engine_version: conversation-engine-v4-primary-v1`, and
`generation_status: generated`; its generated response matched the reply
received on WhatsApp. Authenticated V4 end-to-end processing is therefore
verified.

## Durable data, orchestration, and safety guarantees

### Canonical records and identity

- `public.messages` is the canonical WhatsApp conversation ledger.
- `users.id` is the canonical customer identity; a WhatsApp identifier alone is not customer authentication.
- `public.profiles` is the canonical personalization record. Browser input is untrusted for sensitive personalization.
- Email-based recovery/ownership verification and cross-channel linking remain infrastructure. A claimed email in WhatsApp is never authentication.
- Legacy portal access and payment records remain historical technical data, not authority for the current product promise.

### Concurrency and delivery

The message path preserves inbound deduplication, per-session ordering, atomic claims, leases, output gating, failure recovery, durable outbound reservations, deterministic idempotency keys, and shared completion rules. Multipart responses reserve all parts before sending; an unresolved or failed part prevents premature completion and blind duplicate sends.

The key processing fields remain `processing_order`, `processing_lease_until`, and `processing_completed_at`. The response must pass the grounding/safety gate before a reservation can reach the delivery path.

### Grounding and medical boundaries

The predecessor engine established the useful separation that V4 must preserve:

```text
claimed user turn
→ identify required response obligations
→ resolve authoritative facts and safety policy
→ compose a practical response
→ validate grounding and scope
→ reserve and deliver through the durable path
```

The model may not invent current offer, price, payment method, portal access, checkout, medical capability, or policy. Unknown capabilities require verification. A user seeking medication, dosing, or treatment advice must remain within the nutrition-only boundary.

## Weekly Product & Conversation Intelligence

**Repository implementation:** the existing workflow is named **Dietavity
Weekly Conversation & Sales Intelligence**. Commit `691bc4a` changed its report
framing to **Weekly Product & Conversation Intelligence** for the V4 WhatsApp
food-decision product.

### What the workflow reports

| Layer | Meaning |
| --- | --- |
| Deterministic ledger facts | Conversation/session and message counts; first-observed versus prior-observed sessions; repeat inbound activity; multi-day activity. |
| LLM classifications | Activation, food-decision need, recommendation quality, explicitly supported GLP-1/appetite patterns, safety-boundary quality, friction, willingness-to-pay signals, and priorities. |

Activation means progressing beyond a greeting or curiosity into a genuine food-decision need and receiving substantive guidance. The workflow is session-level reporting, **not** unique-user cohorts or D1/D3/D7 retention, and it must not infer Meta advertising metrics.

The workflow retains chronological reconstruction, Mexico City weekly scheduling, email delivery, Global Error Handler integration, HMAC-anonymized conversation labels, and redaction of phone numbers, email addresses, and sensitive links. Commit `691bc4a` reported 22 focused weekly/privacy/workflow tests passing and 1,191 canonical tests passing (11 skipped). These are repository results, not production certification.

### First manual production run — baseline only

**Production evidence available:** the updated workflow was imported and
manually production-tested successfully. Its first report covered
**2026-10-18 through 2026-10-24**:

| Measure | Result |
| --- | --- |
| Conversations | 17 |
| Messages | 111 |
| First-observed conversations | 15 |
| Returning/prior-observed conversations | 2 |
| LLM-classified activated conversations | 2 |

This is a **legacy-contaminated baseline**, not a V4 performance report: much of the window predates the V4 cutover. The report may accurately characterize historical transcripts, but recommendations to add deterministic ingredient extraction, fragment aggregation, or additional deduplication are not V4 findings and must not override V4 architecture. Likewise, a request for a “light dinner” alone is not evidence of a GLP-1/appetite pattern.

The available project record confirms import and successful manual production
testing. **Requires confirmation:** it does not independently establish that
the recurring schedule is active; do not claim activation without checking the
live n8n workflow.

## Infrastructure and deployment boundaries

### Application and workflow stack

- Node.js 20.x, Express 5.x, EJS, CSS
- PM2, nginx, Ubuntu 24.04
- Supabase/PostgreSQL
- Self-hosted n8n Community Edition
- WhatsApp transport, legacy Stripe Checkout integration, Meta Pixel, and browser analytics

No server-side Meta Conversions API is documented. Meta/browser analytics support measurement; canonical payment records are the authority for confirmed payments.

### Deployment and operational boundaries

Website/runtime code runs under PM2; generated workflows are imported into n8n; schema changes run against PostgreSQL. These are separate deployment surfaces. A repository test result, workflow import, manual run, workflow activation, and production rollout are separate facts and must never be conflated.

Recovery tooling needs appropriately configured direct PostgreSQL access;
application database API access does not automatically grant that capability.
Detailed runbooks and non-secret operational paths may be documented when
needed for safe operation. Credentials, private customer data, and secret
values must remain outside this summary.

The production Docker Compose file is `/root/docker-compose.yml`; it defines
the `root` project and its `root_default` bridge. Its source configuration is
represented by the sanitized Ticket 89 deployment templates, not copied with
credentials into the repository.

### Privacy and legal controls

Dietavity retains a privacy notice, ARCO request flow, sensitive-data consent, privacy-notice versioning, PII redaction in operational reports, conflict-safe identity linking, and enumeration-safe recovery behavior. Do not place personal names, phone numbers, personal email addresses, provider IDs, execution/request IDs, credentials, tokens, or secret values in this document. Non-secret infrastructure paths are allowed only when operationally necessary.

## Current status

| Area | Documented state |
| --- | --- |
| WhatsApp product | V4 production conversation engine is active and successfully qualified. |
| Acquisition | Meta Click-to-WhatsApp campaign resumed. |
| Early product use | A small number of real-user V4 conversations are behaving quite well; do not invent metrics. |
| Trial and pricing | One-week manual free trial active as a validation model; three-month prepaid is unimplemented/unvalidated. |
| Delivery controls | Durable claims, batching, reservation, idempotency, and completion protections remain required. |
| Recovery Poller | Gap closed and PostgreSQL-qualified; bounded recovery only. |
| Docker-to-V4 network | **Production verified:** Ticket 89 deployed with deterministic n8n/Gotenberg addresses, narrow private Nginx access, and preserved image/volume identity. |
| Post-migration V4 verification | **Production verified:** unauthenticated n8n, Gotenberg-denial, n8n-to-Gotenberg, authenticated legitimate inbound, Poller, Monitor, and Twilio checks passed. |
| Global Error Handler | Supported operational workflow for execution/error capture, durable logging where available, and email notification. |
| Weekly intelligence | Updated at `691bc4a`; imported and manually production-tested. Activation needs live confirmation. |
| Older overlapping reporting | Should remain disabled or have its disabled state confirmed. |
| Historical portal/checkout | Preserved technical history; not the active offer or customer journey. |
| Dependency security | Prior runtime checks reported one high and one critical vulnerability; investigate in a controlled task, never with blind automated fixes. |

## Current priorities

1. **Validate real product usefulness.** Observe safety, practicality, recommendation quality, first useful food decisions, repeat usage, and recurring failure patterns in the resumed campaign.
2. **Validate the business.** Learn whether the one-week trial creates sustained value and willingness to pay before implementing or presenting the prepaid hypothesis as an offer.
3. **Use post-cutover evidence.** Let V4 data accumulate and always distinguish deterministic ledger facts, LLM classifications, and recommended actions.
4. **Measure the funnel honestly.** Keep acquisition, conversation start, first useful decision, repeat use, trial completion, paid intent, and confirmed payment separate.
5. **Protect qualified behavior.** Investigate duplicate engine processing, weakened ownership, reservation bypass, or transport anomalies immediately. Preserve the 10-second batching semantics.
6. **Observe the qualified post-migration path.** Continue normal ledger, Recovery Poller, and Ledger Health Monitor observation; investigate any recurrence of V4 transport or ownership failures.
7. **Build only for learning, revenue, reliability, or safety.** Examples: a measured conversion blocker, a material measurement gap, a production defect, meaningful operational risk, or an essential experiment. Architectural polish alone is insufficient.

## Open risks

1. **Product-market fit is unproven.** Positive early conversations do not establish repeat behavior, retention, payment, or sustainable acquisition cost.
2. **Safety and user expectations.** Users may seek medication, dose, or clinical advice. Maintain the nutrition-only boundary and avoid implied clinical treatment.
3. **Small-sample overinterpretation.** Low volume and LLM classifications can create false trends; do not infer retention, cohorts, unique users, or advertising performance without the right data.
4. **Recommendation quality.** V4 must earn trust through familiar, affordable, appetizing, culturally practical food guidance, including the constraints common in GLP-1 use.
5. **Operational regression.** Generic retries, duplicate engine execution, relaxed claims, or bypassed reservations can create duplicate or incorrect replies.
6. **Founder-focus risk.** Legacy portal work, historic recovery, and dependency cleanup can consume attention without improving the active validation loop.

## Historical context — explicitly non-authoritative

The former $149 MXN 28-day program, web portal/PWA, PDFs, website checkout, setup flow, subscription concepts, prepared-meal expectations, and longevity-led meal-program positioning are legacy experiments and technical context only. They are not the current product, price, promise, acquisition funnel, or customer journey.

The legacy website, payment, identity, recovery, and program tables remain relevant where they support data integrity, ownership verification, or technical operations. Their presence must never cause V4 to claim a portal, plan, PDF, checkout, subscription, or medication service is available.

## Maintenance rule

Update this summary when the live product/offer, production architecture, verified qualification evidence, recovery posture, workflow activation, or validated market evidence materially changes. Preserve the distinction between planned work, repository evidence, imported workflow state, manual tests, activated workflows, and verified production behavior.
