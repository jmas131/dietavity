# 2026-09-25 Sales Engine v2 prerequisites — final deployment record

## Status and authority

**Ticket74 is COMPLETE / VERIFIED / PASS.** This document records the human
production execution and independent read-only evidence supplied during the
controlled deployment. It is not a migration ledger and does not itself prove
database state; the independent production catalog checks remain authoritative.

The approved sequence was **17A → 65D → 71 → 72 → 74 corrective-forward**.
No Supabase CLI link, `supabase db push`, migration repair, or repository-managed
migration ledger was used. The repository closure did not access production,
n8n, or remote infrastructure.

## Final prerequisite ledger

| Ticket | Final status | Human execution | Independent verification |
| --- | --- | --- | --- |
| 17A | APPLIED_VERIFIED / PASS | COMMITTED | PASS |
| 65D | APPLIED_VERIFIED / PASS | COMMITTED | PASS |
| 71 | APPLIED_VERIFIED / PASS | Original attempt rolled back; corrected migration COMMITTED | PASS |
| 72 | APPLIED_VERIFIED / CORRECTED_FORWARD / PASS | Original COMMITTED; corrective-forward COMMITTED | PASS, including static seed read in an explicit read-only transaction |
| 74 | COMPLETE / VERIFIED / PASS | Ticket72 ACL corrective-forward COMMITTED | PASS |

## Frozen and executed migration bytes

| Step | Migration | SHA-256 | Final disposition |
| --- | --- | --- | --- |
| 17A | `database/migrations/20260923_ticket_17a_typed_conversational_output_metadata.sql` | `92d5618a1f522374763117b3992ff57b11a3a3d6f7ad5cc0feb208d83e6526d4` | APPLIED_VERIFIED / PASS |
| 65D | `database/migrations/20260924_ticket_65d_authorized_action_execution.sql` | `88bf37e0c1a264f43a83cfc31c54878386455828e6e383da0057480bf04e912d` | APPLIED_VERIFIED / PASS |
| 71 original | `database/migrations/20260925_ticket_71_product_fact_authority.sql` | `d591e1f75d1aed0074259ae2c27759a2324b24d2094eff9816aa65b7b96dce4b` | FAILED_ROLLED_BACK — never committed |
| 71 retired local candidate | `database/migrations/20260925_ticket_71_product_fact_authority.sql` | `9e2baec38d809a1305023cdfec7bcfb05e640a83c1543eec85211feab57c99bc` | Retired — local ACL defect; never run in production |
| 71 final | `database/migrations/20260925_ticket_71_product_fact_authority.sql` | `f09d4b73eb22616f0346e88564a89120a9238d4f84f7ba93152303ea229398f9` | APPLIED_VERIFIED / PASS |
| 72 original (immutable) | `database/migrations/20260925_ticket_72_reviewed_nutrition_knowledge_authority.sql` | `949530622ff4a3898de1f3ad177fa6583d38672105934954cb2573dd763c4c8a` | COMMITTED; ACL repaired forward |
| 74 corrective-forward | `database/migrations/20260926_ticket_74_ticket72_acl_corrective_forward.sql` | `709bba9653da6b9cbbf87e072a208e729a2c3e3dc4c9b608b57aa28534d091fd` | COMMITTED / independently verified |

Any checksum difference is a STOP. The original Ticket72 migration is preserved
byte-for-byte as historical production evidence; it was not edited to repair its
already committed ACL mistake.

## Ticket17A and Ticket65D

Ticket17A and Ticket65D both committed and passed their independent catalog-only
postchecks. The checks verified their expected relations, columns, constraints,
indexes, RLS/FORCE RLS, policies, functions, ACLs, and static contract state,
while confirming non-regression for `public.messages` and the recovery RPCs.

## Ticket71 final history

The original Ticket71 attempt failed before `COMMIT` because PostgreSQL has no
`jsonb_object_length(jsonb)` function. The transaction was cleanly rolled back,
and independent catalog checks found no Ticket71 residue. The first corrected
local candidate was retired before production after disposable local PostgreSQL
testing showed that it did not revoke inherited `service_role` mutations.

The final Ticket71 migration replaces that unavailable JSONB function with a
native closed-key check and explicitly revokes all table privileges from
`service_role` before granting only SELECT and INSERT. Its final SHA-256 is
`f09d4b73eb22616f0346e88564a89120a9238d4f84f7ba93152303ea229398f9`.
The human operator executed that final migration, it committed, and independent
read-only verification passed. Ticket71 is therefore **APPLIED_VERIFIED / PASS**.

## Ticket72 and Ticket74 corrective-forward history

The immutable original Ticket72 migration committed with an excessive inherited
`service_role` table ACL: SELECT, INSERT, UPDATE, DELETE, and TRUNCATE were
available on both reviewed-nutrition authority tables. The defect was
independently confirmed. The original migration was then accidentally re-run;
that event is retained here as execution history and does not change the frozen
source or the final contract.

The additive Ticket74 corrective-forward migration revoked all privileges from
`service_role` on `public.reviewed_nutrition_knowledge_sets` and
`public.reviewed_nutrition_knowledge_records`, then re-granted SELECT and
INSERT. It committed and was independently verified. The final ACL is exactly:

| Role | Tables | Allowed | Explicitly absent |
| --- | --- | --- | --- |
| `service_role` | both Ticket72 tables | SELECT, INSERT | UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN |

The corrective-forward change did not alter Ticket72 data, schema, functions,
RLS, policies, prior-ticket objects, or audit access.

## Ticket72 static seed verification

A human administrator completed the final static-seed comparison in an explicit
`BEGIN TRANSACTION READ ONLY` transaction. The session reported
`transaction_read_only = on` (the session default may remain `off`), returned
exactly one authority set and exactly two records, and ended with `ROLLBACK`.

Verified set:

| knowledge_set_id | knowledge_version | locale | status |
| --- | --- | --- | --- |
| `nutrition-practical-es-mx-v1` | `1` | `es-MX` | `reviewed_active` |

Verified records: `rk-food-storage-basics` and `rk-meal-preparation-basics`.
Both have `knowledge_domain = nutrition_practical`, task kind
`knowledge_question`, empty applicable-input types, and provenance
`{"source_class":"architectural_seed","reference":"ticket-63-test-only"}`.
Their content, topic, and non-null migration-time `created_at` matched the
frozen Ticket72 seed contract.

## Closure

No further production SQL is required for Ticket74. Sales Engine v2 runtime
integration/canary remains a separate controlled follow-up governed by the
Ticket69 production integration boundary; this database prerequisite closure
does not route or enable v2 in Node or n8n.
