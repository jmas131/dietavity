-- Ticket 74: corrective-forward ACL repair for committed Ticket 72 tables.
-- This deliberately changes no data, schema, function, RLS, or policy state.
BEGIN;

REVOKE ALL ON TABLE public.reviewed_nutrition_knowledge_sets,
                    public.reviewed_nutrition_knowledge_records
  FROM service_role;
GRANT SELECT, INSERT ON TABLE public.reviewed_nutrition_knowledge_sets,
                              public.reviewed_nutrition_knowledge_records
  TO service_role;

COMMIT;
