# Ticket 2 — Supabase Credential Audit and Hardening Report

Audit date: 2026-08-07

## Deployment status

The repository changes are ready, but the SQL migration has **not** been
applied to production. Its deployment gate is still closed because n8n exports
refer to stored credential `B3vHRjTvOwuRSoIw` (`Supabase account`) without
exporting its secret or key type, and the available n8n browser session is not
authenticated. The credential must be confirmed as `service_role` (or replaced
with a trusted backend credential) in n8n before applying the migration.

This is the ticket's fail-safe rule in action: no production grants or policies
were revoked while a production access path remained unverified.

## Credential audit

| Component / workflow | Access method | Credential type | Migration required | Repository final state | Safe for hardening? |
| --- | --- | --- | --- | --- | --- |
| Express backend | `supabase-js` via `lib/supabase.js` | `service_role`; `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` | No | Trusted backend key already used | Yes |
| Main n8n workflow | 27 Supabase nodes, stored credential `B3vHRjTvOwuRSoIw` (`Supabase account`) | Unverifiable from sanitized export | If the stored key is anon | Unchanged pending live credential verification | **No — deployment blocker** |
| Main n8n workflow | 13 PostgreSQL nodes plus Postgres chat memory, stored credential `gXJ1myheSM6x1XB8` (`Postgres account`) | Direct PostgreSQL | No | Unchanged | Yes; API-role grants/RLS are not used |
| Weekly Report | PostgreSQL node, stored credential `gXJ1myheSM6x1XB8` (`Postgres account`) | Direct PostgreSQL | No | Unchanged | Yes; API-role grants/RLS are not used |
| Global Error Handler | Direct REST `POST /rest/v1/logs` | Was anon via `SUPABASE_ANONYMOUS_KEY` | Yes | Both `apikey` and bearer authorization now use `SUPABASE_SERVICE_ROLE_KEY` | Yes after updated workflow is imported and env var is set |

No secret values were read, logged, or added to source control.
The unused anonymous-key entry was also removed from `.env.example.text`; the
backend example now documents only the trusted Supabase credential.

### Main workflow Supabase coverage

All 27 Supabase nodes use the same stored credential:

| Table | Node count |
| --- | ---: |
| `users` | 13 |
| `onboarding_sessions` | 5 |
| `logs` | 4 |
| `meal_plans` | 2 |
| `messages` | 2 |
| `unsubscribed_metrics` | 1 |

### Direct PostgreSQL coverage

The main workflow uses direct PostgreSQL for scheduler claiming and
reconciliation, week completion/activation, next-week persistence, program
initialization and week-one planning, Stripe purchase persistence,
onboarding-session state, and PostgreSQL chat memory. The Weekly Report queries
`onboarding_chat_memory` directly. These paths authenticate to PostgreSQL and
do not depend on PostgREST `anon` or `authenticated` table grants.

### Direct REST audit

The only Supabase `/rest/v1/` request in the active workflow files is the Global
Error Handler's `POST /rest/v1/logs`. It has been migrated to
`SUPABASE_SERVICE_ROLE_KEY`. Other HTTP nodes call OpenAI or Stripe, not
Supabase.

## Database review

The schema contains 14 public application tables. All were classified as
backend-only because they hold personal information, payment records, nutrition
data, onboarding/chat content, program state, shopping data, or internal logs:

`users`, `profiles`, `programs`, `weeks`, `meal_plans`, `purchases`, `messages`,
`onboarding_chat_memory`, `onboarding_sessions`, `logs`,
`unsubscribed_metrics`, `shopping_lists`, `shopping_items`, and legacy
`subscriptions`.

The dedicated migration is
`database/migrations/20260807_ticket_2_backend_only_access.sql`. It is
transactional and idempotent for repeat execution. It makes no data or table
structure changes.

### Policies removed

| Table | Policy | Reason |
| --- | --- | --- |
| `logs` | `error_logs` | Allowed every anon row with `USING (true)` |
| `messages` | `messages` | Allowed anon/authenticated with `USING (true)` |
| `unsubscribed_metrics` | `metrics` | Allowed anon/authenticated with `USING (true)` |
| `onboarding_chat_memory` | `onboarding` | Allowed anon/authenticated with `USING (true)` |
| `meal_plans` | `policy_meal_plans` | Allowed anon/authenticated with `USING (true)` |
| `users` | `policy_users` | Allowed anon/authenticated with `USING (true)` |
| `subscriptions` | `subscriptions` | Allowed anon/authenticated with `USING (true)` |

No replacement public policies are created. RLS is enabled on all 14 tables;
the migration adds the missing RLS enablement for `purchases`.

### Permissions changed by the migration

- Revoke every table privilege from `anon` and `authenticated` on all 14
  backend-only tables.
- Preserve and explicitly grant all table privileges to `service_role` on all
  14 tables.
- Revoke execution of `set_updated_at()` and the state-changing
  `start_program_week_one(uuid, uuid, date, date)` from `PUBLIC`, `anon`, and
  `authenticated`.
- Preserve and explicitly grant execution of both functions to `service_role`.
- Remove postgres-owned public-schema default table and sequence privileges for
  `anon` and `authenticated` and default function execution for `PUBLIC`,
  `anon`, and `authenticated`, preventing the exposure from recurring on new
  application objects.
- No public application sequences currently exist in the audited schema, so no
  existing sequence grant requires an object-specific revoke.

PostgreSQL owner/admin privileges and direct PostgreSQL credentials are not
changed.

## Validation results

| Required check | Result |
| --- | --- |
| Express URL/key configuration | Pass (static): `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |
| Direct Supabase REST search | Pass (static): only Global Error Handler found |
| Global Error Handler headers | Pass (static): both use service-role env reference; payload, email node, connections, and workflow structure unchanged |
| Main n8n Supabase credential type | Blocked: sanitized export omits key; live n8n sign-in unavailable |
| n8n PostgreSQL independence from API roles | Pass (static): all relevant nodes use `postgres` credential type |
| Migration table coverage | Pass (static): all 14 public application tables included |
| Permissive policy removal | Pass (static): all 7 allow-all policies dropped |
| Sensitive RPC protection | Pass (static): public API execution revoked; service role preserved |
| JSON workflow validity | Pass: all three active workflow exports parse successfully |
| Existing application unit/regression suite | Not run: Node/npm runtime is unavailable in this workspace shell |
| Anonymous REST CRUD denial | Not run: migration not deployed and no public test credential is present |
| Service-role application operations | Not run: migration not deployed and no trusted test credential is present |
| Portal end-to-end flows | Not run: requires deployed migration and production/staging access |
| Main n8n execution paths | Not run: requires live n8n access and safe workflow executions |
| Weekly Report query/generation/email | Not run: requires live n8n access |
| Global Error Handler log/email simulation | Not run: updated export must first be imported into n8n |
| Ticket 1 authorization | Existing test source remains unchanged; execution not run because Node/npm is unavailable |

## Required deployment and verification sequence

1. In n8n, inspect credential `B3vHRjTvOwuRSoIw` without copying or logging its
   value. Confirm it is a Supabase service-role/trusted secret key. If it is an
   anon/publishable key, replace its API key with the service-role secret.
2. Confirm `SUPABASE_SERVICE_ROLE_KEY` exists in the n8n runtime, import the
   updated Global Error Handler, and verify its two header expressions.
3. Run the repository test suite in an environment with Node/npm.
4. Apply the ticket migration to staging, then test anonymous REST denial for
   SELECT/INSERT/UPDATE/DELETE on every table. A permission-denied response is
   required; an empty result is not sufficient.
5. Run all listed service-role, portal, main workflow, Weekly Report, Global
   Error Handler, and Ticket 1 regression checks in staging.
6. Only after staging passes, apply the same migration to production and repeat
   the security and smoke checks.

## Remaining risks

- The main n8n Supabase credential remains unclassified in repository evidence.
- The updated Global Error Handler exists as an export only until imported into
  the production n8n instance.
- The migration is intentionally unapplied, so the historical production
  exposure may still exist until the deployment gate is satisfied.
- No claim is made that live anonymous access is blocked or live service-role
  behavior passes until the post-deployment tests above are executed.
