'use strict';

// Additive canary changes to the canonical generator; Ticket 9 stays immutable.
module.exports = function applyGlp1Canary(workflow, knowledge, policy) {
  const node = name => {
    const found = workflow.nodes.find(n => n.name === name);
    if (!found) throw new Error(`Missing node: ${name}`);
    return found;
  };
  const replace = (name, from, to, field = 'query') => {
    const parameters = node(name).parameters;
    if (!parameters[field].includes(from)) throw new Error(`Missing Ticket 41 anchor: ${name}`);
    parameters[field] = parameters[field].replace(from, to);
  };
  const detection = `(${policy.detectOfferContext.toString()})($('Set Session Id').item.json.chatInput)`;
  const payload = `={{ JSON.stringify({ session_id: $('Set Session Id').item.json.session_id, offer_context: ${detection} }) }}`;
  const get = node('Get Onboarding Session');
  const postgres = node('Initialize Sales Lead v3');
  get.type = postgres.type;
  get.typeVersion = postgres.typeVersion;
  get.credentials = JSON.parse(JSON.stringify(postgres.credentials));
  get.parameters = {
    operation: 'executeQuery',
    query: `WITH input AS (SELECT $1::jsonb AS payload), tagged AS (
  UPDATE public.onboarding_sessions AS session
  SET offer_context = 'glp1_validation'
  FROM input
  WHERE session.session_id = input.payload->>'session_id'
    AND input.payload->>'offer_context' = 'glp1_validation'
    AND session.offer_context IS NULL
  RETURNING session.*
)
SELECT * FROM tagged
UNION ALL
SELECT session.* FROM public.onboarding_sessions AS session, input
WHERE session.session_id = input.payload->>'session_id'
  AND NOT EXISTS (SELECT 1 FROM tagged);`,
    options: { queryReplacement: payload },
  };
  get.notes = 'Ticket 41: detect exact campaign before AI; persist only offer_context on existing sessions and return the updated row. All other state is preserved. Missing rows use the existing initializer.';
  replace('Initialize Sales Lead v3',
    "(session_id, conversation_stage, created_at, updated_at)\n  VALUES ('{{ $('Set Session Id').item.json.session_id }}', 'new', NOW(), NOW())\n  ON CONFLICT (session_id) DO UPDATE SET updated_at = public.onboarding_sessions.updated_at",
    `(session_id, conversation_stage, offer_context, created_at, updated_at)
  VALUES ($1::jsonb->>'session_id', 'new', $1::jsonb->>'offer_context', NOW(), NOW())
  ON CONFLICT (session_id) DO UPDATE
    SET offer_context = COALESCE(public.onboarding_sessions.offer_context, EXCLUDED.offer_context)`);
  postgres.parameters.options.queryReplacement = payload;

  // Knowledge is built after either session branch, before classification.
  const canonical = node('Build Canonical Dietavity Knowledge');
  canonical.parameters.jsCode = canonical.parameters.jsCode.replace('return [{ json:', 'const canonical =')
    .replace(/ }\];$/, ';') + `
const session = $input.first().json;
if (session.offer_context === 'glp1_validation') {
  canonical.offer_context = session.offer_context;
  canonical.sales_response_knowledge += '\\n\\n' + ${JSON.stringify(knowledge.GLP1_SALES_KNOWLEDGE)};
}
return [{ json: canonical }];`;
  replace('Build Constrained Sales Response',
    "'Para discovery usa la propuesta de valor canónica y una sola pregunta ligera de objetivo. ' +",
    "(decision.offer_context === 'glp1_validation' ? 'Para discovery usa exactamente la pregunta práctica de descubrimiento indicada por la política, sin oferta ni precio. ' : 'Para discovery usa la propuesta de valor canónica y una sola pregunta ligera de objetivo. ') +", 'jsCode');

  replace('Validate Sales Response Contract',
    "if (decision.strategy === 'discovery' || decision.strategy === 'explain_offer'",
    "if ((decision.strategy === 'discovery' && !decision.deterministic_response) || decision.strategy === 'explain_offer'", 'jsCode');
  replace('Validate Sales Response Contract',
    'return [{ json: { ...decision, output } }];',
    `${policy.glp1ResponseViolatesScope.toString()}
if (decision.offer_context === 'glp1_validation' && glp1ResponseViolatesScope(output)) {
  output = 'Dietavity ofrece ayuda general para organizar tus comidas, no tratamiento médico. Para dudas sobre medicamentos o síntomas, consulta al profesional que te lo prescribió.';
  return [{ json: { ...decision, next_last_question_type: null, allow_purchase_cta: false, output } }];
}
return [{ json: { ...decision, output } }];`, 'jsCode');

  // Ticket 42: keep purchase intent distinct from Stripe milestones. One canary
  // milestone per session/offer, including separate inbound purchase requests.
  replace('Persist Sales Response State and Events',
    "WHEN event_names.event_type IN ('meaningful_engagement', 'offer_presented')",
    "WHEN event_names.event_type = 'purchase_intent' AND updated_session.offer_context = 'glp1_validation' THEN 'purchase_intent:' || updated_session.session_id || ':glp1_validation:28d-149-v1'\n      WHEN event_names.event_type IN ('meaningful_engagement', 'offer_presented')");
  replace('Persist Sales Response State and Events',
    "CASE WHEN event_names.event_type = 'offer_presented' THEN '28d-149-v1' ELSE NULL END",
    "CASE WHEN event_names.event_type = 'offer_presented' OR (event_names.event_type = 'purchase_intent' AND updated_session.offer_context = 'glp1_validation') THEN '28d-149-v1' ELSE NULL END");
  replace('Persist Sales Response State and Events',
    "WHEN decision.payload->>'next_last_question_type' = 'purchase_confirmation' THEN '28d-149-v1'",
    "WHEN decision.payload->>'next_last_question_type' = 'purchase_confirmation' OR decision.payload->>'holding_page_would_be_sent' = 'true' THEN '28d-149-v1'");

  const contextMetadata = "jsonb_strip_nulls(jsonb_build_object('offer_context', offer_context))";
  for (const name of ['Initialize Sales Lead v3', 'Persist Sales Response State and Events', 'Persist Checkout Authorization v3', 'Persist Requested Reminder']) {
    replace(name, "'{}'::jsonb", contextMetadata);
  }
  replace('Persist Checkout Authorization v3', "jsonb_build_object('authorization_type', checkout_authorization_type)",
    `jsonb_build_object('authorization_type', checkout_authorization_type) || ${contextMetadata}`);
  replace('Mark Checkout Sent v3', "jsonb_build_object('checkout_session_id', checkout_session_id)",
    `jsonb_build_object('checkout_session_id', checkout_session_id) || ${contextMetadata}`);
  replace('Persist Requested Reminder', "jsonb_build_object('message_sid', reminder_message_sid, 'scheduled_for', reminder_scheduled_for)",
    `jsonb_build_object('message_sid', reminder_message_sid, 'scheduled_for', reminder_scheduled_for) || ${contextMetadata}`);
  replace('Resolve User and Persist Purchase', "jsonb_build_object('checkout_session_id', resolved_purchase.stripe_checkout_session_id)",
    `jsonb_build_object('checkout_session_id', resolved_purchase.stripe_checkout_session_id) ||
    jsonb_strip_nulls(jsonb_build_object('offer_context', (
      SELECT offer_context FROM public.onboarding_sessions
      WHERE session_id = input.payload->>'whatsapp_id'
    )))`);
};
