# Dietavity 28-Day Nutrition Program

**Status:** Functional specification for the current MVP  
**Last updated:** July 2026

## 1. Purpose

The Dietavity 28-Day Nutrition Program is a personalized, WhatsApp-delivered nutrition experience that helps an active subscriber follow longevity-inspired eating habits for four consecutive weeks.

The program turns the user's stated preferences and profile into four practical weekly meal plans. It also supports the ongoing help already provided by Dietavity: recipes, ingredient swaps, meal ideas, shopping lists, restaurant guidance, and general nutrition guidance.

The program is educational nutrition support. It must not diagnose conditions, prescribe treatment, replace professional medical advice, or make therapeutic claims.

## 2. Product Boundaries

### In scope

- A single 28-day program per enrolled user, consisting of four sequential seven-day weeks.
- Personalized weekly meal plans and a shopping list for each generated meal plan.
- Delivery and conversation through WhatsApp.
- Optional refinement of a week's meals through existing conversational requests, such as a recipe, meal swap, or shopping-list request.
- Program and weekly status tracking in Supabase.
- Subscription validation before paid-program content is delivered.

### Out of scope for the MVP

- Medical nutrition therapy, clinical monitoring, diagnoses, or supplement protocols.
- Calorie, macronutrient, weight-loss, or health-outcome guarantees.
- A new web application, mobile application, framework, or separate program service.
- A new data store or changes to the system-of-record model.
- Automatic delivery of more than one week's detailed meal plan at a time.
- Meal ordering, grocery fulfillment, activity tracking, or coach/human-provider workflows.

## 3. Architecture Alignment

The program operates within the existing Dietavity MVP architecture.

| Component | Program responsibility |
| --- | --- |
| Node.js / Express website | Presents existing public, setup, payment-success, and cancellation experiences only. It does not orchestrate program logic. |
| Twilio WhatsApp | Receives user messages and delivers program communications. |
| n8n | Owns program orchestration: validation, state transitions, OpenAI prompt construction, plan generation, Supabase operations, scheduled weekly progression, and WhatsApp replies. |
| OpenAI | Generates personalized food content from the supplied profile and preferences. It does not persist program state. |
| Supabase | Is the source of truth for user, profile, program, week, meal-plan, shopping-list, and message state. |
| Stripe | Is the source of truth for subscription/payment status. |

All program-specific business logic and prompts remain centralized in n8n. This specification does not require a change to the current Node.js website or a major architectural change.

## 4. Enrollment and Personalization

### Eligibility

A user may enter the program when all of the following are true:

1. The user is identified by their WhatsApp identity.
2. The user has an active, valid subscription according to the existing subscription-validation process.
3. The user has a profile or can provide the minimum information required to create one.

If a subscription is not valid, Dietavity must follow the existing subscription/payment flow and must not activate the program.

### Minimum profile information

Before a program becomes ready, Dietavity should collect or confirm the following values supported by `profiles`:

- Eating style: omnivore, vegetarian, vegan, or pescatarian.
- Allergies.
- Medical conditions that may affect food recommendations.
- Foods to avoid.
- Household size, when supplied, for shopping-list quantities.

The following are optional personalization inputs: birth month/year, height, weight, and free-form notes. They may inform tone or practical recommendations but must not lead to clinical, diagnostic, or prescriptive advice.

Existing `users.preferences` values (diet, cuisine, dislikes, allergies, and conditions) may be used to prefill or complement the profile. Where both profile and user preferences have equivalent information, the program must use the most recently confirmed user information; the workflow should retain the profile as the structured program input and user preferences as conversational context.

### Personalization behavior

Each weekly plan must:

- Respect eating style, declared allergies, foods to avoid, and relevant stated conditions.
- Use accessible, practical foods and longevity-inspired dietary patterns without claiming a particular region's outcomes will be reproduced.
- Favor variety across the week while allowing intentional leftovers or repeated staples when practical.
- Be written in clear, warm Spanish unless the product's supported conversation language changes.
- Clearly flag when the user should seek individualized advice from a qualified healthcare professional, especially for a condition, allergy, or request outside general nutrition guidance.

If essential dietary-safety information is missing or ambiguous, Dietavity must ask a concise clarification question before generating the affected weekly plan.

## 5. Program Lifecycle

### Program states

`programs.status` is the authoritative lifecycle state.

| Status | Meaning | Allowed next status |
| --- | --- | --- |
| `personalization` | Program enrollment exists; required profile details are still being gathered or confirmed. | `ready`, `cancelled` |
| `ready` | Required inputs and subscription validation are complete; the program has not started. | `active`, `cancelled` |
| `active` | At least one program week is in progress. | `completed`, `cancelled` |
| `completed` | All four weeks have been completed. `completed_at` is recorded. | None for this program record |
| `cancelled` | The user cancels, loses eligibility, or exits before completion. | None for this program record |

`start_date` is set when the program enters `active`. `current_week` identifies the active program week and must remain within the schema-supported range of 1–4.

### Weekly states

Each program has exactly four `weeks` records, one for each `week_number` from 1 through 4. `weeks.status` controls the state of each week.

| Status | Meaning |
| --- | --- |
| `pending` | A future week that has not been prepared. |
| `planned` | Its meal plan and associated shopping list are available, but the week has not started. |
| `active` | The current seven-day week. `activated_at` is recorded. |
| `completed` | Its seven-day period has ended and `completed_at` is recorded. |

Only one week may be `active` at a time. Future weeks remain `pending` or, if prepared in advance, `planned`. A completed week may not return to `active` within the same program.

### Standard progression

1. Create a program in `personalization` and associate it with the user and, when available, their profile.
2. Create the four weekly records in `pending` status.
3. Once profile details and subscription eligibility are confirmed, set the program to `ready`.
4. On the selected start date, set the program to `active`, set `current_week` to 1, mark week 1 `active`, and generate/deliver its meal plan and shopping list.
5. At the end of each seven-day period, mark the active week `completed` and activate the next week. Update `programs.current_week` before or together with its activation.
6. Generate/deliver the next week's plan and shopping list when that week is activated. A workflow may prepare it earlier by marking it `planned`, but it must not activate it early.
7. After week 4 is completed, set the program to `completed` and record `completed_at`.

If a user stops, cancels, or becomes ineligible, set the program to `cancelled`. Historical meal plans, messages, and completed-week records must remain available for audit and continuity; cancellation must not delete them.

## 6. Weekly Experience

### Weekly meal plan

For each program week, Dietavity generates one `meal_plans` record associated with the user and that week's `week_id`. The `meals` JSON payload is the canonical detailed plan content for that week.

At a minimum, the weekly plan must communicate:

- The week number and its seven-day scope.
- Meals organized by day.
- The meal name and concise preparation guidance or a clear path to request the recipe.
- Practical ingredient or preparation notes needed to follow the plan.
- Allergy/avoidance-aware alternatives when appropriate.
- A short, supportive message explaining how to ask for recipes, swaps, or shopping help.

The plan should be concise enough for WhatsApp. If it is too long for a single useful message, n8n may deliver it as a logical sequence of messages while preserving the same meal-plan record.

### Shopping list

Every generated weekly meal plan should have one associated `shopping_lists` record. Its `shopping_items` must be derived from the weekly plan and may include name, quantity, unit, category, and sort order.

Users may ask for the shopping list again, ask about an item, or mark items checked through any existing product interaction that supports it. Checking an item updates only that `shopping_items.checked` value; it must not alter the meal plan or program progression.

### In-program requests

While a program is active, the existing intent handling remains available:

- **Recipe:** provide instructions for a planned meal or another appropriate meal.
- **Meal swap:** provide a safe equivalent that respects current personalization; preserve the current week unless a revised meal-plan record is explicitly generated.
- **Meal idea:** offer a suitable immediate option without advancing program status.
- **Shopping list:** return or clarify the active week's list.
- **Restaurant guidance:** provide general, preference-aware choices; it does not become a program meal unless the plan is intentionally revised.
- **General advice:** provide general nutrition education, within the safety boundaries above.

Conversational requests must not accidentally create, activate, complete, or cancel a program/week. Program state changes require the relevant program workflow condition or a clear user cancellation instruction.

## 7. Data Specification

No new tables or required schema changes are introduced by this specification.

| Need | Existing source of truth | Required use |
| --- | --- | --- |
| Identity and conversational preferences | `users` | Link via `users.id`; use `whatsapp_id` for messaging and `preferences` for conversational personalization. |
| Structured program profile | `profiles` | Link using `profiles.user_id`; `programs.profile_id` references the profile used for the program. |
| Program lifecycle | `programs` | One program record holds its status, `start_date`, `current_week`, and completion timestamp. |
| Four program weeks | `weeks` | Create one record per week, uniquely understood by `program_id` plus `week_number` in workflow logic. |
| Weekly menu | `meal_plans` | Store structured weekly menu in `meals`; associate it with the user and the relevant `week_id`. Use `generated_at` and `generation_version` for generation history. |
| Weekly groceries | `shopping_lists`, `shopping_items` | One list per meal plan, with individual items and checked state. |
| Conversation history | `messages` | Store inbound and outbound WhatsApp exchanges, including intent and assistant response where applicable. |
| Access validation | `subscriptions` and subscription fields on `users` | Use the existing Stripe-driven validation process; do not create a second payment state. |
| Operational errors | `logs` | Record workflow failures with context without storing secrets. |

`meal_plans.week_id` is the program-week association. A meal plan without a `week_id` remains compatible with existing ad hoc meal-plan behavior and must not be treated as a program week by default.

The current schema does not impose a database uniqueness constraint on `(program_id, week_number)` or require one active program per user. The MVP workflow must enforce these rules during creation and state transitions to avoid duplicate weekly records or concurrent active programs for the same user.

## 8. Workflow Requirements

n8n workflows implementing the program must:

1. Receive WhatsApp-triggered requests and scheduled progression events.
2. Resolve the user from `whatsapp_id` and retrieve current subscription, profile, preferences, program, active week, and relevant meal-plan context from Supabase.
3. Validate subscription eligibility before sending paid program content or moving a program to `active`.
4. Keep plan-generation and safety prompts centralized in n8n.
5. Write state changes to Supabase before or atomically with outward confirmation where workflow capabilities allow, so Supabase remains the source of truth.
6. Use the stored program/week state—not message wording alone—to determine current program progress.
7. Record user-visible inbound/outbound conversation history using the existing `messages` model.
8. Route unexpected errors to the existing error-handling/logging approach and send a brief recovery message when appropriate.

The Node.js website may link users to setup or payment flows, but it must not duplicate program-state logic from n8n.

## 9. Acceptance Criteria

The MVP program satisfies this specification when:

- An eligible user can complete personalization and receive a four-week program record with weeks 1–4.
- Starting the program activates week 1, creates a week-1 meal plan tied to its `week_id`, and makes a shopping list available.
- The plan respects the user's declared eating style, allergies, foods to avoid, and known relevant conditions, or asks for clarification when safe personalization is not possible.
- A user can request a recipe, swap, meal idea, or shopping-list assistance during an active week without changing lifecycle status unintentionally.
- At each weekly boundary, the workflow completes the current week and activates only the next numbered week.
- Completing week 4 marks the program `completed` and records `completed_at`.
- Cancellation stops future delivery and sets the program to `cancelled` without deleting historical records.
- All persisted state fits the existing schema, Supabase remains the source of truth, and no new framework or architectural component is required.

## 10. Assumptions and Open Product Decisions

This document deliberately leaves the following as configuration or future product decisions rather than new architecture:

- The exact day/time a week starts is interpreted in the user's stored `users.timezone`, which defaults to `America/Mexico_City`.
- The exact meal count, recipe depth, and calorie/macro presentation are prompt/content decisions; they must stay within the safety and personalization boundaries above.
- The selected start date may be user-chosen or assigned by the onboarding workflow.
- A future program after completion should be created as a new `programs` record rather than reopening a completed one.
- If an already generated week needs material revision, a new `meal_plans` record may use `generation_version` to identify the revision; the workflow must keep exactly one current plan context for user-facing responses.

## 11. Non-Functional Expectations

- **Reliability:** transitions must be idempotent where practical, so a repeated webhook or schedule execution does not create duplicate activations or plans.
- **Privacy:** store only the data supported by the existing schema and never put service credentials or secrets in messages, plan content, or workflow nodes.
- **Traceability:** preserve timestamps, generations, messages, and logs needed to understand what was delivered and when.
- **Simplicity:** use existing n8n, Supabase, OpenAI, Twilio, Stripe, and Node.js responsibilities; defer abstractions or migrations until justified by real MVP needs.
