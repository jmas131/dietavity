# Changelog

All notable changes to Dietavity will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and follows Semantic Versioning where practical.

---

## [Unreleased]

### Added

- Repository documentation.
- Project architecture documentation.
- Deployment documentation.
- n8n documentation.
- Ticket 9 canonical WhatsApp ledger, Twilio message-level idempotency, and delivery-state tracking.

### Changed

- Weekly conversation reporting now uses canonical customer-visible messages instead of AI memory.

### Fixed

- Ticket 9 outbound reservations now wire canonical `messages.session_id` and
  `messages.body` directly into Twilio send payloads.
- Ticket 36 preserves n8n Twilio string errors, gives explicit provider failure
  precedence over SID-based acceptance, and keeps unresolved replies in
  reconciliation without duplicate sending or premature inbound completion.

---

## [2.4.2] - 2026-07

### Added

- Stripe Checkout integration.
- Success and cancel pages.
- Progressive Web App (PWA) support.
- Dynamic manifest generation.
- Weekly report workflow.
- Global error handler workflow.

### Changed

- Improved onboarding experience.
- Updated landing page.
- Improved payment flow.
- Updated service pages.

### Fixed

- Multiple onboarding issues.
- Subscription flow improvements.
- General bug fixes.

---

## [2.0.0]

### Added

- AI meal plan generation.
- WhatsApp integration through Twilio.
- Supabase integration.
- User onboarding.
- Subscription management.
- Conversation history.
- Personalized nutrition recommendations.

---

## [1.0.0]

### Added

- Initial Dietavity MVP.
- Landing page.
- Basic Express server.
- Initial n8n workflow.
- OpenAI integration.
