# Ticket 7C — Simplified Privacy Notice and Privacy Request Form

## Outcome

The public Privacy Notice now explains Dietavity's data practices through functional categories instead of publishing an infrastructure inventory. Privacy and ARCO requests start at `/privacidad/solicitud`; the internal destination mailbox is fixed in server-only code and is absent from the Privacy Notice and request-form HTML.

Application delivery is implemented through SMTP, matching the email transport already present in Dietavity's n8n infrastructure. The repository contains no production SMTP secrets. A production smoke test remains required after the existing SMTP account is provided to the Express application through environment variables.

## Files changed

- `server.js`
- `lib/privacy-mailer.js`
- `views/privacy-policy.ejs`
- `views/privacy-request.ejs`
- `public/css/style.css`
- `package.json`
- `package-lock.json`
- `test/ticket-3-setup-program-status.test.js`
- `test/ticket-7-public-website.test.js`
- `test/ticket-7c-privacy-request.test.js`
- `docs/TICKET-7C-PRIVACY-REQUEST.md`

The canonical workflow fixture `n8n/Dietavity live 2.5.1 (Ticket 6).json` was not renamed or modified. Its verification hash during Ticket 7C was `8073a813f0379f6af6c01b63f2e74d31dd30550f1a615344801e3446705f2593`.

No database migration was added.

## Final simplified Privacy Notice

The exact public notice is `views/privacy-policy.ejs`. It retains this concise structure:

1. Datos personales que tratamos.
2. Datos personales sensibles.
3. Finalidades del tratamiento.
4. Inteligencia artificial.
5. Información de pago.
6. Proveedores de servicios.
7. Transferencias y comunicaciones.
8. Analítica web y cookies.
9. Conservación.
10. Seguridad.
11. Derechos ARCO.
12. Revocación y limitación.
13. Preguntas y solicitudes de privacidad.
14. Cambios al Aviso de Privacidad.

The notice still states that Dietavity uses artificial intelligence to analyze user-provided information and generate or adapt food recommendations and personalized content. It still discloses user-supplied allergies, declared medical conditions, and other health information, together with Setup's express-consent requirement.

Payment language is functional: specialized payment processors handle payments, while Dietavity receives only the information and identifiers needed to confirm and administer the purchase. The notice does not imply that Dietavity stores full card numbers or security codes.

Analytics language is also functional. It identifies third-party web analytics on Home, Service, and Terms only, and expressly excludes Setup, Portal, Privacy, Privacy Request, Success, and Cancel and sensitive profile information.

## Vendor disclosure changes

The following names were removed from the Privacy Notice:

- Supabase
- OpenAI
- Twilio
- WhatsApp
- Meta
- Stripe
- Google Analytics

No vendor brand remains in the Privacy Notice. No model, API, prompt, workflow, hosting, automation, or orchestration name was added. Customer-facing payment and support experiences outside the Privacy Notice remain out of scope.

The Privacy Notice now groups processors by function: infrastructure, data storage and processing, payment processing, electronic communications, artificial-intelligence tools, and website analytics.

Service providers are described separately from transfers or communications to independent third parties. The notice does not label every processor relationship as a legal transfer, does not invent independent transfers, and says that consent will be requested if a future transfer requires it. The final legal classification of specific provider relationships remains subject to professional review.

## Routes and form

- `GET /privacidad/solicitud` renders `privacy-request.ejs`.
- `POST /privacidad/solicitud` validates and delivers a request or returns a safe form response.

User-visible fields:

- `name`: required text, maximum 100 characters.
- `email`: required email, normalized to lowercase, maximum 254 characters.
- `request_type`: required allowlisted select.
- `message`: required textarea, maximum 4,000 characters.

Stable request-type values:

- `access`
- `rectification`
- `cancellation`
- `objection`
- `consent_revocation`
- `other`

There is also one visually hidden honeypot named `company`. It is not a user-facing request field and is not included in delivered mail.

## Validation and anti-abuse

The backend:

- converts all inputs to strings rather than trusting client types;
- trims and collapses whitespace in single-line fields;
- normalizes message newlines;
- validates a bounded email shape and rejects header newlines;
- rejects request types outside the server allowlist;
- rejects blank and over-limit values;
- caps JSON and URL-encoded request bodies at 32 KB and URL-encoded parameters at 100;
- allows five POST attempts per source IP in a 15-minute in-memory window; and
- returns the normal confirmation for a filled honeypot without sending email.

The rate limiter is intentionally instance-local for the MVP. It resets when the application restarts and is not a distributed privacy-ticket system.

Validation failures return HTTP 400. Oversized parsed bodies return HTTP 413. Rate-limited requests return HTTP 429. Delivery failures return HTTP 500 with a nontechnical retry message. Provider errors and stack traces are not rendered.

## Internal email delivery

`lib/privacy-mailer.js` uses Nodemailer over SMTP with:

- `SMTP_HOST`
- `SMTP_PORT` (defaults to `587`)
- `SMTP_SECURE` (`true` only for an implicit-TLS connection)
- `SMTP_USER`
- `SMTP_PASS`
- `PRIVACY_EMAIL_FROM` (optional; defaults to `SMTP_USER`)

The recipient is fixed server-side and cannot be supplied by the browser. Production must reuse the approved existing SMTP account; do not commit credentials. Missing configuration fails closed and shows the user a retry message.

The subject is `Solicitud de privacidad Dietavity — [tipo]`. The plain-text body contains only:

- Nombre
- Correo electrónico
- Tipo de solicitud
- Mensaje

The user email is used as `Reply-To`. No portal token, payment identifier, database identifier, cookie, password, or infrastructure detail is added.

## Public mailbox exposure

Rendered `/aviso-de-privacidad` and `/privacidad/solicitud` contain no internal mailbox address in visible content, metadata, or client-side JavaScript.

`views/terms-and-conditions.ejs` still displays the same mailbox for the separate purpose of general questions about Terms. The canonical n8n workflow also contains the address in existing general support and legacy-cancellation responses. Those unrelated support paths were deliberately not changed by Ticket 7C.

## Notice version and consent regression

The single server-controlled `PRIVACY_NOTICE_VERSION` is now `2026-08-11`. New successful Setup submissions persist a trusted backend timestamp and `privacy_notice_version = '2026-08-11'`. Client-supplied timestamps and versions remain ignored.

Consent-absent Setup still returns HTTP 400 before profile persistence, name mutation, or program generation. No migration or backfill updates rows that already contain `2026-08-10`. A user who explicitly submits Setup again under the new notice records the new version under the existing Ticket 7B re-consent behavior.

## Verification

Focused Setup, Privacy, request-form, and database-hardening tests: 38 passed, 0 failed.

Complete repository regression suite using `test-support/workflow-fixture.js`, which resolves the canonical `n8n/Dietavity live 2.5.1 (Ticket 6).json`: 86 passed, 0 failed.

Covered request-form cases include GET rendering, valid normalized delivery, each missing field, invalid email, invalid request type, oversized name/message, honeypot, rate limiting, nontechnical delivery failure, fixed recipient, subject, and exact mail body.

At a 390 × 844 browser viewport:

- no horizontal overflow was present;
- inputs and select were 303 px wide and 48 px high with 16 px text;
- textarea was 303 px wide and 182 px high;
- submit button was 303 px wide and 52 px high; and
- all Privacy/Terms navigation links rendered with nonzero usable dimensions.

Static and rendered checks confirm Analytics remains present only on Home, Service, and Terms and absent from Setup, Portal, Privacy, Privacy Request, Success, and Cancel.

## Deployment and smoke test

1. Configure the approved SMTP environment variables above using the existing Dietavity mailbox service.
2. Deploy the application and install the updated dependency lockfile.
3. Restart the application.
4. Verify `/aviso-de-privacidad` and `/privacidad/solicitud`.
5. Send one real privacy request and confirm delivery to the internal destination.
6. Verify neither rendered page exposes the destination.
7. Complete a Setup smoke test and verify the trusted timestamp and version `2026-08-11`.

The real mailbox smoke test cannot be completed from this repository alone because production SMTP credentials are intentionally absent. This is an operational deployment check, not a reason to add or invent credentials.

## Rollback

Roll back the application and dependency files to the last known working release, then restart the application. Do not drop the nullable consent columns, delete evidence, or rewrite any historical consent row.

A rollback that also restores Privacy Notice version `2026-08-10` creates a version mismatch with the already published `2026-08-11` notice and any consents collected for it. Before such a rollback, record the deployment window and decide whether to temporarily pause Setup or deploy a compatible hotfix that keeps the public notice and server-controlled consent version aligned. Consent records already stored as `2026-08-11` must remain untouched.

## OPEN LAUNCH COMPLIANCE ITEM

Add the verified identity and domicile of the responsible party to the Privacy Notice immediately after the accountant provides the required information/documentation.

This item remains unresolved. Do not invent either value or restore visible placeholders.

Additional open items:

1. Professional legal review of the final notice, processor/transfer classifications, international processing, ARCO flow, retention wording, and consent mechanism.
2. Internal category-specific retention schedule.
3. Production analytics/cookie configuration and legal review; no cookie banner was added.
4. Production SMTP configuration and one real delivery smoke test.
