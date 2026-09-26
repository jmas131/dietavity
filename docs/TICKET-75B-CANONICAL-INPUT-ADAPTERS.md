# Ticket 75B — canonical input adapters

T75B adds read-only injectable adapters. The checked-in server remains disabled and has no reader, verifier, route enablement, or credentials, so the endpoint still terminates at `runtime_not_configured`.

The future reader must provide explicit bounded reads: claimed `public.messages` state (including reply existence), current inbound plus bounded `onboarding_chat_memory`, Ticket17A metadata/lineage/anchored canonical parts, Ticket71 active sets/records, and Ticket72 active sets/records. T75B's domain adapter receives only those rows; it exposes no write methods or global Supabase client.

Claim verification independently checks canonical ID, inbound direction, session, owner, canonical unexpired lease, uncompleted state, and no outbound reply. The request lease is not trusted. It never renews/releases/repairs a claim. T75D must repeat these guards atomically at reservation.

Conversation context uses the existing Ticket60 `createConversationContext`: current inbound remains separate; history/artifacts are bounded and ordered solely by timestamps; ties, malformed multipart/artifacts, and cyclic lineage fail closed. Artifact type is taken only from Ticket17A metadata, never inferred from prose.

Ticket71 rows are projected into the existing closed `ticket-71-v1` snapshot and validated by its existing validator. Offer scope is only the canonical server context offer version; absent/unsupported scope remains unresolved rather than defaulting. Ticket72 selects one reviewed-active locale set and projects its records into the existing reviewed-knowledge store. Knowledge remains reviewed provenance, never fact/policy/action authority. Missing locale is `authority_unresolved`; malformed/duplicate/infrastructure states are `authority_unavailable`, never an unknown fact.

All reads accept AbortSignal and check before/after work; no partial bundle proceeds after abort. Logs/responses contain no rows, content, history, profile, phone, SQL errors, or credentials. T75C still needs hardened real database read wrapper/configuration and model/action adapters. Ticket37A schema snapshot drift remains **REQUIRED BEFORE T75D**; it is not changed here.
