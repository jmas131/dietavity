# Dietavity - Project Summary

**Updated:** September 29, 2026  
**Current phase:** Revenue validation and direct replacement of the inadequate legacy WhatsApp response layer  
**Production status:** Core purchase, canonical personalization, portal, WhatsApp assistance, identity linking, and monitoring are operational. The redesigned landing page is published; normal paid-message delivery and legacy subscriber continuation are production validated. The current production Sales Engine still uses its legacy intelligence/response section. Its proven transactional infrastructure remains the production foundation; its response layer is scheduled for direct replacement by the straightforward V2 described in this document. Ticket 39 is implemented and reviewed, but production deployment is not confirmed.

**Scope:** Current state through Ticket 75 and the September 29 strategic decision, based on the existing project summary and referenced project conversations. This is a documented-state summary, not a fresh production audit. Unconfirmed operational actions are explicitly marked. The synced reference summary is preserved unchanged.

## 1. Executive Summary

Dietavity is a personalized 28-day nutrition program designed to eliminate the daily question, “What should I eat today?” It provides breakfast, main meal, dinner, and snack recommendations using practical, familiar, healthy foods, with principles inspired by eating patterns of long-lived populations.

### Current Offer

- `$149 MXN`
- One-time payment
- Personalized 28-day meal program
- Portal access
- WhatsApp assistance

### Primary Acquisition Funnel

```text
Meta Ads
↓
28-Day Program Landing Page
↓
Website Checkout
↓
Stripe Payment
↓
Setup / Personalization
↓
Dietavity Portal
↓
28-Day Program
```

WhatsApp is still available through landing-page and website CTAs, organic conversations, and customer support, but is no longer required to purchase or use Dietavity.

The immediate priority is revenue: improve ads, creative, positioning, landing-page conversion, and understanding actual customer behavior. The one exception is the direct V2 replacement of the inadequate WhatsApp response layer, because it is a near-term commercial learning and conversion blocker rather than infrastructure expansion for its own sake.

## 2. Current Product

Dietavity sells a personalized 28-day meal program that includes:

- Breakfast
- Main meal
- Dinner
- Snack
- Personalized meals
- Recipes and program access through the portal
- WhatsApp assistance when needed

**Price:** `$149 MXN`, one-time payment. This is not a subscription. Customers can select a program start date within the supported post-purchase window.

## 3. Current Positioning

### Previous Positioning

Dietavity originally emphasized longevity-associated food traditions from Japan, Spain, Italy, and Norway.

Analysis found that this positioning created complexity, unfamiliar or impractical foods, expensive ingredients, preparation friction, and a narrow audience. Examples included salmon cost, tofu and miso unfamiliarity in Mexico, lengthy legume preparation, inconvenient oven recipes, and sushi's association with restaurant delivery.

### Current Positioning

**Current positioning / creative platform:** “COMER MEJOR SE NOTA.”

**Functional promise:** “NO PIENSES QUÉ COMER. DIETAVITY LO HACE POR TI.”

The creative platform expresses the desired emotional benefit; the functional promise explains the practical service. Positioning remains under experimental validation. Neither implies guaranteed health, weight-loss, or longevity outcomes.

> Dietavity elimina la pregunta diaria de qué comer con un programa personalizado de comidas fáciles, familiares y saludables, inspirado en principios de alimentación de poblaciones longevas.

The hierarchy is:

```text
PRIMARY PROMISE
Know what to eat every day
↓
PRACTICAL BENEFITS
Easy meals
Familiar ingredients
Healthy eating
Less meal-planning effort
Personalization
↓
DESIRED OUTCOMES
Eat healthier
Manage weight
Feel better
Organize meals
↓
REASON TO BELIEVE
Principles inspired by long-lived populations
```

Longevity is supporting evidence, not the headline proposition.

## 4. Strategic Funnel Shift

### Previous Model

```text
Meta Click-to-WhatsApp Ad
↓
WhatsApp conversation
↓
Sales Engine
↓
Qualification
↓
Examples / objections
↓
Checkout link
↓
Stripe
↓
Setup
```

This created a sophisticated conversational sales system but introduced friction before purchase.

### Current Model

```text
Meta Ad
↓
/programa-de-28-dias
↓
Landing-page persuasion
↓
Direct checkout
↓
Stripe
↓
Setup
↓
Portal
```

The landing page increasingly performs the sales work previously dependent on WhatsApp. WhatsApp remains commercially useful as a secondary channel, support channel, and qualitative research source.

## 5. Current Marketing Priorities

Development should be subordinate to revenue learning unless a technical problem threatens the funnel.

```text
Ads
↓
Creative / videos / carousels
↓
Slogans and positioning
↓
Landing-page conversion
↓
Traffic and funnel data
↓
Purchases
↓
Iteration
```

Key questions:

- Which problem gets people to click?
- Which creative produces qualified traffic?
- Does the landing page explain Dietavity quickly enough?
- Which objections prevent purchase?
- Which meals look attractive and achievable?
- Which messages create purchase intent?
- Where does the website funnel lose visitors?
- What distinguishes buyers from non-buyers?
- Can Dietavity acquire customers economically?

## 6. Website and Landing Page

### Production Stack

- Node.js 20.x
- Express 5.x
- EJS
- CSS
- PM2
- nginx
- Ubuntu 24.04
- PWA portal

**Primary domain:** `dietavity.com`

### Key Routes

```text
/
/servicio
/programa-de-28-dias
/terminos-y-condiciones
/aviso-de-privacidad
/privacidad/solicitud
/comprar
/success
/cancel
/setup
/p/:portal_token
/recuperar-acceso
```

`/programa-de-28-dias` is the canonical campaign landing page. Its current design is the published Ticket 35 redesign, superseding the earlier Ticket 27 presentation.

- Text-first, 14-section editorial narrative with oversized typography and cream, dark-green, black, and lime styling.
- “COMER MEJOR SE NOTA.” leads; “NO PIENSES QUÉ COMER. DIETAVITY LO HACE POR TI.” explains the value.
- Food photography has been removed. CSS product mockups illustrate Setup, the portal, meals, progress, shopping lists, and the “No me gustó” control.
- Personalization examples reflect supported diet/preferences rather than a goal selector that Setup does not collect.
- Direct purchase is primary; WhatsApp remains secondary, with the intentional messaging CTA “Escribe en WhatsApp.”
- Responsive navigation, existing site/social links, keyboard focus, reduced-motion support, SEO, and Open Graph/X metadata are retained or included.
- Checkout, Stripe redirect validation, GA events, and Meta Pixel behavior were preserved.

Mockups demonstrate the product; they do not themselves submit personalization or create new backend capabilities. Extending this visual system across the whole site is deferred until commercial evidence justifies the work.

## 7. Website Purchase Architecture

Ticket 24 removed WhatsApp as a purchase requirement.

```text
Landing page
↓
Website checkout initiation
↓
Canonical users.id created
↓
Stripe Checkout
↓
Payment confirmation
↓
Purchase linked to users.id
↓
Setup
↓
Program
```

A website customer may exist as:

```text
users.id = canonical identity
email = customer/recovery identity
whatsapp_id = NULL
portal_token = portal credential
```

WhatsApp is optional.

## 8. Canonical Customer Identity

```text
users.id
= canonical Dietavity customer identity

email
= recovery / ownership-verification identity

whatsapp_id
= optional linked communication identity

portal_token
= bearer-style portal access credential
```

There is no password system, no Supabase Auth customer login, and no mandatory WhatsApp account.

## 9. Stripe and Payments

Stripe Checkout handles payment for the 28-day, `$149 MXN`, one-time offer.

Supported payment messaging includes:

- Credit/debit card
- OXXO
- Apple Pay where available

Website purchases link through canonical `users.id`, not WhatsApp. Stripe email capture is used for account recovery and identity verification.

## 10. Setup and Personalization

After payment, the customer completes Setup, including:

- Required name
- Program personalization
- Dietary and preference information
- Sensitive-data consent where applicable
- Privacy-notice version tracking

Sensitive-data consent uses fields including:

```text
sensitive_data_consent_at
privacy_notice_version
```

`public.profiles` is the canonical personalization source. When a valid profile exists, it fully governs Week 1 and later-week generation; historical `users.preferences` does not merge into or override it. Empty canonical allergies, dislikes, and conditions remain empty. Historical cuisine is not inherited; it becomes `null` when no canonical equivalent exists. Historical preferences remain stored unchanged, and generation does not retrieve historical chat memory.

Setup collects personalization and consent and initiates/prepares the program through the existing lifecycle. Start-date selection is a separate pre-start portal step after Week 1 is prepared. Program readiness is verified before normal use.

`goal`, budget tiers, and a canonical ingredient catalog remain proposed future personalization work, not current Setup capabilities.

## 11. Portal

The portal is the source of truth for the customer's program. It provides:

- Current program and week
- Daily meals
- Recipes and program content
- Program progression
- Regeneration where supported

WhatsApp complements the portal rather than replacing it. The portal selects the newest program for the canonical user. A completed program remains historical; a successor starts as a separate four-week program.

### Legacy subscriber continuation — production validated

The one remaining legacy active subscriber can receive a successor without a new purchase when eligibility is verified: linked active subscription, current canonical profile and consent, completed latest program, no unfinished program, and no eligible unlinked one-time purchase. Conflicting subscription states fail closed; `past_due`, canceled, inactive, and trialing do not authorize this path. Ordinary one-time purchasers do not require a subscription.

Ticket 38 was validated in production:

- Program 1 remained completed and preserved.
- A distinct Program 2 was created with four weeks and no linked purchase.
- Week 1 had one seven-day meal plan and status `planned`; Weeks 2–4 remained `pending`.
- Exactly one `program_ready` event was recorded.
- Program 2 remained in `personalization`, with `current_week = 1` and `start_date = null`.
- The existing portal link showed “Prepara tu primera semana,” correctly awaiting the subscriber’s start-date choice.

This is an operator-initiated continuation through the existing generation webhook, not a new subscription offer or automatic renewal scheduler. No fake purchase, reopened Program 1, Week 5, or replacement portal credential is required. The temporary `profile_only` restoration design was removed and is not part of the current architecture.

Sequential repeats reuse the unfinished successor, but a pre-existing simultaneous-initialization race remains because no unfinished-program uniqueness constraint exists. Serialize first-generation requests. HTTP `202` acknowledges initialization, not completed meal generation; repeating the webhook is not a general recovery mechanism for failed Week 1 generation.

## 12. Meal Regeneration Security

Ticket 12 hardened `/api/regenerate-meal`. The backend uses canonical server-side profile information rather than browser-supplied dietary restrictions.

Canonical restrictions include:

- Allergies
- Exclusions
- Eating style
- Supported non-medical conditions and preferences

The endpoint fails closed when required canonical profile information cannot be safely resolved.

## 13. Portal and Database Connectivity Resilience

A production `504` revealed that `/p/:token` could wait indefinitely for Supabase/PostgREST requests until nginx timed out.

Ticket 29 introduced:

```text
GET /p/:token
↓
8-second total portal data-loading deadline
↓
Abort outstanding Supabase/PostgREST requests
↓
Controlled branded HTTP 503 if deadline exceeded
```

It also added privacy-safe stage diagnostics and request correlation. nginx timeouts were not increased. Production smoke testing passed.

Verified WhatsApp requests have a separate existing one-minute recovery loop: `Resume Verified WhatsApp Requests` runs `Find Verified WhatsApp Sessions` before claiming or sending. If this read-only lookup fails, the inbound remains verified, unfinished, and discoverable on the next successful run. Advisory locking, leases, ordering, and unique outbound keys protect against duplicate replies.

Ticket 34 diagnosed transient `EAI_AGAIN` DNS failures and Supabase pooler connection timeouts on port `6543`; these were connectivity failures, not SQL statement timeouts. It added diagnostic documentation and regression coverage, with no new runtime retry, migration, workflow regeneration, or speculative index. Blanket retries were intentionally avoided because they would also retry permanent SQL and permission errors.

## 14. WhatsApp Role

WhatsApp is now secondary to the landing-page funnel.

### Roles

- Prospect conversations from landing page, website, and organic sources
- Customer questions about programs, recipes, access, meals, and accounts
- Optional account linking for website customers who later contact Dietavity through WhatsApp

## 15. Sales Engine

The existing n8n workflow, `Dietavity Sales Engine (Ticket 10)`, is the production Sales Engine. It handles:

- Inbound WhatsApp messages
- Sales classification
- Deterministic and AI responses
- Checkout intent
- Paid-customer assistance
- Message ordering
- Identity-verification initiation
- Durable outbound persistence
- Twilio delivery
- Conversation state

WhatsApp remains a supporting channel rather than the acquisition center.

### Current production versus V2 replacement

The durable transactional path is retained:

```text
WhatsApp inbound
↓
Inbound deduplication
↓
Session ordering and atomic claim
↓
User, customer, payment, and conversation-context retrieval
↓
Response generation
↓
Durable outbound reservation and delivery safety
↓
Completion
```

The **current production response section is Legacy**. It remains live only until the direct V2 workflow update is validated and activated. Legacy response quality is inadequate for the commercial questions Dietavity needs to answer; it is not the desired long-term intelligence layer.

The September 29 decision is to modify the necessary nodes in the existing `Dietavity Sales Engine (Ticket 10)` workflow directly. V2 will replace the legacy reasoning/response section while preserving the proven transactional path above, including inbound deduplication, claims and ordering, payment/customer state, outbound idempotency, transport safety, and completion semantics.

### Straightforward production V2: obligation-grounded RAG

```text
Incoming claimed message
↓
Load conversation context
↓
Detect what the user is asking
→ Obligation[]
↓
Resolve facts + policy for each obligation
→ ResolvedObligation[] + permitted claims
↓
Generate response within permitted claims
→ Response phrasing
↓
Validate response against permitted claims
→ Structural / grounding gate
↓
Existing WhatsApp delivery
```

This is not loose document-search RAG. It deliberately separates four responsibilities:

1. **Obligation detection** identifies each question, request, or required response obligation in the claimed turn.
2. **Authoritative resolution** maps each obligation to verified Dietavity facts, relevant customer/commercial context, and applicable policy, producing the permitted claims.
3. **Composition** writes natural Spanish from that resolved material. The composer may not decide Dietavity facts, add unrelated claims, or invent missing capabilities.
4. **Validation** checks that each obligation was addressed and that the proposed response introduces no unsupported Dietavity claim or policy violation. A failing response is regenerated in a controlled way or falls back safely before delivery.

The knowledge base is expected to remain structured and deterministic at this stage; a vector database is not required for the small commercial knowledge surface. Candidate knowledge/policy domains include offer, pricing, payment methods, how the program works, digital location, prepared-food delivery boundaries, personalization, GLP-1 scope, medical boundaries, refunds, privacy, support, checkout, and examples. Retrieval must be narrow: a location question must not cause unrelated claims about payment, checkout, or product details.

This design preserves useful commercial strategy and safety rules, but makes factual grounding explicit. For example, a location question can be resolved to the authoritative digital-service facts and a no-CTA policy; composition then phrases only those facts rather than adding an office, a city, a payment method, or an unrequested sales pitch.

### Ticket 75: established findings and superseded migration path

Ticket 75 established that the V2 supporting infrastructure is substantially functional: the endpoint/network path, JWT-based authentication, model client, Supabase adapters, durable replay protection, and diagnostic/shadow-routing infrastructure were proven. The remaining blocker was the integration at the claimed-turn request boundary: authentication succeeded, but request-contract validation and the shadow integration remained problematic. This was an integration-contract problem, not evidence that the underlying endpoint, model, or data infrastructure was unavailable.

The former Ticket 75 plan—repair the internal claimed-turn integration, run parallel Legacy/V2 shadow turns, evaluate shadow outputs, then promote V2—has been **superseded as the immediate path**. It is not current production work. Likewise, the following are deliberately out of scope for the direct V2 launch: shadow cohorts, parallel Legacy/V2 answer generation, an internal claimed-turn HTTP boundary, a workflow-to-application token call for that boundary, shadow-specific replay machinery, six-stage/model orchestration, and a separate migration/deployment architecture.

This does not discard the grounding architecture or Ticket 75’s useful infrastructure findings. It discards migration machinery whose value is currently lower than rapid learning about whether better sales conversations can convert.

### Direct V2 implementation and rollback plan

```text
Back up active Sales Engine workflow JSON
↓
Modify the existing Ticket 10 workflow’s intelligence/response nodes
↓
Run structural validation
↓
Run 5–10 controlled conversations
↓
Activate V2 in production
↓
Resume Meta Ads and observe conversion/quality
```

Controlled conversations should cover, at minimum, location, price, how the plan is built, GLP-1 availability/scope, medical-dose questions, thanks/closing, explicit purchase intent, objections, and contextual follow-ups. The prior workflow JSON is the immediate rollback artifact: deactivate the updated workflow and restore the backed-up prior version if a material issue appears. No data rollback is implied.

### Why this decision changed

Dietavity is far from profitability, and Legacy response quality is already known to be inadequate. The immediate business question is whether a substantially better sales conversation can help convert paid traffic into customers. At this stage, launch learning and sales velocity outweigh elaborate shadow-first migration machinery. The direct V2 still requires production-quality grounding, validation, transactional safety, and controlled testing; it simply avoids treating co-existence with the response layer being replaced as the primary project.

### Sales clarification — implemented; deployment unconfirmed

Ticket 39 adds three targeted behaviors without a new funnel or intent taxonomy:

| Buyer signal | Implemented behavior |
| --- | --- |
| What happens or what is paid after 28 days | Explain that the initial $149 MXN covers 28 days, renewal is not automatic, and the customer may choose to buy another program; do not invent its future price. |
| Expectation of prepared-food delivery | Clarify that Dietavity supplies a digital program and recipes through the portal, with WhatsApp assistance; it does not deliver prepared meals. |
| Repeated unresolved billing question | Answer the remaining ambiguity or ask one narrow clarification instead of repeating the same price message. |

Explicit purchase/Checkout and support precedence remain intact. Broad openings, product questions, and recipe/customer-assistance paths retain their existing routing.

Recent clarification context comes from `public.messages`, not a separate memory store. It requires the exact claimed inbound and normalized session, the immediately preceding canonically linked accepted sales/Checkout exchange, no intervening inbound, and a maximum age of seven days. Acceptance requires valid provider SID evidence. Context only influences repetition routing when recognized billing semantics and a current billing repetition/unresolved statement are present. Prospect isolation uses canonical session identity because a prospect may not yet have `users.id`.

`Reserve Sales Reply` persists `deterministic_reason` alongside existing `strategy` and `buyer_signal` in `messages.metadata`. No schema change, migration, secret, environment variable, or Stripe behavior change is required.

**Status:** Implemented, final review passed, and approved for controlled deployment. The conversation does not confirm import/activation. Generated artifacts remain inactive; passing tests do not establish production deployment.

## 16. Canonical Message Ledger and Ordering

`public.messages` is the canonical WhatsApp conversation ledger.

Ticket 17 introduced durable per-session processing fields:

```text
processing_order
processing_lease_until
processing_completed_at
```

Features include atomic claims, leases, output gating, failure recovery, durable ordering, and idempotency. This addressed concurrency from overlapping Twilio/n8n executions.

## 17. Secure Portal Recovery - Ticket 28

Ticket 28 introduced secure email-based account recovery with:

- Normalized Stripe email persistence
- Enumeration-safe recovery responses
- Cryptographically random recovery credentials
- Hashed stored tokens
- Expiration
- Single-use redemption
- Conflict-safe behavior
- Paid-account eligibility checks
- Ambiguous duplicate-email failure
- Portal-token rotation after verified portal recovery

A claimed email inside WhatsApp is never authentication.

## 18. Cross-Channel Identity Linking - Ticket 28A

Ticket 28A handles a website customer who later contacts Dietavity through WhatsApp for an account-specific request:

```text
Unknown WhatsApp
↓
Account-specific paid request detected
↓
Secure Dietavity verification link
↓
Customer supplies purchase email
↓
Email verification
↓
WhatsApp linked to canonical users.id
↓
Original pending message resumes automatically
↓
Existing paid assistant answers
```

Ordinary unknown-WhatsApp sales or generic recipe questions do not trigger verification.

### Distinct Semantics

```text
recover_portal
→ verify
→ link if appropriate
→ rotate portal_token

link_whatsapp
→ verify
→ link WhatsApp
→ preserve portal_token
→ resume pending message
```

Ticket 28A was validated end-to-end in production; the customer did not need to resend the original question.

## 19. WhatsApp Outbound Reliability and Recovery

Tickets 36/37/37A addressed Twilio error `21617`, caused by a paid reply exceeding the 1,600-character body limit, and established the current paid-assistant transport protections:

1. **Explicit delivery evidence.** Twilio API acceptance is distinct from handset delivery. Explicit failures override SID-based acceptance; ambiguous responses remain unresolved.
2. **A deterministic size boundary.** Oversized replies are whitespace-compacted and split without blind truncation. Each labeled part is validated against a 1,500 UTF-16-code-unit safe limit before reservation and sending.
3. **Durable multipart reservation.** All parts are reserved atomically with deterministic idempotency keys and metadata linking them to one logical reply.
4. **One logical completion rule.** Normal completion, stale reconciliation, and the Global Error Handler require acceptable transport evidence for all expected parts. Failed or unknown parts preserve FIFO blocking and prevent premature completion or blind duplicate sends.
5. **Canonical response persistence.** Paid-assistant state uses the reserved durable response. The earlier dangling workflow reference was fixed and production validated, with structural regression coverage.

**Production status:** Updated workflows and both Ticket 37A recovery and historical-reopen definitions are installed in production. The ordinary one-part paid-reply canary and normal Twilio reconciliation passed.

### Historical recovery: intentionally not executed

Recovery tooling supports guarded atomic preparation/reopening, ordered send claims, and messaging-window checks while preserving the stored response and reservation identity. The historical recovery itself was intentionally not executed, so it was **not end-to-end validated** and the original reply remains unrecovered. Installed definitions and the successful normal-path canary do not establish successful historical recovery. Incident-specific evidence and execution procedures belong in the recovery runbooks.

## 20. Validation Baseline

Latest reported results after the final Ticket 39 context-scope correction:

| Validation | Result |
| --- | --- |
| Ticket 39 focused tests | 9/9 passed |
| Relevant Sales Engine regressions | 83/83 passed |
| Full repository suite | **384/384 passed** |
| Failures / skipped | **0 / 0** |

Generated workflow synchronization passed. These are reported repository results, not a new test run or production certification performed for this summary. Earlier test counts are superseded.

## 21. Weekly Conversation & Sales Intelligence

The preferred report is `Dietavity Weekly Conversation & Sales Intelligence`, evolved from the Daily Conversation Auditor and manually validated. It should be the sole weekly conversation report. The older overlapping report should be disabled; completion of that action is not confirmed.

```text
Schedule: Monday 08:00
Timezone: America/Mexico_City
Window: Previous seven complete calendar days
Source: public.messages
```

It preserves chronological reconstruction, HMAC anonymization, PII redaction, SMTP, and Global Error Handler integration.

### Analytical Focus

- Sales-funnel signals
- Prospect motivations
- Questions and objections
- What helped or hurt sales
- Customer language for ads, videos, landing pages, slogans, FAQs, and positioning
- Product expectations
- Genuine technical findings only

The report separates `OBSERVED`, `INTERPRETATION`, and `RECOMMENDED ACTION`, grades evidence as strong/moderate/weak, and does not require an engineering ticket every week.

Canonical product facts come from `lib/dietavity-knowledge.js`; unknown capabilities are reported as requiring verification rather than invented. Checkout intent is not proof of purchase. Test/debug traffic is excluded only when reliable metadata identifies it.

The latest report comparison favored this report’s evidence discipline over the older report’s unsupported recommendations. Four-versus-five conversation counts and uncertain customer/prospect classification should be watched if they recur, not treated as proven defects from one small sample. Five conversations justify narrow clarification corrections, not new funnels, subscription machinery, or automatic sales CTAs after every recipe.

## 22. Privacy and Legal Infrastructure

Dietavity includes:

- Privacy notice
- ARCO request flow
- Sensitive-data consent
- Privacy-notice versioning
- PII redaction in operational reports
- Secure recovery credentials
- Conflict-safe identity linking
- No authentication based solely on claimed chat identity

Legal text avoids inventing unresolved provider or legal details.

## 23. Global Error Handling

The production-tested Global Error Handler provides durable:

- n8n execution/error capture
- Database logging
- Email notification

This remains the operational-failure mechanism; the weekly report serves commercial learning. During a Supabase outage, database error logging can itself fail. Email alerting is an independent attempt, not proof that the database record was written. Multipart completion checks also apply in this handler.

## 24. Infrastructure

### Application

- Node.js 20.x
- Express 5.x
- EJS
- PM2
- nginx
- Ubuntu 24.04

### Database

- Supabase
- PostgreSQL
- Key tables: `users`, `profiles`, `purchases`, `programs`, `weeks`, `meal_plans`, `messages`, `onboarding_sessions`, `sales_funnel_events`; legacy subscription records support entitlement checks
- Recovery/verification infrastructure from Tickets 28/28A

### Automation and Integrations

- Self-hosted n8n Community Edition; last observed production version: 2.36.8
- Stripe Checkout
- WhatsApp via Twilio
- Meta Pixel

No server-side Meta Conversions API implementation was introduced. GA and browser Meta Pixel events support funnel measurement; canonical payment records remain the authority for confirmed purchases.

### Deployment boundary

Website files run under PM2, generated workflows are imported into n8n, and migrations change PostgreSQL. These are separate deployment surfaces. Operational credentials, private environment-file locations, token material, and host-specific secret configuration are intentionally not recorded in this summary.

Both Ticket 37A recovery and historical-reopen definitions are installed in production; historical recovery was intentionally not executed or end-to-end validated. Recovery tooling requires separately configured direct PostgreSQL connectivity; application Supabase API access does not configure it automatically. Detailed tooling, incident-file locations, and execution procedures remain in runbooks.

Temporary Codex/SSH access was revoked. PostgreSQL client and ACL utilities were installed during the investigation; they are operational tooling, not new application services.

## 25. Architectural Principles Established

- **Canonical identity:** `users.id`, not WhatsApp, is the customer.
- **Portal as source of truth:** WhatsApp assists but does not own the program.
- **WhatsApp optional:** Customers can purchase and use Dietavity without it.
- **Email verifies ownership:** Email recovery supports secure cross-channel verification.
- **Canonical personalization:** `public.profiles` governs generation; legacy preferences do not override it.
- **Browser data is untrusted:** Sensitive personalization uses canonical server-side data.
- **Messages are durable:** `public.messages` is the canonical WhatsApp ledger.
- **Logical replies are durable:** Multipart reservation, per-part evidence, and shared completion rules protect against duplicate sends and premature completion.
- **Acceptance is not delivery:** Provider API acceptance does not establish handset delivery.
- **Fail closed:** Ambiguous identity and security situations are not guessed.
- **Product facts are canonical:** AI components must not invent capabilities.
- **Obligations before phrasing:** Detect what must be answered, resolve authoritative facts and policy, then compose only within permitted claims.
- **Grounding gate before delivery:** A response must structurally answer its resolved obligations and remain within permitted claims before it reaches the existing delivery path.
- **Evidence before engineering:** A conversation problem does not automatically justify a software ticket.

## 26. Current Status and Open Operational Actions

| Area | Current documented status |
| --- | --- |
| Website funnel and one-time Stripe purchase | Production operational |
| Campaign landing page | Ticket 35 redesign published |
| Setup / canonical profiles | Operational; Ticket 38 production validated |
| Portal / four-week lifecycle | Operational; bounded loading and secure access validated |
| Email recovery / WhatsApp linking | Operational; cross-channel linking production validated |
| Verified-request recovery | Existing one-minute loop confirmed; no blanket runtime retry added |
| Paid WhatsApp assistance | Updated transport protections deployed; ordinary one-part production canary passed |
| Historical failed recipe | Intentionally not recovered; historical multipart recovery remains unvalidated end to end |
| Legacy subscriber continuation | Program 2 production validated; awaiting normal customer start-date selection at last observation |
| Current Sales Engine | Production transactional infrastructure operational; Legacy response section remains live pending direct V2 cutover |
| Ticket 39 sales clarification | Implemented and approved; production deployment remains unconfirmed and should be reconciled during the direct V2 update |
| Ticket 75 shadow-first V2 | Supporting infrastructure proven, but claimed-turn request contract/shadow integration remained problematic; superseded as the immediate migration path |
| Direct production V2 | Chosen September 29; not yet implemented, structurally validated, or production activated |
| Weekly Sales Intelligence | Operational and preferred report |
| Older overlapping report | Disable / confirm disabled status |
| Automated tests | 384 passed, 0 failed, 0 skipped after Ticket 39 |
| Commercial validation | Repeatable paid acquisition remains unproven |

### Next controlled change: direct production V2

Before modifying production, export and preserve the currently active `Dietavity Sales Engine (Ticket 10)` workflow JSON as the rollback version. Implement the obligation-grounded RAG section in that existing workflow; do not introduce the superseded shadow-first architecture as a launch dependency. Validate the workflow structure and credentials, ensure the existing claim/order, identity, payment-state, durable outbound, and Global Error Handler paths remain connected, then run 5–10 controlled conversations that cover the defined regression set.

When the controlled set passes, activate only one authoritative production Sales Engine and monitor workflow executions, message-ledger evidence, and provider transport evidence. If a material issue occurs, deactivate the updated version and restore the saved pre-V2 workflow JSON. Resume Meta Ads after production activation and use real conversation quality and conversion behavior as the next learning loop.

### Ticket 39 deployment reconciliation

Confirm whether Ticket 39 was activated before or while preparing the direct V2 update. Preserve its useful clarification behavior where it remains consistent with the resolved obligations and policy model. Validate continuation, delivery confusion, and repeated billing questions with an authorized test identity, and inspect the existing ledger metadata as appropriate. Cut over with only one production Sales Engine active, then monitor executions and transport evidence.

Do not import the Stripe sandbox for Ticket 39: it was regenerated for synchronization, contains none of the Ticket 39 functional nodes, and has no Ticket 39 functional change. No SQL migration or data rollback is required. Workflow rollback means deactivating the new version and restoring the backed-up prior version.

Confirm the older overlapping weekly report is disabled, then observe real conversations for at least the next reporting cycle before expanding scope.

## 27. Immediate Priorities

### Priority 1 - Replace the Legacy response layer and restart learning

Complete the direct production V2 in the existing Sales Engine: backup, workflow modification, structural validation, 5–10 controlled conversations, activation, and Meta Ads resumption. This is the only near-term engineering initiative elevated above commercial work because inadequate Legacy responses currently impair the sales experiment itself.

Do not restart the shadow-first migration as a prerequisite. The direct V2 must retain established transactional protections and must not let the composer invent Dietavity facts.

### Priority 2 - Generate Revenue

Determine whether the offer can acquire paying customers economically:

```text
Meta traffic
→ Landing-page engagement
→ Checkout initiation
→ Purchase
```

Evaluate the current headline and reduced-decision-fatigue promise against the published landing page. Historical pre-redesign traffic showed interest but no reported campaign sales; those earlier figures are not a post-redesign conversion baseline or proof that every stored purchase was organic revenue.

### Priority 3 - Creative Development

Develop and test stronger Reels, carousels, hooks, headlines, slogans, meal imagery, and problem/solution concepts. Emphasize the practical problem Dietavity solves rather than relying primarily on longevity.

### Priority 4 - Measure the Landing-Page Funnel

```text
Ad impressions
→ Clicks
→ Landing-page visits
→ CTA interaction
→ Checkout
→ Purchase
```

This separates advertising, audience, positioning, landing-page, offer, checkout, and trust constraints.

### Priority 5 - Learn from Buyers and Prospects

Use Meta performance, landing-page behavior, purchases, WhatsApp conversations, and weekly Sales Intelligence together. WhatsApp is particularly valuable as qualitative research alongside quantitative funnel data.

Watch whether clear continuation answers reduce hesitation, how often digital meal plans are confused with prepared-food delivery, and whether useful immediate recipe interactions precede purchase. Preserve helpful recipe conversations without forcing a sales CTA into every answer. Do not infer broad patterns from five conversations.

### Priority 6 - Engineering Only Where It Unlocks Revenue

New technical work should remove a conversion blocker, improve measurement, fix a production defect, reduce meaningful operational risk, or enable an important experiment. “Could be architecturally nicer” is not sufficient by itself.

### Deferred Product Direction

Deeper personalization and a more practical shopping list are potential differentiators after revenue evidence. Proposed work includes meaningful goals, budget tiers, ingredient normalization, and a canonical personalized ingredient set shared by meal planning, shopping lists, and WhatsApp assistance. Regional/seasonal availability would be an estimate, not live supermarket inventory. These are backlog concepts, not delivered capabilities. A whole-site visual redesign is likewise deferred.

## 28. Open Risks

1. **Product-market fit remains unproven.** The largest risk is commercial: whether enough people will pay at an economically sustainable acquisition cost.
2. **Landing-page conversion is critical.** Direct selling means the page must answer questions and build trust without a long WhatsApp interaction.
3. **Creative/message fit needs validation.** Longevity-heavy advertising underperformed; practical positioning still needs empirical evidence.
4. **Meal perception matters.** Meals must feel achievable, familiar, affordable, appetizing, healthy, and relevant to Mexican/Latin American users.
5. **Health-condition expectations.** Prospects may expect support for diabetes, prediabetes, or hypertension; Dietavity must not imply clinical treatment.
6. **Low data volume.** Small numbers of purchases or conversations can mislead conclusions.
7. **V2 cutover risk.** Direct production V2 has not yet been implemented or controlled-tested. The response layer must preserve existing claims, ordering, and outbound protections while improving grounding and relevance.
8. **Known operational limits.** Ticket 39 deployment and older-report deactivation remain unconfirmed; historical multipart recovery was not completed; simultaneous program initialization can still create duplicates.
9. **Infrastructure can consume founder attention.** The foundation is mature enough for commercial validation, so each new engineering request should be evaluated for immediate customer impact.

## 29. Current Strategic Thesis

Dietavity has transitioned from primarily a sophisticated WhatsApp nutrition assistant into a digital product with a clear acquisition, fulfillment, support, and feedback architecture:

```text
ACQUISITION
Meta Ads
↓
Landing Page
↓
Direct Checkout
↓
Stripe Payment

PRODUCT
Setup
↓
Personalization
↓
28-Day Program
↓
Portal

SUPPORT / LEARNING
WhatsApp
↓
Sales questions
Customer assistance
Secure account linking
Qualitative market intelligence

FEEDBACK LOOP
Meta data + funnel data + purchases + WhatsApp conversations
↓
Weekly sales intelligence
↓
Ads / creative / positioning / landing page
↓
More experiments
↓
Revenue
```

The technical foundation is no longer Dietavity's primary constraint. The next phase is discovering a repeatable commercial engine: find the message that makes the right people click, the offer and landing page that make them buy, and the product experience that makes the purchase feel worthwhile. That should drive the roadmap.

The direct V2 is a focused exception: it replaces a known-quality constraint in the WhatsApp sales experience without reopening a broad infrastructure program. Its success criterion is not architectural sophistication; it is grounded, relevant customer answers and faster learning about sales conversion.

## 30. Source and Maintenance Boundary

This revision preserves the architecture and strategy from the August 29 summary and incorporates the later implementation reports, operator outputs, production confirmations, and decisions in [Dietavity project - 11 (We need money!)](chatgpt-conversation://6a832411-7198-83e8-b12c-7ced277f2438) and [Dietavity project - 13 (We need money!)](chatgpt-conversation://6ab9c3ca-d554-83e8-b49e-3f70fac0b5e4). Later corrections and observed outcomes take precedence over earlier proposals. Proposed work is not treated as deployed functionality.

Update the operational status when the direct V2 workflow is implemented, controlled-tested, activated, rolled back, or superseded; also update Ticket 39 activation, report deactivation, and subsequent production checks when confirmed. Do not overwrite historical incident evidence or equate repository test success with a production rollout.

## 31. WP2.6 Final Production Cutover — October 13, 2026

**Status: production-qualified and active.** This record supersedes earlier WP2.6 planning, paused-cutover, and legacy-selected status statements in this summary.

```text
Twilio WhatsApp
→ n8n inbound persistence / ordering / claim
→ Node Conversation Engine
→ n8n persistence / outbound reservation / Twilio delivery
→ WhatsApp
```

n8n remains responsible for orchestration and durable delivery semantics. Node owns conversational intelligence: semantic extraction, authority, ephemeral food state, obligation interpretation/reconciliation, V1.3 recommendation selection, safety boundaries, composition, and the final delivery decision.

### Cutover and boundary

The Node-selected Ticket 10 workflow was imported and activated manually through the n8n UI. `Select Direct RAG Backend` selects Node. The legacy Direct RAG intelligence branch remains present but unselected as a temporary manual rollback option; it is not a launch prerequisite to delete it.

The first real Node-selected execution exposed one handoff mismatch: the real n8n/Postgres claim path supplied `processing_order` as a numeric string such as `"474"`, while the request builder had required a JavaScript integer. The boundary now accepts only canonical positive decimal strings, normalizes them to `Number`, validates the normalized positive safe integer, and emits the numeric value. Empty, whitespace-padded, leading-zero, exponent, fractional, unsafe, zero, negative, and other noncanonical representations fail closed. No database, schema, or upstream claim change was required.

### Production qualification

The real WhatsApp production path passed this sequence through WhatsApp → n8n → Node Conversation Engine → n8n persistence/delivery → WhatsApp:

1. `Tengo pollo. ¿Qué me recomiendas?` returned a useful chicken recommendation.
2. `También tengo tortillas, aguacate y jitomate.` preserved conversational food continuity.
3. `Ya comí pollo. ¿Qué puedo comer ahora?` no longer treated chicken as currently available.
4. `Tengo poca hambre.` returned bounded low-appetite nutrition guidance without medical overreach.
5. A medication dose-change question refused dose-change guidance and referred the person to the prescribing professional.

One duplicate response occurred because the previously failed inbound turn was processed after the handoff fix. Treat it as a historical incident, not an active defect, unless it recurs.

### Current decision and priority

WP2.6 is complete enough for commercial launch. Explicitly defer deletion of the legacy intelligence branch, additional Conversation Engine refinements, low-appetite optimization, investigation of the one-time duplicate, infrastructure cleanup, additional observability/hardening, and broad backend work unless real production evidence shows a concrete blocker or materially commercial defect.

Immediate priority is revenue validation:

1. Verify the website purchase funnel once end to end.
2. Review and finalize the commercial landing page.
3. Restart Meta traffic.
4. Diagnose the first commercial bottleneck from observed behavior: impressions without clicks indicate creative; clicks without Checkout indicate landing-page or offer issues; Checkout without purchase indicates trust, price, or payment friction; purchases shift focus to traffic and economics optimization.
