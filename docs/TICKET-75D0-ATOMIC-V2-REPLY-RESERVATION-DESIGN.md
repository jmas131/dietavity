# Ticket75D.0 — Atomic V2 Reply Reservation Design

> **Binding correction (Ticket75D.0A):** the former requirement for PostgreSQL
> to recompute Ticket68A's `logical_reply_key` is superseded by
> [the SQL-verifiable approved-reply binding](TICKET-75D0A-SQL-VERIFIABLE-APPROVED-REPLY-BINDING.md).
> `logical_reply_key` remains Ticket68A's semantic-manifest identity; T75D.1
> must recompute the distinct bounded `reservation_binding` instead.

## Determination

**DISCOVERY_COMPLETE_READY_FOR_T75D_1.** This is a repository-only design. No migration, schema, workflow, recovery implementation, production connection, or delivery action was made.

## Existing lifecycle and ownership

Ticket17 writes/claims inbound `public.messages` in FIFO `processing_order` under a per-session advisory lock. n8n owns claim acquisition, current multipart insertion, Twilio transport, provider-evidence updates, and completion. Postgres owns the durable ledger, claim lease, constraints, and recovery RPC state transitions. Node owns only the approved Ticket68/Ticket68A semantic output. Twilio supplies per-part provider evidence. Recovery Poller reuses already-persisted parts: prepare can split a verified historical failed reply; claim selects one pending part, marks a send token, n8n transports it, and completion checks acceptance evidence for the whole group.

T75D.1 bridges Node approval to the existing n8n transport boundary. It must not send, complete, or generate another response.

## Messages and multipart contract

`public.messages` has UUID `id`, nullable `user_id`, `session_id`, `direction`, `body`, `timestamp`, `message_kind`, fixed `twilio` provider, `provider_message_sid`, `idempotency_key`, `in_reply_to_id`, `delivery_status`, JSONB `metadata`, and Ticket17 `processing_order`, owner, lease, completion, and outcome fields. Relevant checks require nonempty outbound body when idempotency is present, JSON-object metadata, and the closed delivery-status vocabulary. There is a unique partial `idempotency_key` index and inbound processing-order index; there is no unique `in_reply_to_id` index.

The canonical physical outbound group is 1-based. Every part has the same inbound `in_reply_to_id`, same `metadata.logical_reply_key`, integer JSONB `part_index` and `part_count`, `pending` status, and null provider SID initially. Base idempotency is the logical key; later parts are `${key}:part:${LPAD(index, 3, '0')}`. Ordering is `part_index`; acceptance/completion requires evidence for every part. Recovery detects malformed/missing groups, then selects the first unaccepted pending part.

## Existing reservation gap

`RESERVE_MULTIPART_OUTBOUND_SQL` inserts all JSON-array parts in one statement and checks an existing outbound sibling. Its lease renewal locks the inbound row, but it does not prove the lease is currently valid and accepts caller-owned arbitrary body/metadata. It is not a sufficient final v2 authority boundary. It remains the legacy path and is not changed by this ticket.

## T75D.1 locking and preconditions

New RPC: `public.reserve_v2_approved_logical_reply(jsonb)` (name provisional until implementation review). In one transaction it must:

1. Validate an exact closed JSONB payload before writes.
2. Acquire `pg_advisory_xact_lock(hashtextextended(session_id, 17))`, matching Ticket17/Ticket37A.
3. Lock the canonical inbound row `FOR UPDATE`.
4. Validate inbound direction, exact session, owner, non-null unexpired lease, no completion, non-null processing order, and no earlier unfinished inbound in that session.
5. Lock/check all outbound siblings for that inbound.
6. Return an exact previous reservation only when every stored part, manifest binding, and optional artifact match; otherwise reject conflict.
7. Insert every validated part, then persist the optional Ticket17A artifact, and return the complete ordered group.

This lock order—advisory session lock, inbound row, outbound siblings, artifact anchor/lineage—matches existing recovery ordering and serializes legacy/v2 reservation, claim, completion, and recovery work. The inbound row lock plus sibling check makes the absence of a unique `in_reply_to_id` constraint safe only for writers following this established lock discipline. T75D.1 must explicitly test concurrent legacy/v2 behavior.

## Identity and RPC contract

Ticket68A `logical_reply_key` is the stable approved semantic identity: it binds canonical inbound plus the eligible response binding. The request supplies its versioned manifest/bindings, final-response digest, ordered bounded part texts, and the Ticket17 claim tuple (`inbound_id`, `session_id`, `processing_owner`). It never supplies context, authority, prompt, Stripe data, arbitrary metadata, or provider response.

Recovery compatibility requires a distinction: Ticket37A's existing recovery SQL requires physical base `idempotency_key = reply:<canonical inbound provider SID>:paid`. T75D.1 must retain that physical key and store the Ticket68A key plus manifest/response digest as fixed v2 metadata. It must derive the physical key from the locked inbound row, not trust it. This avoids changing recovery semantics while allowing a retry to prove it is the same approved reply. Per-part keys and part metadata are derived in SQL from the validated ordered parts.

Suggested closed payload fields: `contract_version`, `canonical_inbound_message_id`, `session_id`, `processing_owner`, `ticket68a_manifest` (only required identity/bindings), `response_sha256`, `parts`, and optional `artifact` containing only Ticket17A's existing eight-field payload except that the RPC sets its anchor to inserted part 1 and derives the physical logical key.

Result is a closed, ordered `reserved_new` or `reserved_existing` object with physical logical key, manifest key, exact message IDs/indexes/counts/bodies/idempotency keys/statuses, and optional artifact ID. Ownership/lease, malformed input, conflicting reply, and artifact conflict are typed SQL errors. A lost post-commit response is retried with the same manifest identity and returns `reserved_existing`; conflicting body/manifest/inbound never silently wins.

## Atomic artifacts and delivery

If an artifact is present, call existing `persist_conversation_artifact(jsonb)` inside the same SECURITY DEFINER transaction after part 1 exists. Its existing locks and validations prove anchor direction, part 1, physical key, multipart shape, lineage, idempotency, and cycles. Any artifact failure rolls back all part inserts. Retried matching artifacts return the existing row; mismatch rejects.

Inserted rows are `pending`, with no provider SID, acceptance evidence, recovery send token, or completion update. Reservation is not delivery. Existing completion predicates remain responsible for requiring every part's acceptance evidence.

## Recovery and coexistence

The reserved base stores `assistant_response` as the approved full response and uses the legacy physical idempotency shape, so Ticket37A recovery prepare/claim can operate on v2 rows after a qualifying verified failure without rerunning Node. Fixed v2 manifest metadata is additional integrity evidence, not a new recovery branch. The Recovery Poller remains unchanged.

Legacy/v2 coexistence is safe only if T75D.1 uses the Ticket17 advisory + inbound-row locking sequence and rejects every pre-existing outbound sibling, as the legacy multipart reservation does after locking. No uniqueness constraint is proposed initially: adding one could affect historical multipart rows and needs a separate production catalog/data preflight before any future constraint decision.

## Security and migration plan

T75D.1 should add one transactional forward-only migration, a `SECURITY DEFINER` function with `SET search_path TO pg_catalog, public`, explicit input validation, explicit `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`, then `GRANT EXECUTE` only to `service_role`. It must not grant table mutation. Update `database/schema.sql` from the checked-in source and add function-scoped schema synchronization coverage. No historical migration, including Ticket72, changes.

## Real PostgreSQL test matrix

Disposable loopback PostgreSQL must exercise single/multipart first insert; exact and concurrent identical replay; concurrent conflict; expired/wrong owner/wrong session/completed/FIFO rejection; existing sibling; malformed counts/indexes/body; same key different body; rollback without partial rows; Ticket17A single/multipart anchor, lineage, replay, and conflict; recovery prepare/claim compatibility; completion false before evidence and true only after all required evidence; ACL/RLS; and lease/recovery contention where reproducible.

## Deployment posture and remaining scope

Later deployment requires an approved additive migration, backup/preflight catalog checks, human-authorized mutation, read-only postflight verification, and forward correction rather than destructive rollback. The migration may deploy before n8n uses it; n8n wiring belongs after the boundary is validated. The unrelated Ticket10 workflow-artifact failure is not relevant to this RPC design.
