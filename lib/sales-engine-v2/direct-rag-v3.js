'use strict';

// Direct RAG V3 proposition-test authority. The model can identify
// obligations and phrase only these claims; it cannot revive the retired
// 28-day commercial offer.
const GLP1_LIVE_PILOT_CHECKOUT_SUPPRESSED = true;
const FIRST_CONTACT_DISCOVERY_QUESTION = '¿Qué necesitas resolver con tu alimentación ahora?';
const OBSOLETE_CURRENT_PRODUCT_CLAIMS = /(?:\$\s*149|149\s*(?:mxn|pesos?)|28\s*d[ií]as|\b(?:lo|se)\s+consulta\w*.{0,30}\bportal\b|\b(?:accede|ingresa)\w*.{0,30}\bportal\b|desayuno,?\s*comida,?\s*cena\s+y\s*snack|cuatro\s+comidas|checkout)/iu;
const MEDICATION_MANAGEMENT_ADVICE = /\b(?:sube|baja|aumenta|reduce|cambia|ajusta|suspende|inicia)\b.{0,50}\b(?:dosis|medicamento|mg)\b/iu;

const FACTS = Object.freeze({
  general_information: ['Dietavity es un asistente de alimentación por WhatsApp para personas que usan GLP-1. Puedes contarme qué has comido, cuánto apetito tienes o qué alimentos tienes disponibles, y te ayudo a decidir qué comer. Puedes probarlo gratis.'],
  how_it_works: ['Por WhatsApp me cuentas tu situación de comida, te doy una recomendación práctica y podemos ajustarla según lo que te funcione. Puedes probarlo gratis.'],
  price: ['Actualmente puedes probar Dietavity gratis. Todavía no hay un precio futuro definido.'],
  delivery_channel: ['Dietavity funciona por WhatsApp; no necesitas un portal para usarlo.'],
  glp1_scope: ['Dietavity ofrece apoyo para decidir qué comer; no vende, entrega ni receta medicamentos GLP-1.'],
  medical_boundary: ['No puedo orientarte sobre cambiar, iniciar o suspender una dosis. Consulta al profesional que te la prescribe.'],
  purchase_intent: ['La prueba gratuita está disponible actualmente por WhatsApp. No necesitas completar una compra para probarla.'],
  acknowledgement: ['¡Con gusto! 😊'],
  unsupported: ['No tengo información confirmada para afirmar que Dietavity ofrezca eso.'],
});

function deliveryChannelFact(message) {
  const value = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  if (/\b(?:descarg|instal|bajar)\w*\b/u.test(value)) {
    return 'Dietavity funciona directamente por WhatsApp; no necesitas descargar una app ni entrar a un portal para usarlo.';
  }
  if (/\b(?:este|por este)\s+(?:numero|chat)\b|\baqui\s+(?:mismo|en el chat)\b|\bpor aqui\b/u.test(value)) {
    return 'Sí 😊 Puedes usar Dietavity directamente en este chat de WhatsApp.';
  }
  return 'Dietavity funciona por WhatsApp; no necesitas un portal para usarlo.';
}

const INTERPRETER_OBLIGATION_TYPES = Object.freeze(['general_information', 'how_it_works', 'food_decision', 'food_context', 'recommendation_feedback', 'price', 'delivery_channel', 'glp1_scope', 'medical_boundary', 'purchase_intent', 'acknowledgement', 'unsupported']);
const OBLIGATION_TYPE_CONTRACT = Object.freeze(Object.fromEntries(INTERPRETER_OBLIGATION_TYPES.map(type => [type, type === 'unsupported' ? 'bounded_unknown' : 'resolved'])));
const SUBJECTS = new Set(INTERPRETER_OBLIGATION_TYPES);
function copy(value) { return structuredClone(value); }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function normalized(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase(); }
function canonical(value) { return String(value || '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('es-MX'); }

function extractFoodContext(message, mostRecentAssistantMessage = '') {
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  const foodTerms = [
    ['huevos', /\bhuevos?\b/u], ['pollo', /\bpollo\b/u], ['tortillas', /\btortillas?\b/u],
    ['aguacate', /\baguacate\b/u], ['pechuga', /\bpechuga\b/u],
    ['verduras', /\b(?:vegetales|verduras?)\b/u], ['arroz', /\barroz\b/u],
    ['pescado', /\bpescado\b/u], ['carne', /\bcarne\b/u], ['leche', /\bleche\b/u],
    ['fruta', /\bfrutas?\b/u], ['tocino', /\btocino\b/u], ['cafe', /\bcafe\b/u],
  ];
  const foods = value => foodTerms.filter(([, pattern]) => pattern.test(value)).map(([food]) => food);
  const contextual_rejection = /\bno se me antoja|no quiero|no me apetece\b/u.test(text);
  const explicitConsumed = /\b(?:ya\s+)?(?:me\s+)?(?:comi|desayune|cene|almorce|merende)\b/u.test(text)
    || /\b(?:para|de)\s+(?:el\s+|la\s+)?(?:desayuno|desayunar|comida|comer|cena|cenar)\b/u.test(text)
    || /\bmi\s+(?:desayuno|comida|cena)\b/u.test(text);
  const availableMatch = text.match(/\b(?:tengo(?:\s+disponibles?)?|hay|cuento\s+con|dispongo\s+de)\s+([^.!?]+)/u);
  const explicitlyAvailable = availableMatch ? foods(availableMatch[1]) : [];
  const explicitlyConsumed = explicitConsumed ? foods(text.split(/\bpero\b/u)[0]) : [];
  const recentQuestion = String(mostRecentAssistantMessage || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  const askedForAvailability = /(?:que|cuales?)\s+(?:alimentos|comida|ingredientes)[^?]{0,100}(?:tienes|hay|disponibles?)/u.test(recentQuestion);
  const bareFoods = foods(text);
  const inferredAvailable = explicitlyConsumed.length === 0 && explicitlyAvailable.length === 0
    && !contextual_rejection && askedForAvailability && !/[?¿]/u.test(text) ? bareFoods : [];
  return {
    recently_consumed: explicitlyConsumed,
    available_foods: explicitlyAvailable.length ? explicitlyAvailable : inferredAvailable,
    appetite: /\bpoco apetito|no tengo hambre|poca hambre\b/u.test(text) ? 'low' : null,
    contextual_rejection,
  };
}

function resolveFoodDecision(message, mostRecentAssistantMessage = '', history = []) {
  const context = extractFoodContext(message, mostRecentAssistantMessage);
  const has = food => context.available_foods.includes(food);
  if (has('huevos') && has('tortillas') && has('aguacate')) return { context, permitted_claims: ['Puedes comer 2 huevos revueltos con una tortilla y un poco de aguacate. Es una porción sencilla si tienes poco apetito.'], clarification_question: null };
  if (has('pollo') && has('tortillas') && has('aguacate')) return { context, permitted_claims: ['Puedes preparar una tortilla con pollo y un poco de aguacate. Usa una porción sencilla y come despacio si todavía tienes poco apetito.'], clarification_question: null };
  if (context.available_foods.length) {
    const lastCustomer = Array.isArray(history) ? [...history].reverse().find(item => item?.role === 'customer') : null;
    const lastCustomerText = String(lastCustomer?.text || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
    const lowAppetite = context.appetite === 'low' || /\bpoco apetito|no tengo hambre|poca hambre\b/u.test(lastCustomerText);
    const protein = ['huevos', 'pollo', 'pechuga', 'pescado', 'carne', 'tocino'].find(has);
    const vegetable = has('verduras') ? 'verduras' : null;
    const starch = has('arroz') ? 'arroz' : has('tortillas') ? 'tortilla' : null;
    let meal;
    if (protein) meal = [protein, vegetable ? `con ${vegetable}` : null, !vegetable && starch ? `con ${starch}` : null].filter(Boolean).join(' ');
    else if (vegetable && starch) meal = `${starch} con ${vegetable}`;
    else if (has('leche') && has('fruta')) meal = 'leche con fruta';
    else meal = context.available_foods[0];
    const appetiteNote = lowAppetite ? ' Empieza con una porción pequeña y come despacio.' : '';
    return { context, permitted_claims: [`Con lo que tienes, prepara ${meal}.${appetiteNote}`], clarification_question: null };
  }
  const clarification_question = context.contextual_rejection
    ? '¿Qué alimentos tienes disponibles ahora?'
    : '¿Qué alimentos tienes disponibles ahora?';
  if (context.contextual_rejection) return { context, permitted_claims: [`Entiendo, buscamos otra cosa para este momento. ${clarification_question}`], clarification_question };
  if (context.appetite === 'low') return { context, permitted_claims: [`Si tienes poco apetito, empieza con una porción pequeña que aporte proteína. ${clarification_question}`], clarification_question };
  return { context, permitted_claims: [`Para recomendarte algo concreto, ${clarification_question}`], clarification_question };
}

function permitsFirstContactDiscoveryQuestion(context, obligations) {
  return Array.isArray(obligations) && obligations.length === 1 && obligations[0]?.type === 'general_information' && (!Array.isArray(context?.history) || context.history.length === 0) && !String(context?.most_recent_assistant_message || '').trim();
}

function buildConversationContext({ currentMessage, history = [], recentAssistantMessage = '', customerState = {}, sessionId, offerVersion = 'glp1-whatsapp-free-test-v3' }) {
  if (typeof currentMessage !== 'string' || !currentMessage.trim() || typeof sessionId !== 'string' || !sessionId) throw new Error('CONVERSATION_CONTEXT_INVALID');
  const safeHistory = Array.isArray(history) ? history.slice(-12).map(item => ({ role: item.role === 'assistant' ? 'assistant' : 'customer', text: String(item.text || '').slice(0, 1000) })) : [];
  return Object.freeze({ contract_version: 'direct-rag-v3-proposition-test', locale: 'es-MX', session_id: sessionId, current_message: currentMessage.trim().slice(0, 2000), history: safeHistory, most_recent_assistant_message: String(recentAssistantMessage || '').slice(0, 1500), customer_state: copy(customerState), commercial_state: { purchase_context: false, checkout_suppressed: true }, offer_version: offerVersion });
}

function validateObligations(value, currentMessage) {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw new Error('OBLIGATIONS_INVALID');
  return value.map((item, index) => {
    if (!plain(item) || !SUBJECTS.has(item.type) || typeof item.evidence !== 'string' || !currentMessage.includes(item.evidence)) throw new Error('OBLIGATIONS_INVALID');
    return { id: `o-${index + 1}`, type: item.type, evidence: item.evidence };
  });
}

function resolveObligations({ context, obligations }) {
  const foodDecision = obligations.some(obligation => ['food_decision', 'food_context', 'recommendation_feedback'].includes(obligation.type)) ? resolveFoodDecision(context.current_message, context.most_recent_assistant_message, context.history) : null;
  let foodClaimAssigned = false;
  const results = obligations.map(obligation => {
    const food = ['food_decision', 'food_context', 'recommendation_feedback'].includes(obligation.type);
    const permitted_claims = food && !foodClaimAssigned ? foodDecision.permitted_claims : food ? [] : obligation.type === 'delivery_channel' ? [deliveryChannelFact(context.current_message)] : copy(FACTS[obligation.type] || FACTS.unsupported);
    if (food) foodClaimAssigned = true;
    return { obligation: copy(obligation), resolution: obligation.type === 'unsupported' ? 'bounded_unknown' : 'resolved', permitted_claims, ...(food ? { food_context: copy(foodDecision.context) } : {}), prohibited_or_boundary_claims: ['obsolete_28_day_offer', 'portal_access', 'price_149', 'four_meal_product', 'checkout', ...(obligation.type === 'medical_boundary' ? ['medication_management_advice'] : []), ...(obligation.type === 'glp1_scope' ? ['medication_sale_delivery_or_prescription'] : [])], action_authorization: null, ...(obligation.type === 'purchase_intent' ? { checkout_suppressed_reason: 'proposition_test_no_checkout' } : {}) };
  });
  const discovery = permitsFirstContactDiscoveryQuestion(context, obligations);
  const clarification_question = discovery ? null : foodDecision?.clarification_question || null;
  const required_questions = discovery ? [FIRST_CONTACT_DISCOVERY_QUESTION] : clarification_question ? [clarification_question] : [];
  return { resolved_obligations: results, permitted_claims: [...results.flatMap(item => item.permitted_claims), ...(discovery ? [FIRST_CONTACT_DISCOVERY_QUESTION] : [])], authorized_action: null, checkout_suppressed_reason: results.find(item => item.checkout_suppressed_reason)?.checkout_suppressed_reason || null, conversation_policy: { discovery_question_authorized: discovery, food_clarification_authorized: Boolean(clarification_question), clarification_question, required_questions }, checkout_question_response: null };
}

function buildCompositionEnvelope({ context, resolution }) {
  const required_questions = copy(resolution.conversation_policy?.required_questions || []);
  return Object.freeze({ contract_version: 'direct-rag-v3-proposition-test', current_message: context.current_message, relevant_conversation_context: { history: context.history, most_recent_assistant_message: context.most_recent_assistant_message }, resolved_obligations: copy(resolution.resolved_obligations), permitted_claims: copy(resolution.permitted_claims), response_policy: { locale: 'es-MX', max_questions: required_questions.length, required_questions, question_authorization: { generic_first_contact: Boolean(resolution.conversation_policy?.discovery_question_authorized), food_clarification: Boolean(resolution.conversation_policy?.food_clarification_authorized), authorized_food_clarification_question: resolution.conversation_policy?.clarification_question || null }, unsolicited_purchase_cta: false, action_authorization: null } });
}

function gateResponse({ envelope, response, coveredObligationIds, usedClaims = [] }) {
  if (!plain(envelope) || typeof response !== 'string' || !response.trim() || !Array.isArray(usedClaims)) return { cleared: false, reason: 'STRUCTURE_INVALID' };
  const required = envelope.resolved_obligations.map(item => item.obligation.id);
  if (!Array.isArray(coveredObligationIds) || required.some(id => !coveredObligationIds.includes(id))) return { cleared: false, reason: 'OBLIGATION_COVERAGE_MISSING' };
  if (OBSOLETE_CURRENT_PRODUCT_CLAIMS.test(response)) return { cleared: false, reason: 'OBSOLETE_CURRENT_PRODUCT_CLAIM' };
  if (MEDICATION_MANAGEMENT_ADVICE.test(response)) return { cleared: false, reason: 'MEDICATION_GUIDANCE' };
  const allowed = envelope.permitted_claims.map(canonical);
  if (canonical(response) !== canonical(envelope.permitted_claims.join(' ')) && !allowed.includes(canonical(response))) return { cleared: false, reason: 'UNSUPPORTED_ACTUAL_RESPONSE' };
  const requiredQuestions = envelope.response_policy?.required_questions || [];
  if ((response.match(/\?/gu) || []).length !== requiredQuestions.length || requiredQuestions.some(question => response.split(question).length - 1 !== 1)) return { cleared: false, reason: requiredQuestions.length ? 'REQUIRED_QUESTION_MISSING' : 'UNAUTHORIZED_QUESTION' };
  return { cleared: true, reason: null };
}

module.exports = { FACTS, INTERPRETER_OBLIGATION_TYPES, OBLIGATION_TYPE_CONTRACT, GLP1_LIVE_PILOT_CHECKOUT_SUPPRESSED, FIRST_CONTACT_DISCOVERY_QUESTION, OBSOLETE_CURRENT_PRODUCT_CLAIMS, buildConversationContext, extractFoodContext, resolveFoodDecision, permitsFirstContactDiscoveryQuestion, deliveryChannelFact, validateObligations, resolveObligations, buildCompositionEnvelope, gateResponse };
