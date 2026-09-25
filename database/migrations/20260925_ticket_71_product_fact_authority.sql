-- Ticket 71: local-only, reviewed immutable product-fact authority sets.
-- This migration is not evidence of production installation or verification.
BEGIN;

-- Intentionally self-contained: Ticket 70 did not establish that Ticket 58's
-- helper function is installed in production.
CREATE OR REPLACE FUNCTION public.product_fact_authority_value_is_valid(target_value_type text, target_value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE target_value_type
    WHEN 'boolean' THEN jsonb_typeof(target_value) = 'boolean'
    WHEN 'integer' THEN jsonb_typeof(target_value) = 'number' AND trunc((target_value #>> '{}')::numeric) = (target_value #>> '{}')::numeric
    WHEN 'money' THEN jsonb_typeof(target_value) = 'object' AND jsonb_typeof(target_value -> 'amount') = 'number' AND (target_value ->> 'amount')::numeric >= 0 AND jsonb_typeof(target_value -> 'currency') = 'string' AND length(target_value ->> 'currency') = 3 AND target_value ->> 'currency' = upper(target_value ->> 'currency')
    WHEN 'enum' THEN jsonb_typeof(target_value) = 'string' AND target_value #>> '{}' <> ''
    WHEN 'enum_set' THEN jsonb_typeof(target_value) = 'array' AND jsonb_array_length(target_value) > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(target_value) AS item WHERE jsonb_typeof(item) <> 'string' OR item #>> '{}' = '') AND (SELECT count(*) = count(DISTINCT item #>> '{}') FROM jsonb_array_elements(target_value) AS item)
    WHEN 'object' THEN jsonb_typeof(target_value) = 'object'
    WHEN 'text' THEN jsonb_typeof(target_value) = 'string'
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.product_fact_authority_value_is_valid(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_fact_authority_value_is_valid(text, jsonb) TO service_role;

CREATE TABLE IF NOT EXISTS public.product_fact_authority_sets (
  authority_set_id text PRIMARY KEY,
  authority_version text NOT NULL,
  scope jsonb NOT NULL,
  scope_key text GENERATED ALWAYS AS (scope::text) STORED,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_fact_authority_sets_scope_typed CHECK (
    (scope = '{"scope_type":"provider"}'::jsonb)
    OR (scope ? 'scope_type' AND scope ->> 'scope_type' = 'offer_version' AND scope ? 'offer_version' AND jsonb_typeof(scope -> 'offer_version') = 'string' AND jsonb_object_length(scope) = 2)
  ),
  CONSTRAINT product_fact_authority_sets_status CHECK (status IN ('draft', 'reviewed_active', 'retired')),
  CONSTRAINT product_fact_authority_sets_version CHECK (authority_version <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS product_fact_authority_one_active_scope
  ON public.product_fact_authority_sets(scope_key) WHERE status = 'reviewed_active';

CREATE TABLE IF NOT EXISTS public.product_fact_authority_records (
  fact_id text PRIMARY KEY,
  authority_set_id text NOT NULL REFERENCES public.product_fact_authority_sets(authority_set_id) ON DELETE RESTRICT,
  fact_key text NOT NULL,
  state text NOT NULL,
  value_type text NOT NULL,
  value jsonb,
  CONSTRAINT product_fact_authority_record_key CHECK (fact_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  CONSTRAINT product_fact_authority_record_state CHECK (state IN ('known_true', 'known_false', 'unknown', 'not_applicable')),
  CONSTRAINT product_fact_authority_record_value_type CHECK (value_type IN ('boolean', 'integer', 'money', 'enum', 'enum_set', 'object', 'text')),
  CONSTRAINT product_fact_authority_record_unknown_value CHECK (state NOT IN ('unknown', 'not_applicable') OR value IS NULL),
  CONSTRAINT product_fact_authority_record_known_value CHECK (state NOT IN ('known_true', 'known_false') OR (value IS NOT NULL AND public.product_fact_authority_value_is_valid(value_type, value))),
  CONSTRAINT product_fact_authority_record_unique_key UNIQUE (authority_set_id, fact_key)
);

ALTER TABLE public.product_fact_authority_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_fact_authority_sets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.product_fact_authority_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_fact_authority_records FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_fact_authority_sets, public.product_fact_authority_records FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.product_fact_authority_sets, public.product_fact_authority_records TO service_role;

-- Activation is explicit and transactional. A reviewed set is immutable in
-- normal use; the caller retires the old exact scope and activates the new one.
CREATE OR REPLACE FUNCTION public.activate_product_fact_authority_set(target_authority_set_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_scope text;
BEGIN
  SELECT scope_key INTO target_scope FROM public.product_fact_authority_sets WHERE authority_set_id = target_authority_set_id FOR UPDATE;
  IF target_scope IS NULL THEN RAISE EXCEPTION 'PRODUCT_FACT_AUTHORITY_SET_NOT_FOUND'; END IF;
  UPDATE public.product_fact_authority_sets SET status = 'retired' WHERE scope_key = target_scope AND status = 'reviewed_active';
  UPDATE public.product_fact_authority_sets SET status = 'reviewed_active' WHERE authority_set_id = target_authority_set_id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_FACT_AUTHORITY_SET_NOT_DRAFT'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.activate_product_fact_authority_set(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_product_fact_authority_set(text) TO service_role;

-- BEGIN GENERATED TICKET 71 SEED
WITH seed AS (SELECT * FROM jsonb_to_recordset($ticket_71_seed$[{"authority_set_id":"standard-28d-149-v1","authority_version":"1","status":"reviewed_active","scope":{"scope_type":"offer_version","offer_version":"28d-149-v1"},"facts":[{"fact_id":"pf-standard-price","fact_key":"offer.price","state":"known_true","value_type":"money","value":{"amount":149,"currency":"MXN"}},{"fact_id":"pf-standard-duration","fact_key":"offer.duration_days","state":"known_true","value_type":"integer","value":28},{"fact_id":"pf-standard-billing","fact_key":"offer.billing_model","state":"known_true","value_type":"enum","value":"one_time"},{"fact_id":"pf-standard-subscription","fact_key":"offer.subscription","state":"known_false","value_type":"boolean","value":false},{"fact_id":"pf-standard-renewal","fact_key":"offer.automatic_renewal","state":"known_false","value_type":"boolean","value":false},{"fact_id":"pf-standard-meals","fact_key":"offer.meals","state":"known_true","value_type":"enum_set","value":["breakfast","lunch","dinner","snack"]},{"fact_id":"pf-standard-personalization","fact_key":"offer.personalization_after_verified_payment","state":"known_true","value_type":"boolean","value":true},{"fact_id":"pf-standard-portal","fact_key":"service.portal_delivery","state":"known_true","value_type":"boolean","value":true},{"fact_id":"pf-standard-whatsapp","fact_key":"service.whatsapp_support","state":"known_true","value_type":"enum_set","value":["recipes","meal_ideas","practical_guidance","restaurant_guidance"]},{"fact_id":"pf-standard-payments","fact_key":"payment.supported_methods","state":"known_true","value_type":"enum_set","value":["credit_card","debit_card","oxxo","apple_pay"]},{"fact_id":"pf-standard-refund","fact_key":"offer.public_refund_policy","state":"unknown","value_type":"object","value":null}]},{"authority_set_id":"dietavity-provider-boundaries-v1","authority_version":"1","status":"reviewed_active","scope":{"scope_type":"provider"},"facts":[{"fact_id":"pf-provider-glp1-sale","fact_key":"service.glp1_medication_sale","state":"known_false","value_type":"boolean","value":false},{"fact_id":"pf-provider-glp1-delivery","fact_key":"service.glp1_medication_delivery","state":"known_false","value_type":"boolean","value":false},{"fact_id":"pf-provider-glp1-prescription","fact_key":"service.glp1_medication_prescription","state":"known_false","value_type":"boolean","value":false}]}]$ticket_71_seed$::jsonb) AS value(authority_set_id text, authority_version text, status text, scope jsonb, facts jsonb)), inserted AS (
  INSERT INTO public.product_fact_authority_sets (authority_set_id, authority_version, status, scope)
  SELECT authority_set_id, authority_version, status, scope FROM seed ON CONFLICT (authority_set_id) DO NOTHING
)
INSERT INTO public.product_fact_authority_records (fact_id, authority_set_id, fact_key, state, value_type, value)
SELECT item.fact_id, seed.authority_set_id, item.fact_key, item.state, item.value_type, item.value
FROM seed CROSS JOIN LATERAL jsonb_to_recordset(seed.facts) AS item(fact_id text, fact_key text, state text, value_type text, value jsonb)
ON CONFLICT (fact_id) DO NOTHING;
-- END GENERATED TICKET 71 SEED
COMMIT;
