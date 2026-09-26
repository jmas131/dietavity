# Ticket75B.1c — SQL Integration Closure

Validation uses an explicitly configured disposable PostgreSQL 18 loopback database. The test rejects any URL except `postgresql://…@127.0.0.1/...`; it neither links to Supabase nor uses production credentials. The integration setup creates only the prerequisite table shapes from the canonical schema, then executes the unchanged Ticket17A, Ticket71, and Ticket72 migrations.

It validates `messages` claim fields, timestamptz values, zero/multiple sibling-compatible representation, JSONB metadata/idempotency keys, accepted outbound filtering, legacy memory JSON, session null and known offer bindings, Ticket17A anchor/multipart metadata, Ticket71 JSONB scope/value/null rows, and Ticket72 JSONB array/provenance rows. Existing deterministic reader tests remain the Supabase query-builder/abort/error boundary; no local Supabase transport stack was introduced.

The reader remains a bounded multi-read projection, not a consistent transaction snapshot. It does not claim TOCTOU safety. Ticket75D must atomically revalidate ownership, lease, no conflicting reply, and reservation conditions. Ticket37A remains required before T75D.

No defects requiring reader or schema changes were found. This ticket does not deploy, migrate production, or make server defaults active.
