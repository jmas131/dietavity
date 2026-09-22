'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const knowledge = require('../lib/dietavity-knowledge');
const policy = require('../lib/sales-engine-v3');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'archive', 'Dietavity live 2.5.1 (Ticket 6).json');
const developmentPath = path.join(root, 'n8n', 'Dietavity Sales Engine v3 (Ticket 8).json');
const rollbackPath = path.join(root, 'archive', 'Dietavity live 2.5.1 pre-ticket-8.json');
const workflow = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

if (!fs.existsSync(rollbackPath)) {
  fs.writeFileSync(rollbackPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

const byName = (name) => {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`Missing workflow node: ${name}`);
  return node;
};

const uuid = () => crypto.randomUUID();
const postgresCredentials = byName('Initialize 28-Day Program').credentials;
const openAiCredentials = byName('Onboarding Agent').credentials;
const twilioCredentials = byName('Respond to Chat').credentials;

const legacyNodes = new Set([
  'Create Onboarding Session', 'Switch Onboarding State', 'Build Welcome Prompt',
  'Build Pitch Prompt', 'Build Short Closing Prompt',
  'Build Payment Pending Response Prompt', 'Build Subscription Decision Response Prompt',
  'Set State Ask Subscription', 'Set State Subscription Deferred', 'Set Payment Pending',
  'Detect Thank You', 'If Thank You', 'Detect Negative', 'If Negative',
  'Build Welcome Farewell Prompt', 'Detect Affirmative', 'Is Affirmative',
  'If CTA Sent and not Ask Subscription', 'Set Message to Output',
  'Onboarding Manager', 'Onboarding Agent',
]);

workflow.nodes = workflow.nodes.filter((node) => !legacyNodes.has(node.name));
for (const name of legacyNodes) delete workflow.connections[name];
for (const connectionGroups of Object.values(workflow.connections)) {
  for (const outputGroups of Object.values(connectionGroups)) {
    for (const output of outputGroups) {
      for (let index = output.length - 1; index >= 0; index -= 1) {
        if (legacyNodes.has(output[index].node)) output.splice(index, 1);
      }
    }
  }
}

workflow.name = 'Dietavity Sales Engine v3 (Ticket 8)';
workflow.active = false;

byName('Set Session Id').parameters.assignments.assignments.push(
  {
    id: uuid(), name: 'session_id', type: 'string',
    value: "={{ ($('Incoming Message').item.json.data.from ?? '').replace(/^whatsapp:/, '').replace(/\\s+/g, '') }}",
  },
  {
    id: uuid(), name: 'inbound_message_sid', type: 'string',
    value: "={{ $('Incoming Message').item.json.data.messageSid || $('Incoming Message').item.json.data.sid || $execution.id }}",
  },
);

byName('Get Onboarding Session').parameters.filters.conditions[0].keyValue = "={{ $('Set Session Id').item.json.session_id }}";

const node = (name, type, position, parameters, extra = {}) => ({
  parameters,
  type,
  typeVersion: extra.typeVersion || 2,
  position,
  id: uuid(),
  name,
  ...extra,
});

const pg = (name, position, query, notes) => node(
  name, 'n8n-nodes-base.postgres', position,
  { operation: 'executeQuery', query, options: {} },
  { typeVersion: 2.6, credentials: postgresCredentials, notes },
);

const code = (name, position, jsCode, notes) => node(
  name, 'n8n-nodes-base.code', position, { jsCode },
  { typeVersion: 2, notes },
);

const salesKnowledge = code(
  'Build Canonical Dietavity Knowledge', [67904, 50016],
  `return [{ json: ${JSON.stringify({
    offer_version: knowledge.OFFER_VERSION,
    role_and_identity: knowledge.ROLE_AND_IDENTITY,
    product_facts: knowledge.PRODUCT_FACTS,
    food_philosophy: knowledge.FOOD_PHILOSOPHY,
    meal_generation_rules: knowledge.MEAL_GENERATION_RULES,
    medical_and_scope_boundaries: knowledge.MEDICAL_AND_SCOPE_BOUNDARIES,
    commercial_policy_facts: knowledge.COMMERCIAL_POLICY_FACTS,
    sales_response_knowledge: knowledge.SALES_RESPONSE_KNOWLEDGE,
  })} }];`,
  'Single canonical runtime source for Sales Engine v3 identity, offer, food philosophy, meal rules, scope, and commercial policy.',
);

const initializeLead = pg(
  'Initialize Sales Lead v3', [67488, 50480],
  `WITH inserted_session AS (
  INSERT INTO public.onboarding_sessions (session_id, conversation_stage, created_at, updated_at)
  VALUES ('{{ $('Set Session Id').item.json.session_id }}', 'new', NOW(), NOW())
  ON CONFLICT (session_id) DO UPDATE SET updated_at = public.onboarding_sessions.updated_at
  RETURNING *
), inserted_event AS (
  INSERT INTO public.sales_funnel_events (
    session_id, event_type, event_key, metadata
  )
  SELECT
    session_id,
    'lead_started',
    'lead_started:' || session_id,
    '{}'::jsonb
  FROM inserted_session
  ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
)
SELECT * FROM inserted_session;`,
  'Creates only current operational context and emits retry-safe lead_started. No CTWA attribution is persisted because the repository contains no verified real CTWA payload field fixture.',
);

const classifier = node(
  'Interpret Sales Buyer Signal', '@n8n/n8n-nodes-langchain.agent', [68320, 49648],
  {
    promptType: 'define',
    text: "={{ $('Set Session Id').item.json.chatInput }}",
    options: {
      systemMessage: `You interpret one inbound Spanish WhatsApp turn for Dietavity Sales Engine v3. You interpret meaning only. You never authorize Checkout, reminders, or any side effect.

Return only JSON:
{
  "buyer_signal": "information_request",
  "topic": null,
  "goal": null,
  "goal_supplied": false,
  "timing_iso": null,
  "explicit_reminder_request": false,
  "material_question": false,
  "substantive_engagement": true,
  "needs_clarification": false
}

Allowed buyer_signal values: ${policy.BUYER_SIGNALS.join(', ')}.
Allowed topics: price, payment_methods, what_is_included, how_it_works, post_purchase, start_date, personalization, portal, WhatsApp_assistance, AI, privacy, payment_security, refund, diet_support, allergies, health_scope, product_scope, or null.

Rules:
- Use explicit_purchase only for an unambiguous current request to buy, start, pay, or receive the payment link.
- A request to receive or find the payment link, including a question such as "¿Me mandas el enlace?" or "¿Dónde pago?", is explicit_purchase and is not by itself a material_question.
- Use contextual_affirmation for strong yes-like answers; use ambiguous_acknowledgement for ok, okay, perfecto, vale, or listo.
- material_question is true for an unresolved question about payment, price, start/timing, refund, health/safety, privacy, or product scope.
- explicit_reminder_request is true only if the person asks Dietavity to contact/remind them proactively.
- timing_iso must be an ISO-8601 timestamp with timezone only when reminder timing is resolvable from the current time {{ $now.toISO() }}; otherwise null.
- A generic or prefilled "Hola, quiero más información" is not substantive engagement.
- Do not infer a reminder request from deferred interest.
- Extract at most a short nonsensitive sales goal. Never extract medical details, allergies, profile data, payment data, full reasoning, or hidden chain-of-thought.`,
    },
  },
  { typeVersion: 3 },
);

const classifierModel = node(
  'Sales Interpretation Model', '@n8n/n8n-nodes-langchain.lmChatOpenAi', [68320, 49872],
  {
    model: { __rl: true, mode: 'list', value: 'gpt-5-mini' },
    builtInTools: {}, options: { reasoningEffort: 'low' },
  },
  { typeVersion: 1.3, credentials: openAiCredentials },
);

const parser = code(
  'Parse Sales Interpretation', [68640, 49648],
  `const allowedSignals = ${JSON.stringify(policy.BUYER_SIGNALS)};
const allowedTopics = ${JSON.stringify([...policy.MATERIAL_TOPICS, 'what_is_included', 'how_it_works', 'post_purchase', 'personalization', 'portal', 'WhatsApp_assistance', 'AI', 'diet_support'])};
try {
  const raw = String($input.first().json.output || '').replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/g, '');
  const parsed = JSON.parse(raw);
  return [{ json: {
    interpretation_valid: allowedSignals.includes(parsed.buyer_signal),
    buyer_signal: allowedSignals.includes(parsed.buyer_signal) ? parsed.buyer_signal : 'other',
    topic: allowedTopics.includes(parsed.topic) ? parsed.topic : null,
    goal: typeof parsed.goal === 'string' ? parsed.goal.slice(0, 160) : null,
    goal_supplied: parsed.goal_supplied === true,
    timing_iso: typeof parsed.timing_iso === 'string' ? parsed.timing_iso : null,
    explicit_reminder_request: parsed.explicit_reminder_request === true,
    material_question: parsed.material_question === true,
    substantive_engagement: parsed.substantive_engagement !== false,
    needs_clarification: parsed.needs_clarification === true
  } }];
} catch {
  return [{ json: { interpretation_valid: false, buyer_signal: 'other', topic: null, goal: null, goal_supplied: false, timing_iso: null, explicit_reminder_request: false, material_question: false, substantive_engagement: false, needs_clarification: true } }];
}`,
  'Invalid AI output degrades to non-consequential other. It cannot authorize Checkout or reminder scheduling.',
);

const policySource = [
  normalizeFunction(policy.normalizeMessage),
  normalizeFunction(policy.isStrongAffirmation),
  normalizeFunction(policy.isWeakAcknowledgement),
  normalizeFunction(policy.hasDeterministicExplicitPurchase),
  normalizeFunction(policy.hasDeterministicMaterialQuestion),
  normalizeFunction(policy.isInitialGenericInquiry),
  normalizeFunction(policy.isSubstantiveEngagement),
  normalizeFunction(policy.validContext),
  normalizeFunction(policy.validatedReminderTime),
  normalizeFunction(policy.topicEvent),
  normalizeFunction(policy.decideSalesTurn),
].join('\n\n');

function normalizeFunction(fn) {
  return fn.toString().replace(/^function\s+/, 'function ');
}

const policyNode = code(
  'Apply Deterministic Commercial Policy', [68960, 49648],
  `const OFFER_VERSION = ${JSON.stringify(knowledge.OFFER_VERSION)};
const BUYER_SIGNALS = ${JSON.stringify(policy.BUYER_SIGNALS)};
const LAST_QUESTION_TYPES = ${JSON.stringify(policy.LAST_QUESTION_TYPES)};
const MATERIAL_TOPICS = new Set(${JSON.stringify([...policy.MATERIAL_TOPICS])});
const SECONDARY_EVENT_BY_SIGNAL = ${JSON.stringify(policy.SECONDARY_EVENT_BY_SIGNAL)};
${policySource}
const message = $('Set Session Id').item.json.chatInput;
const interpretation = $input.first().json;
const session = $('If Existing Onboarding Session').item.json.session_id
  ? $('Get Onboarding Session').item.json
  : $('Initialize Sales Lead v3').item.json;
const decision = decideSalesTurn({ message, interpretation, session, now: new Date() });
return [{ json: { ...decision, session_id: $('Set Session Id').item.json.session_id, inbound_message_sid: $('Set Session Id').item.json.inbound_message_sid } }];`,
  'The only commercial authorization gate. Only pending_action=send_checkout can reach Checkout; fallback and invalid interpretation cannot.',
);

const actionSwitch = node(
  'Route Authorized Sales Action', 'n8n-nodes-base.switch', [69312, 49648],
  {
    rules: { values: [
      switchRule('send_checkout'),
      switchRule('schedule_requested_reminder'),
      switchRule('close'),
      switchRule('respond'),
    ] },
    options: { fallbackOutput: 'extra' },
  },
  { typeVersion: 3.4 },
);

function switchRule(action) {
  return {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
      conditions: [{
        id: uuid(), leftValue: '={{ $json.pending_action }}', rightValue: action,
        operator: { type: 'string', operation: 'equals' },
      }], combinator: 'and',
    },
  };
}

const persistAuthorization = pg(
  'Persist Checkout Authorization v3', [69648, 49104],
  `WITH decision AS (
  SELECT $1::jsonb AS payload
), authorized_session AS (
  UPDATE public.onboarding_sessions AS session
  SET conversation_stage = 'offer',
      goal = COALESCE(NULLIF(decision.payload->>'goal', ''), session.goal),
      offer_version = decision.payload->>'offer_version',
      checkout_authorization_type = decision.payload->>'checkout_authorization_type',
      checkout_authorized_at = NOW(),
      updated_at = NOW()
  FROM decision
  WHERE session.session_id = decision.payload->>'session_id'
    AND decision.payload->>'pending_action' = 'send_checkout'
    AND (decision.payload->>'checkout_authorized')::boolean IS TRUE
    AND decision.payload->>'strategy' IN ('direct_purchase', 'purchase_confirmation')
    AND decision.payload->>'offer_version' = '28d-149-v1'
  RETURNING session.*
), intent_event AS (
  INSERT INTO public.sales_funnel_events (
    session_id, event_type, event_key, buyer_signal, topic, strategy,
    offer_version, metadata
  )
  SELECT
    session_id,
    'purchase_intent',
    'purchase_intent:' || session_id || ':' || (SELECT payload->>'inbound_message_sid' FROM decision),
    (SELECT payload->>'buyer_signal' FROM decision),
    NULLIF((SELECT payload->>'topic' FROM decision), ''),
    (SELECT payload->>'strategy' FROM decision),
    offer_version,
    jsonb_build_object('authorization_type', checkout_authorization_type)
  FROM authorized_session
  ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
), engagement_event AS (
  INSERT INTO public.sales_funnel_events (
    session_id, event_type, event_key, buyer_signal, topic, strategy, metadata
  )
  SELECT
    session_id, 'meaningful_engagement', 'meaningful_engagement:' || session_id,
    (SELECT payload->>'buyer_signal' FROM decision),
    NULLIF((SELECT payload->>'topic' FROM decision), ''),
    (SELECT payload->>'strategy' FROM decision), '{}'::jsonb
  FROM authorized_session
  ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
)
SELECT * FROM authorized_session;`,
  'Atomic audit evidence and purchase_intent. Empty result means fail closed before Stripe.',
);
persistAuthorization.parameters.options.queryReplacement = "={{ JSON.stringify($json) }}";

byName('Add whatsapp_id').parameters.assignments.assignments[0].value = "={{ ({ whatsapp_id: $('Set Session Id').item.json.session_id, offer_version: '28d-149-v1', authorization_type: $('Persist Checkout Authorization v3').item.json.checkout_authorization_type }) }}";
const checkoutParams = byName('LIVE Stripe Checkout Session Payment').parameters.bodyParameters.parameters;
checkoutParams.push(
  { name: 'metadata[lead_session_id]', value: "={{ $('Set Session Id').item.json.session_id }}" },
  { name: 'metadata[offer_version]', value: knowledge.OFFER_VERSION },
  { name: 'payment_intent_data[metadata][lead_session_id]', value: "={{ $('Set Session Id').item.json.session_id }}" },
  { name: 'payment_intent_data[metadata][offer_version]', value: knowledge.OFFER_VERSION },
);

const persistCheckoutCreated = pg(
  'Persist Checkout Session Evidence v3', [70528, 49104],
  `UPDATE public.onboarding_sessions
SET checkout_session_id = '{{ $json.id }}', updated_at = NOW()
WHERE session_id = '{{ $('Set Session Id').item.json.session_id }}'
  AND checkout_authorized_at IS NOT NULL
  AND checkout_authorization_type IN ('explicit', 'contextual')
  AND offer_version = '28d-149-v1'
RETURNING *;`,
  'Persists the Stripe Session ID before the URL is sent. Does not mark checkout_pending yet.',
);

byName('Message with Stripe Payment URL').parameters.assignments.assignments[0].value = "=¡Perfecto! 😊 Tu programa personalizado de 28 días cuesta $149 MXN en un solo pago.\nPuedes adquirirlo aquí:\n{{ $('LIVE Stripe Checkout Session Payment').item.json.url }}\nEl enlace sólo estará activo durante 24 horas.";

const persistCheckoutSent = pg(
  'Mark Checkout Sent v3', [71248, 49104],
  `WITH updated_session AS (
  UPDATE public.onboarding_sessions
  SET conversation_stage = 'checkout_pending',
      checkout_sent_at = NOW(),
      last_question_type = NULL,
      last_question_at = NULL,
      commercial_context_expires_at = NULL,
      updated_at = NOW()
  WHERE session_id = '{{ $('Set Session Id').item.json.session_id }}'
    AND checkout_session_id = '{{ $('LIVE Stripe Checkout Session Payment').item.json.id }}'
    AND checkout_authorized_at IS NOT NULL
  RETURNING *
), inserted_event AS (
  INSERT INTO public.sales_funnel_events (
    session_id, event_type, event_key, buyer_signal, strategy,
    offer_version, metadata
  )
  SELECT
    session_id, 'checkout_sent', 'checkout_sent:' || checkout_session_id,
    '{{ $('Apply Deterministic Commercial Policy').item.json.buyer_signal }}',
    '{{ $('Apply Deterministic Commercial Policy').item.json.strategy }}',
    offer_version, jsonb_build_object('checkout_session_id', checkout_session_id)
  FROM updated_session
  ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
)
SELECT * FROM updated_session;`,
  'Runs only after Twilio accepts the Checkout URL message; this is the checkout_pending transition and retry-safe checkout_sent milestone.',
);

const responsePrompt = code(
  'Build Constrained Sales Response', [69712, 49888],
  `const decision = $('Apply Deterministic Commercial Policy').item.json;
const knowledge = $('Build Canonical Dietavity Knowledge').item.json;
const session = $('Get Onboarding Session').item.json || {};
const prompt = knowledge.sales_response_knowledge + ${JSON.stringify('\n\n# Contrato de esta respuesta\n')} + JSON.stringify({
  strategy: decision.strategy,
  buyer_signal: decision.buyer_signal,
  topic: decision.topic,
  goal: decision.goal || session.goal || null,
  max_questions: decision.max_questions,
  allow_purchase_cta: decision.allow_purchase_cta,
  next_last_question_type: decision.next_last_question_type,
  illustrative_example: decision.strategy === 'show_example'
}) + ${JSON.stringify('\n\n# Instrucciones\n')} +
'Responde únicamente con el texto final en español para WhatsApp. Sigue exactamente una estrategia y un objetivo. No autorices ni menciones que programaste una acción. ' +
'Para discovery usa la propuesta de valor canónica y una sola pregunta ligera de objetivo. ' +
'Para show_example da desayuno, comida, cena y snack, indica que es ilustrativo/no personalizado y termina con una pregunta sobre qué incluye. ' +
'Para explain_offer comunica la oferta canónica y termina exactamente con una pregunta de compra. ' +
'Para clarify tras un acuse débil pregunta únicamente si desea el enlace; si falta fecha de recordatorio pregunta únicamente qué día. ' +
'Para deferred no programes contacto ni hagas pregunta. Para graceful_close no hagas CTA ni pregunta. Para acknowledgement responde brevemente. ' +
'Para salud, privacidad, IA o reembolso responde el asunto sin CTA de compra. Nunca inventes una política de reembolso. ' +
'No repitas hechos salvo que sean necesarios para responder. No solicites preferencias detalladas ni comiences la personalización antes del pago. ' +
'Nunca muestres identificadores internos de oferta ni prometas ajustes de calorías, porciones, macronutrientes, micronutrientes, condiciones médicas o medicamentos.';
return [{ json: { ...decision, prompt } }];`,
  'Consumes the single canonical knowledge source and the constrained deterministic response contract.',
);

const responseAgent = node(
  'Generate Sales Response v3', '@n8n/n8n-nodes-langchain.agent', [70080, 49888],
  {
    promptType: 'define', text: "={{ $('Set Session Id').item.json.chatInput }}",
    options: { systemMessage: '={{ $json.prompt }}' },
  }, { typeVersion: 3 },
);

const responseModel = node(
  'Sales Response Model', '@n8n/n8n-nodes-langchain.lmChatOpenAi', [70080, 50112],
  { model: { __rl: true, mode: 'list', value: 'gpt-5-mini' }, builtInTools: {}, options: { reasoningEffort: 'low' } },
  { typeVersion: 1.3, credentials: openAiCredentials },
);

const validateResponse = code(
  'Validate Sales Response Contract', [70416, 49888],
  `const decision = $('Apply Deterministic Commercial Policy').item.json;
const generated = String($input.first().json.output || '').trim();
const questions = (generated.match(/\\?/g) || []).length;
const prohibited = /\\$\\s*99|99\\s*MXN|al mes|suscr[ií]b|renovaci[oó]n autom[aá]tica positiva|planes? de 7 d[ií]as.*actualiz/i.test(generated);
const internalOfferVersion = /\\b\\d+d-\\d+(?:-[a-z0-9]+)+\\b/i;
const unsupportedPersonalizationClaim = /ajust(?:amos|ar|a)\\s+(?:las?\\s+)?(?:calor[ií]as|porciones|macronutrientes|micronutrientes)|distribuci[oó]n de macronutrientes|densidad de prote[ií]na|(?:calcio|vitamina D|B12).{0,40}(?:personaliz|ajust)|medicaci[oó]n.{0,40}(?:personaliz|ajust)|textura y digesti[oó]n/i;
const fallback = {
  discovery: '¡Hola! 👋 En Dietavity te decimos qué comer cada día durante 28 días, con un programa personalizado inspirado en hábitos de alimentación de países longevos.\\n¿Qué te gustaría conseguir principalmente: comer más saludable, bajar de peso, tener más energía o simplemente organizar mejor tus comidas?',
  clarify: decision.next_last_question_type === 'reminder_date' ? 'Claro. ¿Qué día quieres que te lo recuerde?' : '¿Quieres que te envíe el enlace para adquirirlo?',
  graceful_close: 'Claro. Gracias por conocer Dietavity. Si en otro momento te interesa, puedes escribirnos por aquí.',
  deferred: 'Claro. Tómate el tiempo que necesites. Cuando quieras continuar, puedes escribirnos por aquí.',
  acknowledgement: '¡Con gusto! 😊',
  conversational: 'Puedo ayudarte con información sobre el programa Dietavity de 28 días.',
  handle_objection: 'Entiendo. Si quieres retomarlo después, puedes escribirnos por aquí.',
  answer_question: 'No pude responder esa pregunta con certeza. Escríbenos a soporte@dietavity.com para confirmarla.',
  show_example: 'Claro 😊 Un día ilustrativo podría incluir avena con fruta y nueces; pollo con verduras y arroz integral; tostadas de atún con ensalada; y manzana con crema de cacahuate. Tu programa se personaliza después del pago con la información que nos compartas durante la personalización.\\n¿Quieres que te cuente qué incluye el programa?',
  explain_offer: 'El programa personalizado de Dietavity dura 28 días y cuesta $149 MXN en un solo pago, sin renovación automática.\\n¿Quieres comenzar tu programa?'
};
const normalizedCustomerMessage = String($('Set Session Id').item.json.chatInput || '')
  .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLocaleLowerCase('es-MX');
const asksCredit = /\\btarjetas? de credito\\b/.test(normalizedCustomerMessage);
const asksDebit = /\\btarjetas? de debito\\b/.test(normalizedCustomerMessage);
const asksAge = /\\b(edad|años?|nacimiento)\\b/.test(normalizedCustomerMessage);
const asksDailyMessages = /\\b(diari[oa]s?|cada dia|todos los dias|mensajes? proactiv[oa]s?)\\b/.test(normalizedCustomerMessage);
let paymentMethodsResponse = 'Aceptamos tarjeta de crédito, tarjeta de débito, OXXO y Apple Pay.\\n¿Quieres que te envíe el enlace?';
if (asksCredit && asksDebit) paymentMethodsResponse = 'Sí, aceptamos pagos con tarjeta de crédito y tarjeta de débito. También puedes pagar en OXXO y con Apple Pay.\\n¿Quieres que te envíe el enlace?';
else if (asksCredit) paymentMethodsResponse = 'Sí, aceptamos pagos con tarjeta de crédito. También puedes pagar con tarjeta de débito, OXXO y Apple Pay.\\n¿Quieres que te envíe el enlace?';
else if (asksDebit) paymentMethodsResponse = 'Sí, aceptamos pagos con tarjeta de débito. También puedes pagar con tarjeta de crédito, OXXO y Apple Pay.\\n¿Quieres que te envíe el enlace?';
else if (/\\boxxo\\b/.test(normalizedCustomerMessage)) paymentMethodsResponse = 'Sí, aceptamos pagos en OXXO. También puedes pagar con tarjeta de crédito, tarjeta de débito y Apple Pay.\\n¿Quieres que te envíe el enlace?';
else if (/\\bapple\\s*pay\\b/.test(normalizedCustomerMessage)) paymentMethodsResponse = 'Sí, aceptamos pagos con Apple Pay. También puedes pagar con tarjeta de crédito, tarjeta de débito y OXXO.\\n¿Quieres que te envíe el enlace?';
const deterministicTopic = {
  price: 'El programa personalizado de Dietavity cuesta $149 MXN en un solo pago. Incluye tu programa de alimentación para 28 días y no tiene renovación automática.\\n¿Quieres comenzar tu programa?',
  payment_methods: paymentMethodsResponse,
  what_is_included: 'Incluye 28 días personalizados con desayuno, comida, cena y snack, acceso por el portal Dietavity y ayuda bajo demanda por WhatsApp durante el programa. Después del pago completas tu personalización.\\n¿Quieres comenzar tu programa de 28 días?',
  how_it_works: 'Después del pago verificado completas tu personalización, preparamos tu programa personalizado de 28 días y lo consultas en el portal Dietavity. Puedes elegir comenzar desde hoy hasta 30 días después.',
  post_purchase: 'Después del pago verificado completas tu personalización con la información que nos compartas y luego consultas tu programa en el portal Dietavity.',
  start_date: 'La compra y el inicio son distintos. Puedes elegir comenzar desde hoy hasta 30 días calendario después.',
  personalization: asksAge ? 'Sí, la edad es uno de los datos que se solicitan después del pago durante la personalización, junto con información como tus preferencias y restricciones. Se usa como parte de tu perfil para preparar el programa; Dietavity no sustituye atención médica profesional.' : 'La personalización se realiza después del pago verificado con datos de tu perfil, preferencias y restricciones compatibles con el servicio.',
  portal: 'El programa se consulta en el portal Dietavity después del pago verificado y de completar tu personalización.',
  WhatsApp_assistance: asksDailyMessages ? 'Puedes escribirnos por WhatsApp durante el programa para pedir recetas, ideas de comidas, orientación práctica y opciones en restaurantes. La ayuda es bajo demanda; no se envían mensajes diarios proactivos.' : 'Durante el programa puedes escribirnos por WhatsApp para pedir recetas, ideas de comidas, orientación práctica y opciones en restaurantes.',
  AI: 'Sí. Dietavity es un servicio de alimentación personalizada apoyado por inteligencia artificial. Un nutriólogo humano no elabora individualmente cada programa.',
  privacy: 'Dietavity usa la información que proporcionas durante la personalización para personalizar el programa y debe tratarla conforme al Aviso de Privacidad. No necesitas compartir datos sensibles en esta conversación de ventas.',
  payment_security: 'El pago se completa en el Checkout seguro configurado para Dietavity. No compartas datos de tarjeta por WhatsApp.',
  refund: 'No tengo una política pública de reembolso aprobada para citar. Escríbenos a soporte@dietavity.com para que revisemos tu caso sin inventar condiciones.',
  diet_support: 'Durante la personalización puedes indicar preferencias y restricciones compatibles con la personalización disponible.',
  allergies: 'Durante la personalización puedes proporcionar alergias relevantes. Dietavity no sustituye atención médica; si existe riesgo de una reacción, busca orientación profesional apropiada.',
  health_scope: 'Durante la personalización puedes proporcionar condiciones relevantes, pero Dietavity no diagnostica, trata enfermedades ni sustituye atención médica o profesional apropiada.',
  product_scope: 'Dietavity ofrece un programa personalizado de 28 días con desayuno, comida, cena y snack, consultado en el portal, más ayuda bajo demanda por WhatsApp durante el programa.'
};
let output = generated;
if (decision.strategy === 'answer_question' && deterministicTopic[decision.topic]) output = deterministicTopic[decision.topic];
if (decision.strategy === 'answer_question' && decision.next_last_question_type === 'purchase_confirmation' && !/[?¿]/.test(output)) output += '\\n¿Quieres que te envíe el enlace?';
if (decision.strategy === 'discovery' || decision.strategy === 'explain_offer' || decision.strategy === 'graceful_close' || decision.strategy === 'deferred') output = fallback[decision.strategy];
if (decision.strategy === 'clarify' || decision.strategy === 'show_example') output = fallback[decision.strategy];
if (decision.strategy === 'conversational' && decision.next_last_question_type === 'show_example') output = 'Gracias por compartirlo. En Dietavity podemos orientar tu programa de 28 días hacia ese objetivo con comidas prácticas y variadas.\\n¿Quieres que te muestre un ejemplo ilustrativo de cómo podría verse uno de tus días?';
if (decision.strategy === 'handle_objection' && decision.buyer_signal === 'objection_price') output = 'Entiendo. Son $149 MXN en un solo pago por un programa personalizado de 28 días, así que equivale a poco más de $5 MXN por día. No hay mensualidad ni renovación automática.';
const outputQuestions = (String(output || '').match(/\\?/g) || []).length;
const outputProhibited = /\\$\\s*99|99\\s*MXN|al mes|suscr[ií]b|planes? de 7 d[ií]as.*actualiz/i.test(String(output || ''));
if (!output || outputQuestions > decision.max_questions || outputProhibited || internalOfferVersion.test(String(output || '')) || unsupportedPersonalizationClaim.test(String(output || ''))) output = fallback[decision.strategy] || fallback.conversational;
return [{ json: { ...decision, output } }];`,
  'Fail-safe response validator: maximum one question and no obsolete subscription/price claims.',
);

byName('Respond to Chat').parameters.message = '={{ $json.output }}';

const persistResponse = pg(
  'Persist Sales Response State and Events', [71136, 49888],
  `WITH decision AS (
  SELECT $1::jsonb AS payload
), updated_session AS (
  UPDATE public.onboarding_sessions AS session
  SET conversation_stage = CASE WHEN decision.payload->>'pending_action' = 'close' THEN 'closed' ELSE decision.payload->>'conversation_stage' END,
      goal = COALESCE(NULLIF(decision.payload->>'goal', ''), session.goal),
      last_question_type = NULLIF(decision.payload->>'next_last_question_type', ''),
      last_question_at = CASE WHEN NULLIF(decision.payload->>'next_last_question_type', '') IS NULL THEN NULL ELSE NOW() END,
      offer_version = CASE WHEN decision.payload->>'next_last_question_type' = 'purchase_confirmation' THEN '28d-149-v1' ELSE session.offer_version END,
      commercial_context_expires_at = CASE WHEN decision.payload->>'next_last_question_type' = 'purchase_confirmation' THEN NOW() + INTERVAL '30 minutes' ELSE NULL END,
      updated_at = NOW()
  FROM decision
  WHERE session.session_id = decision.payload->>'session_id'
    AND decision.payload->>'pending_action' IN ('respond', 'close')
  RETURNING session.*
), event_names AS (
  SELECT DISTINCT jsonb_array_elements_text(decision.payload->'events') AS event_type
  FROM decision
  WHERE decision.payload->>'pending_action' IN ('respond', 'close')
), inserted_events AS (
  INSERT INTO public.sales_funnel_events (
    session_id, event_type, event_key, buyer_signal, topic, strategy,
    offer_version, metadata
  )
  SELECT
    updated_session.session_id,
    event_names.event_type,
    CASE
      WHEN event_names.event_type IN ('meaningful_engagement', 'offer_presented')
        THEN event_names.event_type || ':' || updated_session.session_id || CASE WHEN event_names.event_type = 'offer_presented' THEN ':28d-149-v1' ELSE '' END
      ELSE event_names.event_type || ':' || updated_session.session_id || ':' || (SELECT payload->>'inbound_message_sid' FROM decision)
    END,
    (SELECT payload->>'buyer_signal' FROM decision),
    NULLIF((SELECT payload->>'topic' FROM decision), ''),
    (SELECT payload->>'strategy' FROM decision),
    CASE WHEN event_names.event_type = 'offer_presented' THEN '28d-149-v1' ELSE NULL END,
    '{}'::jsonb
  FROM updated_session CROSS JOIN event_names
  ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
)
SELECT * FROM updated_session;`,
  'Runs after Twilio accepts the response. It creates 30-minute purchase context only when purchase_confirmation was actually sent and emits response-dependent funnel events.',
);
persistResponse.parameters.options.queryReplacement = "={{ JSON.stringify($('Validate Sales Response Contract').item.json) }}";

const scheduleReminder = node(
  'Schedule Requested WhatsApp Reminder', 'n8n-nodes-base.httpRequest', [69648, 49472],
  {
    method: 'POST',
    url: '=https://api.twilio.com/2010-04-01/Accounts/{{ $env.TWILIO_ACCOUNT_SID }}/Messages.json',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'twilioApi',
    sendBody: true,
    contentType: 'form-urlencoded',
    bodyParameters: { parameters: [
      { name: 'To', value: "=whatsapp:{{ $('Set Session Id').item.json.session_id }}" },
      { name: 'MessagingServiceSid', value: '={{ $env.TWILIO_MESSAGING_SERVICE_SID }}' },
      { name: 'ScheduleType', value: 'fixed' },
      { name: 'SendAt', value: "={{ $('Apply Deterministic Commercial Policy').item.json.reminder_scheduled_for }}" },
      { name: 'ContentSid', value: '={{ $env.TWILIO_SALES_REMINDER_CONTENT_SID }}' },
    ] }, options: {},
  },
  { typeVersion: 4.3, credentials: twilioCredentials, notes: 'Fail-closed approved-template scheduling. Requires configured TWILIO_MESSAGING_SERVICE_SID and approved TWILIO_SALES_REMINDER_CONTENT_SID; no free-form proactive message.' },
);

const validateScheduled = code(
  'Validate Scheduled Reminder', [70000, 49472],
  `const response = $input.first().json;
if (response.status !== 'scheduled' || !/^(SM|MM)[0-9a-fA-F]{32}$/.test(String(response.sid || ''))) {
  throw new Error('Twilio did not confirm a scheduled reminder');
}
return [{ json: { ...$('Apply Deterministic Commercial Policy').item.json, reminder_message_sid: response.sid, output: 'Claro 😊 Te enviaré un recordatorio en la fecha que pediste.' } }];`,
  'A reminder is never acknowledged unless Twilio returns status=scheduled and a valid Message SID.',
);

const persistReminder = pg(
  'Persist Requested Reminder', [70320, 49472],
  `WITH decision AS (SELECT $1::jsonb AS payload), updated_session AS (
  UPDATE public.onboarding_sessions AS session
  SET reminder_requested_at = NOW(),
      reminder_scheduled_for = (decision.payload->>'reminder_scheduled_for')::timestamptz,
      reminder_message_sid = decision.payload->>'reminder_message_sid',
      last_question_type = NULL, last_question_at = NULL,
      commercial_context_expires_at = NULL, updated_at = NOW()
  FROM decision
  WHERE session.session_id = decision.payload->>'session_id'
    AND decision.payload->>'pending_action' = 'schedule_requested_reminder'
    AND decision.payload->>'reminder_message_sid' ~ '^(SM|MM)[0-9a-fA-F]{32}$'
  RETURNING session.*
), inserted_event AS (
  INSERT INTO public.sales_funnel_events (session_id, event_type, event_key, buyer_signal, strategy, metadata)
  SELECT session_id, 'reminder_requested', 'reminder_requested:' || reminder_message_sid,
    'deferred_interest', 'reminder', jsonb_build_object('message_sid', reminder_message_sid, 'scheduled_for', reminder_scheduled_for)
  FROM updated_session ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
), engagement_event AS (
  INSERT INTO public.sales_funnel_events (session_id, event_type, event_key, buyer_signal, strategy, metadata)
  SELECT session_id, 'meaningful_engagement', 'meaningful_engagement:' || session_id,
    '{{ $('Apply Deterministic Commercial Policy').item.json.buyer_signal }}', 'reminder', '{}'::jsonb
  FROM updated_session ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
)
SELECT * FROM updated_session;`,
  'Persists one approved scheduled reminder only after Twilio confirmation. No automatic second follow-up.',
);
persistReminder.parameters.options.queryReplacement = "={{ JSON.stringify($('Validate Scheduled Reminder').item.json) }}";

const reminderResponse = node(
  'Confirm Requested Reminder', 'n8n-nodes-base.twilio', [70640, 49472],
  {
    from: '+18158698400',
    to: "={{ $('Set Session Id').item.json.session_id }}",
    toWhatsapp: true,
    message: "={{ $('Validate Scheduled Reminder').item.json.output }}",
    options: {},
  }, { typeVersion: 1, credentials: twilioCredentials },
);

workflow.nodes.push(
  salesKnowledge, initializeLead, classifier, classifierModel, parser, policyNode,
  actionSwitch, persistAuthorization, persistCheckoutCreated, persistCheckoutSent,
  responsePrompt, responseAgent, responseModel, validateResponse, persistResponse,
  scheduleReminder, validateScheduled, persistReminder, reminderResponse,
);

workflow.connections['If Existing Onboarding Session'] = {
  main: [
    [{ node: 'Build Canonical Dietavity Knowledge', type: 'main', index: 0 }],
    [{ node: 'Initialize Sales Lead v3', type: 'main', index: 0 }],
  ],
};
workflow.connections['Initialize Sales Lead v3'] = { main: [[{ node: 'Build Canonical Dietavity Knowledge', type: 'main', index: 0 }]] };
workflow.connections['Build Canonical Dietavity Knowledge'] = { main: [[{ node: 'Interpret Sales Buyer Signal', type: 'main', index: 0 }]] };
workflow.connections['Sales Interpretation Model'] = { ai_languageModel: [[{ node: 'Interpret Sales Buyer Signal', type: 'ai_languageModel', index: 0 }]] };
workflow.connections['Interpret Sales Buyer Signal'] = { main: [[{ node: 'Parse Sales Interpretation', type: 'main', index: 0 }]] };
workflow.connections['Parse Sales Interpretation'] = { main: [[{ node: 'Apply Deterministic Commercial Policy', type: 'main', index: 0 }]] };
workflow.connections['Apply Deterministic Commercial Policy'] = { main: [[{ node: 'Route Authorized Sales Action', type: 'main', index: 0 }]] };
workflow.connections['Route Authorized Sales Action'] = { main: [
  [{ node: 'Persist Checkout Authorization v3', type: 'main', index: 0 }],
  [{ node: 'Schedule Requested WhatsApp Reminder', type: 'main', index: 0 }],
  [{ node: 'Build Constrained Sales Response', type: 'main', index: 0 }],
  [{ node: 'Build Constrained Sales Response', type: 'main', index: 0 }],
  [{ node: 'Build Constrained Sales Response', type: 'main', index: 0 }],
] };
workflow.connections['Persist Checkout Authorization v3'] = { main: [[{ node: 'Add whatsapp_id', type: 'main', index: 0 }]] };
workflow.connections['LIVE Stripe Checkout Session Payment'] = { main: [[{ node: 'Persist Checkout Session Evidence v3', type: 'main', index: 0 }]] };
workflow.connections['Persist Checkout Session Evidence v3'] = { main: [[{ node: 'Message with Stripe Payment URL', type: 'main', index: 0 }]] };
workflow.connections['Respond to Chat Subscription'] = { main: [[{ node: 'Mark Checkout Sent v3', type: 'main', index: 0 }]] };
workflow.connections['Mark Checkout Sent v3'] = { main: [[]] };
workflow.connections['Build Constrained Sales Response'] = { main: [[{ node: 'Generate Sales Response v3', type: 'main', index: 0 }]] };
workflow.connections['Sales Response Model'] = { ai_languageModel: [[{ node: 'Generate Sales Response v3', type: 'ai_languageModel', index: 0 }]] };
workflow.connections['Generate Sales Response v3'] = { main: [[{ node: 'Validate Sales Response Contract', type: 'main', index: 0 }]] };
workflow.connections['Validate Sales Response Contract'] = { main: [[{ node: 'Respond to Chat', type: 'main', index: 0 }]] };
workflow.connections['Respond to Chat'] = { main: [[{ node: 'Persist Sales Response State and Events', type: 'main', index: 0 }]] };
workflow.connections['Persist Sales Response State and Events'] = { main: [[]] };
workflow.connections['Schedule Requested WhatsApp Reminder'] = { main: [[{ node: 'Validate Scheduled Reminder', type: 'main', index: 0 }]] };
workflow.connections['Validate Scheduled Reminder'] = { main: [[{ node: 'Persist Requested Reminder', type: 'main', index: 0 }]] };
workflow.connections['Persist Requested Reminder'] = { main: [[{ node: 'Confirm Requested Reminder', type: 'main', index: 0 }]] };
workflow.connections['Confirm Requested Reminder'] = { main: [[]] };

// Preserve chat memory for conversational context, while authorization uses only
// structured session evidence. Attach it only to response generation, not policy.
workflow.connections['Postgres Chat Memory'] = { ai_memory: [[{ node: 'Generate Sales Response v3', type: 'ai_memory', index: 0 }]] };

// Shared prompt contracts for every meal-capable AI node.
const mealKnowledge = knowledge.MEAL_PROMPT_KNOWLEDGE;
byName('Build Nutrition Prompt').parameters.jsCode = byName('Build Nutrition Prompt').parameters.jsCode
  .replace('const prompt = `', 'const prompt = ' + JSON.stringify(mealKnowledge) + ' + `\\n\\n` + `');
byName('Build Regeneration Prompt').parameters.jsCode = byName('Build Regeneration Prompt').parameters.jsCode
  .replace('const prompt = `', 'const prompt = ' + JSON.stringify(mealKnowledge) + ' + `\\n\\n` + `');
byName('Build Weekly Update Prompt').parameters.jsCode = byName('Build Weekly Update Prompt').parameters.jsCode
  .replace('const system_message = `', 'const system_message = ' + JSON.stringify(mealKnowledge) + ' + `\\n\\n` + `')
  .replace('Eres la nutricionista de Dietavity.\n\n', '');
byName('Meal Plan Swap Chat Completions').parameters.jsonBody = byName('Meal Plan Swap Chat Completions').parameters.jsonBody
  .replace('Eres una nutricionista experta en planificación alimentaria.\n\n', `${mealKnowledge.replace(/`/g, '\\`')}\n\n`);
byName('Meal Plan Swap Chat Completions').notes = 'Ticket 8: executable system content inherits the canonical Dietavity Role & Identity, food philosophy, localization, and meal-generation rules.';
byName('Dietavity Nutrition Model').parameters.responses.values[0].content = `${mealKnowledge}\n\n# Responsabilidad específica del asistente pagado\nLa PWA y el portal son la fuente de verdad del perfil, programa, semanas, comidas, cambios persistidos y lista del súper. WhatsApp ayuda bajo demanda. Nunca generes ni prometas un programa paralelo ni afirmes que cambiaste datos persistidos.\n\n# Estilo\nResponde en español, de forma breve y con máximo una pregunta.`;

// Verified purchase -> linkage and retry-safe purchase_completed in the same DB transaction.
const purchaseNode = byName('Resolve User and Persist Purchase');
purchaseNode.parameters.query = purchaseNode.parameters.query.replace(
  ')\nSELECT\n  resolved_user.id AS user_id,',
  `), linked_funnel AS (
  UPDATE public.sales_funnel_events AS event
  SET user_id = resolved_user.id
  FROM resolved_user, input
  WHERE event.session_id = input.payload->>'whatsapp_id'
    AND event.user_id IS NULL
  RETURNING event.id
), purchase_event AS (
  INSERT INTO public.sales_funnel_events (
    session_id, user_id, event_type, event_key, offer_version, metadata
  )
  SELECT
    input.payload->>'whatsapp_id', resolved_user.id,
    'purchase_completed',
    'purchase_completed:' || resolved_purchase.stripe_checkout_session_id,
    '28d-149-v1',
    jsonb_build_object('checkout_session_id', resolved_purchase.stripe_checkout_session_id)
  FROM input CROSS JOIN resolved_user CROSS JOIN resolved_purchase
  WHERE resolved_purchase.payment_status = 'paid'
  ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
)
SELECT
  resolved_user.id AS user_id,`,
);

// Subscriber is historical only; v3 routing is already bypassed by resolved user.
byName('Mark Onboarding Session Subscriber').parameters.query = byName('Mark Onboarding Session Subscriber').parameters.query
  .replace("onboarding_state = 'subscriber',", "conversation_stage = NULL,");

// Program readiness uses the existing Ticket 3 semantic: personalization program,
// Week 1 planned, and a persisted meal plan. Emit in the same transaction.
const readyNode = byName('Plan New Program Week 1');
readyNode.parameters.query = readyNode.parameters.query.replace(
  'UPDATE programs p\nSET',
  ', updated_program AS (\nUPDATE programs p\nSET',
).replace(
  'RETURNING p.id AS program_id, p.status, p.start_date, p.current_week;',
  `RETURNING p.id AS program_id, p.user_id, p.status, p.start_date, p.current_week
), ready_event AS (
  INSERT INTO public.sales_funnel_events (
    session_id, user_id, event_type, event_key, metadata
  )
  SELECT users.whatsapp_id, updated_program.user_id, 'program_ready',
    'program_ready:' || updated_program.program_id || ':' || '{{ $json.week_id }}',
    jsonb_build_object('program_id', updated_program.program_id, 'week_id', '{{ $json.week_id }}')
  FROM updated_program JOIN public.users ON users.id = updated_program.user_id
  ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
)
SELECT program_id, status, start_date, current_week FROM updated_program;`,
);

fs.writeFileSync(developmentPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, developmentPath)}`);
console.log(`Rollback ${path.relative(root, rollbackPath)}`);
