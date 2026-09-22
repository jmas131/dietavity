# Ticket 7B — Sensitive-Data Consent and Privacy MVP Launch Report

## Outcome

Ticket 7B persists express sensitive-data consent evidence on the canonical `public.profiles` record and prepares the Privacy Notice for normal MVP publication. Ticket 7A's required unchecked checkbox and pre-persistence HTTP 400 validation remain unchanged.

Files changed:

- `server.js`
- `database/dietavity-database-schema.sql`
- `database/migrations/20260810_ticket_7b_sensitive_data_consent.sql`
- `views/privacy-policy.ejs`
- `test/ticket-3-setup-program-status.test.js`
- `test/ticket-7-public-website.test.js`
- `test/supabase-hardening.test.js`
- `docs/TICKET-7B-PRIVACY-MVP-LAUNCH.md`

## Database and application implementation

Migration: `database/migrations/20260810_ticket_7b_sensitive_data_consent.sql`

Columns added to `public.profiles`:

```sql
sensitive_data_consent_at timestamptz
privacy_notice_version text
```

Both columns are nullable so the migration is safe for existing profiles. The migration is idempotent through `ADD COLUMN IF NOT EXISTS`. It does not change grants, policies, RLS, functions, or public APIs. Ticket 2 continues to revoke `anon` and `authenticated` access to the entire `profiles` table and the Express client continues to use only the service-role key.

The application defines one server-controlled version identifier:

```js
const PRIVACY_NOTICE_VERSION = '2026-08-10';
```

After explicit consent passes backend validation, the POST handler reads only the existing profile's two consent fields. For an existing consent to the same notice version, it preserves the stored timestamp. Otherwise it creates `new Date().toISOString()` on the server. It then adds that timestamp and the server constant to the same profile object used by the existing `profiles.upsert(...)` operation.

The browser cannot control either value. Request fields named `sensitive_data_consent_at` or `privacy_notice_version` are ignored because `normalizeProfile` does not copy them and the handler overwrites the evidence with server-controlled values.

The timestamp source is the backend application server clock, never a browser value. The single profile upsert persists sensitive profile fields and consent evidence together. If the existing-evidence read or combined upsert fails, Setup returns HTTP 500, does not update the user's name, does not invoke program generation, and does not report success.

## Repeat submission behavior

`profiles.user_id` is unique and Setup uses `upsert(..., { onConflict: 'user_id' })`, so repeat Setup submissions update the canonical row rather than creating duplicates.

- Existing timestamp + version `2026-08-10`: preserve the original timestamp.
- Missing timestamp, missing version, or a different future version: store a new server timestamp and current version after the user explicitly checks the Setup box.

This supports later re-consent logic without building a consent-event subsystem. Concurrent first submissions could race and retain the timestamp from the last successful upsert; resolving that edge case would require database-side conditional logic beyond the intended MVP architecture.

## Privacy Notice MVP publication

The customer-visible Privacy Notice cleanly omits the incomplete responsible-party identity/domicile section. It does not display literal placeholders or empty labels. The confirmed privacy/ARCO contact `soporte@dietavity.com` remains the first substantive section and is also repeated for ARCO and consent-revocation/limitation requests.

The Privacy route remains `/aviso-de-privacidad`, all existing links remain intact, and its robots directive is now:

```html
<meta name="robots" content="index, follow">
```

The page remains free of Google Analytics. Its displayed notice version comes from the same server constant persisted with consent.

## OPEN LAUNCH COMPLIANCE ITEM

Add the verified identity and domicile of the responsible party to the Privacy Notice immediately after the accountant provides the required information/documentation.

This issue is unresolved. Hiding incomplete placeholders does not establish full legal compliance. The final notice, identity/domicile insertion, consent mechanism, provider disclosures, retention practices, and ARCO process still require professional legal review.

## Analytics and cookies

Source verification confirms Google Analytics remains limited to Home, Service, and Terms. It is absent from Setup, Portal, Privacy, Success, and Cancel, and no API response loads it. No profile field, portal token, allergy, medical condition, diet, weight, or height event was added. No cookie banner was added. The separate cookie-consent/configuration legal review item remains open.

## Refund policy

**BUSINESS POLICY APPROVED — FINAL LEGAL WORDING PENDING REVIEW.**

The approved business direction is that refunds may be available when requested before personalization/generation of the 28-day program begins. Once the personalized program has been generated or delivered, payments are generally non-refundable, except where required by applicable law or for duplicate or erroneous charges.

This direction was not added to customer-facing Terms. No refund period, processing time, method, or additional eligibility condition was invented.

## Deployment order

Deploy Tickets 7, 7A, and 7B as one combined application state:

1. Apply `database/migrations/20260810_ticket_7b_sensitive_data_consent.sql`.
2. Verify `public.profiles.sensitive_data_consent_at` and `public.profiles.privacy_notice_version` exist and that `anon`/`authenticated` still have no table access.
3. Deploy the combined Ticket 7 + 7A + 7B application code; do not deploy code that expects the columns before the migration.
4. Restart the application.
5. Submit a Setup smoke test with the checkbox checked and confirm redirect to the preparation portal.
6. Verify the profile row contains a trustworthy timestamp and `privacy_notice_version = '2026-08-10'`.
7. Verify an unchecked submission returns HTTP 400 without profile changes or generation.
8. Verify `/aviso-de-privacidad` returns 200, exposes the contact, contains no placeholders, is `index, follow`, and has no Analytics tag.

## Rollback

If application rollback is required, roll back the application code but leave both nullable profile columns in place. Older code will ignore them. Do not drop or clear collected consent evidence. A later forward deployment can reuse the columns. Only remove them under a separately reviewed retention/deletion procedure with an explicit reason and evidence-preservation decision.

## Verification and remaining issues

Automated tests cover consent present/missing, server-controlled timestamp and notice version, combined persistence failure, same-version repeat submission, schema migration/access-control safety, Privacy rendering/indexing/contact, legal-link availability, and the Analytics boundary. The broader regression result and any missing legacy fixture are reported in the Ticket 7B handoff.

Focused Ticket 7B/Setup/Privacy/security tests passed 30/30. The complete repository suite reported 49 passes and 4 failures. All four failures are the pre-existing missing-fixture condition: Ticket 2/4/5/6 tests reference `n8n/Dietavity live 2.4.3.json`, which is absent. The available Ticket 4 portal-rendering regressions passed; the missing workflow fixture prevented the other legacy assertions from running and is documented separately from Ticket 7B.

Remaining launch/compliance work:

1. Complete the open responsible-party identity/domicile item above immediately when verified information arrives.
2. Obtain final professional review of the Privacy Notice and consent/ARCO processes.
3. Complete the production Analytics cookie/configuration assessment.
4. Convert the approved refund direction into reviewed final legal wording before publishing it in Terms.
