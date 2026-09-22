# Ticket 54 — clause-level safety and canonical fact priority

## Local implementation

Safety now composes the deterministic medical referral with canonical answers to separate safe questions. No generated draft is used to build that mixed response. The classifier's stale health topic cannot override a current, explicit GLP-1 product-scope question. The ambiguous standalone medication-action boundary remains conservative; “puedo usarlo” followed by a cooking routine no longer triggers it.

The current-question contract splits coordinated requests, preserves the existing illustrative sample alongside personalization/unknown operational details, and adds canonical GLP-1 suitability and portal-access answers. These facts come from the existing product model: general food organization for adults already using GLP-1 under medical supervision, and portal access after verified payment and Setup. Restricted dietary sample requests still cannot borrow the unrestricted chicken example. Unknown batch preparation, meal-time guarantees and support SLAs remain unconfirmed. Checkout, consent, provider/ledger and database behavior are unchanged.

Ticket 48 now reports per-clause coverage and fails its deterministic coverage assertion when a required answer disappears, including during medical handling. Its Judge instructions explicitly accept truthful, relevant uncertainty and prohibit inferring batch-cooking capability from personalization or an SLA from WhatsApp support. The Judge receives final customer-visible replies, not generated drafts. This bounded lexical coverage check is not a semantic truth evaluator; independent autonomous judging and transcript review remain necessary.

Changed sources: `lib/sales-response-contract.js`, `lib/sales-engine-v3.js`, `lib/dietavity-knowledge.js`, `lib/ticket-48-harness.js`, and the canonical/Ticket 49/Ticket 48 generators. The canonical Sales Engine and Ticket 41A/48 harness JSON are regenerated and inactive. Two Ticket 49 expectations were updated for the approved behavior: safe price questions survive medical handling, and missing coverage now fails rather than only warns. Their safety and missing-answer checks remain enforced.

## Exact evidence and validation

The supplied `eight-scenario-test-output-ticket-53.json` has SHA-256 `a8adacc56580d37a2ac327badf4bf02a3e7b7661feee4396210adee224fc6be0`. Its embedded artifact hash matches the frozen pre-change runtime: `a4b0187af68ebbfd61abdfff7fdb80e99a085724ac954d57dce19128f3bfad44`. The fixture preserves recorded interpretation, draft, state, timestamp and transcript boundaries. The original Judge verdicts are provenance only, never reused to judge changed replies.

- F, run 39415, turn 7: baseline falsely refers practical support/sample/batch questions to a prescriber. Corrected output gives known support/sample/shopping facts and explicit uncertainty, without medical handling or timing guarantees.
- H, run 39429, turn 2: corrected output answers GLP-1 product suitability and refers dose decisions to the prescriber. Removing the dose clause prevents medical handling, even with the original health interpretation.
- A, run 39382, turn 3: corrected output preserves both personalization and the illustrative sample.
- All **79/79** saved replies reproduce under the frozen baseline. Changed-code replay has **zero execution and assertion failures**. This is recorded-model replay, not a fresh autonomous conversation.
- Focused Ticket 54: **13 passed**, no failures/skips.
- Tickets 41–54 historical tests: **242 passed**, no failures/skips.
- Full serial suite: **613 tests, 612 passed, one pre-existing failure**, no skips. Ticket 37A's schema-source equality assertion at `test/ticket-37a-logical-reply-recovery.test.js:82` remains unresolved, as already documented before Ticket 54. No database files were changed to conceal it.
- Both harness generation checks pass. The parallel Node runner encountered its existing IPC deserialization issue; the full serial run avoids that runner issue. npm is unavailable in this environment, so the package's `node --test` command was run directly with the available runtime.

Logs, baseline failures, replay comparison, and acceptance status are in `outputs/ticket-54/`. Reproduction:

```bash
node scripts/refactor-ticket-10-workflow.js
node scripts/generate-ticket-41a-chat-harness.js
node scripts/generate-ticket-48-harness.js
node --test test/ticket-54-clause-precedence.test.js
node --test --test-concurrency=1 test/ticket-4*.test.js test/ticket-5*.test.js
node --test --test-concurrency=1
node scripts/run-ticket-54-replay.js
node scripts/generate-ticket-41a-chat-harness.js --check
node scripts/generate-ticket-48-harness.js --check
```

## Pending autonomous acceptance and deployment

`outputs/ticket-54/inactive-f-h-a-harness.json` is ready to import into an isolated n8n environment with the existing test OpenAI credential. It runs F → H → A, in that order, through the existing Ticket 48 architecture. No isolated runner was provided, so it has **not been imported or executed remotely**. No fresh full eight-scenario batch was run.

Once an isolated runner is available, import the inactive harness and manually run F → H → A. Inspect actual transcripts, coverage assertions, unsupported claims and independent Judge evidence; distinguish engine failures from customer-agent or Judge failures. Run a fresh eight-scenario autonomous batch only if all three pass. Recorded replay cannot satisfy this gate. The pre-existing full-suite failure also remains an explicit local validation discrepancy.

No production workflow was imported, activated or deployed. No migration, production data mutation, real customer message or payment operation is part of this implementation. Production deployment remains a separate, explicitly authorized operation after fresh acceptance.
