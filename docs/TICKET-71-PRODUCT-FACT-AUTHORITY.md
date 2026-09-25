# Ticket 71 — Product fact authority

Ticket 58 proved the fail-closed resolver contract with a local fact fixture. Ticket 71 adds the production-ready local data contract needed for a later controlled rollout: a reviewed, immutable authority-set manifest, a relational migration artifact, deterministic resolver, and exact scope adapter. No production database, Supabase project, workflow, provider, or deployment was accessed or changed.

## Authority and scope

`config/sales-engine-v2/product-fact-authority.json` is the single reviewed repository source. It contains immutable authority sets, each with an explicit `authority_set_id`, `authority_version`, lifecycle state, exact scope, and typed fact records. The generated migration payload is parity-tested against it. The older Ticket 58 dictionary remains a compatibility fixture for pre-existing tests; it is not a second Ticket 71 authority or a runtime fallback.

The current canonical identity is `offer_version`, because the current `ConversationContext` exposes it and the standard product uses `28d-149-v1`. Authority scope is typed and closed: `{ "scope_type": "provider" }` is the only provider scope, and `{ "scope_type": "offer_version", "offer_version": "28d-149-v1" }` is the only offer-version form. `{}` is never authority scope. A closed runtime map classifies the three GLP-1 medication boundary keys as provider-only and the reviewed offer/payment/portal/support keys as offer-version-only; arbitrary `service.*` keys are not provider facts. There is no inheritance: a provider key selects provider scope directly even when an offer version exists, while an offer key with no offer version is bounded unknown. Campaign is ignored by the scope adapter: `glp1_validation` can control policy/action routing, but cannot redefine product truth. Unknown offer versions return bounded unknown; they never fall back to the standard offer.

## Lifecycle, resolution, and provenance

Only `reviewed_active` sets resolve. `draft` and `retired` sets establish no customer fact. There can be only one reviewed-active set for an exact scope; a duplicate is an authority conflict and fails closed. Activation is the local migration's explicit, transactional service-role function: it retires the active exact scope and activates a draft. It never selects a row by timestamp or insertion order. Historical sets remain auditable; the resolver provenance uses the stable `fact_id` and `authority_version`, so a pinned version is reproducible.

The resolver accepts typed keys only, exact scopes only, and optional complete-set membership queries. It never reads customer prose, models, RAG, policies, actions, or providers. Its results are `resolved`, `unknown`, or `not_applicable`. Missing meaningful facts are bounded unknown, not false. A reviewed complete `payment.supported_methods` set authoritatively makes non-members false; an unknown/incomplete set stays unknown. Known facts carry `{ type: "canonical_fact", id: fact_id, version: authority_version }`—no SQL metadata, reviewer identity, notes, or model metadata.

## Current reviewed seed

The standard `28d-149-v1` set establishes: MXN 149, 28 days, one-time billing/no subscription or auto-renewal, breakfast/lunch/dinner/snack, post-payment personalization, portal delivery, WhatsApp assistance, and the complete approved payment set (credit card, debit card, OXXO, Apple Pay). Public refund policy remains explicitly unknown. The provider-wide set retains only the reviewed GLP-1 medication sale, delivery, and prescription boundaries. There is no GLP-1-specific product fact set: its holding-page next step remains Ticket 59/65 policy/action authority, not a product fact.

Prepared-food delivery, physical locations, dates, checkout destinations, and speculative products (including a Quelites PDF) are intentionally not newly seeded. Tests use a future-product fixture solely to prove isolation; it is not authority data.

## Storage and rollout

`20260925_ticket_71_product_fact_authority.sql` adds backend-only authority-set and record tables. RLS is forced; `PUBLIC`, `anon`, and `authenticated` have no table or activation-function privilege; `service_role` receives read/insert plus the narrowly scoped activation function, not direct update/delete authority. The migration is additive and idempotent. It has not been applied anywhere. Production must separately review the manifest, install and inspect this migration/ACLs, provide a read snapshot adapter, verify the live offer-version context mapping, and conduct controlled integration work. Ticket 71 neither authorizes checkout nor creates actions, provider results, delivery status, reviewed nutrition knowledge, or marketing-copy truth.
