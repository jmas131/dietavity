# Ticket 38: canonical generation and legacy continuation

Implementation is prepared locally. Production has not been changed. The generated Ticket 10 workflow remains inactive for import. No database migration, application restart, new credential, environment variable, scheduler, webhook, or retention change is required.

## Behavior

- `Normalize Program Generation Request`: retains the ordinary `{ "id": "<user UUID>" }` contract. Temporary restoration inputs and authorization are removed.
- `Validate Program Generation User`: accepts an existing unfinished program, an eligible unlinked paid one-time purchase, or eligible legacy continuation. Unknown/ineligible requests take the existing rejection branch. Its response now explains both possibilities.
- `Initialize 28-Day Program`: independently rechecks eligibility in the program INSERT, retains existing unfinished-program reuse and the deterministic purchase-lock/link CTEs, then creates four pending weeks atomically with the program. No existing program or historical week is updated here.
- `Merge Program Profile Preferences`: if a canonical profile object exists, replaces the entire working preference object with `eating_style -> diet`, `allergies -> allergies`, `foods_to_avoid -> dislikes`, `medical_conditions -> conditions`, and `cuisine: null`. Empty canonical values remain empty. It never writes `users.preferences`. Missing profiles retain the existing legacy fallback for already-provisioned programs.
- `Build Weekly Update Prompt`: applies the same projection itself, covering the scheduled later-week path that bypasses the Week 1 merge. Includes conditions as safety context, without treatment claims, and forwards the current item's profile.
- `Add Profile Context to New Program Prompt`: reads the current item's profile, for every week, rather than a separate Week 1 node execution. Birth information, height, weight, notes and the existing supported profile context remain canonical. Historical chat/onboarding memory is not read by these generation paths. Previous meal titles remain variety context.
- `Get New Program Week 1 Context`, `Respond to Program Generation Webhook`, and `Build Program Generation Response`: restoration-only fields are removed; ordinary context and response behavior are restored.
- Existing generation, parsing, meal persistence, shopping-list behavior, Week 1 planning, `program_ready`, start-date selection and portal routes remain intact. No workflow node type, version, connection, credential, or execution setting is changed.

Purchase-free continuation requires a persisted profile with non-future consent and the current Setup privacy notice (`2026-08-11`), a nonempty linked Stripe subscription ID, an active user subscription status, latest program `completed`, no unfinished program, and no eligible unlinked paid purchase. If user subscription status is missing, a matching active Stripe subscription row can establish entitlement. Any matching subscription row with non-active/unknown status blocks continuation. Explicit canceled, inactive, past-due, trialing and unpaid user states do not qualify. A paid purchase takes the ordinary purchase path even for a legacy subscriber; it is never classified as purchase-free continuation.

Normal paid one-time customers do not require a subscription. Purchase ordering and linking are unchanged. An existing unfinished program consumes no additional purchase. Setup still triggers generation only when no historical program exists; the immediate legacy successor therefore uses the existing generation webhook once.

## Validation

- Focused canonical, Setup, portal, purchase, start-date and meal-contract tests: **54 passed, 0 failed, 0 skipped**.
- Explicit in-memory PostgreSQL suite executing the generated SQL: **26 passed, 0 failed, 0 skipped**. Covers positive continuation, one-time initialization, direct-initializer rejection, consent/status variants, sequential repeats, rollback, and Week 1 parsing/persistence/planning/events with a deterministic seven-day model fixture.
- Full canonical `package.json` test script (`node --test`): **375 passed, 0 failed, 0 skipped**. This includes Sales Engine and historical lifecycle regressions. The bundled Node executable was used because `node`/`npm` are not on this workspace's default PATH.
- A generation test executes the real Ticket 10 generator with an intercepted file write and compares the complete artifact byte-for-byte.

Reproduce on a development host with Node on PATH:

```bash
node scripts/refactor-ticket-10-workflow.js
node --test test/ticket-38-canonical-generation.test.js test/ticket-4-purchase-and-scheduled-preparation.test.js test/ticket-3-setup-program-status.test.js test/program-start.test.js test/ticket-s2-workflow.test.js test/ticket-21-practical-meal-generation.test.js
npm test
```

The supplemental SQL suite follows the repository's existing temporary PGlite pattern. PGlite 0.3.14 was downloaded into `/tmp` for this local verification; it is not a project/runtime dependency:

```bash
DIETAVITY_PGLITE_PATH=/path/to/temporary/pglite/package node --test test-support/run-ticket-38-postgres.js
```

## Existing concurrency and recovery limits

Sequential retries reuse the unfinished successor and never create Program 3 or additional weeks. This is verified for `personalization`, `ready`, and `active`.

Simultaneous first requests can still both observe no unfinished program and insert two programs. The existing SQL statement is atomic, but does not serialize program eligibility; the purchase-row lock does not protect purchase-free creation or the preceding program INSERT. The schema has no unique unfinished-program index. This is a pre-existing weakness retained under the ticket's explicit concurrency exception. Fixing it globally requires a schema constraint with duplicate-data preflight and review of every program writer, or transaction-scoped serialization with fresh reads. A lock added inside the same snapshot/CTE alone is not a sufficient fix. Do not issue overlapping generation requests for this operation.

A repeated webhook request acknowledges an existing unfinished program; it does not resume failed Week 1 generation. HTTP 202 acknowledges initialization, not meal-plan completion. If generation fails after creating Program 2, inspect its execution and persisted state before recovery; do not create another program or assume a retry regenerates Week 1. Real model output and production provider/runtime behavior were not exercised by local tests. The existing parser does not strictly require seven complete days, so verify the actual seven-day meal plan before declaring production success.

Consent version is deliberately checked against current Setup, with a test that fails if the two versions diverge. Future privacy-notice updates must regenerate the workflow accordingly.

## Minimal production deployment (after authorization)

1. Export/back up the currently deployed Sales Engine workflow and identify its existing production workflow ID. Confirm no program-generation execution for this subscriber is running.
2. Import `n8n/Dietavity Sales Engine (Ticket 10).json` into the existing production workflow using the established n8n editor import procedure. Preserve its production identity and existing credential bindings. Inspect the node changes listed above before publishing. If the UI imports as a separate workflow, leave it inactive until the existing workflow is retired during the switch; never leave two Sales Engine webhook/schedule copies active.
3. Save and publish/activate the updated workflow using the production runtime's existing procedure. Confirm the original `POST /webhook/generate-28-day-program` route and existing credentials/error-workflow binding remain in effect. No repository-wide service restart, SQL migration, Stripe/Twilio change, or new environment configuration is part of this ticket.
4. Use the single controlled request below. Monitor the existing execution to completion. No WhatsApp smoke-test send is needed for this ticket.

## One-time Program 2 procedure

Use the already verified subscriber UUID. No real UUID or portal token is embedded here. These are ordinary request parameters, not restoration configuration.

1. In the existing privileged SQL console, substitute the subscriber UUID into the read-only preflight below. Save the results in the operator's private session. Confirm one completed program, four completed historical weeks, zero unfinished programs, zero eligible unlinked paid purchases, an active linked subscription, and current consent. Compare current subscription rows with the entitlement rules above. Coordinate a single caller; do not run Setup/generation operations concurrently.

```sql
WITH target AS (SELECT '<subscriber UUID>'::uuid AS id)
SELECT u.id,
       u.subscription_status,
       NULLIF(BTRIM(u.stripe_subscription_id), '') IS NOT NULL AS linked_subscription,
       md5(to_jsonb(u)::text) AS user_fingerprint,
       md5(to_jsonb(pr)::text) AS profile_fingerprint,
       pr.sensitive_data_consent_at IS NOT NULL
         AND pr.sensitive_data_consent_at <= NOW()
         AND pr.privacy_notice_version = '2026-08-11' AS current_consent,
       (SELECT count(*) FROM purchases p WHERE p.user_id=u.id) AS purchase_count,
       (SELECT md5(COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]'::jsonb)::text)
          FROM purchases p WHERE p.user_id=u.id) AS purchases_fingerprint,
       (SELECT count(*) FROM programs p WHERE p.user_id=u.id) AS total_programs,
       (SELECT count(*) FROM programs p WHERE p.user_id=u.id
          AND p.status IN ('personalization','ready','active')) AS unfinished_programs,
       (SELECT count(*) FROM purchases p WHERE p.user_id=u.id
          AND p.purchase_type='28_day_program' AND p.payment_status='paid'
          AND p.program_id IS NULL) AS eligible_unlinked_purchases,
       (SELECT jsonb_agg(jsonb_build_object('provider',s.provider,'status',s.status))
          FROM subscriptions s WHERE s.user_id=u.id
          AND s.stripe_subscription_id=u.stripe_subscription_id) AS subscription_states
FROM target t JOIN users u ON u.id=t.id LEFT JOIN profiles pr ON pr.user_id=u.id;

SELECT p.id, p.status, p.start_date, p.current_week,
       md5(to_jsonb(p)::text) AS program_fingerprint,
       (SELECT count(*) FROM weeks w WHERE w.program_id=p.id) AS week_count,
       (SELECT count(*) FROM weeks w WHERE w.program_id=p.id AND w.status='completed') AS completed_weeks,
       (SELECT md5(jsonb_agg(to_jsonb(w) ORDER BY w.week_number)::text)
          FROM weeks w WHERE w.program_id=p.id) AS weeks_fingerprint
FROM programs p WHERE p.user_id='<subscriber UUID>'::uuid
ORDER BY p.created_at, p.id;
```

2. From the existing deployed application directory, using the current server configuration, send exactly one request. This mirrors `server.js`'s `/root/.env` loading, URL precedence, request body, and 30-second timeout. It does not print the configured URL, secrets, or response payload and has no automatic retry:

```bash
node - '<subscriber UUID>' <<'NODE'
require('dotenv').config({ path: '/root/.env', quiet: true });
const axios = require('axios');
const id = process.argv[2];
const url = process.env.PROGRAM_GENERATION_WEBHOOK_URL || process.env.GENERATE_PROGRAM_WEBHOOK_URL;
if (!url || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
  throw new Error('Existing generation URL and verified subscriber UUID are required.');
}
axios.post(url, { id }, { timeout: 30000 }).then(response => {
  console.log('Generation HTTP status:', response.status);
}).catch(error => {
  console.error('Generation request failed:', error.response?.status || error.code || 'unknown');
  process.exitCode = 1;
});
NODE
```

3. Expect HTTP 202 for a newly created program. In the matching n8n execution confirm initializer output `created=true`, `weeks_created=4`, `purchase_linked=false`, and `purchase_id=null`. Record Program 2's ID. Wait for the execution through `Plan New Program Week 1` / `Build Program Generation Response`; 202 alone is not success. On timeout or error, inspect state first and do not blindly resend.
4. Repeat the read-only preflight queries. Expect total programs 2 and unfinished programs 1. Verify the user, profile, purchases, and Program 1/program-weeks fingerprints match the baseline. This checks that portal token, subscription identifiers, historical preferences/profile, and historical program/weeks remain unchanged. Confirm no purchase was added or linked. Inspect Program 2 with:

```sql
SELECT p.id, p.status, p.start_date, p.current_week,
       w.week_number, w.status AS week_status, w.activated_at,
       (SELECT count(*) FROM meal_plans mp WHERE mp.week_id=w.id) AS meal_plan_count,
       (SELECT jsonb_array_length(mp.meals->'days') FROM meal_plans mp WHERE mp.week_id=w.id) AS plan_days
FROM programs p JOIN weeks w ON w.program_id=p.id
WHERE p.id='<Program 2 UUID>'::uuid ORDER BY w.week_number;

SELECT count(*) AS ready_event_count FROM sales_funnel_events
WHERE event_type='program_ready' AND metadata->>'program_id'='<Program 2 UUID>';

SELECT count(*) AS linked_purchase_count FROM purchases
WHERE program_id='<Program 2 UUID>'::uuid;
```

5. Expect Program 2 `personalization`, `start_date=null`, `current_week=1`; exactly four weeks; Week 1 `planned` with exactly one seven-day meal plan; weeks 2–4 `pending` without meal plans; all activation timestamps null; one `program_ready` event; zero linked purchases. Review the seven days in the existing portal for valid meals/recipes and canonical exclusions. Open the subscriber's existing portal link and confirm the new program and normal start-date controls. Leave start-date selection to the subscriber.

Rollback is reimporting the saved production workflow if needed. It does not undo data already created; preserve completed history and any successor record, and inspect state before deciding on a separate recovery action.
