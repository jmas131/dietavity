-- Ticket 58: canonical, backend-only product/provider fact store.
-- Seed payload is generated from config/sales-engine-v2/product-facts.json by
-- scripts/generate-sales-engine-v2-product-fact-seed.js and parity-tested.
BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION public.product_fact_value_is_valid(target_value_type text, target_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE target_value_type
    WHEN 'boolean' THEN jsonb_typeof(target_value) = 'boolean'
    WHEN 'integer' THEN jsonb_typeof(target_value) = 'number'
      AND trunc((target_value #>> '{}')::numeric) = (target_value #>> '{}')::numeric
    WHEN 'money' THEN jsonb_typeof(target_value) = 'object'
      AND jsonb_typeof(target_value -> 'amount') = 'number'
      AND (target_value ->> 'amount')::numeric >= 0
      AND jsonb_typeof(target_value -> 'currency') = 'string'
      AND length(target_value ->> 'currency') = 3
      AND target_value ->> 'currency' = upper(target_value ->> 'currency')
    WHEN 'enum' THEN jsonb_typeof(target_value) = 'string' AND target_value #>> '{}' <> ''
    WHEN 'enum_set' THEN jsonb_typeof(target_value) = 'array'
      AND jsonb_array_length(target_value) > 0
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(target_value) AS item WHERE jsonb_typeof(item) <> 'string' OR item #>> '{}' = '')
      AND (SELECT count(*) = count(DISTINCT item #>> '{}') FROM jsonb_array_elements(target_value) AS item)
    WHEN 'object' THEN jsonb_typeof(target_value) = 'object'
    WHEN 'text' THEN jsonb_typeof(target_value) = 'string'
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.product_fact_value_is_valid(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_fact_value_is_valid(text, jsonb) TO service_role;

CREATE TABLE IF NOT EXISTS public.product_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_key text NOT NULL,
  offer_version text,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  offer_scope_key text GENERATED ALWAYS AS (coalesce(offer_version, '')) STORED,
  scope_key text GENERATED ALWAYS AS (scope::text) STORED,
  state text NOT NULL,
  value_type text NOT NULL,
  value jsonb,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  version integer NOT NULL,
  provenance text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_facts_key_check CHECK (fact_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  CONSTRAINT product_facts_scope_object_check CHECK (jsonb_typeof(scope) = 'object'),
  CONSTRAINT product_facts_state_check CHECK (state IN ('known_true', 'known_false', 'unknown', 'not_applicable', 'deprecated')),
  CONSTRAINT product_facts_value_type_check CHECK (value_type IN ('boolean', 'integer', 'money', 'enum', 'enum_set', 'object', 'text')),
  CONSTRAINT product_facts_status_check CHECK (status IN ('active', 'deprecated', 'draft')),
  CONSTRAINT product_facts_version_check CHECK (version > 0),
  CONSTRAINT product_facts_validity_check CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT product_facts_unknown_value_check CHECK (state NOT IN ('unknown', 'not_applicable') OR value IS NULL),
  CONSTRAINT product_facts_deprecated_active_check CHECK (NOT (state = 'deprecated' AND status = 'active')),
  CONSTRAINT product_facts_known_value_check CHECK (
    state NOT IN ('known_true', 'known_false') OR (
      value IS NOT NULL AND public.product_fact_value_is_valid(value_type, value)
    )
  ),
  CONSTRAINT product_facts_identity_version_key UNIQUE (fact_key, offer_scope_key, scope_key, version)
);

ALTER TABLE public.product_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_facts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_facts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.product_facts TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_facts_no_active_validity_overlap' AND conrelid = 'public.product_facts'::regclass) THEN
    ALTER TABLE public.product_facts
      ADD CONSTRAINT product_facts_no_active_validity_overlap EXCLUDE USING gist (
        fact_key WITH =,
        offer_scope_key WITH =,
        scope_key WITH =,
        tstzrange(valid_from, coalesce(valid_to, 'infinity'::timestamptz), '[)') WITH &&
      ) WHERE (status = 'active');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_product_facts_updated_at' AND tgrelid = 'public.product_facts'::regclass AND NOT tgisinternal) THEN
    CREATE TRIGGER set_product_facts_updated_at
      BEFORE UPDATE ON public.product_facts
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

-- BEGIN GENERATED TICKET 58 SEED
INSERT INTO public.product_facts (fact_key, offer_version, scope, state, value_type, value, valid_from, valid_to, version, provenance, status)
SELECT fact_key, offer_version, scope, state, value_type, value, valid_from, valid_to, version, provenance, status
FROM jsonb_to_recordset($ticket_58_seed$[{"fact_key":"offer.price","offer_version":"28d-149-v1","scope":{},"state":"known_true","value_type":"money","value":{"amount":149,"currency":"MXN"},"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-57-SALES-ENGINE-V2-ARCHITECTURE.md#canonical-fact-inventory","status":"active"},{"fact_key":"offer.duration_days","offer_version":"28d-149-v1","scope":{},"state":"known_true","value_type":"integer","value":28,"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-57-SALES-ENGINE-V2-ARCHITECTURE.md#canonical-fact-inventory","status":"active"},{"fact_key":"offer.billing_model","offer_version":"28d-149-v1","scope":{},"state":"known_true","value_type":"enum","value":"one_time","valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-57-SALES-ENGINE-V2-ARCHITECTURE.md#canonical-fact-inventory","status":"active"},{"fact_key":"offer.subscription","offer_version":"28d-149-v1","scope":{},"state":"known_false","value_type":"boolean","value":false,"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-57-SALES-ENGINE-V2-ARCHITECTURE.md#canonical-fact-inventory","status":"active"},{"fact_key":"offer.automatic_renewal","offer_version":"28d-149-v1","scope":{},"state":"known_false","value_type":"boolean","value":false,"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-57-SALES-ENGINE-V2-ARCHITECTURE.md#canonical-fact-inventory","status":"active"},{"fact_key":"offer.meals","offer_version":"28d-149-v1","scope":{},"state":"known_true","value_type":"enum_set","value":["breakfast","lunch","dinner","snack"],"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-57-SALES-ENGINE-V2-ARCHITECTURE.md#canonical-fact-inventory","status":"active"},{"fact_key":"offer.personalization_after_verified_payment","offer_version":"28d-149-v1","scope":{},"state":"known_true","value_type":"boolean","value":true,"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-57-SALES-ENGINE-V2-ARCHITECTURE.md#canonical-fact-inventory","status":"active"},{"fact_key":"offer.start_date_window","offer_version":"28d-149-v1","scope":{},"state":"known_true","value_type":"object","value":{"minimum_days":0,"maximum_days":30},"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-57-SALES-ENGINE-V2-ARCHITECTURE.md#canonical-fact-inventory","status":"active"},{"fact_key":"payment.supported_methods","offer_version":"28d-149-v1","scope":{},"state":"known_true","value_type":"enum_set","value":["credit_card","debit_card","oxxo","apple_pay"],"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-57-SALES-ENGINE-V2-ARCHITECTURE.md#canonical-fact-inventory","status":"active"},{"fact_key":"service.portal_delivery","offer_version":"28d-149-v1","scope":{},"state":"known_true","value_type":"boolean","value":true,"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-57-SALES-ENGINE-V2-ARCHITECTURE.md#canonical-fact-inventory","status":"active"},{"fact_key":"service.whatsapp_support","offer_version":"28d-149-v1","scope":{},"state":"known_true","value_type":"enum_set","value":["recipes","meal_ideas","practical_guidance","restaurant_guidance"],"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-57-SALES-ENGINE-V2-ARCHITECTURE.md#canonical-fact-inventory","status":"active"},{"fact_key":"service.prepared_food_delivery","offer_version":"28d-149-v1","scope":{},"state":"known_false","value_type":"boolean","value":false,"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-57-SALES-ENGINE-V2-ARCHITECTURE.md#canonical-fact-inventory","status":"active"},{"fact_key":"service.in_person_location","offer_version":"28d-149-v1","scope":{},"state":"known_false","value_type":"boolean","value":false,"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-57-SALES-ENGINE-V2-ARCHITECTURE.md#canonical-fact-inventory","status":"active"},{"fact_key":"service.glp1_medication_sale","offer_version":null,"scope":{},"state":"known_false","value_type":"boolean","value":false,"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-44-GLP1-PRODUCT-SCOPE.md","status":"active"},{"fact_key":"service.glp1_medication_delivery","offer_version":null,"scope":{},"state":"known_false","value_type":"boolean","value":false,"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-44-GLP1-PRODUCT-SCOPE.md","status":"active"},{"fact_key":"service.glp1_medication_prescription","offer_version":null,"scope":{},"state":"known_false","value_type":"boolean","value":false,"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"docs/TICKET-44-GLP1-PRODUCT-SCOPE.md","status":"active"},{"fact_key":"offer.public_refund_policy","offer_version":"28d-149-v1","scope":{},"state":"unknown","value_type":"object","value":null,"valid_from":"2026-09-22T00:00:00.000Z","valid_to":null,"version":1,"provenance":"lib/dietavity-knowledge.js#MULTI_TOPIC_ANSWERS.refund","status":"active"}]$ticket_58_seed$::jsonb)
AS seed(fact_key text, offer_version text, scope jsonb, state text, value_type text, value jsonb, valid_from timestamptz, valid_to timestamptz, version integer, provenance text, status text)
ON CONFLICT ON CONSTRAINT product_facts_identity_version_key DO NOTHING;
-- END GENERATED TICKET 58 SEED

COMMIT;
