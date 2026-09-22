# Ticket 42A — Holding-page presentation and analytics

## Changes

- views/glp1-holding.ejs: branded shell, standard metadata/favicon, GA and optional Meta integration; exact approved three-paragraph main content.
- public/css/glp1-holding.css: narrowly scoped mobile-first layout.
- test/ticket-42-glp1-holding.test.js: primary-copy assertion now targets main; standard navigation is allowed while payment controls remain forbidden.
- test/ticket-42a-holding-presentation.test.js: HTTP, asset, navigation, analytics and no-payment regressions.
- docs/TICKET-42A-HOLDING-PRESENTATION.md: this report.

Reused the public purchase page's /css/ticket-27-landing.css palette, system
typography, header, brand-link treatment, logo and favicon. Footer uses the same
Inicio / Términos y Condiciones / Aviso de Privacidad destinations as the service
page. No shared CSS or assets were modified. No external font or UI library was
added. The page has a Dietavity title, canonical URL, theme color and noindex
metadata; it is not an SEO landing page.

GA uses the existing G-L3F2YSYBMP property and gtag.js bootstrap. Its single config
call retains automatic page_view measurement; one additional
glp1_purchase_intent_page_view event is queued per normal load, without custom
parameters. This is browser observation only, not authoritative purchase intent.

Meta Pixel is an optional existing public-page convention. The page uses the
same server-provided metaPixelId and /js/meta-pixel.js loader, without
data-page-event. When configured, only init and PageView are queued. No new
Meta mappings, Purchase, InitiateCheckout or ViewContent events are added.

## Validation

Focused tests: 14 passed, 0 failed, 0 skipped:
node --test test/ticket-42a-holding-presentation.test.js test/ticket-42-glp1-holding.test.js test/ticket-25-website-purchase-funnel.test.js

Full canonical suite (node --test, the package's npm test command):
412 tests, 411 passed, 1 failed, 0 skipped. The sole failure remains the known
Ticket 37A exact schema/source snapshot assertion at
test/ticket-37a-logical-reply-recovery.test.js:82. Ticket 37A was not modified.

HTTP tests verify GET /programa-glp1 and both logo/favicon assets return 200.
Analytics tests execute the inline GA code and shared Meta loader with and
without a configured pixel, checking exact queued event counts and names.

Local Chrome screenshots and layout checks at 320x740, 390x844 and 1440x900
confirmed loaded logo, no horizontal overflow, readable 18–22px primary text
and 16px price text, and a restrained legal footer. Mobile price copy wraps
naturally. Mobile and desktop screenshots were visually inspected. External
requests were blocked during browser validation so no analytics data was sent.
Live GA ingestion remains a post-deployment verification step.

## Production deployment steps — not performed

1. Back up the deployed holding EJS view.
2. Publish public/css/glp1-holding.css and views/glp1-holding.ejs through the
   existing website deployment process. Keep /programa-glp1 unchanged. No server,
   environment, database or workflow change is required.
3. Verify the live route returns 200, logo and favicon resolve, exact copy is
   visible, mobile/desktop layouts work, and no payment control exists.
4. Use browser network inspection and GA debugging to confirm the existing
   Google tag loads, the standard page_view occurs, and exactly one dedicated
   event occurs per normal load.
5. If META_PIXEL_ID is configured, verify only normal Meta PageView tracking
   occurs, with no Purchase or InitiateCheckout event.

## Rollback

Restore the previous EJS view through the website deployment process. The added
CSS can remain unused or be removed after rollback. Preserve the URL and all
Sales Engine artifacts and database evidence; no migration or data rollback
is required.

Sales Engine, offer context/version, intent event semantics/deduplication,
Stripe, generic Checkout, WhatsApp/Twilio, recovery, database, Setup, portal
and meal-generation behavior are unchanged. Nothing was deployed automatically.
