# Ticket 41A — Sales conversation Chat/Test harness

## Artifact and scope

Import `n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json` as a **separate, inactive workflow**. It tests Sales Engine conversations with fake identities through n8n's manual Chat/Test interface. No production Sales Engine, source policy, knowledge module, schema, or migration was changed for this ticket. Nothing was imported, activated, or executed against a live database or model during implementation.

Generator: `scripts/generate-ticket-41a-chat-harness.js`.

```sh
node scripts/generate-ticket-41a-chat-harness.js
node scripts/generate-ticket-41a-chat-harness.js --check
```

Regenerate this harness after changes to the canonical Sales Engine JSON. The generator reads `n8n/Dietavity Sales Engine (Ticket 10).json`; it does not regenerate or modify that source. Regression checks ensure copied classifier prompts, canonical knowledge, policy, response builder, validator, and model configuration stay identical.

## Established pattern and canonical logic

Repository inspection found historical references to `When chat message received` in early archived exports, together with the established `chatInput` → `Set Session Id` → onboarding session/agent/Postgres memory pattern. No complete Chat Trigger node or runnable earlier Chat harness remains in the available exports. This harness reuses that input/state/memory pattern and the current canonical sales nodes rather than reconstructing an old classifier or duplicating prompts by hand.

The added Chat Trigger uses node version 1.1, `public: false`, and `responseMode: lastNode`. Existing node versions are preserved. The terminal Code nodes provide an `output` string for Chat and separate structured diagnostic fields. This follows the documented private manual interface and last-node response mechanism in [n8n's Chat Trigger documentation](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.chattrigger/).

Flow:

```text
Private Chat Trigger → operator-selected fake identity → guarded Set Session Id
→ canonical session load/initialization → canonical knowledge and AI classifier
→ canonical interpretation parser → isolated recent-response adapter
→ canonical deterministic policy → canonical action router
  ├─ respond/close → canonical response builder + AI + memory + validator
  │                 → canonical state UPDATE + final test-memory correction
  │                 → Chat reply and inspection fields
  └─ Checkout/reminder → terminal TEST ONLY inspection result
```

Manual use makes real calls to the configured OpenAI models and uses the selected database. There is no mocked classifier in the imported workflow. The automated local tests substitute model outputs only at the model boundary; they do not claim to validate live model behavior or a live n8n import.

## Isolation and persistence

Select one of these values in **Configure Fake Identity**:

| Fake identity | Actual canonical database `session_id` |
| --- | --- |
| `+5215554111111` (default) | `ticket41a:+5215554111111` |
| `+5215554222222` (generic regression) | `ticket41a:+5215554222222` |

Only those two exact selections are accepted. Chat-supplied identities, session IDs, or provider IDs cannot override the selection. No Twilio Message SID is invented. The namespace prevents collision even if the phone-shaped number happens to belong to a real person; the plain `+521...` database records are never used. Inspection output exposes both the actual `session_id` and the selected `fake_whatsapp_id`.

If you map the harness to the current database, it writes **only** namespaced rows in:

- `onboarding_sessions`: the canonical context load/update, session initializer and response-state UPDATE. `offer_context`, question state, goals and the current offer behave as in the Sales Engine.
- `onboarding_chat_memory`: the existing Postgres memory node maintains conversational context. After validation, the latest AI entry (flat runtime format or nested legacy format) is replaced with the actual Chat response and marked with `additional_kwargs.ticket41a_final = true`. The recent-response adapter reads only those validated test replies.

The final memory correction and response-state UPDATE share one SQL statement. Missing final memory raises a database error and rolls back that update. Database/model failures are not converted into successful test responses. Send **one message at a time** and wait for each execution to finish; this is a manual conversation harness, not a test of production inbound ordering or concurrency. Ticket 41B blocks subsequent response generation if any AI reply in the session lacks the final marker (the SQL guard raises division by zero). After an interrupted/failed model execution, clean up the fake session before restarting the sequence to avoid unfinished AI context.

The Chat window's generated session ID is intentionally ignored. Opening a new Chat window does **not** reset the selected fake identity's database state.

## Side-effect boundary

The allowlisted graph contains no Twilio, Stripe, HTTP request, email, portal-recovery, user lookup/provisioning, scheduled trigger, or execute-workflow node. The production `errorWorkflow` setting is omitted so failures do not invoke its email/error workflow. Credentials are unresolved harness-specific names with no production credential IDs; map them explicitly before manual use.

Checkout stops before **Persist Checkout Authorization v3** and before Stripe. The terminal result shows `checkout_would_be_created = true` only if the canonical policy both selects `send_checkout` and authorizes it. The result retains `offer_version = 28d-149-v1`. It creates no URL, Checkout Session, authorization evidence, payment, or simulated successful purchase. The sequence ends there; post-Checkout/payment behavior is outside this harness.

Requested reminders also terminate with an explicit intercepted-action result. They are not scheduled or sent. Test lead/response events are excluded from the adapted SQL, so no funnel events are written. The harness never writes `messages`, claims a canonical WhatsApp inbound, or fabricates Twilio acceptance. Its final Chat text lives only in test AI memory and n8n execution output.

## Nodes

The standalone workflow has 21 nodes:

| Nodes | Purpose |
| --- | --- |
| When chat message received | Private manual Chat/Test entry. |
| Configure Fake Identity | Operator selects one allowlisted fake identity. |
| Set Session Id | Validates text and identity; creates the namespaced canonical key. |
| Get Onboarding Session; If Existing Onboarding Session | Unchanged canonical context persistence/load and branch. |
| Initialize Sales Lead v3 | Canonical initializer, with only its funnel-event CTE removed. |
| Build Canonical Dietavity Knowledge | Unchanged Ticket 41 conditional knowledge. |
| Interpret Sales Buyer Signal; Sales Interpretation Model; Parse Sales Interpretation | Unchanged canonical AI classifier, model, and parser. |
| Get Recent Sales Clarification Context | Adapter reads the latest validated test reply from existing AI memory. |
| Apply Deterministic Commercial Policy; Route Authorized Sales Action | Unchanged policy and routing conditions; Checkout/reminder edges terminate locally. |
| Build Constrained Sales Response; Generate Sales Response v3; Sales Response Model | Unchanged response prompt, agent, and model. |
| Postgres Chat Memory | Existing memory node with its key bound to the guarded test session. |
| Validate Sales Response Contract | Unchanged final validator, including GLP-1 discovery and safety rules. |
| Persist Harness Response State | Canonical response-state UPDATE without business events; corrects final test AI memory. |
| Return Chat Response | Emits the final reply and minimal inspection fields. |
| Intercept External Action | Terminal Checkout/reminder inspection without side effects. |

Inspection fields: `session_id`, `fake_whatsapp_id`, `user_message`, `offer_context`, `buyer_signal`, `strategy`, `assistant_response`, `offer_version`, `checkout_would_be_created`, and `intercepted_action`. As of Ticket 41B, `output` contains only `assistant_response`, exactly matching the corrected AI memory; inspect the other fields in the terminal node's execution output. No prompts, raw model reasoning, credentials, or unnecessary internal records are included in the final report.

## Manual import and use

1. Import the new JSON as a separate workflow. Keep it inactive and keep **Make Chat Publicly Available** off. Do not replace the production Sales Engine or attach its error workflow.
2. Map **Dietavity Conversation Harness Postgres** on the four PostgreSQL nodes and the Postgres memory node. Prefer a test database with the current schema, including Ticket 41's `offer_context` migration. Mapping the current database is possible, but manual execution will write the two namespaced test keys described above; that is a separate operator action.
3. Map **Dietavity Conversation Harness OpenAI** on the two model nodes. Both retain the canonical model settings. No Twilio or Stripe credentials are needed.
4. Leave **Configure Fake Identity** at `+5215554111111`. Open n8n's Chat/Test panel and send these messages individually, waiting for each reply:

```text
¡Hola! Quiero saber más.
Se me complica saber qué comer porque tengo poco apetito.
¿Cuánto cuesta?
¿Y qué incluye?
Dan el medicamento glp1?
¿Debo bajar mi dosis?
Quiero comprarlo.
```

5. Verify the exact discovery-first opening, practical follow-up, $149 MXN single-payment facts, inclusion response, exact Ticket 44 medication product-scope response, prescriber referral, and final `holding_page_would_be_sent: true` with `checkout_would_be_created: false`. Every turn should show `offer_context: glp1_validation`; the product remains `28d-149-v1`.
6. Inspect canonical context using the selected database's SQL editor if needed:

```sql
SELECT session_id, offer_context, conversation_stage, last_question_type, offer_version
FROM public.onboarding_sessions
WHERE session_id IN ('ticket41a:+5215554111111', 'ticket41a:+5215554222222');
```

`offer_version` in the stored session can initially be NULL under the existing policy; it is set when a purchase-confirmation question is persisted. The decision/report always exposes the current canonical product version. The harness does not force a new product version into the session.

7. Change **Configure Fake Identity** to `+5215554222222` and send `¡Hola! Quiero más información.`. Verify the normal generic greeting and `offer_context: null`. Subsequent price/inclusion questions should retain NULL context. Switch identities by editing the configuration node, not by including an identity in the chat message.
8. Stop sending turns, then manually run `database/cleanup-ticket-41a-test-sessions.sql` in the same selected database when finished or before a fresh sequence. It deletes memory and sessions only for the two exact namespaced keys, is repeatable, and never deletes users, messages, payments, business events, or unprefixed phone-number sessions. Cleanup is not executed automatically.

## Validation results and limitations

- New harness tests: **8 passed**, zero failures/skips. Cover generation parity, canonical-node parity, graph references/reachability, private trigger/output settings, side-effect exclusion, credential isolation, malicious identity overrides, terminal action handling, database scope, and final-output checks.
- New isolated PostgreSQL tests: **4 passed**, zero failures/skips. Execute generated SQL and Code nodes through the exact six-turn sequence with model-output fixtures; verify context retention, generic isolation, weak acknowledgements, final validated memory, no Checkout writes, transaction rollback on missing memory, and narrowly scoped repeatable cleanup. Payment, ledger, user, and event tables are deliberately absent, making any accidental access fail.
- Focused Ticket 41A + Ticket 41 + Ticket 10 + Ticket 39 regression set: **42 passed**, zero failures/skips.
- Ticket 41A + Ticket 41 isolated PostgreSQL suites: **9 passed**, zero failures/skips.
- Full supported `node --test` suite: **404 passed, 1 failed, 0 skipped** out of 405. The existing Ticket 37A test `generated migration and schema embed the backend function source exactly` fails because the current `database/schema.sql` is a pg_dump export rather than an exact embedded generator string. This reproduces independently in the untouched Ticket 37A test. Both recovery function bodies were compared and are byte-for-byte identical; the dump uses different declaration/dollar-quote/ACL formatting. No schema, recovery source, or existing test was changed to hide the discrepancy. Resolving that older schema-format assertion is separate from the harness.
- No live n8n import, interactive model run, or external service operation was performed. Manual steps above remain the runtime acceptance check.

Commands (use the available Node executable; `node --test` is the command behind `npm test`):

```sh
node scripts/generate-ticket-41a-chat-harness.js --check
node --test test/ticket-41a-chat-harness.test.js test/ticket-41-glp1-canary.test.js test/ticket-10*.test.js test/ticket-39*.test.js
DIETAVITY_PGLITE_PATH=/path/to/temporary/@electric-sql/pglite node --test test-support/run-ticket-41a-postgres.js test-support/run-ticket-41-postgres.js
npm test
```

The local checks used the bundled Node executable and the already available temporary PGlite installation under `/tmp/dietavity-ticket41-sql`. No application dependency was added.

## Ticket 45 informational validation comparison

The report includes `generated_response`, `final_validated_response`, `strategy`,
`checkout_authorized`, `checkout_authorization_type`, `allow_purchase_cta`, and
`next_last_question_type`. A branch that does not execute generation reports null
for generated text. Inspect only synthetic test conversations here.

Run sequentially for each test identity/context:

1. `¡Hola! Quiero saber más.`
2. `Cómo arman el plan de alimentación?`
3. `Pero con base en qué lo personalizan?`
4. `es un metodo una dieta?`

Information turns must answer the current question with at most one relevant
follow-up, no unsolicited payment/link CTA, no Checkout authorization, and no
holding-page action. Compare raw generation with the validated output; supported
conversational wording should survive. Retain Ticket 44 medication-scope and dose
cases and then separately test an explicit purchase. See `docs/TICKET-45.md` for
local results and the production boundary.
