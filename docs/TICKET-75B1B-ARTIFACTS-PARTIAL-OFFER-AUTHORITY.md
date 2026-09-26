# Ticket75B.1b — Artifacts and Partial Offer Authority

T75B.1b extends the injected, read-only Supabase reader. It does not enable the server, create a database client, read credentials, deploy, migrate, or alter any production path.

## Ticket17A projection

The reader obtains recent candidate anchors from the already bounded, session-scoped canonical outbound-message history. It reads `conversation_artifacts(artifact_id,artifact_type,generation_operation,generation_task_id,logical_reply_key,anchor_message_id)` for those anchors, retains the ten newest roots by canonical message timestamp, and follows lineage with `conversation_artifact_lineage(artifact_id,source_artifact_id,position)`.

Lineage expansion is deterministic and read-only. The hard cap is 50 nodes/lineage rows; an over-cap graph fails `context_invalid` rather than returning a partial graph. Source artifact metadata is read by ID, so a missing source remains a broken lineage for Ticket60A to reject. Multipart material comes only from `messages(id,direction,body,timestamp,idempotency_key,metadata)`, filtered by the exact stored `metadata.logical_reply_key`, with a hard cap of 49,950 rows (50 artifacts × Ticket17A’s 999-part maximum). The reader produces `{ artifact, lineage, messages }`; it never infers type from prose, classifies legacy rows, repairs metadata, invents parts, or writes through `persist_conversation_artifact`.

Ticket60A remains the sole structural validator: it checks contract/type, ordered lineage, cycles, anchors, complete part sequence, logical key, and idempotency key. Malformed, incomplete, conflicting, broken, and cyclic input therefore fails as `context_invalid` at context construction. Database failures remain `authority_unavailable`; aborts remain `deadline_exceeded`.

## Partial Ticket71 authority

The canonical input bundle continues to contain the validated Ticket71 snapshot in `product_fact_authority`. It now adds immutable `product_fact_authority_scope`, with separate `provider` and `offer` statuses. A valid active provider set is available independently. For the offer scope:

- Persisted offer with an exact reviewed active set: `available`.
- Persisted offer with no exact reviewed active set: `unresolved` with `reviewed_offer_authority_absent`.
- Missing session or SQL-null `offer_version`: `unresolved` with `canonical_offer_binding_absent`.

Null offer binding is omitted only while forming the existing Ticket60 runtime metadata, so its closed validator produces an empty offer context rather than rejecting the entire bundle. It is not defaulted, inferred from text/history/campaign/GLP-1 context, or selected from an active offer. Malformed authority data and database unavailability remain `authority_unavailable`, distinct from unresolved scope.

This remains not ready for T75C: T75B.1c must still validate these reads against disposable SQL/PostgreSQL semantics. Ticket37A remains required before T75D.
