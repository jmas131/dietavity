# Ticket 43 — Softer GLP-1 opening

## Change

The canonical deterministic opening in `lib/sales-engine-v3.js` changed from:

> ¡Hola! 😊 Claro. ¿Qué es lo que más se te está complicando con la comida desde que empezaste a usarlo?

To exactly:

> ¡Hola! 😊 Claro. Dietavity te ayuda a organizar comidas sencillas y personalizadas durante 28 días, especialmente cuando estás comiendo menos. ¿Qué te gustaría saber?

Only the response string changed in application code. Detection, normalization, context persistence, offer version, downstream practical discovery, medical routing, commercial policy, and purchase authorization are unchanged.

## Files changed

- `lib/sales-engine-v3.js`: canonical copy.
- `test/ticket-41-glp1-canary.test.js`: exact copy, single question, generic exclusion; retains existing variant, safety, persistence-contract and downstream regressions.
- `test/ticket-41a-chat-harness.test.js`: sequential embedded-policy/validator/harness regression covering introduction, practical difficulty, price, inclusions, medication and holding-page purchase. Commercial model output and persisted session state are simulated; no live database or model is called.
- `n8n/Dietavity Sales Engine (Ticket 10).json`: regenerated.
- `n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json`: regenerated.
- `docs/TICKET-43.md`: implementation and operational notes.

Generators used, in order:

```bash
node scripts/refactor-ticket-10-workflow.js
node scripts/generate-ticket-41a-chat-harness.js
```

File snapshots confirmed both generated artifacts differ only by the opening string. The generator also rewrote `Dietavity WhatsApp Recovery Poller.json`, whose content remained identical. Both changed workflow artifacts remain inactive. Harness synchronization check passed. This workspace has no Git metadata.

## Validation

- Pre-change focused baseline: 23 passed, 0 failed.
- Updated focused suites (Tickets 41, 41A, 42): 25 passed, 0 failed.
- Historical suites (Tickets 8, 8D, 10B, 32, 39, 42A): 59 passed, 0 failed.
- Canonical full command `node --test` (the exact package.json npm test script): 410 passed, 2 failed, 0 skipped, reproduced on retry. npm is unavailable in this environment; bundled Node was used.
- One failure is the known Ticket 37A schema snapshot assertion in `test/ticket-37a-logical-reply-recovery.test.js:82`; it was left untouched.
- The other is a concurrent Node test-runner deserialization error for Ticket 28. Its unchanged suite passes individually: 6 passed, 0 failed.
- Full serial run `node --test --test-concurrency=1`: 413 passed, 1 failed, 0 skipped. Only the known Ticket 37A assertion remains. The default concurrent runner discrepancy remains unresolved; no test was skipped or weakened.

Local HTTP tests required execution with localhost binding permitted. No production services were called or changed.

## Deployment (separate, authorized operation)

1. Back up the currently deployed Sales Engine workflow and record its workflow identity and activation state.
2. Review/import the regenerated Ticket 10 workflow inactive, preserve the existing credentials and runtime configuration, and verify that the intended production difference is only the opening copy.
3. Optionally import the regenerated Ticket 41A harness inactive into the existing isolated test setup and validate the sequence above. Its local regression simulates persistence; it is not a live database test.
4. Under explicit production authorization, apply the reviewed change to the intended existing Sales Engine and preserve its prior activation state. Avoid activating a second inbound listener.
5. Verify the first campaign response and unchanged generic/purchase behavior through the approved production validation process.

No database migration, Stripe change, website deployment, or service restart is required by this copy change.

## Rollback

Restore the previous opening string in the canonical module and rerun both generators and focused tests. If deployment occurred, restore the backed-up Sales Engine workflow under explicit production authorization, preserving its original identity, credentials and activation state; restore the previous harness if it was imported.

Database, Stripe, Twilio delivery, website, Setup, portal, meal generation and fulfillment behavior did not change. Nothing was deployed, imported, activated or sent automatically.
