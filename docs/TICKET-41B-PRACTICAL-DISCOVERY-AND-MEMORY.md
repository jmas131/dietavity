# Ticket 41B — Practical discovery and final Chat memory

## Changes and root causes

The practical-food follow-up could arrive from the classifier as `question`, `diet_support` (or `personalization`), and `material_question: true`. That selected `answer_question`, enabled the purchase CTA, and let the validator replace a useful generated answer with generic preferences/restrictions copy. The old test supplied an information-request interpretation without a material topic, so it missed the incident.

`lib/sales-engine-v3.js` now identifies practical food difficulties in the existing GLP-1 context before that generic material-question branch. A general, non-clinical food-organization response survives final validation, offers no Checkout, stores no health goal, and ends with one practical discovery question. It covers difficulty choosing food, organizing meals, and finding time to cook. Current deterministic commercial questions, explicit purchase, objections, support, and medical safety retain precedence. Generic conversations retain their existing behavior.

The harness correction previously targeted only `message.data.content` and `message.data.additional_kwargs`. With a flat `{type, content, additional_kwargs}` row, `jsonb_set` does not create the missing intermediate `data` object: the UPDATE can count a row without replacing its raw text or setting the marker. The local fixture used only nested rows and concealed this failure. The new SQL preserves either layout and existing metadata, including absent/null kwargs. This reproduces the reported symptom locally; the deployed runtime and live rows were not inspected.

Chat previously appended inspection JSON to the visible response, while memory stored only the reply. Chat now returns exactly the final reply; inspection fields remain in the terminal node's execution output. Before the response model can read memory, the harness rejects any session containing an unmarked AI reply. Failed or old test sessions require the existing scoped cleanup before restarting. It does not silently mark old raw replies as final.

The generator and inactive canonical Sales Engine and harness JSON were regenerated. No migration or application dependency was added.

## Production memory finding

The source production graph connects `Postgres Chat Memory` to `Generate Sales Response v3`, before `Validate Sales Response Contract`. There is no corresponding final-response rewrite of that AI memory in the Sales Engine. Thus pre-validation AI context is also possible there; this is not exclusively a harness issue. The production final-message evidence is separate: validated output goes to `Reserve Sales Reply` and the canonical `messages` ledger, and recent sales clarification context reads accepted canonical replies.

Production memory writes remain unchanged. The harness can replace its latest AI row because it is expressly sequential, isolated, and has no delivery recovery. A production correction must relate memory to canonical inbound reservations and handle outbound retries, failed sends, and historical raw rows; the current AI-memory schema has no inbound reservation key. Copying the harness's latest-row update would not establish those guarantees. This ticket prepares the shared policy fix without claiming to resolve production AI-memory parity or changing canonical delivery behavior.

## Validation

- Focused Ticket 41/41A and historical Ticket 10/39 suites: **44 passed**, no failures or skips.
- Isolated PGlite execution of generated Ticket 41/41A SQL: **11 passed**, no failures or skips. Includes flat and nested memory, metadata preservation, absent/null kwargs, rejection of unfinished history, transactional rollback on missing memory, identity isolation, and cleanup.
- Exact requested six-message conversation rerun locally, in order:
  1. `¡Hola! Quiero saber más.` — exact discovery opening.
  2. `Se me complica saber qué comer porque tengo poco apetito.` — practical food guidance, no generic preferences/restrictions or Checkout offer.
  3. `¿Cuánto cuesta?` — $149 MXN facts.
  4. `¿Y qué incluye?` — canonical inclusions.
  5. `¿Debo bajar mi dosis?` — prescriber referral.
  6. `Quiero comprarlo.` — Checkout intercepted; no payment or external side effect.
- For each response-producing turn, tests compare latest AI memory to the actual Chat `output`, require `ticket41a_final: true`, and compare the next turn's clarification context to the previous final reply. The final intercepted action retains the existing no-write boundary.
- Full suite, `node --test --test-concurrency=1`: **406 passed, 1 failed, 0 skipped** (407 total). The unchanged Ticket 37A assertion requires the entire generated SQL string to occur verbatim in the pg_dump-formatted schema. This discrepancy is already recorded in the Ticket 41A report; it was not hidden by modifying the test or schema. The initial concurrent run additionally encountered a Node test-runner deserialization error for Ticket 28; the sequential full run passed that file.
- Harness generation synchronization check passed.

These are local workflow/SQL tests with fixture model outputs, not a live n8n/OpenAI acceptance run. The workspace has no Git metadata, so a Git diff was unavailable.

## Separate deployment steps

No live import, activation, deployment, database mutation, or provider action was performed. The canonical Sales Engine and harness artifacts remain inactive.

For an authorized runtime acceptance test, import the regenerated harness separately, map test credentials, clean only the two exact namespaced test sessions using the existing cleanup script, and repeat the six messages in the manual Chat/Test UI. Inspect `output`, `assistant_response`, and the latest memory row in the same selected test database. Existing unvalidated history intentionally fails closed. Publishing the shared policy fix to the production Sales Engine is a separate production operation.
