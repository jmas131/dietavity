# Ticket75B.0 — Canonical production read-contract discovery

## Evidence boundary

This is repository/static evidence only, based on `database/schema.sql`, Ticket17/17A/60/71/72 migrations and tests, and `n8n/references/production-sales-engine-2026-09-21.json`. It does not prove present production deployment/runtime configuration.

| Requirement | Canonical object / exact columns | Join/key and cardinality | Authority / failure | Reader |
| --- | --- | --- | --- | --- |
| Claimed inbound | `public.messages`: `id,direction,session_id,processing_owner,processing_lease_until,processing_completed_at,processing_order` | `id = :inbound_id`, one row | Ticket17 canonical claim; missing/wrong direction/session/owner is `claim_not_owned`; null/expired lease is `claim_expired` | `readClaim` |
| Existing reply conflict | `public.messages`: `id,in_reply_to_id,direction,metadata,idempotency_key` | `in_reply_to_id = inbound.id AND direction='outbound'`, 0..N | Any outbound blocks a fresh v2 reply; logical key is `metadata->>'logical_reply_key'`, falling back to `idempotency_key` for legacy singleton rules | `readClaim` |
| Current message | `public.messages`: `id,provider_message_sid,body,timestamp,direction,session_id` | same inbound row | Canonical message text/time; missing SID/body/time fails `context_invalid` | `readContext` |
| Canonical outbound history | `public.messages`: `id,direction,body,timestamp,in_reply_to_id,metadata,idempotency_key,delivery_status,provider_message_sid` | session-scoped, bounded, explicitly ordered by `timestamp`; timestamp tie is ambiguous under Ticket60 | Canonical final sent body is evidence; only accepted/scheduled/sent/delivered evidence is eligible for final-assistant history | `readContext` |
| Legacy memory history | `public.onboarding_chat_memory`: `id,session_id,created_at,updated_at,message` | `session_id`; bounded/order `created_at` | Required only for prior assistant/customer turns not represented as canonical final outbound message. Ticket60 normalizes its exact JSON shape; malformed/tied timestamps fail closed | `readContext` |
| Artifact metadata | `public.conversation_artifacts`: `artifact_id,artifact_type,generation_operation,generation_task_id,logical_reply_key,anchor_message_id` | anchor → `messages.id`, one anchor per artifact | Typed Ticket17A authority only; no prose inference | `readContext` |
| Artifact lineage | `public.conversation_artifact_lineage`: `artifact_id,source_artifact_id,position` | artifact ID, ordered `position`, 0..N | Missing/cycle/broken lineage fails Ticket60A validation | `readContext` |
| Artifact multipart body | `public.messages`: `id,direction,body,timestamp,idempotency_key,metadata,in_reply_to_id` | anchor session/reply and `metadata.logical_reply_key`; exact `part_index/part_count` | Ticket60A reconstructs parts only when all indices/count/key constraints hold | `readContext` |
| Fact authority set | `public.product_fact_authority_sets`: `authority_set_id,authority_version,status,scope` | 1 active set per typed `scope` enforced by partial unique scope index | Ticket71 reviewed active only; duplicates/malformed are fail-closed | `readFactAuthority` |
| Fact records | `public.product_fact_authority_records`: `fact_id,authority_set_id,fact_key,state,value_type,value` | set ID 1..N | Exact projection to `factSnapshot()` | `readFactAuthority` |
| Knowledge set | `public.reviewed_nutrition_knowledge_sets`: `knowledge_set_id,knowledge_version,locale,status,created_at` | one active set per locale partial unique index | Ticket72 reviewed-active locale only | `readKnowledgeAuthority` |
| Knowledge record | `public.reviewed_nutrition_knowledge_records`: `knowledge_id,knowledge_set_id,knowledge_domain,topic,task_kinds,applicable_input_types,content,provenance` | set ID 1..N | Exact projection to `knowledgeSnapshot()`; reviewed knowledge is never fact/policy/action authority | `readKnowledgeAuthority` |

## Claim

One bounded explicit-column inbound query plus one bounded existence query for outbound siblings establishes the read-time claim view. It cannot establish future reservation safety; Ticket75D must repeat lease/owner/no-reply checks atomically. Ticket17 claim SQL in the reference uses `messages.processing_order,id`, `processing_owner`, `processing_lease_until`, and `processing_completed_at`; completion predicate is the existing `Mark Session Inbound Complete` SQL.

## Current message and history

`public.messages` is sufficient for current inbound and canonical final outbound transport evidence, but not sufficient for all existing Ticket60 conversational history: the production-shape adapter explicitly supports `onboarding_chat_memory.message` (`id,session_id,created_at,updated_at,message`). Therefore T75B.1 must read both sources, normalize neither as authority, bound before context construction, and fail closed on equal timestamps. UUIDs are never chronology. Multipart is represented in `messages.metadata.logical_reply_key`, `part_index`, and `part_count`; text comes from ordered canonical outbound bodies.

## Ticket17A mapping

Ticket17A migration `20260923_ticket_17a_typed_conversational_output_metadata.sql` makes `persist_conversation_artifact(jsonb)` the sole write boundary. The read contract is a left/joined projection into Ticket60A records: `{ artifact, lineage, messages }`, where `artifact` uses the metadata columns above; `lineage` is ordered `{ source_artifact_id, position }`; `messages` contains only the exact six fields accepted by `normalizeArtifactMessage`. Legacy messages have no artifact rows and must not be classified/backfilled.

## OFFER_VERSION conclusion — CANONICAL_BINDING_PARTIAL

`public.onboarding_sessions.offer_version` is the only session-keyed product/offer field found. It is related by `onboarding_sessions.session_id = messages.session_id`, is nullable, and is used by existing Sales Engine checkout/state constraints (`checkout_authorized_at` requires a non-null offer version). This makes it a canonical binding only for sessions whose persisted session offer exists.

It does **not** prove an offer for arbitrary pre-purchase inbound rows: `messages` has no offer column; `onboarding_chat_memory` has none; `purchases` and `programs` are post-purchase/user keyed rather than a universal session-to-offer relation; `onboarding_sessions.offer_context` is only nullable `glp1_validation`, a campaign/context marker rather than product truth. The captured workflow hard-codes standard offer values in legacy logic, which is implementation behavior, not a future-product canonical binding. Thus T75B.1 must derive offer version solely from the claimed session row when non-null; otherwise emit `authority_unresolved`. It must not default to `28d-149-v1`, infer from text/history, or turn GLP-1 context into offer truth. This is a blocker before T75C for any turn requiring offer-scoped Ticket71 facts; provider-scoped facts remain separately resolvable.

## Database client recommendation

Use the existing `@supabase/supabase-js` backend client behind a narrow injected reader, not direct `pg`: it is the only existing Node DB mechanism, supports explicit selected columns and existing service-role/RLS deployment conventions, and adds no dependency/operational path. Its query cancellation is not sufficient to rely on alone; pass AbortSignal where supported, check before/after every query, and discard late results. A disposable real-PostgreSQL integration harness may use the repository's existing PGlite/local pattern for SQL semantics, but must reject non-loopback connection hosts. A single read transaction/consistent snapshot is desirable for context/artifacts/authority if the supported client path can provide it; otherwise T75B.1 must document read consistency and revalidate at reservation.

## Ticket37A

The Ticket37A schema-source formatting drift concerns the recovery-function source synchronization. T75B.1 reads `messages` and Ticket17A/71/72 tables, not those recovery function definitions; it does not alter reader correctness. It remains **REQUIRED BEFORE T75D** because T75D changes schema snapshot content.

## Remaining blockers before T75B.1

1. Implement tested explicit Supabase read projections, including exact Ticket17A joined/multipart mapping.
2. Decide/verify a supported disposable PostgreSQL/PGlite integration harness and loopback-only enforcement.
3. Treat absent `onboarding_sessions.offer_version` as `authority_unresolved`; T75C must not use offer-scoped facts for such contexts.
