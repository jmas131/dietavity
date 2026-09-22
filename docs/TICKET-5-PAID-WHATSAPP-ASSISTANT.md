# Ticket 5 — Paid WhatsApp Assistant Refactor

## Scope and rollback

- Production workflow source changed: `n8n/Dietavity live 2.4.3.json` (renamed internally to `Development - Dietavity live 2.5.0 (Ticket 5)`).
- Reproducible migration: `scripts/refactor-ticket-5-workflow.js`.
- Regression coverage: `test/ticket-5-paid-whatsapp-assistant.test.js`.
- Exact pre-change rollback copy: `archive/Dietavity live 2.4.3 pre-ticket-5.json`.
- No database schema, RLS/grant, portal API, program lifecycle, scheduler, or server route was changed.

## Intent migration

Old paid-user intents:

`meal_plan`, `meal_idea`, `shopping_list`, `restaurant_near`, `restaurant_menu`, `recipe`, `advice`, `support`, `general`, `unsubscribe`.

New paid-user intents:

`portal_help`, `program_help`, `recipe`, `meal_idea`, `restaurant_near`, `restaurant_menu`, `advice`, `support`, `general`, `unsubscribe`.

`unsubscribe` remains a compatibility intent. The classifier does not authorize cancellation.

The classifier no longer extracts `name`, `diet`, `allergy`, `dislike`, `condition`, `cuisine`, or meal-plan `duration` as profile entities. It may emit a non-persisted `profile_statement` type so the current response can handle an allergy, medical condition, dislike, diet, or name statement safely.

## Routing architecture

1. `Incoming Message` resolves the WhatsApp user as before.
2. `If Identify User State` continues to separate known customers from unknown/unpaid leads. Its false branch and the existing sales/onboarding flow were not redesigned.
3. Known customers use `Detect Intent and Entities` and `Parse JSON Intent and Entities`.
4. `Get Customer Assistant Context` reads the latest persisted program facts, PWA profile restrictions, and legacy subscription eligibility without returning a Stripe subscription ID or portal token.
5. `Build Customer Assistant Input` combines classification and persisted context without mutating it.
6. `Switch Customer Assistant Intents` sends:
   - `unsubscribe` to `If Active Legacy Subscription`;
   - `portal_help`, `program_help`, `support`, profile statements, and simple greetings/acknowledgements to deterministic handling;
   - `recipe`, `meal_idea`, `restaurant_near`, `restaurant_menu`, `advice`, and nontrivial `general` messages to the nutrition model.

Inbound/outbound message and intent logging remain connected. Portal tokens are not included in intent classification, program-context SQL output, or analytics/error payloads. A portal URL necessarily appears in the outbound customer message when requested.

## Deterministic handling

### `portal_help`

`Build Deterministic Customer Response` constructs `https://dietavity.com/p/<resolved-user.portal_token>` only from the already-resolved WhatsApp user. The model never receives or invents this URL. Shopping-list and existing-program recipe requests direct the customer to this canonical portal.

### `program_help`

`Get Customer Assistant Context` reads `programs.status`, `programs.start_date`, and `programs.current_week` for the resolved user. Deterministic responses cover start date, current week, 28-day/four-week duration, next-week questions, meal swaps, and requests for another seven-day plan. Replacement-plan requests do not create data and direct individual swaps to the portal's `No me gustó` action.

### `support` and simple `general`

Access/payment/technical support returns the existing support email and the user's portal URL when available. Simple greetings, thanks, and acknowledgements avoid an AI call.

## AI-assisted handling

`recipe`, `meal_idea`, `restaurant_near`, `restaurant_menu`, `advice`, and nontrivial `general` retain AI assistance. Their prompt:

- describes the product as a 28-day program;
- treats the PWA/portal as the source of truth;
- forbids creating or promising a parallel program or persisted meal swap;
- uses structured profile restrictions read from `profiles` only as safety context;
- forbids diagnoses, treatment, medication changes, or claims that WhatsApp changed the profile/program.

Restaurant behavior remains at the same capability level as the previous workflow: conversational recommendations based on supplied restaurant/location context, without a separate live places-search node.

## Legacy cancellation

`If Active Legacy Subscription` can reach the existing cancellation chain only when persisted state proves all of the following:

- `users.stripe_subscription_id` is present (the identifier used by the retained Stripe node); and
- either the mirrored `users.subscription_status` is cancellable or a matching Stripe subscription row is cancellable; and
- the status is `active`, `trialing`, or `past_due`.

Eligible requests retain the existing chain:

`Unsubscribe User Message` → `Unsubscribe Agent` → `Extract Next Action Unsubscribe` → `Stripe Cancel a Subscription` → existing result/metrics branch.

For a 28-day purchaser without that active legacy state, Stripe is not called. The deterministic response explains that the program is a one-time purchase and provides support guidance for disputed charges.

## Retired persistence and onboarding behavior

The active customer route no longer merges inferred profile values or writes `users.preferences`/`users.name`. The legacy `condition` parser inconsistency is therefore irrelevant to this path and was not “fixed” by adding persistence.

The `Ask Name`/`Ask Diet` questionnaire was removed. The legacy checkout welcome message no longer asks for a name or writes the `ask_name` marker; structured setup remains responsible for the name and profile.

## Nodes removed

- Preference/profile pipeline: `Unified Merge`, `Safeguard`, `If updateNeeded General`, `If updateNeeded all Other Intents`, `Persist Preference General`, `Update User Preference all Other Intents`, `Build Preference Update Response`, `Send Update Preferences Message`, `Finalize Onboarding`.
- Name/diet questionnaire: `If Ask Name`, `If User Name`, `Update User Name`, `Update User Ask Name`, `Send Ask Name Again`, `If Ask Diet`, `Update User Ask Diet`, `Send Ask Diet`.
- Standalone WhatsApp plan pipeline: `If UpdateNeeded Meal Plan`, `Build Meal Plan Prompt`, `Meal Plan Chat Completions`, `Parse JSON Meal Plan`, `If JSON Error`, `Error JSON Meal Plan`, `Portal Token Link`, `Create Meal Plan`, `Update User Preference Meal Plan`, `Send Meal Plan Link`, `Send Error Meal Plan Link`, `Send Error Notification Meal Plan`.
- Superseded orchestration: `Follow Up Detector`, `Read Last Assistant Message`, `Combined Object`, `Switch Intents`.

## Nodes added

- `Get Customer Assistant Context`
- `Build Customer Assistant Input`
- `Switch Customer Assistant Intents`
- `If Active Legacy Subscription`
- `Build Deterministic Customer Response`

## Nodes retained only for legacy compatibility

- `Unsubscribe User Message`
- `Unsubscribe Agent`
- `OpenAI Chat Model Unsubscribe`
- `Extract Next Action Unsubscribe`
- `Stripe Cancel a Subscription`
- `If Stripe Unsubscribe `
- `Create Unsubscribe Metrics Row`
- `Delete User`
- `Send Unsubscribe Message`
- `Send Unsubscribe Delay Message`

These nodes remain solely to preserve cancellation for the remaining active legacy subscription product.

## Paid-user prompts changed

- `Detect Intent and Entities` system prompt: new intent taxonomy and no persistent profile extraction.
- `Build Nutrition Prompt`: 28-day companion tasks, profile safety context, and no program mutation.
- `Dietavity Nutrition Model` system instructions: PWA/portal ownership, 28-day language, and medical/data boundaries.
- `Send Welcome New User`: removes the legacy name question and weekly-subscription wording.

The lead/sales prompts remain unchanged because Ticket 5 explicitly excludes redesigning that flow.

## Verification

`node --test` passes all 54 tests (54 passed, 0 failed), including:

- Ticket 5 taxonomy, portal/program deterministic handling, retired persistence/meal-plan nodes, cancellation gate, lead/customer split, and connection integrity;
- Ticket 1 portal-token authorization;
- Ticket 2 backend-only Supabase checks;
- Ticket 3 setup/readiness behavior;
- Ticket 4 purchase/program association and scheduled-preparation UI;
- shopping-list, program-start, Stripe workflow, regeneration, generation, and scheduler regressions.

The final reachability audit reports 135 workflow nodes and zero unreachable executable nodes. The migration script was run repeatedly to verify idempotence.

## Remaining legacy dependency and risk

The retained cancellation chain still runs `Delete User` after successful Stripe cancellation. This is pre-existing behavior and was left unchanged under Ticket 5's instruction not to modify the underlying legacy cancellation implementation. It is a data-retention/integrity risk: related program/profile/message rows use cascading foreign keys, while a linked `purchases` row can block deletion via `ON DELETE RESTRICT`. Retiring or redesigning that delete should be a separate, explicitly scoped migration before the legacy subscription product is removed.
