# Ticket 8 — Sales Engine v3: Conversion Architecture, Deterministic Commercial Policy, Unified AI Identity & Funnel Instrumentation

## 1. Objective

Replace the current unknown-user WhatsApp onboarding/sales branch with Sales Engine v3.

The goal is to create a sales system that is:

- Conversational rather than rigid.
- Conversion-focused without being aggressive.
- Context-aware.
- Safe against ambiguous affirmations such as ok, perfecto, or unrelated sí.
- Deterministic for commercial side effects.
- Consistent with the current Dietavity 28-day product.
- Measurable from first lead through program readiness.
- Auditable when Checkout is authorized.
- Consistent in Dietavity identity, product facts, and food philosophy across AI prompts.

This is a substantial replacement of the unknown-user sales branch, not another incremental patch of the current onboarding state machine.

The existing audit concluded that v3 should substantially replace the unknown-user onboarding branch while preserving Twilio ingress, user routing, one-time Stripe Checkout/payment verification, Setup/program infrastructure, the paid-user assistant, and Ticket 6 legacy cancellation. ONBOARDING-V3-AUDIT.md

## 2. Scope Boundary

### Replace / redesign

Redesign the unknown-user sales/onboarding logic currently responsible for:

- onboarding_state-driven sales progression.
- Generic affirmative detection.
- Generic negative detection.
- Thank-you routing.
- CTA text detection.
- ask_subscription authorization behavior.
- Multiple independent sales prompt builders.
- Repeated product facts across prompts.
- Existing unknown-user sales response strategy.

Do not preserve obsolete sales architecture merely for compatibility if v3 replaces its function.

### Preserve

Do not redesign unrelated production infrastructure:

- Twilio WhatsApp ingress.
- Initial user lookup / known-vs-unknown routing.
- Ticket 5 paid-user WhatsApp assistant.
- Ticket 6 legacy subscription cancellation.
- Existing one-time Stripe Checkout infrastructure where compatible.
- Verified Stripe payment webhook.
- purchases.
- /setup.
- Sensitive-data consent and consent evidence.
- 28-day program initialization.
- Weeks and meal-plan generation.
- Portal.
- Ticket 1 authorization architecture.
- Ticket 2 backend-only database hardening.
- Ticket 3 readiness logic.
- Tickets 4–7C behavior outside this ticket's explicit scope.
- Global Error Handler.

A verified existing Dietavity user must continue to bypass Sales Engine v3.

## 3. Current Product — Canonical Commercial Facts

Sales Engine v3 must use a single authoritative representation of the current Dietavity offer.

### Product

**Programa personalizado Dietavity de 28 días**

### Primary sales promise

En Dietavity te decimos qué comer cada día durante 28 días, con un programa personalizado inspirado en hábitos de alimentación de países longevos.

### Price

**$149 MXN**

### Billing

One-time payment.

No subscription.

No automatic renewal.

### Program

28 days.

Includes:

- Breakfast.
- Lunch.
- Dinner.
- Snack.

### Delivery

Program is accessed through the Dietavity portal.

### Setup

After verified payment, the customer completes Setup to provide the information required for personalization.

### Start date

Purchase date and program start date are separate.

The customer may select a start date from:

```text
today
through
today + 30 calendar days
```

Verify that the current backend/portal implementation supports and enforces this exact window.

If the existing implementation differs, report the discrepancy before silently changing product behavior.

### WhatsApp assistance

During the program, users may request on-demand help through WhatsApp, including appropriate:

- Recipes.
- Meal ideas.
- Practical healthy-eating guidance.
- Restaurant guidance.

Do not describe this as proactive or daily messaging.

### Accepted payment methods

Proactively mention only currently accepted methods:

- Credit card.
- Debit card.
- OXXO.
- Apple Pay.

Do not proactively list unsupported payment providers.

If the lead asks about an unsupported method, e.g. PayPal or Mercado Pago, answer in substance:

Por el momento aceptamos tarjeta de crédito, tarjeta de débito, OXXO y Apple Pay.

Do not maintain customer-facing lists of unsupported providers.

## 4. Canonical Dietavity Role & Identity

The current workflow historically accumulated similar but non-identical identity sections because AI nodes were added at different times.

Ticket 8 must eliminate this prompt drift.

Create one canonical Dietavity Role & Identity source and inject/reuse it wherever an AI node represents Dietavity, rather than maintaining independently evolving copies wherever technically practical. Canonical content:

```text
# Rol e Identidad
Eres la asistente de nutrición de Dietavity, un servicio de
alimentación personalizada apoyado por inteligencia
artificial.
Dietavity se inspira en patrones de alimentación y hábitos
de bienestar de poblaciones con alta longevidad,
especialmente de Japón, Italia, España y Noruega, y los
combina con principios generales de alimentación saludable
cuando sea apropiado.
Tu personalidad es cálida, clara, empática y cercana.
Hablas de Dietavity en primera persona plural ("en
Dietavity", "te ayudamos", "personalizamos") y nunca finges
ser una persona humana ni afirmas que un nutriólogo humano
está elaborando individualmente las recomendaciones cuando
no es así.
```

Do not use:

Eres la nutricionista de Dietavity.

if that could imply a human or licensed professional personally provides the service.

AI use must be disclosed accurately when relevant or directly asked.

## 5. Canonical Food Philosophy

Create a shared Dietavity food-philosophy source for AI tasks that generate or discuss meals.

Canonical principles:

```text
# Filosofía Alimentaria de Dietavity
Las recomendaciones de Dietavity se inspiran en patrones de
alimentación asociados con poblaciones de alta longevidad,
pero no deben limitarse a reproducir platos tradicionales
de esos países.
Adapta esos principios a alimentos, sabores y preparaciones
familiares para personas en México y Latinoamérica.
Prioriza:
- Comidas sencillas, apetecibles y fáciles de preparar.
- Ingredientes comunes y fáciles de encontrar en México y
Latinoamérica.
- Verduras, frutas, leguminosas, cereales integrales,
nueces y semillas.
- Fuentes adecuadas de proteína según las preferencias y
necesidades del usuario.
- Pescado y mariscos cuando sean apropiados.
- Grasas principalmente insaturadas y alimentos mínimamente
procesados.
- Variedad de alimentos y estilos culinarios.
- Preparaciones realistas para la vida cotidiana.
La inspiración internacional debe orientar los principios
nutricionales, no imponer una cocina extranjera.
Una comida puede ser mexicana o latinoamericana si respeta
los principios nutricionales de Dietavity. No es necesario
que el plato sea originario de Japón, Italia, España o
Noruega.
```

The intended philosophy is:

Global inspiration + local accessibility.

Do not interpret longevity nutrition as requiring every meal to be Japanese, Mediterranean, or Nordic.

Likewise, do not artificially Mexicanize every meal.

A valid Dietavity program may naturally include meals such as:

- Enchiladas de pollo.
- Salmon with potatoes and salad.
- Japanese-inspired rice, vegetables and egg.
- Lentil soup.
- Mexican-style breakfasts.
- Mediterranean preparations.
- Nordic-inspired fish.
- Other nutritionally compatible everyday meals.

## 6. Shared Meal-Generation Rules

Any AI prompt capable of generating:

- Meal plans.
- Meal examples.
- Recipes.
- Emergency meals.
- Meal ideas.
- Swaps.
- Similar food recommendations.

must inherit equivalent canonical rules:

```text
# Reglas de Generación de Alimentos
- Ofrece comidas sencillas, apetecibles y fáciles de
elaborar.
- Prioriza ingredientes fáciles de encontrar en México y
Latinoamérica.
- Adapta los principios alimentarios de Dietavity al
contexto local sin limitarte a platos tradicionales
mexicanos o latinoamericanos.
- Mantén variedad entre cocina mexicana/latinoamericana e
inspiración mediterránea, japonesa, nórdica y otras
preparaciones compatibles con los principios de Dietavity.
- No fuerces ingredientes o platos extranjeros cuando
exista una alternativa local equivalente.
- No "mexicanices" artificialmente todas las comidas.
- Prioriza alimentos mínimamente procesados y preparaciones
realistas para la vida cotidiana.
- Respeta siempre las preferencias, restricciones, alergias
y demás información válida del usuario disponible para esa
generación.
- En ejemplos previos a la compra, deja claro que son
ilustrativos y no recomendaciones personalizadas para ese
usuario.
```

Task-specific meal-generation prompts may add stricter nutritional requirements but must not redefine or contradict these shared principles.

## 7. Core Sales Architecture

Do not use one field to represent conversation state, message meaning, and commercial authorization.

Separate:

```text
conversation_stage
+
buyer_signal
+
pending_action
+
commercial context
```

Architecture:

```text
USER MESSAGE
│
▼
Load lead context
│
▼
AI interpretation
│
▼
Structured buyer signal / topic / entities
│
▼
Deterministic commercial policy
│
▼
Response strategy router
│
├──────────────► response generation
│
└──────────────► authorized side effect
```

Fundamental invariant:

AI interprets. Deterministic policy authorizes. Infrastructure executes. The LLM must never independently authorize Stripe Checkout, reminders, or other consequential commercial side effects.

## 8. Conversation Stages

Use a deliberately small durable taxonomy:

```text
new
evaluating
offer
checkout_pending
closed
new
```

New unknown lead.

```text
evaluating
```

Lead is learning, asking questions, discussing objectives, objections or timing.

```text
offer
```

Purchasing is now the active commercial subject.

This does not itself authorize Checkout.

```text
checkout_pending
```

A Checkout Session has successfully been created and the URL sent.

```text
closed
```

Explicit rejection / opt-out.

Do not use closed merely because someone wants to buy later.

## 9. Buyer Signals

Interpret each inbound turn into a structured buyer signal.

Initial taxonomy:

```text
information_request
positive_interest
question
objection_price
objection_trust
objection_timing
deferred_interest
explicit_purchase
contextual_affirmation
ambiguous_acknowledgement
gratitude
rejection
support_issue
other
```

Additional structured fields may capture:

```text
topic
goal
timing
explicit_reminder_request
needs_clarification
```

Do not create dozens of durable states for objections.

An objection is a signal, not a conversation stage.

## 10. Pending Actions

Keep consequential actions small and explicit:

```text
none
respond
ask_purchase_confirmation
send_checkout
schedule_requested_reminder
close
```

If necessary:

```text
support_handoff
```

may be added only where justified by existing support behavior.

Critical invariant:

Only pending_action = send_checkout, after deterministic policy authorization, may reach Checkout creation.

## 11. One-Message / One-Question Rule

Every Dietavity sales response may end with at most one question.

Do not produce multi-path questions such as:

¿Quieres saber más o prefieres que te muestre un ejemplo?

Do not ask:

¿Cuál es tu objetivo y qué se te dificulta más?

Prefer one clear action:

¿Quieres que te muestre un ejemplo?

or:

¿Qué te gustaría conseguir principalmente?

Additional rule:

Each Dietavity message should have one primary conversational objective.

Examples:

```text
Explain value → one discovery question
Show example → one progression question
Explain offer → one purchase question
Answer objection → zero or one appropriate question
Clarify ambiguity → one clarification question
Close → no question
```

Also:

Do not ask a question unless its answer can change Dietavity's next useful action.

## 12. Do Not Repeat Known Information

Do not repeatedly restate:

- Price.
- Features.
- Payment details.
- Cancellation information.
- Product description.
- Other facts the lead already acknowledged.

Repeat a fact only when necessary to answer the current question or complete a consequential commercial action.

## 13. Discovery Strategy

For a generic Meta-style entry such as:

¡Hola! Quiero más información.

and when the lead has not already expressed their goal, use one light discovery question.

Preferred opening:

```text
¡Hola! 👋 En Dietavity te decimos qué comer cada día
durante 28 días, con un programa personalizado inspirado en
hábitos de alimentación de países longevos.
¿Qué te gustaría conseguir principalmente: comer más
saludable, bajar de peso, tener más energía o simplemente
organizar mejor tus comidas?
```

Discovery is:

- Useful.
- Light.
- Skippable.
- Never mandatory before answering a direct question.
- Never allowed to obstruct explicit purchase intent.

Do not recreate Setup inside WhatsApp.

Do not collect full:

- Age.
- Weight.
- Allergies.
- Conditions.
- Diet.
- Dislikes.
- Activity.

during the sales conversation merely because Setup later collects them.

## 14. Illustrative Meal Example

After a lead gives a goal, Dietavity may connect that goal to the product and ask:

¿Quieres que te muestre un ejemplo de cómo podría verse uno de tus días?

If accepted, show one concise illustrative day.

Example:

```text
Claro 😊 Un día podría verse así:
🌅 Desayuno: Yogur natural con avena, frutos rojos y nueces
☀ Comida: Pollo al limón con verduras asadas y arroz
integral
🌙 Cena: Tostadas de aguacate y atún con ensalada
🍎 Snack: Manzana con un poco de crema de cacahuate
Tu programa completo se personaliza con la información que
nos das en la configuración.
¿Quieres que te cuente qué incluye el programa?
```

The exact food example may vary appropriately according to the lead's expressed objective.

Pre-purchase examples are:

**illustrative product demonstrations**

and are not personalized recommendations.

## 15. Canonical Happy Path

Reference flow:

```text
Meta / WhatsApp lead
↓
Primary value proposition
↓
One light discovery question
↓
Lead objective
↓
Personalized relevance
↓
Offer illustrative example
↓
Example
↓
Offer explanation
↓
Purchase confirmation
↓
Valid authorization
↓
Checkout
```

Target normal path: approximately four Dietavity messages before Checkout, but this is not a rigid requirement.

The lead determines the pace.

## 16. Fast Paths

### Price-first

Lead:

¿Cuánto cuesta?

Answer immediately.

Do not force discovery first.

Example:

```text
El programa personalizado de Dietavity cuesta $149 MXN en
un solo pago e incluye 28 días de alimentación adaptados a
tu información y preferencias.
¿Quieres que te cuente qué incluye?
```

### Purchase-ready

Lead:

Quiero comprar el programa.

Do not force the lead through discovery, meal example and offer explanation.

If no material unresolved question exists, this can authorize Checkout directly.

Principle:

Never make a customer prove they want to buy.

## 17. Commercial Offer Response

When the lead requests/accepts the offer explanation, use the canonical facts.

Reference response:

```text
El programa cuesta $149 MXN en un solo pago e incluye 28
días personalizados con desayuno, comida, cena y snack. Lo
consultas en tu portal Dietavity y durante el programa
puedes escribirnos por WhatsApp para pedir recetas, ideas
de comidas y orientación práctica.
Después del pago completas una breve configuración y eliges
cuándo comenzar, hasta 30 días después.
¿Quieres comenzar tu programa de 28 días?
```

This question creates valid commercial context.

Persist:

```text
last_question_type = purchase_confirmation
last_question_at = now
offer_version = 28d-149-v1
commercial_context_expires_at = now + 30 minutes
```

## 18. Checkout Authorization

There are only two valid Checkout strategies:

```text
direct_purchase
purchase_confirmation
```

### A. Explicit purchase

Examples:

```text
Quiero comprarlo.
Mándame el enlace.
Pásame el link para pagar.
¿Dónde pago?
Quiero empezar.
```

These may independently authorize Checkout if:

- There is no material unresolved question.
- There is no safety issue.
- The current product is available.
- Policy validation passes.

No redundant confirmation is required.

### B. Contextual purchase affirmation

Example:

Dietavity:

¿Quieres comenzar tu programa de 28 días?

Lead:

Sí.

Checkout may be authorized only when:

```text
last_question_type = purchase_confirmation
AND
commercial context age <= 30 minutes
AND
offer_version = current
AND
affirmation is sufficiently strong
```

## 19. Strong vs Weak Affirmations

Do not treat all positive-sounding short messages equally.

### Strong contextual affirmations

Examples:

```text
sí
sí quiero
claro
adelante
```

These may authorize Checkout when answering a valid recent purchase-confirmation question.

### Weak acknowledgements

Examples:

```text
ok
okay
perfecto
vale
listo
```

These must not independently authorize Checkout, even when following a purchase question.

If purchase context strongly suggests that this is what the user means, clarify:

¿Quieres que te envíe el enlace para adquirirlo?

Only the subsequent valid authorization may send Checkout.

This specifically prevents recurrence of the historical ambiguous-affirmation problem identified in the audit. ONBOARDING-V3-AUDIT.md

## 20. Contextual Affirmations Must Respect Question Type

Examples:

```text
last_question_type = show_example
user = "sí"
→ show_example
→ NEVER Checkout
last_question_type = explain_offer
user = "sí"
→ explain_offer
→ NEVER Checkout
last_question_type = purchase_confirmation
user = "sí"
valid <=30-minute context
→ purchase_confirmation
→ Checkout authorized
```

This behavior must have regression tests.

## 21. Material-Question Override

A message may contain explicit purchase intent and a material unresolved question simultaneously.

Example:

Sí quiero comprarlo, pero ¿aceptan OXXO?

Do not send Checkout before answering the question.

Material questions include at least:

```text
payment
price
program start/timing
refund
health/safety
privacy
product scope
```

Policy:

```text
material unresolved question
↓
answer first
↓
optional one purchase-confirmation question
↓
authorization on next valid turn
```

For example:

Sí, puedes pagar con OXXO. También aceptamos tarjeta de crédito, débito y Apple Pay.

¿Quieres que te envíe el enlace?

## 22. Response Strategy Router

Select exactly one primary strategy per inbound turn.

Supported strategies:

```text
direct_purchase
purchase_confirmation
clarify
answer_question
handle_objection
discovery
show_example
explain_offer
deferred
reminder
graceful_close
acknowledgement
conversational
```

Suggested routing precedence:

1. safety / substantive medical issue
2. verified existing purchase/user transition
3. explicit rejection
4. explicit reminder request
5. material unresolved question
6. explicit purchase intent
7. contextual response to known last_question_type
8. consequential ambiguity requiring clarification
9. objection
10. deferred interest
11. generic information request + goal unknown → discovery
12. positive interest / appropriate progression
13. acknowledgement / gratitude
14. conversational fallback Do not blindly implement ordering if existing workflow constraints require a safer equivalent; preserve the policy semantics.

## 23. Direct Questions

Answer direct questions before trying to progress the sale.

Canonical topics may include:

```text
price
payment_methods
what_is_included
how_it_works
post_purchase
start_date
personalization
portal
WhatsApp_assistance
AI
privacy
payment_security
refund
diet_support
allergies
health_scope
```

A direct question does not automatically receive a purchase CTA.

## 24. Commercial vs Sensitive Questions

### Commercial questions

Examples:

- Price.
- What's included.
- Payment.
- Start date.

These may naturally end with one progression question.

### Product questions

Examples:

- Meal types.
- Dietary preferences.
- Examples.

These may progress to product demonstration or offer explanation.

### Trust / sensitive questions

Examples:

- AI.
- Medical conditions.
- Allergies.
- Privacy.
- Payment security.

Answer the issue clearly first.

Generally do not append a purchase CTA on the same turn after a substantive health/privacy concern.

## 25. Objection Handling

Universal policy:

```text
Understand
↓
Answer directly
↓
Resolve/explain
↓
Decide whether any next question is genuinely useful
```

Do not use:

```text
objection
→ generic reassurance
→ repeat whole offer
→ CTA
```

### Price

Example:

Se me hace caro.

Possible response:

```text
Entiendo. Son $149 MXN en un solo pago por un programa
personalizado de 28 días, así que equivale a poco más de $5
MXN por día. Además, no hay mensualidad ni renovación
automática.
```

Do not necessarily ask another question.

Never invent:

- Discounts.
- Scarcity.
- Deadlines.
- Bonuses.
- Guarantees.
- Promotional prices.

### Trust

Answer factually.

If the user asks what payment processor is used, answer accurately.

Do not unnecessarily expose unrelated infrastructure.

### AI

If asked whether AI is used, answer clearly.

Do not obscure it behind phrases such as only:

tecnología avanzada. Never imply that a human nutritionist individually creates the program when that is not true.

### Timing

If the lead will be ready within the allowed scheduling window, explain that purchase and program start can differ.

### “I need to think”

Do not pressure.

Example:

```text
Claro. Tómate el tiempo que necesites. Cuando quieras
continuar, puedes escribirnos por aquí.
```

No question required.

## 26. Medical / Health Scope

If the lead mentions allergies or health conditions, explain accurately that Setup allows relevant information to be provided for personalization.

Do not imply diagnosis or medical treatment.

Dietavity must not claim to replace appropriate medical or professional care.

Do not append a forced purchase CTA immediately after a substantive health/safety concern.

## 27. Weight-Loss Claims

Do not guarantee a specific weight loss.

If asked:

¿Cuánto peso voy a bajar?

answer in substance that results vary and cannot be guaranteed.

Do not invent expected kilogram ranges.

Any weight-management claim must reflect actual product capabilities.

## 28. Capability Claims Must Match Product Behavior

Sales claims must be backed by actual implementation.

Examples:

- Portions.
- Personalization.
- Supported diets.
- Allergies.
- Medical-condition handling.
- Program scheduling.
- WhatsApp assistance.

If the code does not support a claim reliably, do not add that claim to sales copy merely because it sounds attractive.

Report discrepancies.

## 29. Deferred Interest

Examples:

```text
Cuando regrese.
El próximo mes.
Déjame pensarlo.
Después lo compro.
```

Default behavior:

- Respond naturally.
- Do not schedule proactive contact.
- Do not automatically close the lead.
- Do not force another CTA.

Dietavity's default policy is:

No proactive sales messages.

This is intended to reduce spam risk and unnecessary WhatsApp/Twilio messaging.

## 30. Explicit Reminder Exception

A proactive reminder is allowed only when the lead explicitly requests one.

Example:

Recuérdame en dos semanas.

Requirements:

```text
explicit_reminder_request = true
AND
requested timing is resolvable
```

If timing is unclear:

Claro. ¿Qué día quieres que te lo recuerde?

Only one clarification question.

Once resolved:

```text
pending_action = schedule_requested_reminder
```

Rules:

- Maximum one reminder per explicit request.
- No automatic second follow-up.
- Use an appropriate approved WhatsApp template where required.
- Do not transform this into a general lead-nurture campaign.

## 31. Explicit Rejection

Examples:

```text
No gracias.
No me interesa.
Ya no quiero información.
```

Route to:

```text
graceful_close
```

Example:

```text
Claro. Gracias por conocer Dietavity. Si en otro momento te
interesa, puedes escribirnos por aquí.
```

No question. No CTA.

No reminder.

Do not attempt to overcome an explicit rejection.

## 32. Gratitude / Acknowledgements

Examples:

```text
Gracias.
Perfecto.
Ok.
Entiendo.
```

Default:

```text
pending_action = none
```

Use a short natural response where appropriate.

Example:

¡Con gusto! 😊

Do not use these messages as generic purchase authorization.

## 33. Conversational Fallback

Humans will send messages outside the anticipated taxonomy.

Allow a conversational fallback, but enforce:

```text
pending_action = none
```

Fallback must never:

- Send Checkout.
- Schedule reminders.
- Perform another commercial side effect.

## 34. Multi-Intent Messages

Do not generate several independent responses to one message. Example:

Me interesa pero estoy viajando, regreso el 20 y quería saber si aceptan OXXO.

Interpret all useful signals:

```text
positive interest
timing
payment question
```

Preserve context, but respond primarily to the most immediately actionable unresolved need.

Do not create three simultaneous conversational branches.

## 35. Response Generation Contract

The response generator should receive constrained structured inputs.

Conceptually:

```json
{
"strategy": "answer_question",
"topic": "payment_methods",
"facts": {
"accepted_methods": [
"credit_card",
"debit_card",
"oxxo",
"apple_pay"
]
},
"max_questions": 1,
"allow_purchase_cta": false
}
```

The LLM has freedom over natural Spanish phrasing.

It does not have freedom over:

- Product price.
- Billing model.
- Payment methods.
- Start-date limit.
- Checkout authorization.
- Reminder authorization.
- Refund policy.
- Medical scope.
- Other canonical business facts.

## 36. Checkout Response

After successful authorization and Checkout Session creation:

```text
¡Perfecto! 😊 Tu programa personalizado de 28 días cuesta
$149 MXN en un solo pago.
Puedes adquirirlo aquí:
[CHECKOUT URL]
```

No question.

Do not ask:

¿Me avisas cuando hayas pagado?

Payment state must come from verified Stripe infrastructure.

## 37. Checkout State Ordering

Do not mark a lead checkout_pending merely because the system intends to create Checkout.

Conceptually:

```text
authorize
↓
create Stripe Checkout Session
↓
persist Checkout evidence
↓
send Checkout URL
↓
checkout_pending
```

State must reflect reality. Preserve robust failure behavior and Global Error Handler routing.

Do not allow a failed Checkout creation to masquerade as a successful checkout_pending transition.

## 38. After Checkout

Once Checkout has been sent:

- Do not repeatedly pitch.
- Do not repeatedly create new Checkout Sessions without a legitimate reason.
- Do not trust "ya pagué" as proof of payment.
- Use verified payment state.

Once verified purchase exists, the customer must leave Sales Engine v3 and enter the existing post-purchase path.

## 39. Data Architecture

Maintain three distinct responsibilities:

```text
onboarding_sessions
= current operational context
onboarding_chat_memory
= conversational history
sales_funnel_events
= append-only commercial history
```

Do not use chat memory as the authoritative source for consequential commercial authorization.

Do not turn onboarding_sessions into an analytics history table.

## 40. onboarding_sessions v3

Evolve the current table toward current operational context.

Target conceptual fields:

```text
session_id
conversation_stage
last_question_type
last_question_at
offer_version
commercial_context_expires_at
checkout_authorization_type
checkout_authorized_at
checkout_session_id
checkout_sent_at
reminder_requested_at
reminder_scheduled_for
created_at
updated_at
```

Allowed last_question_type values should include at least:

```text
primary_goal
show_example
explain_offer
purchase_confirmation
reminder_date
```

Use NULL rather than unnecessary sentinel values where appropriate.

Do not permanently store current buyer_signal or response strategy here merely because they are convenient. Those are per-turn/business-history concepts.

## 41. Checkout Evidence

Persist enough evidence to answer:

Why did Dietavity send this Checkout link?

At minimum:

```text
offer_version
checkout_authorization_type
checkout_authorized_at
checkout_session_id
checkout_sent_at
```

Authorization type:

```text
explicit
contextual
```

This must be auditable.

## 42. New sales_funnel_events Table

Add a backend-only append-oriented table conceptually similar to:

```sql
CREATE TABLE public.sales_funnel_events (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
session_id text,
user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
event_type text NOT NULL,
event_key text UNIQUE,
buyer_signal text,
topic text,
strategy text,
offer_version text,
metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
created_at timestamptz NOT NULL DEFAULT now()
);
```

Adapt types/constraints/indexes to the existing schema conventions after inspecting the real database schema.

Do not blindly execute this illustrative SQL without checking existing constraints and architecture.

The table must remain inaccessible to frontend anonymous/authenticated clients under the Ticket 2 backend-only security model.

## 43. Core Funnel Events

Implement these canonical funnel milestones:

```text
lead_started
meaningful_engagement
offer_presented
purchase_intent
checkout_sent
purchase_completed
setup_completed
program_ready
```

**lead_started**

Once per genuinely new unknown WhatsApp lead entering Sales Engine v3.

```text
meaningful_engagement
```

Once when the lead first sends a substantive response beyond the initial generic/prefilled inquiry.

Examples that qualify:

```text
quiero bajar de peso
cuánto cuesta
aceptan OXXO
muéstrame un ejemplo
```

The initial Meta prefilled:

Hola, quiero más información.

must not by itself count as meaningful engagement.

```text
offer_presented
```

When the canonical offer containing the current price/product is actually communicated to the lead.

```text
purchase_intent
```

When valid explicit purchase intent or valid contextual purchase authorization is detected. Store authorization type.

```text
checkout_sent
```

Only after:

- Checkout Session exists.
- Relevant evidence is persisted.
- Checkout URL is actually sent successfully according to the workflow's reliable execution semantics.

```text
purchase_completed
```

Emit from the verified Stripe payment path, not from WhatsApp claims.

It must represent a validated and persisted purchase.

```text
setup_completed
```

Emit when Setup succeeds with required profile data and sensitive-data consent evidence successfully persisted.

```text
program_ready
```

Use the same canonical readiness semantics already established for the portal/Ticket 3 rather than inventing an unrelated analytics definition.

## 44. Secondary Commercial Events

Support a limited set of useful commercial signals such as:

```text
price_question
payment_method_question
timing_objection
price_objection
trust_objection
health_question
deferred_interest
reminder_requested
rejection
```

Do not turn every chat message into a funnel event. Do not add low-value analytics such as:

```text
user_said_thanks
user_said_ok
user_mentioned_chicken
```

The event table should answer:

What happened commercially?

The chat table answers:

What was said?

## 45. Event Idempotency

Key milestones must be retry-safe.

Add a mechanism such as:

```text
event_key
```

with uniqueness where appropriate.

Conceptual examples:

```text
lead_started:<session_id>
meaningful_engagement:<session_id>
checkout_sent:<checkout_session_id>
purchase_completed:<checkout_session_id>
setup_completed:<user_id>:<appropriate_program_or_setup_identifier>
program_ready:<program_id>:<appropriate_week/readiness_identifier>
```

Determine the exact safe identifiers from the real schema.

Stripe webhook retries must not duplicate purchase_completed.

Workflow retries must not corrupt funnel metrics.

## 46. Pre-Purchase → Customer Linkage

Before purchase:

```text
session_id = populated
user_id = NULL
```

After verified purchase/customer creation:

```text
session_id = original lead session
user_id = resolved Dietavity user
```

Preserve enough linkage to measure the full:

```text
lead
→ engagement
→ offer
→ intent
→ Checkout
→ purchase
→ Setup
→ program
```

journey.

Do not depend solely on mutable WhatsApp session state after user creation.

## 47. Funnel Metrics Enabled by This Ticket

No dashboard is required in Ticket 8.

The schema must make these metrics calculable:

```text
Lead → Engagement
meaningful_engagement / lead_started
Engagement → Offer
offer_presented / meaningful_engagement
Offer → Intent
purchase_intent / offer_presented
Intent → Checkout
checkout_sent / purchase_intent
Checkout → Purchase
purchase_completed / checkout_sent
Purchase → Setup
setup_completed / purchase_completed
Setup → Program
program_ready / setup_completed
Lead → Purchase
purchase_completed / lead_started
```

Correct data collection is the goal.

Do not build unnecessary reporting UI.

## 48. Meta / Click-to-WhatsApp Attribution

Do not invent Meta attribution fields based on assumptions.

First inspect the actual inbound Twilio payload available to the production workflow.

Determine whether real CTWA messages expose useful fields such as:

```text
referral
source_id
source_url
headline
body
ctwa_clid
campaign/ad identifiers
```

or equivalents.

If useful attribution exists, capture only verified available data.

For MVP, attribution may live in metadata jsonb, for example:

```json
{
"source": "meta_ctwa",
"campaign_id": "...",
"adset_id": "...",
"ad_id": "...",
"referral_id": "..."
}
```

Do not create a large speculative Meta schema.

If the current payload does not expose useful attribution, document that fact rather than fabricating support.

## 49. Reminder Persistence

Operational reminder context may remain in onboarding_sessions:

```text
reminder_requested_at
reminder_scheduled_for
```

Emit:

```text
reminder_requested
into sales_funnel_events.
```

If useful and implemented safely, also emit:

```text
reminder_sent
```

when the scheduled template is actually sent.

One active requested reminder per lead is sufficient for MVP unless existing infrastructure requires otherwise.

## 50. Analytics Privacy

Do not copy sensitive Setup data into sales_funnel_events.

Do not store there:

- Medical conditions.
- Allergy values.
- Detailed nutrition profile.
- Full prompts.
- Full assistant responses.
- Chain-of-thought/internal reasoning.
- Card details.
- Portal tokens.
- Unnecessary IP information.

Store structured business telemetry only.

## 51. Existing Session Migration

Do not blindly map historical states without inspecting live data first.

Current/historical states may include:

```text
lead
ask_subscription
subscription_deferred
payment_pending
subscriber
closed
```

Before writing the final migration:

1. Inspect the actual current state distribution.
2. Determine which states have live rows.
3. Preserve useful historical sessions.
4. Avoid unnecessary semantic reconstruction of old conversations. Likely conceptual mapping for unpaid leads:

```text
lead
ask_subscription
subscription_deferred
→ evaluating
payment_pending
→ checkout_pending
closed
→ closed
```

Known/verified users should continue bypassing sales routing.

Do not use this conceptual mapping without validating the live database first.

## 52. Existing Chat Memory

Preserve onboarding_chat_memory for conversational continuity unless implementation inspection finds a compelling reason to evolve it.

However:

Chat memory is context for AI conversation, not authorization evidence for commercial side effects.

A Stripe action must never depend solely on the LLM remembering what was said several messages earlier.

## 53. Canonical Knowledge Architecture

Avoid independent copies of product facts scattered across prompt nodes.

Create shared/canonical sources wherever practical for:

```text
Dietavity Role & Identity
Product / offer facts
Food Philosophy
Meal-generation rules
Medical/scope boundaries
Commercial policy facts
```

Task-specific prompts should consume these sources and add only their task instructions.

Do not allow different AI agents to independently redefine:

- What Dietavity is.
- Price.
- Product duration.
- Billing model.
- Payment methods.
- Start-date rules.
- AI identity.
- Food philosophy.

## 54. Refund Policy

Do not allow the LLM to invent refund rules.

Use only finalized approved customer-facing refund policy if it exists in the deployed application/business rules at implementation time. If the final policy remains unresolved or unpublished, report that clearly rather than inventing an answer.

Do not silently create legal/business policy in this ticket.

## 55. Error Handling

Preserve production-grade failure behavior.

Commercial side effects must fail safely.

Examples:

- AI interpretation failure must not authorize Checkout.
- Unknown/invalid strategy must not authorize Checkout.
- Missing commercial context must not authorize contextual Checkout.
- Stripe Checkout creation failure must not produce a success message.
- Funnel-event failure must be handled deliberately so it cannot silently corrupt critical purchase behavior.
- Reminder scheduling failure must not falsely tell the user that the reminder was scheduled.
- Database persistence failure must not create misleading state.
- Existing Global Error Handler integration must remain valid.

Fallback principle:

When uncertain, respond safely; do not perform the commercial side effect.

## 56. Security

Preserve all Ticket 1/2 security invariants.

New database objects must follow backend-only access.

Do not expose:

- service-role credentials,
- Stripe secrets,
- internal prompt structures,
- portal tokens,
- internal sales metadata,

to the browser or WhatsApp user.

Any new SQL migration must be reviewed against existing grants/RLS/security architecture.

## 57. Regression Requirements — Commercial Authorization

Add automated tests for at least:

### Example acceptance cases

```text
"Mándame el enlace para pagar."
→ Checkout allowed
"Quiero comprar el programa."
→ Checkout allowed
purchase_confirmation + "sí" within 30 minutes
→ Checkout allowed
```

### Mandatory rejection cases

```text
show_example + "sí"
→ no Checkout
explain_offer + "sí"
→ explain offer
→ no Checkout
purchase_confirmation + "ok"
→ no Checkout
purchase_confirmation + "perfecto"
→ no Checkout
expired purchase_confirmation + "sí"
→ no Checkout
"Sí quiero comprarlo, pero ¿aceptan OXXO?"
→ answer material question first
→ no immediate Checkout
generic conversational fallback
→ no Checkout
AI interpretation failure
→ no Checkout
```

## 58. Regression Requirements — Conversation

Test:

- Generic Meta lead → discovery.
- Goal already supplied → do not ask it again.
- Price question → direct price answer.
- Payment-method question → current accepted methods.
- Unsupported provider question → accepted methods only.
- Meal-example acceptance.
- Offer explanation.
- Price objection.
- Timing objection.
- “Déjame pensarlo.”
- Explicit rejection.
- Gratitude.
- Health question.
- AI transparency question.
- “¿Un nutriólogo hace mi plan?”
- Multi-intent message.
- One-question maximum.
- No forced CTA after sensitive concern.
- No unnecessary repeated offer facts.

## 59. Regression Requirements — Reminder

Test:

```text
"Recuérdame en dos semanas."
→ one scheduled reminder
"Recuérdame después."
→ one clarification question
→ no reminder until timing resolved
deferred interest without explicit reminder request
→ no proactive message scheduled
explicit reminder already scheduled
→ no accidental duplicate
```

Also verify the appropriate WhatsApp template mechanism rather than sending an arbitrary proactive free-form message where prohibited.

## 60. Regression Requirements — Funnel

Verify:

- lead_started only once.
- Initial generic/prefilled inquiry does not itself count as meaningful_engagement.
- First substantive response emits meaningful_engagement.
- Offer communication emits offer_presented.
- Valid purchase authorization emits purchase_intent.
- Checkout creation/send emits checkout_sent.
- Stripe webhook retry does not duplicate purchase_completed.
- Setup success emits setup_completed.
- Program readiness emits program_ready.
- session_id → user_id linkage survives purchase.
- Event idempotency works under retries.
- Sensitive Setup data is absent from funnel metadata.

## 61. Regression Requirements — Shared Prompt Identity

Audit all AI nodes in the canonical workflow.

Verify that nodes representing Dietavity do not contain conflicting identities such as:

```text
Eres la nutricionista...
Eres un experto...
Eres un asistente...
```

where those redefine the canonical Dietavity identity.

Task roles are allowed, but core identity must remain consistent.

Add a maintainable regression mechanism if practical so future prompt changes cannot silently reintroduce contradictory Role & Identity definitions.

## 62. Regression Requirements — Food Localization

Verify meal-generating prompts inherit the canonical food/localization principles.

Test representative outputs/constraints sufficiently to ensure the system permits:

- Appropriate Mexican/Latin American meals.
- Mediterranean-inspired meals.
- Japanese-inspired meals.
- Nordic-inspired meals.
- General healthy meals.

while not forcing every meal into one cuisine.

Do not make brittle tests that require exact recipe wording from an LLM.

Prefer contract/prompt/invariant tests.

## 63. Preserve Paid-User Behavior

Ticket 8 must not regress the Ticket 5 paid-user assistant.

Known users must retain:

- Portal handling.
- Program status.
- Recipes.
- Meal ideas.
- Restaurant functionality.
- Advice.
- Conversational handling.
- Shopping-list portal direction.
- Legacy cancellation gating.

Do not accidentally route paid users into Sales Engine v3.

## 64. Preserve Ticket 6 Cancellation Safety

Ticket 8 must not reintroduce destructive legacy cancellation behavior.

Preserve:

- No Delete User.
- Safe legacy cancellation persistence.
- One-time purchasers cannot reach Stripe subscription cancellation.
- Repeated cancelar after cancellation does not re-trigger Stripe cancellation.
- Purchase/program/history preservation.

## 65. Preserve Post-Purchase Architecture

Do not redesign:

```text
verified payment
→ purchase
→ Setup
→ consent persistence
→ program initialization
→ Week 1
→ meal plan
→ portal readiness
```

except for the minimum additions needed to emit funnel events and link the original lead session to the resulting user.

## 66. Implementation Approach

Before modifying the canonical workflow:

1. Inspect the current workflow.
2. Inspect current database schema.
3. Inspect live-state compatibility assumptions.
4. Identify the exact unknown-user replacement boundary.
5. Identify reusable Checkout infrastructure.
6. Identify post-purchase points for funnel events.
7. Inspect current prompt duplication.
8. Inspect actual Twilio CTWA payload support available in the workflow/repository.
9. Produce migrations.
10. Implement v3 in a development copy.
11. Run structural and regression tests.
12. Provide exact deployment and rollback instructions. Do not directly modify/activate production n8n.

## 67. Deployment Safety

Implementation must be suitable for:

```text
development workflow
→ automated tests
→ controlled n8n import
→ sandbox/test execution
→ production deployment
```

Do not:

- Activate a production workflow automatically.
- Execute a real Stripe cancellation.
- Send a real sales reminder without explicit test authorization.
- Mutate production customer data during implementation.
- Assume migrations have already been applied.

## 68. Required Manual Test Matrix

After automated tests pass, document a concise manual test plan using a fake/test lead where possible.

At minimum test:

### Generic lead

```text
Hola, quiero más información.
```

Expected:

- v3 discovery.
- No Checkout.

### Example context

```text
Sí.
```

after show_example.

Expected:

- Example.
- No Checkout.

### Offer context

```text
Sí.
```

after valid purchase confirmation.

Expected:

- Checkout.

### Weak acknowledgement

```text
Ok.
```

after purchase confirmation.

Expected:

- No Checkout.
- Clarification if appropriate.

### Explicit purchase

```text
Mándame el enlace para pagar.
```

Expected:

- Checkout.

### Material question + intent

```text
Sí quiero comprarlo, pero ¿aceptan OXXO?
```

Expected:

- Payment answer first.
- No immediate Checkout.

### Deferred

```text
Estoy de viaje, regreso en dos semanas.
```

Expected:

- Timing response.
- No proactive reminder.

### Explicit reminder

```text
Recuérdame en dos semanas.
```

Expected:

- One scheduled reminder through approved mechanism.

### Rejection

```text
No gracias.
```

Expected:

- Graceful close.
- No CTA.

## 69. Required Verification

Before reporting completion, verify at minimum:

- Workflow JSON parses.
- No dangling connections.
- All intended executable nodes reachable.
- Unknown users reach Sales Engine v3.
- Known users bypass Sales Engine v3.
- Only authorized strategies can reach Checkout.
- Fallback cannot reach Checkout.
- Reminder path is isolated from generic deferred interest.
- Canonical product price is $149 MXN.
- No sales prompt still advertises $99 MXN/mes.
- No sales prompt advertises a subscription.
- No obsolete 7-day weekly subscription description remains in the unknown-user sales branch.
- 30-minute contextual authorization enforced.
- 30-day program-start rule matches backend reality.
- Accepted payment methods match current product configuration.
- Unified Role & Identity applied.
- Shared Food Philosophy/localization applied.
- Funnel events are idempotent.
- Backend-only database security preserved.
- Existing Tickets 1–7C regressions pass.
- Canonical workflow fixture references remain valid.

## 70. Required Deliverables

Provide:

1. Updated canonical n8n workflow JSON.
2. Database migration(s).
3. Any shared prompt/configuration modules required.
4. Automated Ticket 8 tests.
5. Updated canonical regression suite as necessary.
6. Exact rollback workflow/artifacts.
7. Implementation report in Markdown.
8. Manual sandbox test instructions.
9. Migration/deployment order.
10. Any unresolved production assumptions or risks.

## 71. Implementation Report Requirements

The final report must explicitly state:

### Architecture

- Final unknown-user branch boundary.
- Which old onboarding nodes were removed/replaced.
- Final buyer-signal taxonomy.
- Final response strategies.
- Exact Checkout authorization rules.
- Exact reminder authorization rules.

### Database

- Final onboarding_sessions changes.
- Final sales_funnel_events schema.
- Indexes/constraints.
- Event idempotency mechanism.
- Migration of existing session states.
- Security/grants/RLS treatment.

### Prompts

- How canonical Role & Identity is shared.
- How canonical product facts are shared.
- How Food Philosophy/localization is shared.
- Which prompts generate meals.
- Any remaining intentional prompt-specific identity/task differences.

### Funnel

- Exact definition of each core funnel event.
- Where each event is emitted.
- How pre-purchase session_id links to post-purchase user_id.

### Attribution

- Actual Twilio/CTWA fields found.
- Fields persisted.
- Or explicitly state that useful attribution was not available.

### Verification

- Tests passed/failed.
- Workflow structural audit.
- Security regression.
- Existing Ticket regression status.
- Manual tests still required.

## 72. Non-Goals

Do not add unless technically required for Ticket 8:

- CRM.
- Sales dashboard.
- Meta Ads API integration.
- Automated ad-spend import.
- General proactive lead nurturing.
- Multiple follow-up campaigns.
- New subscription products.
- Discount engine.
- Promo-code system.
- Referral system.
- Human sales console.
- Full redesign of paid-user WhatsApp.
- Full redesign of program generation.
- New medical functionality.
- New payment providers.
- Changes to Ticket 6 cancellation architecture.
- Unrelated portal redesign.

## 73. Definition of Done

Ticket 8 is complete when:

1. Unknown users are handled by Sales Engine v3 rather than the obsolete onboarding sales architecture.
2. Dietavity maintains conversational context without using coarse state as purchase authorization.
3. AI interpretation and commercial authorization are separated.
4. Only direct_purchase and valid purchase_confirmation paths can reach Checkout.
5. Ambiguous acknowledgements cannot accidentally trigger Checkout.
6. Direct purchase requests can reach Checkout without unnecessary funnel friction.
7. Material questions are answered before Checkout.
8. Responses contain at most one actionable question.
9. Discovery is light and skippable.
10. Objections are handled without automatically forcing another CTA.
11. Deferred leads receive no proactive messages unless they explicitly request a reminder.
12. Explicit reminders can schedule one approved-template follow-up.
13. Program start may be scheduled up to 30 calendar days, consistent with backend enforcement.
14. Product facts reflect the current $149 MXN one-time 28-day program.
15. Payment copy mentions only accepted methods unless a specific unsupported provider is asked about.
16. Dietavity's Role & Identity is canonical and consistent across AI nodes.
17. Meal-generating AI uses the shared longevity + Mexico/Latin America localization philosophy.
18. Funnel events reliably measure lead → engagement → offer → intent → Checkout → purchase → Setup → program readiness.
19. Commercial events are retry-safe and auditable.
20. New analytics data does not duplicate unnecessary sensitive profile information.
21. Paid-user, Stripe, Setup, program, portal, security and Ticket 6 cancellation architecture remain intact.
22. Full canonical regression suite passes.
23. A development/sandbox manual test plan is delivered before production activation.

## Guiding Principle

When implementation choices are ambiguous, preserve this hierarchy:

- Understand the lead accurately.
- Answer what they actually asked.
- Demonstrate Dietavity's value naturally.
- Never create unnecessary sales friction.
- Never pressure an explicit rejection.
- Never infer consequential commercial consent from ambiguity.
- AI interprets; deterministic policy authorizes; infrastructure executes.
