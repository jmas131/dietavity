# Ticket75B.1a — Canonical Supabase Reader Core

`lib/sales-engine-v2/supabase-canonical-reader.js` is an injected, read-only adapter for the four T75B domain reads: `readClaim`, `readContext`, `readFactAuthority`, and `readKnowledgeAuthority`. It neither creates a Supabase client nor reads credentials, and is not wired into server defaults. The checked-in server remains fail-closed.

All selections are explicit. Claims read `messages(id,direction,session_id,processing_owner,processing_lease_until,processing_completed_at,processing_order)`, followed by a one-row outbound sibling existence check over `messages(id,in_reply_to_id,direction,metadata,idempotency_key)`. Context reads the current inbound, outbound canonical transport history, legacy `onboarding_chat_memory`, and `onboarding_sessions(session_id,offer_version)`. Ticket71 reads its authority sets and records; Ticket72 reads locale-filtered knowledge sets and their records.

History reads are each capped at 100 rows at the database boundary, ordered newest-first for a bounded recent window, then returned in ascending timestamp order. Ticket60 remains responsible for its stricter 20-turn/12,000-character context projection and rejects timestamp ties rather than treating IDs as chronology. Canonical outbound history includes only accepted, scheduled, sent, or delivered messages; legacy rows retain their exact persisted shape for Ticket60 normalization.

`offer_version` is read exclusively from the claimed session row. A missing session or persisted SQL `NULL` is returned as `null`; it is never defaulted or inferred from text, campaign/GLP-1 context, purchases, or programs. T75B.1b will represent this partial offer authority in the domain bundle. This core intentionally returns `conversationArtifacts: []`; Ticket17A metadata, lineage, and multipart reconstruction are explicitly deferred to T75B.1b.

The adapter checks `AbortSignal` before and after every query, passes it to a Supabase PostgREST builder where available, and discards late results after an abort. Any client/query failure becomes `CanonicalInputError('authority_unavailable')`; raw database errors are not propagated. Multi-query reads are not a single database snapshot. Reservation safety remains dependent on later atomic ownership/lease/no-reply revalidation.

This ticket uses deterministic mocked Supabase query-chain tests only. It does not connect to a database, deploy, migrate, or make the runtime production-ready. Disposable SQL verification remains T75B.1c.
