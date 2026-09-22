# Ticket 7 — Public Website and Privacy Implementation Report

**Implementation date:** August 10, 2026  
**Status:** Website implementation complete; production publication is blocked by the legal/business items listed below.

## Files changed

- `server.js`
- `views/home.ejs`
- `views/service-features.ejs`
- `views/terms-and-conditions.ejs`
- `views/success.ejs`
- `views/cancel.ejs`
- `views/setup.ejs`
- `views/privacy-policy.ejs` (new)
- `public/css/style.css`
- `test/ticket-7-public-website.test.js` (new)
- `docs/TICKET-7-PUBLIC-WEBSITE-PRIVACY.md` (new)

No portal/program UI or backend business logic was changed. The only backend change is the new public Privacy route.

## Public legacy-copy audit and replacements

### Home

| Legacy customer-facing copy | Replacement |
| --- | --- |
| “Planes de alimentación listos para seguir…” as an indefinite proposition | “Tu programa personalizado de nutrición para 28 días” |
| “Tu asistente de comidas saludables en WhatsApp” | Portal-first program positioning with WhatsApp as a companion |
| “Planes semanales • Recetas e ideas de comidas • Cancela cuando quieras” | Four-week program contents and a one-time purchase |
| “Planes semanales” without a defined duration | “28 días, organizados en 4 semanas” |
| “Sin apps… Solo conversación por WhatsApp” | Program in the Dietavity portal/PWA; help through WhatsApp |
| “$99 MXN al mes” | “$149 MXN” and “Pago único” |
| “Empieza cuando quieras, cancela cuando quieras” | “Un solo pago. No es una suscripción recurrente.” |

The updated proposition includes breakfasts, lunches, dinners, snacks, estimated calories, recipes, a shopping list, the “No me gustó” swap, the portal/PWA, WhatsApp support, and weekly progression. Macros are not advertised because the current portal visibly presents calories but does not have a stable macro display.

### Service

| Legacy customer-facing copy | Replacement |
| --- | --- |
| Weekly plans requested whenever the user chooses | A defined 28-day program progressing through four weeks |
| “Todo sucede directamente en WhatsApp” | The structured program lives in the portal; WhatsApp provides help |
| “Suscripción” and “$99 MXN al mes” | A $149 MXN one-time Stripe Checkout purchase |
| Cancellation by sending “cancelar” | Removed from the new-customer proposition |

The page now presents the requested six-step journey from WhatsApp introduction through weekly portal use and WhatsApp support.

### Terms and Conditions

| Legacy customer-facing clause | Replacement |
| --- | --- |
| Up to two complete plans per week, implying an indefinite service | One 28-day program organized into four weekly plans |
| “Suscripciones y pagos” handled externally | One-time $149 MXN purchase through Stripe Checkout |
| “El usuario puede cancelar cuando quiera” | Removed; there is no new-customer subscription to cancel |

The new Terms explain personalization from user-supplied data, portal access, Stripe processing without Dietavity storing full card numbers/CVV, service availability, and the non-medical nature of the guidance. No refund promise or policy was invented.

### Success and canceled Checkout

- Success now confirms payment and explains that the next step is the secure Setup/profile link sent through WhatsApp. Subscription-activation language was removed.
- Cancel now states that the Checkout ended before payment completion and that the program was not activated. It does not describe cancellation of an active subscription or guarantee a payment state that the page cannot independently verify.

## Privacy Notice

`GET /aviso-de-privacidad` renders `views/privacy-policy.ejs` with the title “Aviso de Privacidad | Dietavity”. The full Spanish notice covers:

- responsible-party identity and address placeholders;
- privacy contact;
- identity/contact, profile, program-use, communications, payment, and technical data;
- sensitive health data, including allergies and declared medical conditions;
- Stripe payment processing and the identifiers Dietavity stores;
- Twilio and WhatsApp/Meta messaging data;
- necessary and optional purposes;
- AI-assisted generation, responses, and intent classification;
- Supabase, OpenAI, Twilio, WhatsApp/Meta, Stripe, hosting infrastructure, and Google Analytics;
- international processing at a cautious, high level;
- no sale of personal data;
- non-invented, purpose-based retention wording;
- ARCO rights, consent revocation, and use/disclosure limitation;
- high-level administrative, technical, and physical safeguards;
- Google Analytics cookies and normal technical logs;
- changes to the notice and the last-updated date.

The drafting was checked against the current [Federal Law on Protection of Personal Data Held by Private Parties](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf) (latest reform shown as November 14, 2025) and its [Regulations](https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LFPDPPP.pdf). This report and notice are implementation artifacts, not legal advice.

## Third-party services disclosed

| Service | Disclosed role |
| --- | --- |
| Supabase | User, profile, program, purchase, message, and operational record storage |
| OpenAI | AI-assisted program/content generation, responses, and message classification using relevant inputs |
| Twilio and WhatsApp/Meta | WhatsApp message transport and associated sender/message data |
| Stripe | Checkout, payment processing, fraud controls, and purchase-status identifiers |
| Hosting/infrastructure provider | Site, portal, workflow availability, and technical logs; no provider name was invented |
| Google Analytics | Public-site measurement and related technical/cookie data |

## Legal links

Terms and Privacy links are visible on Home, Service, Success, canceled Checkout, and Setup. Terms links to Privacy, and Privacy links back to Terms. Setup shows both immediately before the submission button and again in the footer.

## Sensitive-data consent assessment

**Does the current Setup flow have an adequate consent/acknowledgment mechanism for sensitive profile data? No.**

Setup collects allergies, medical conditions, height, weight, and potentially health information in notes. It previously had no Privacy link or acknowledgment. This ticket adds clear Terms and Privacy links but deliberately does not treat passive access to those links as express written/electronic consent. The current Mexican private-sector law states that sensitive-data processing requires express written consent through a signature, electronic signature, or an established authentication mechanism. A reviewed consent mechanism, evidence record, wording, and withdrawal flow are therefore a launch-critical follow-up.

## Required post-change audits

Search scope: `server.js`, `views/`, and `public/`.

| Pattern | Remaining public occurrence |
| --- | ---: |
| `$99` | 0 |
| `$249` | 0 |
| `/mes` | 0 |
| `suscripción mensual` | 0 |
| `renovación automática` | 0 |
| `plan mensual` | 0 |

There are no remaining obsolete new-customer references in rendered/public website files.

### Broader repository occurrences

- `docs/PROJECT-SUMMARY.md` contains old $99/$249 monthly figures. Classification: **required legacy/internal** documentation; it is not rendered by the website.
- `n8n/Dietavity live 2.5.1 (Ticket 6).json` contains active onboarding prompt nodes that can still describe $99 MXN/month to WhatsApp leads. Classification: **public bug still requiring removal**. This website ticket did not rewrite the n8n workflow because that would change the separately versioned Ticket 5/6 orchestration artifact and requires its own regression/deployment process.
- Ticket 5/6 documentation and cancellation workflow copy still refer to subscription cancellation for verified legacy subscribers. Classification: **required legacy/internal**, preserving Ticket 6 behavior.
- Ticket 7 test regular expressions contain the forbidden strings only as negative assertions. Classification: **required legacy/internal** test coverage.

## Tests and results

### Ticket 7 automated tests

`node --test test/ticket-7-public-website.test.js`

- 7 passed
- 0 failed

Coverage includes route/view mapping, Home offer and features, Service sequence, Terms, Success/Cancel distinction, Privacy disclosures/placeholders, and legal links.

### HTTP route smoke test

All returned HTTP 200 from the local Express server:

- `/`
- `/servicio`
- `/terminos-y-condiciones`
- `/aviso-de-privacidad`
- `/pago-exitoso`
- `/pago-cancelado`

### Mobile browser check

Tested all six pages at a 390 × 844 responsive viewport:

- no horizontal overflow on any page;
- footer links visible on every page;
- CTAs met a usable minimum rendered size;
- legal content rendered at 16px with approximately 27.5px line height and a 339px content width.

### Full regression suite

The full `node --test` run reached 42 passing tests, including all Ticket 7 tests, but ended with four pre-existing failures because several tests reference the absent file `n8n/Dietavity live 2.4.3.json`. The repository currently contains `n8n/Dietavity live 2.5.1 (Ticket 6).json`. This ticket did not recreate or rename a workflow artifact because doing so could affect Tickets 4–6 without a validated source-of-truth decision.

## Production blockers and unresolved business facts

1. **Responsible identity and domicile:** Replace `[RESPONSABLE LEGAL DE DIETAVITY]` and `[DOMICILIO DEL RESPONSABLE]`. The Privacy page visibly marks itself as pending review and uses `noindex, nofollow`; it must not be deployed with these placeholders, and indexing should be enabled only after approval.
2. **Privacy contact:** `soporte@dietavity.com` exists in current support flows, but the owner must confirm that it is the official privacy/ARCO channel.
3. **Sensitive-data consent:** Add a legally reviewed express electronic consent and evidence mechanism before collecting Setup health data.
4. **Refund policy:** No finalized policy was found. None was invented; the business/legal owner must define and review one.
5. **Retention schedule:** The notice uses purpose-based wording because no approved category-specific schedule exists. Document one internally.
6. **WhatsApp lead copy:** Update and regression-test the active n8n onboarding prompts that still advertise the legacy monthly product.
7. **Analytics choice mechanism:** Google Analytics is already loaded. The notice discloses it, but the owner/legal reviewer should determine whether a cookie preference mechanism or configuration changes are required for the intended deployment.
