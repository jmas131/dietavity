# Ticket 32 - Weekly Conversation & Sales Intelligence

## Architecture and scope

Ticket 32 evolves the Ticket 19 read-only auditor; it does not add a parallel
auditor or modify the separate general `Dietavity Weekly Report` workflow. The
renamed generated artifact is:

`n8n/Dietavity Weekly Conversation & Sales Intelligence.json`

It continues to read `public.messages`, HMAC-pseudonymize session identifiers,
redact obvious PII and token-like values, call OpenAI once when conversations
exist, format escaped HTML, send through the existing SMTP credential, and route
unexpected failures to the existing Global Error Handler. It remains inactive.

## Cadence and reporting window

- Old: daily at 22:00, execution-time interval `[NOW() - 24 hours, NOW())`.
- New: weekly on Monday at 08:00 in `America/Mexico_City`.
- New window: the seven complete local calendar days preceding execution day.
  SQL converts both local-midnight boundaries to instants and uses a half-open
  interval. The report states the inclusive local start and end dates.

## Analytical contract

The report now covers sample quality, intent, funnel signals, wants, questions
and objections, sales-helping and sales-hurting moments, marketing and
positioning, product/customer experience, and technical findings. Material
themes separate observed evidence, interpretation, and recommended action.
Counts are per conversation, and one conversation is normally labeled an
isolated weak-evidence observation rather than a recurring pattern.

Canonical positioning, offer, payment, and medical-scope facts are generated
from `lib/dietavity-knowledge.js`. The prompt requires "Product capability
requires verification" for facts outside that supplied context. Prepared-food
delivery confusion is product/positioning clarity, not authorization to build a
delivery service. Health conversations cannot create diagnostic, therapeutic,
medication, or clinical-diet claims.

No reliable test-traffic marker is part of the auditor input. The auditor must
state that limitation, retain such conversations in counts, and never exclude
traffic through message-text guesses.

Engineering tickets are optional and limited to one supported actual technical
defect that is appropriately solved in engineering without relying on an
unverified capability. The HTML formatter independently suppresses a proposed
ticket when no technical finding is present. Recommendations never make changes.

## Critical failures

The workflow retains `sa10JQEAbxNYvCGG` as its n8n error workflow, so runtime
failures remain immediately visible through the existing Global Error Handler.
The weekly analysis also calls out conversational evidence of payment-state
corruption, duplicate charges or delivery, unsafe health responses,
privacy/security issues, or widespread Checkout/messaging failure. No second
monitoring system was added.

## Deployment

No database migration is required. After review and an authorized deployment:

1. Back up the currently deployed Daily Conversation Auditor.
2. Import `n8n/Dietavity Weekly Conversation & Sales Intelligence.json` as
   inactive, replacing the old auditor rather than running both.
3. Preserve the existing Postgres, OpenAI, SMTP, HMAC secret, and Global Error
   Handler configuration.
4. Run a controlled manual execution for zero-message and representative-message
   windows; inspect the stated dates, redaction, HTML, and error routing.
5. Deactivate/remove the old daily schedule, then activate only the reviewed
   weekly workflow.

Repository implementation does not authorize import, replacement, activation,
or any production change.
