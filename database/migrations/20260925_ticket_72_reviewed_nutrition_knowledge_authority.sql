-- Ticket 72: local-only reviewed nutrition knowledge authority. Not applied or
-- verified in production by this repository change.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reviewed_nutrition_knowledge_sets (
  knowledge_set_id text PRIMARY KEY,
  knowledge_version text NOT NULL,
  locale text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviewed_nutrition_knowledge_sets_version CHECK (knowledge_version <> ''),
  CONSTRAINT reviewed_nutrition_knowledge_sets_locale CHECK (locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  CONSTRAINT reviewed_nutrition_knowledge_sets_status CHECK (status IN ('draft', 'reviewed_active', 'retired'))
);
CREATE UNIQUE INDEX IF NOT EXISTS reviewed_nutrition_knowledge_one_active_locale
  ON public.reviewed_nutrition_knowledge_sets(locale) WHERE status = 'reviewed_active';
CREATE TABLE IF NOT EXISTS public.reviewed_nutrition_knowledge_records (
  knowledge_id text NOT NULL,
  knowledge_set_id text NOT NULL REFERENCES public.reviewed_nutrition_knowledge_sets(knowledge_set_id) ON DELETE RESTRICT,
  knowledge_domain text NOT NULL,
  topic text NOT NULL,
  task_kinds jsonb NOT NULL,
  applicable_input_types jsonb NOT NULL,
  content text NOT NULL,
  provenance jsonb NOT NULL,
  PRIMARY KEY (knowledge_id, knowledge_set_id),
  CONSTRAINT reviewed_nutrition_knowledge_id CHECK (knowledge_id ~ '^[a-z][a-z0-9-]*$'),
  CONSTRAINT reviewed_nutrition_knowledge_domain CHECK (knowledge_domain IN ('nutrition_practical')),
  CONSTRAINT reviewed_nutrition_knowledge_topic CHECK (topic IN ('food_storage', 'meal_preparation')),
  CONSTRAINT reviewed_nutrition_knowledge_task_kinds CHECK (jsonb_typeof(task_kinds) = 'array' AND jsonb_array_length(task_kinds) > 0 AND task_kinds <@ '["knowledge_question", "transformation", "organization"]'::jsonb),
  CONSTRAINT reviewed_nutrition_knowledge_input_types CHECK (jsonb_typeof(applicable_input_types) = 'array' AND applicable_input_types <@ '["meal_name", "ingredient", "preparation_step", "meal_component", "schedule_constraint", "time_constraint", "user_preference"]'::jsonb),
  CONSTRAINT reviewed_nutrition_knowledge_content CHECK (content <> ''),
  CONSTRAINT reviewed_nutrition_knowledge_provenance CHECK (provenance = jsonb_build_object('source_class', 'architectural_seed', 'reference', provenance -> 'reference') AND jsonb_typeof(provenance -> 'reference') = 'string' AND provenance ->> 'reference' <> '')
);
ALTER TABLE public.reviewed_nutrition_knowledge_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviewed_nutrition_knowledge_sets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reviewed_nutrition_knowledge_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviewed_nutrition_knowledge_records FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reviewed_nutrition_knowledge_sets, public.reviewed_nutrition_knowledge_records FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.reviewed_nutrition_knowledge_sets, public.reviewed_nutrition_knowledge_records TO service_role;
CREATE OR REPLACE FUNCTION public.activate_reviewed_nutrition_knowledge_set(target_knowledge_set_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_locale text;
BEGIN
  SELECT locale INTO target_locale FROM public.reviewed_nutrition_knowledge_sets WHERE knowledge_set_id = target_knowledge_set_id FOR UPDATE;
  IF target_locale IS NULL THEN RAISE EXCEPTION 'REVIEWED_NUTRITION_KNOWLEDGE_SET_NOT_FOUND'; END IF;
  UPDATE public.reviewed_nutrition_knowledge_sets SET status = 'retired' WHERE locale = target_locale AND status = 'reviewed_active';
  UPDATE public.reviewed_nutrition_knowledge_sets SET status = 'reviewed_active' WHERE knowledge_set_id = target_knowledge_set_id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEWED_NUTRITION_KNOWLEDGE_SET_NOT_DRAFT'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.activate_reviewed_nutrition_knowledge_set(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_reviewed_nutrition_knowledge_set(text) TO service_role;
-- BEGIN GENERATED TICKET 72 SEED
WITH seed AS (SELECT * FROM jsonb_to_recordset($ticket_72_seed$[{"knowledge_set_id":"nutrition-practical-es-mx-v1","knowledge_version":"1","status":"reviewed_active","locale":"es-MX","records":[{"knowledge_id":"rk-food-storage-basics","knowledge_domain":"nutrition_practical","topic":"food_storage","task_kinds":["knowledge_question"],"applicable_input_types":[],"content":"Para conservar comida cocida, guárdala en un recipiente limpio y cerrado en el refrigerador tan pronto como se haya enfriado lo suficiente para manipularla. Si tienes dudas sobre su estado, es más seguro desecharla.","provenance":{"source_class":"architectural_seed","reference":"ticket-63-test-only"}},{"knowledge_id":"rk-meal-preparation-basics","knowledge_domain":"nutrition_practical","topic":"meal_preparation","task_kinds":["knowledge_question"],"applicable_input_types":[],"content":"Para adelantar la preparación de comidas, puedes separar ingredientes, lavar y cortar verduras, y dejar porciones listas antes de cocinar. Conserva cada preparación según sus necesidades y revisa su estado antes de consumirla.","provenance":{"source_class":"architectural_seed","reference":"ticket-63-test-only"}}]}]$ticket_72_seed$::jsonb) AS value(knowledge_set_id text, knowledge_version text, status text, locale text, records jsonb)), inserted AS (
INSERT INTO public.reviewed_nutrition_knowledge_sets (knowledge_set_id, knowledge_version, status, locale)
SELECT knowledge_set_id, knowledge_version, status, locale FROM seed ON CONFLICT (knowledge_set_id) DO NOTHING RETURNING knowledge_set_id
)
INSERT INTO public.reviewed_nutrition_knowledge_records (knowledge_id, knowledge_set_id, knowledge_domain, topic, task_kinds, applicable_input_types, content, provenance)
SELECT item.knowledge_id, seed.knowledge_set_id, item.knowledge_domain, item.topic, item.task_kinds, item.applicable_input_types, item.content, item.provenance
FROM seed CROSS JOIN LATERAL jsonb_to_recordset(seed.records) AS item(knowledge_id text, knowledge_domain text, topic text, task_kinds jsonb, applicable_input_types jsonb, content text, provenance jsonb)
ON CONFLICT (knowledge_id, knowledge_set_id) DO NOTHING;
-- END GENERATED TICKET 72 SEED
COMMIT;
