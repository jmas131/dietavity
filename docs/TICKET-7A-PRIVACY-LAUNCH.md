# Ticket 7A — Privacy Launch Implementation Report

## Status

The technical requirements in Ticket 7A are implemented. The Privacy Notice is **NOT READY FOR PUBLIC PRODUCTION until placeholders are resolved**:

- `[RESPONSABLE LEGAL DE DIETAVITY]`
- `[DOMICILIO DEL RESPONSABLE]`

The Privacy Notice remains `noindex, nofollow` while those launch-critical facts are pending.

## Files changed

- `server.js`
- `views/setup.ejs`
- `views/privacy-policy.ejs`
- `views/success.ejs`
- `views/cancel.ejs`
- `test/ticket-3-setup-program-status.test.js`
- `test/ticket-7-public-website.test.js`
- `docs/TICKET-7A-PRIVACY-LAUNCH.md`

## Express consent in Setup

Immediately before the submit button, Setup now shows a required checkbox named `sensitive_data_consent`. It is unchecked by default and uses this wording:

> Consiento expresamente el tratamiento de los datos personales sensibles que proporcione, incluidos datos de salud como alergias y condiciones médicas, para personalizar mi programa Dietavity de acuerdo con el Aviso de Privacidad.

“Aviso de Privacidad” links directly to `/aviso-de-privacidad` and opens in a new tab so reviewing it does not unnecessarily discard entered Setup data. The nearby legal paragraph also links to both Terms and Privacy. Bootstrap's standard checkbox layout, a full text label, and the existing responsive page structure keep the control usable on mobile.

The POST handler independently accepts the actual form value (`true`) and the conventional equivalent values `on` and `1`:

```js
const sensitiveDataConsent =
  req.body.sensitive_data_consent === 'on' ||
  req.body.sensitive_data_consent === 'true' ||
  req.body.sensitive_data_consent === '1';
```

If consent is absent or invalid, the handler returns HTTP 400 before looking up the user, normalizing or upserting the profile, updating the user's name, checking program state, or calling the generation webhook.

## Consent evidence

**Does Dietavity currently persist evidence of when/how sensitive-data consent was obtained? No.**

The inspected application schema contains no consent field, consent-event table, or suitable existing application persistence mechanism. Supabase Auth's `auth.oauth_consents` table is provider infrastructure and is not evidence of Dietavity Setup consent. No schema change was introduced by this ticket. A legally reviewed evidence and retention approach remains a data-governance consideration before launch.

## Privacy Notice and contact

The Privacy Notice now states that Dietavity may process user-supplied allergies, declared medical conditions, and other health information; uses these data to personalize the Dietavity program; and requests express consent through the Setup checkbox. It does not imply consent merely from viewing the notice.

`soporte@dietavity.com` is confirmed and used as the official channel for privacy questions, ARCO requests, consent revocation, and requests to limit data use or disclosure. No alternative privacy address was added.

The two responsible-party placeholders remain unchanged and visually highlighted in the draft warning and responsible-identity section.

## Google Analytics audit

The templates use the Google tag (`gtag.js`) loaded asynchronously from `www.googletagmanager.com`, followed inline by `gtag('js', new Date())` and `gtag('config', '<measurement ID>')`. They do not use a Google Tag Manager container. The same GA4-style Measurement ID is used consistently; the ID is intentionally omitted here because it is not operationally necessary for this report.

After correcting the scope discrepancy found during the audit, Analytics loads on exactly:

- `views/home.ejs` (`/`)
- `views/service-features.ejs` (`/servicio`)
- `views/terms-and-conditions.ejs` (`/terminos-y-condiciones`)

Because the scripts are in each page's `<head>`, Analytics begins loading during page load, before user interaction. The inspected source contains only the basic `gtag('config', ...)` call: no advertising-feature options, Google Signals setting, ad-personalization setting, explicit IP-anonymization option, custom events, or transmission of Setup/profile fields is visible.

The audit initially found the same tag unexpectedly in Success, Cancel, and Privacy. Those three snippets were removed to match the confirmed deployment. Analytics is absent from Setup, the personalized plan portal, Success, Cancel, Privacy, and application API responses. No Analytics tag was added to any page.

The Privacy Notice now limits its disclosure to the three actual pages, describes the purpose as measuring site use and performance, identifies Google as the service provider that may process technical/usage information, and explains that browser identifiers, analytics cookies, or similar technologies may be used. It does not claim that health-profile data is sent to Analytics.

## Cookie preference/consent assessment

Confirmed technical facts: GA loads before interaction on the three listed pages; the source has no cookie banner, preference center, or consent-mode configuration; and the source does not expose advertising options or explicit IP-anonymization configuration.

Legal assessment: source inspection alone cannot conclusively determine whether a Mexico-only deployment requires prior cookie consent or a preference mechanism. The current notice gives disclosure and browser-level blocking information, but a Mexican privacy professional should review the final GA property configuration, cookies actually set in production, applicable notice/consent obligations, and whether an opt-out or consent mechanism is required. No banner was invented or implemented in this ticket.

## Refund policy preparation

The current Terms contain no refund, reimbursement, cancellation, automatic-renewal, or subscription-refund policy. They accurately describe the new-customer product as a one-time payment with no recurring charges, so no contradictory customer-facing language needed removal. Ticket 6's internal/legacy subscription-cancellation behavior remains untouched.

**FINAL REFUND POLICY REQUIRES BUSINESS/LEGAL APPROVAL BEFORE LAUNCH.** The proposed business direction in Ticket 7A was not published as legal Terms or converted into a customer promise.

## Verification

Automated coverage verifies:

- required, unchecked Setup checkbox and direct Privacy link;
- consent-present Setup persistence and generation flow;
- consent-absent HTTP 400 with no profile/name modification or webhook call;
- Privacy sensitive-data/express-consent language, confirmed contact, placeholders, and draft warning;
- Analytics present only on Home, Service, and Terms, and absent from Setup, plan portal, Success, Cancel, and Privacy;
- relevant authorization, backend-only access, Setup/readiness, shopping-list, public-route, and database-hardening behavior (41 targeted tests passed).

A browser check at a 390 × 844 mobile viewport confirmed that the checkbox and full linked label are visible, the checkbox is unchecked and required, the Privacy link is visible and points to `/aviso-de-privacidad`, native validation reports the missing value, and the page has no horizontal overflow. The link opens in a new tab with `noopener noreferrer`.

The complete suite reported 45 passes and 4 failures. All four failures are caused by the pre-existing missing fixture `n8n/Dietavity live 2.4.3.json`, referenced by Ticket 2/4/5/6 tests; none reached a Ticket 7A assertion. The available Ticket 4 portal-rendering tests passed. Restoring or retargeting that legacy workflow fixture is required to obtain a fully green complete suite.

## Remaining launch-critical privacy/legal work

1. Confirm and replace the legal responsible party and domicile placeholders; keep the Privacy Notice out of public production until resolved.
2. Obtain professional review of the Privacy Notice, the express-consent wording/electronic mechanism, ARCO/revocation process, and international-provider disclosures.
3. Decide and implement a legally appropriate consent-evidence/retention mechanism.
4. Complete the production cookie audit and professional assessment described above.
5. Obtain business/legal approval for the final refund policy before adding it to the Terms.
