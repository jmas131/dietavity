# Ticket 60 — Canonical ConversationContext and Memory Adapter

## Purpose and boundary

This ticket adds a pure, synchronous adapter at `lib/sales-engine-v2/memory-adapter.js`. It accepts already-read conversation records and allowlisted server runtime metadata and emits the one v2 `ConversationContext`. It neither reads Postgres nor n8n, calls a model, resolves facts or policy, interprets language, creates a response, or performs an action. It remains disconnected from customer traffic.

Ticket 60A adds a separate, bounded `conversation_artifacts` projection. Its input is already-read Ticket 17A records (`artifact`, ordered `lineage`, and the canonical outbound message parts for that artifact's logical reply), never a scan or classification of historical prose. The projection is conversational material only; it does not establish product truth, policy, safety, authorization, delivery, execution, or factual correctness.

`current_message` is structurally separate from `history`. The future Interpreter consumes this context, examines the current message itself, and may use history only as conversational context.

## Inventory and dispositions

| Candidate field/source | Classification | v2 disposition |
| --- | --- | --- |
| `onboarding_chat_memory.id`, `created_at`, `message.type`, `message.content`/`data.content` | CONVERSATION_HISTORY | Normalized to source ID, role, text, and occurrence time. |
| `public.messages` final outbound body | CONVERSATION_HISTORY | A future read adapter may supply it as the same normalized shape when it is the durable correction source; this ticket does not query it. |
| Ticket 17A artifact row + ordered lineage + anchored canonical outbound logical reply | BOUNDED_CONVERSATIONAL_ARTIFACT | Projected only after structural validation and complete logical-reply reconstruction. It is not ordinary history or an authority source. |
| Reserved inbound `public.messages.id`, provider message ID/body/received time | CURRENT_TURN_INPUT | Required `currentTurn`; canonical ledger UUID is distinct from provider/source identity and never appended as ordinary history. |
| Reconciled session/conversation ID, session ID, channel, locale, offer version, campaign | TRUSTED_RUNTIME_METADATA | Explicit runtime allowlist only. Campaign is never inferred from text. |
| Session checkout/valid-confirmation evidence | OPERATIONAL_STATE | Optional trusted `commercial_state.checkout_sent` and `valid_purchase_confirmation`; it is not intent. |
| Price, duration, payment methods, capabilities | PRODUCT_TRUTH_NOT_MEMORY | Ticket 58 only. |
| Medication boundary, checkout/reminder authorization | POLICY_NOT_MEMORY | Ticket 59 only. |
| Intent labels, buyer signals, historical classifications, strategy, reminders | DERIVED_INTERPRETATION_NOT_MEMORY | Excluded. Future Interpreter/orchestrator owns current obligations. |
| Raw prompts, model drafts, execution/provider/payment IDs, credentials, profile/health data | GENERATED_RESPONSE_NOT_MEMORY / DEPRECATED_OR_LEGACY | Excluded. |
| Current purchase request and deterministic `safety_gate` for Ticket 59 | NEEDS_DECISION | A future Interpreter plus resolution boundary must establish these structured policy inputs; memory must not supply them. |

The source table has `id uuid DEFAULT gen_random_uuid()` and `created_at timestamptz DEFAULT now()`. Its primary key is UUID-only; there is no memory-row sequence, insertion ordinal, provider ordinal, or composite ordering index. Therefore UUID lexical order is not conversational chronology. Chronology is `occurred_at` only; the production reference merely configures the `Postgres Chat Memory` node with its table/session key and exposes no SQL ordering guarantee. The known `public.messages.processing_order` is an authoritative bigint sequence for inbound reservations, but no memory row stores or links to it. Distinct equal memory timestamps consequently fail `MEMORY_ORDER_AMBIGUOUS`; the adapter does not invent chronology. The known test/harness forms use `human`/`ai` with `content` or legacy `data.content`. The Ticket 48 isolated harness has final-only in-memory transcript entries. Both production rows and harness entries converge through `normalizeMemoryEntry` to the same shape, without writes.

## Canonical contract

The Ticket 57 schema is refined compatibly in `docs/contracts/sales-engine-v2-contract.schema.json`: history source identity and deterministic history metadata are now required, and the adapter's runtime subobjects are allowlisted. The adapter returns:

```js
{
  contract_version: '2.0',
  context_id: '<conversation_id>:<current_message_id>', locale: 'es-MX',
  current_message: { source_id, canonical_message_id, role: 'customer', text, occurred_at },
  history: [{ source_id, role: 'customer' | 'assistant', text, occurred_at, final_visible? }],
  history_metadata: { ordering: 'occurred_at', history_truncated, retained_prior_turns, retained_prior_characters },
  conversation_artifacts: [{ artifact_id, artifact_type, generation_operation, generation_task_id,
    logical_reply_key, anchor_message_id, text, lineage_artifact_ids, occurred_at }],
  conversation_artifacts_metadata: { ordering: 'occurred_at', artifacts_truncated,
    retained_artifacts, retained_artifact_characters },
  session_state: { session_id }, offer_context: { offer_version? }, customer_state: {},
  commercial_state: { checkout_sent?, valid_purchase_confirmation? },
  metadata: { channel: 'whatsapp', campaign?: 'standard' | 'glp1_validation' },
  authoritative_context: {}, informational_context: { knowledge: [] }
}
```

`customer_state`, `authoritative_context`, and `informational_context` retain the existing Ticket 57 interface but are deliberately empty at this boundary. The adapter does not import facts or knowledge. IDs are opaque internal values; no phone number, payment, provider-delivery, credential, or profile field is admitted. The adapter logs nothing.

## Ticket 60A artifact eligibility, reconstruction, and bounds

`createConversationContext` accepts `conversationArtifacts`, defaulting to `[]`. Every supplied item must be `{ artifact, lineage, messages }`. `artifact` and `lineage` reuse `lib/conversation-artifact-validator.js` exactly: Ticket 17A's closed types/operations and contiguous ordered lineage are not redefined. Every supplied lineage reference must resolve within the supplied typed artifact set. Bounding admits a retained dependent artifact only with its complete transitive lineage closure; this is deterministic dependency preservation, not unrestricted history expansion.

`messages` contains only the canonical outbound parts for that artifact's `logical_reply_key`. The adapter requires a unique set of message IDs, outbound direction, nonempty canonical `body`, valid timestamps, consistent complete `part_index`/`part_count` from 1 through the declared count, canonical part idempotency keys, and the Ticket 17A anchor as part 1. It then joins those bodies in ascending canonical part order with a newline. It does not inspect delivery status or expose provider evidence. A single-part reply is still expressed with the same explicit multipart identity (`part_index: 1`, `part_count: 1`).

Artifact order is ascending anchor `occurred_at`; equal anchor timestamps fail because this boundary has no additional authoritative ordering field. Defaults are `maxConversationArtifacts: 10` and `maxConversationArtifactCharacters: 12000`, independent from history's `20` and `12000` limits. Candidates are considered newest first, but each candidate is admitted only with its complete transitive lineage closure. A closure that would exceed either limit is omitted as a unit; no lineage is truncated. After selection, the retained closure is returned in ascending canonical order. An older independent artifact may still be retained after a newer closure does not fit. `conversation_artifacts_metadata` reports exactly the final collection: `artifacts_truncated` is true whenever any valid input artifact is omitted, and `retained_artifact_characters` is the exact sum of retained `text` lengths. This deterministic truncation is the only non-error bounds behavior and never broadens the ledger exposed to downstream stages.

The final collection is lineage-closed: every `lineage_artifact_id` must name another retained artifact. JSON Schema defines each item's closed shape and lineage ID syntax, but cannot safely express membership in a sibling array item or the aggregate character total; `validateConversationContext` enforces both cross-item lineage membership and exact metadata totals at the executable contract boundary.

Malformed Ticket 17A metadata, invalid type/operation, a missing or non-first anchor, dangling/broken or cyclic lineage, duplicate artifact IDs, equal timestamps, malformed/ambiguous multipart groups, and unresolvable content all fail context construction. They are never downgraded into an eligible artifact or silently classified from ordinary history. A caller may recover operationally by building no context and following its existing failure path; this pure boundary does not create a fallback artifact.

The projection provides only explicit bounded inputs for a later selector to use for transform, summarize, or show. It does not infer the requested operation, choose an artifact for a request, create obligations, resolve policy or facts, generate prose, authorize action, or persist metadata.

## Roles, ordering, deduplication, and bounds

Known source roles are `human`, `customer`, and `user` to `customer`; `ai` and `assistant` to `assistant`. Unknown/system/tool roles fail with `MEMORY_ROLE_UNSUPPORTED`; no text heuristic exists.

Each normalized record requires a parseable ISO timestamp and nonempty durable source ID. Order is ascending `occurred_at` only. `onboarding_chat_memory.id` is a randomly generated UUID, so it is identity evidence but cannot resolve a timestamp tie; two distinct history entries with the same instant fail `MEMORY_ORDER_AMBIGUOUS`. Duplicate source IDs also fail. If exactly one memory entry has the current turn ID, it is excluded; two such entries fail `CURRENT_TURN_DUPLICATED`. Text is copied byte-for-byte with no trim, translation, extraction, or claim repair.

Options default to `maxPriorTurns: 20` and `maxPriorCharacters: 12000`. The adapter retains the newest chronological suffix that fits both constraints, never truncates the current message, and publishes `history_truncated` plus retained counts. There is no summarization.

## Runtime metadata and commercial boundary

`runtimeMetadata` must contain `conversation_id`, `session_id`, and `channel: 'whatsapp'`; locale defaults only to `es-MX`. Optional values are offer version, reviewed campaign (`standard` or `glp1_validation`), and the two operational booleans above. Unexpected fields and malformed values fail. It cannot infer a campaign from GLP-1 text.

Ticket 59 remains compatible: its `commercial_state.current_purchase_request` and deterministic `safety_gate` must be supplied later by a resolution boundary after interpretation/policy inputs exist. This adapter refuses to manufacture either from historical messages or session-memory classifications.

## API and failure semantics

`createConversationContext({ currentTurn, memory, runtimeMetadata, options })` is side-effect free. `currentTurn.canonical_message_id` is required and must be the UUID of the already-reserved inbound `public.messages` row; `currentTurn.id` remains a separate source/provider identity. Production rows can be normalized with `normalizeOnboardingChatMemoryRow`; canonical/harness entries use `normalizeMemoryEntry`.

Machine-readable `ConversationContextError.code` values distinguish `CURRENT_TURN_INVALID`, `MEMORY_HISTORY_INVALID`, `MEMORY_ROLE_UNSUPPORTED`, `MEMORY_TIMESTAMP_INVALID`, `MEMORY_ORDER_AMBIGUOUS`, `MEMORY_DUPLICATE_ID`, `CURRENT_TURN_DUPLICATED`, `RUNTIME_METADATA_INVALID`, `MEMORY_ADAPTER_CONFIGURATION_INVALID`, and validator-level context/order errors. Empty memory is valid. Structural failure never silently becomes an empty context.

## Tests and later integration

`test/ticket-60-conversation-context-memory-adapter.test.js` covers empty context, production/harness parity, roles, timestamp order, UUID timestamp-tie ambiguity, deterministic truncation, exact-ID current-turn removal, duplicate failure, stale price/purchase/medication isolation, malformed inputs, metadata allowlisting, and configuration failure. It has no database, network, model, Stripe, Twilio, or write dependency.

Later Interpreter integration must provide a trusted inbound current turn and a source read adapter, call this module once, then derive obligations from `current_message` without converting history into fact, policy, or authorization input. Ticket 58 and Ticket 59 are unchanged. Production Sales Engine and Recovery Poller references are unchanged.
