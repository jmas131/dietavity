'use strict';

// Direct RAG V3 proposition-test authority. The model can identify
// obligations and phrase only these claims; it cannot revive the retired
// 28-day commercial offer.
const GLP1_LIVE_PILOT_CHECKOUT_SUPPRESSED = true;
const FIRST_CONTACT_DISCOVERY_QUESTION = '¿Qué necesitas resolver con tu alimentación ahora?';
const OBSOLETE_CURRENT_PRODUCT_CLAIMS = /(?:\$\s*149|149\s*(?:mxn|pesos?)|28\s*d[ií]as|\b(?:lo|se)\s+consulta\w*.{0,30}\bportal\b|\b(?:accede|ingresa)\w*.{0,30}\bportal\b|desayuno,?\s*comida,?\s*cena\s+y\s*snack|cuatro\s+comidas|checkout)/iu;
const MEDICATION_MANAGEMENT_ADVICE = /\b(?:sube|baja|aumenta|reduce|cambia|ajusta|suspende|inicia)\b.{0,50}\b(?:dosis|medicamento|mg)\b/iu;
const SEMANTIC_CONTEXT_VERSION = 'direct-rag-v3.2b-patch-1';

const FACTS = Object.freeze({
  general_information: ['Dietavity es un asistente de alimentación por WhatsApp para personas que usan GLP-1. Puedes contarme qué has comido, cuánto apetito tienes o qué alimentos tienes disponibles, y te ayudo a decidir qué comer. Puedes probarlo gratis.'],
  how_it_works: ['Por WhatsApp me cuentas tu situación de comida, te doy una recomendación práctica y podemos ajustarla según lo que te funcione. Puedes probarlo gratis.'],
  nutrition_support_request: ['Puedo ayudarte con decisiones prácticas de alimentación según tu apetito, lo que ya comiste o los alimentos que tienes disponibles.'],
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

const INTERPRETER_OBLIGATION_TYPES = Object.freeze(['general_information', 'how_it_works', 'nutrition_support_request', 'food_decision', 'recommendation_feedback', 'price', 'delivery_channel', 'glp1_scope', 'medical_boundary', 'purchase_intent', 'acknowledgement', 'unsupported']);
const OBLIGATION_TYPE_CONTRACT = Object.freeze(Object.fromEntries(INTERPRETER_OBLIGATION_TYPES.map(type => [type, type === 'unsupported' ? 'bounded_unknown' : 'resolved'])));
const SUBJECTS = new Set(INTERPRETER_OBLIGATION_TYPES);
// Accepted only by the source-level compatibility seam used by existing V3.1
// resolver tests. The interpreter/parser taxonomy deliberately does not emit it.
const LEGACY_RESOLVER_OBLIGATION_TYPES = new Set(['food_context']);
function copy(value) { return structuredClone(value); }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function normalized(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase(); }
function canonical(value) { return String(value || '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('es-MX'); }

function extractSemanticContext(message, history = [], interpreterContext = {}) {
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  const foodTerms = [
    ['huevos', /\bhuevos?\b/u], ['pollo', /\bpollo\b/u], ['tortillas', /\btortillas?\b/u],
    ['aguacate', /\baguacate\b/u], ['pechuga', /\bpechuga\b/u],
    ['verduras', /\b(?:vegetales|verduras?)\b/u], ['arroz', /\barroz\b/u],
    ['pescado', /\bpescado\b/u], ['carne', /\bcarne\b/u], ['leche', /\bleche\b/u],
    ['fruta', /\bfrutas?\b/u], ['tocino', /\btocino\b/u], ['cafe', /\bcafe\b/u],
  ];
  const foods = value => foodTerms.filter(([, pattern]) => pattern.test(value)).map(([food]) => food);
  const unique = values => [...new Set(values)];
  const isNegatedAt = (value, index) => /\b(?:no|nunca|jamas)\s+(?:(?:ya|me)\s+)?(?:me\s+)?$/u.test(value.slice(Math.max(0, index - 40), index));
  // Food assertions can have mixed polarity within one clause ("pollo y no
  // verduras"). Keep that polarity with the individual food rather than
  // assigning a truth value to the entire verb phrase.
  const affirmativeFoods = (value, baseNegated = false) => baseNegated ? [] : foodTerms
    .filter(([, pattern]) => {
      const match = pattern.exec(value);
      if (!match) return false;
      const prefix = value.slice(0, match.index);
      return !/(?:^|\b(?:y|pero|ni)\b|[,;])\s*(?:no|ni)\s*$/u.test(prefix);
    })
    .map(([food]) => food);
  const sentenceIsQuestionAt = (value, index) => {
    const start = Math.max(value.lastIndexOf('.', index), value.lastIndexOf('!', index), value.lastIndexOf('?', index), value.lastIndexOf(';', index)) + 1;
    const endCandidates = [value.indexOf('.', index), value.indexOf('!', index), value.indexOf('?', index), value.indexOf(';', index)].filter(position => position >= 0);
    const end = endCandidates.length ? Math.min(...endCandidates) + 1 : value.length;
    return /[¿?]/u.test(value.slice(start, end));
  };
  const segmentAfter = (value, index, boundary) => value.slice(index).split(boundary, 1)[0];
  const contextual_rejection = /\bno se me antoja|no quiero|no me apetece\b/u.test(text);
  const eventMatches = [
    ['consumed', /\b(?:ya\s+)?(?:me\s+)?(?:comi|desayune|cene|almorce|merende)\b/gu],
    ['prepared', /\b(?:me\s+)?prepare\b/gu],
  ];
  const recent_food_events = [];
  for (const [kind, pattern] of eventMatches) {
    for (const match of text.matchAll(pattern)) {
      if (!isNegatedAt(text, match.index) && !sentenceIsQuestionAt(text, match.index)) {
        const eventClause = segmentAfter(text, match.index, /\b(?:pero|aunque)\b|\by\s+(?=(?:tengo|hay|cuento|dispongo)\b)|[.!?;]/u);
        const assertedFoods = affirmativeFoods(eventClause);
        if (assertedFoods.length) recent_food_events.push({ kind, foods: assertedFoods, evidence: match[0] });
      }
    }
  }
  // A bare meal-position phrase is ambiguous and often future-facing. Keep the
  // legacy descriptive "de desayuno" form only when it is a food description,
  // not a question or planning statement; all other food events need a past or
  // present event verb above.
  const descriptiveMealPosition = /\bde\s+(?:el\s+|la\s+)?(?:desayuno|comida|cena)\b/u;
  const planningOrQuestion = /[?¿]|\b(?:quiero|quisiera|voy\s+a|puedo|recomiendas?|preparar)\b/u;
  if (descriptiveMealPosition.test(text) && !recent_food_events.length && !planningOrQuestion.test(text)) recent_food_events.push({ kind: 'consumed', foods: foods(text), evidence: text.match(descriptiveMealPosition)[0] });
  const explicitlyAvailable = [];
  const availabilityAnchor = /\b(?:tengo(?:\s+disponibles?)?|hay|cuento\s+con|dispongo\s+de)\b/gu;
  for (const match of text.matchAll(availabilityAnchor)) {
    if (sentenceIsQuestionAt(text, match.index)) continue;
    const availabilityClause = segmentAfter(text, match.index + match[0].length, /\b(?:pero|aunque)\b|\by\s+(?=(?:tengo|hay|cuento|dispongo)\b)|[.!?;]/u);
    explicitlyAvailable.push(...affirmativeFoods(availabilityClause, isNegatedAt(text, match.index)));
  }
  const recentQuestion = String(history.at?.(-1)?.role === 'assistant' ? history.at(-1).text : '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  const askedForAvailability = /(?:que|cuales?)\s+(?:alimentos|comida|ingredientes)[^?]{0,100}(?:tienes|hay|disponibles?)/u.test(recentQuestion);
  const bareFoods = foods(text);
  const inferredAvailable = recent_food_events.length === 0 && explicitlyAvailable.length === 0
    && !contextual_rejection && askedForAvailability && !/[?¿]/u.test(text) ? bareFoods : [];
  const glp1Medication = /\b(?:glp[ -]?1|mounjaro|ozempic|semaglutida|tirzepatida)\b/u;
  const hasCurrentPersonalGlp1Usage = value => {
    const usage = /\b(?:uso|estoy\s+usando|me\s+(?:estan\s+)?inyect(?:an|ando)|me\s+inyecto|tomo|recibo)\b/gu;
    if (!glp1Medication.test(value)) return false;
    for (const match of value.matchAll(usage)) if (!isNegatedAt(value, match.index)) return true;
    return false;
  };
  const currentGlp1Mentioned = glp1Medication.test(text);
  const currentGlp1Usage = hasCurrentPersonalGlp1Usage(text);
  const priorGlp1Usage = Array.isArray(history) && history.some(item => item?.role === 'customer' && hasCurrentPersonalGlp1Usage(String(item.text || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()));
  const priorGlp1Mentioned = Array.isArray(history) && history.some(item => item?.role === 'customer' && glp1Medication.test(String(item.text || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()));
  const professionalMentioned = /\b(?:nutriologa|nutriologo|medic[oa]|profesional)\b/u.test(text);
  const dissatisfactionReported = professionalMentioned && /\b(?:no tiene idea|no sabe|no entiende|no conoce)\b/u.test(text);
  const requestedEvidence = typeof interpreterContext?.recommendation_request_evidence === 'string' && message.includes(interpreterContext.recommendation_request_evidence)
    ? interpreterContext.recommendation_request_evidence : null;
  return {
    contract_version: SEMANTIC_CONTEXT_VERSION,
    glp1_context: { mentioned: currentGlp1Mentioned || priorGlp1Mentioned, usage_reported: currentGlp1Usage || priorGlp1Usage, source: currentGlp1Usage ? 'current_turn' : priorGlp1Usage ? 'history' : null },
    food_context: {
      available_foods: unique(explicitlyAvailable.length ? explicitlyAvailable : inferredAvailable),
      recent_food_events,
      recently_consumed: unique(recent_food_events.filter(event => event.kind === 'consumed').flatMap(event => event.foods)),
      appetite_observation: /\bpoco apetito|no tengo hambre|poca hambre\b/u.test(text) ? { kind: 'low', evidence: 'current_turn' } : /\bmucha hambre\b/u.test(text) && /\bcomo poco\b/u.test(text) ? { kind: 'variable_hunger_with_small_intake', evidence: 'current_turn' } : null,
      contextual_rejection,
    },
    professional_support_context: { mentioned: professionalMentioned, dissatisfaction_reported: dissatisfactionReported },
    recommendation_request: { current_food_decision: Boolean(requestedEvidence), evidence: requestedEvidence },
  };
}

function validateInterpreterSemanticContext(value, currentMessage) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'recommendation_request_evidence')) throw new Error('SEMANTIC_CONTEXT_INVALID');
  if (value.recommendation_request_evidence !== null && value.recommendation_request_evidence !== undefined && (typeof value.recommendation_request_evidence !== 'string' || !currentMessage.includes(value.recommendation_request_evidence))) throw new Error('SEMANTIC_CONTEXT_INVALID');
  return value.recommendation_request_evidence ? { recommendation_request_evidence: value.recommendation_request_evidence } : {};
}

// The interpreter is probabilistic, but a standalone request for help after a
// confirmed GLP-1 disclosure has one bounded response obligation. Reconcile
// only classifications that carry no independent material work; medication,
// food-decision, commercial, delivery, and all other stronger obligations win.
function reconcileWeakNutritionSupportObligations(obligations, currentMessage, semanticContext) {
  if (!semanticContext?.glp1_context?.usage_reported || !Array.isArray(obligations) || !obligations.length) return obligations;
  const value = String(currentMessage || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().trim();
  const genericSupportRequest = /^[¿¡\s]*(?:hola[,.!\s]+)?(?:(?:me\s+)?pued(?:e|es|en)\s+ayudar|(?:me\s+)?ayudas?|(?:me\s+)?podrian\s+ayudar(?:me)?|necesito\s+(?:que\s+me\s+)?(?:ayuda|ayudar|ayuden|ayudes)|quisiera\s+ayuda|busco\s+ayuda)(?:\s+(?:con\s+)?(?:mi\s+)?(?:alimentacion|comida|nutricion))?(?:\s+(?:por\s+favor|porfa))?[?!.\s]*$/u;
  const weakTypes = new Set(['general_information', 'acknowledgement', 'unsupported']);
  if (!genericSupportRequest.test(value)) return obligations;
  const material = obligations.filter(obligation => !weakTypes.has(obligation?.type) && obligation?.type !== 'nutrition_support_request');
  if (material.length) return obligations;
  if (obligations.some(obligation => obligation?.type === 'nutrition_support_request')) return obligations.filter(obligation => !weakTypes.has(obligation?.type));
  const evidence = obligations.find(obligation => typeof obligation?.evidence === 'string' && currentMessage.includes(obligation.evidence))?.evidence || currentMessage;
  return [{ type: 'nutrition_support_request', evidence }];
}

function extractFoodContext(message, mostRecentAssistantMessage = '') {
  const context = extractSemanticContext(message, mostRecentAssistantMessage ? [{ role: 'assistant', text: mostRecentAssistantMessage }] : []);
  return {
    recently_consumed: context.food_context.recently_consumed,
    available_foods: context.food_context.available_foods,
    appetite: context.food_context.appetite_observation?.kind === 'low' ? 'low' : null,
    contextual_rejection: context.food_context.contextual_rejection,
  };
}

function foodContextForResolution(semanticContext, message, mostRecentAssistantMessage = '') {
  if (!semanticContext?.food_context) return extractFoodContext(message, mostRecentAssistantMessage);
  return {
    recently_consumed: semanticContext.food_context.recently_consumed || [],
    available_foods: semanticContext.food_context.available_foods || [],
    appetite: semanticContext.food_context.appetite_observation?.kind === 'low' ? 'low' : null,
    contextual_rejection: Boolean(semanticContext.food_context.contextual_rejection),
  };
}

function resolveFoodDecision(message, mostRecentAssistantMessage = '', history = [], semanticContext = null, mayClarifyInventory = true) {
  const context = foodContextForResolution(semanticContext, message, mostRecentAssistantMessage);
  const has = food => context.available_foods.includes(food);
  if (has('huevos') && has('tortillas') && has('aguacate')) return { context, permitted_claims: ['Puedes comer 2 huevos revueltos con una tortilla y un poco de aguacate. Es una porción sencilla si tienes poco apetito.'], clarification_question: null };
  if (has('pollo') && has('tortillas') && has('aguacate')) return { context, permitted_claims: ['Puedes preparar una tortilla con pollo y un poco de aguacate. Usa una porción sencilla y come despacio si todavía tienes poco apetito.'], clarification_question: null };
  if (context.available_foods.length) {
    const lowAppetite = context.appetite === 'low';
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
  const clarification_question = mayClarifyInventory ? '¿Qué alimentos tienes disponibles ahora?' : null;
  if (context.contextual_rejection) return { context, permitted_claims: [`Entiendo, buscamos otra cosa para este momento.${clarification_question ? ` ${clarification_question}` : ''}`], clarification_question };
  if (context.appetite === 'low') return { context, permitted_claims: [`Si tienes poco apetito, empieza con una porción pequeña que aporte proteína.${clarification_question ? ` ${clarification_question}` : ''}`], clarification_question };
  return { context, permitted_claims: [clarification_question ? `Para recomendarte algo concreto, ${clarification_question}` : 'Entiendo. Cuando quieras decidir qué comer, puedo ayudarte con una opción práctica.'], clarification_question };
}

function nutritionSupportClaim(semanticContext) {
  if (semanticContext?.professional_support_context?.dissatisfaction_reported) return 'Entiendo que buscas apoyo claro para tus decisiones de alimentación. Puedo ayudarte por aquí con decisiones prácticas de comida; no sustituyo atención médica ni doy indicaciones sobre medicamentos.';
  if (semanticContext?.glp1_context?.usage_reported) return 'Sí. Puedo ayudarte con decisiones de alimentación mientras usas GLP-1: qué comer según tu apetito, lo que ya comiste o los alimentos que tienes disponibles. No doy indicaciones sobre dosis ni sobre el medicamento.';
  return 'Puedo ayudarte con decisiones prácticas de alimentación según tu apetito, lo que ya comiste o los alimentos que tienes disponibles.';
}

function contextualSemanticClaim(semanticContext) {
  if (semanticContext?.professional_support_context?.dissatisfaction_reported) return nutritionSupportClaim(semanticContext);
  if (semanticContext?.food_context?.appetite_observation?.kind === 'variable_hunger_with_small_intake') return 'Entiendo que por momentos tienes mucha hambre y cuando comes, comes poco. Puedo ayudarte a pensar una siguiente comida de forma práctica, sin ajustar medicamentos.';
  const event = semanticContext?.food_context?.recent_food_events?.[0];
  if (event?.kind === 'prepared' && event.foods?.length) return `Entiendo: preparaste una comida con ${event.foods.join(', ')}.`;
  if (event?.kind === 'consumed' && event.foods?.length) return `Gracias por contarme lo que comiste: ${event.foods.join(', ')}.`;
  return null;
}

function permitsFirstContactDiscoveryQuestion(context, obligations) {
  return Array.isArray(obligations) && obligations.length === 1 && obligations[0]?.type === 'general_information' && (!Array.isArray(context?.history) || context.history.length === 0) && !String(context?.most_recent_assistant_message || '').trim();
}

function buildConversationContext({ currentMessage, history = [], recentAssistantMessage = '', customerState = {}, sessionId, offerVersion = 'glp1-whatsapp-free-test-v3' }) {
  if (typeof currentMessage !== 'string' || !currentMessage.trim() || typeof sessionId !== 'string' || !sessionId) throw new Error('CONVERSATION_CONTEXT_INVALID');
  const safeHistory = Array.isArray(history) ? history.slice(-12).map(item => ({ role: item.role === 'assistant' ? 'assistant' : 'customer', text: String(item.text || '').slice(0, 1000) })) : [];
  const current_message = currentMessage.trim().slice(0, 2000);
  const most_recent_assistant_message = String(recentAssistantMessage || '').slice(0, 1500);
  const semanticHistory = most_recent_assistant_message && safeHistory.at(-1)?.text !== most_recent_assistant_message ? [...safeHistory, { role: 'assistant', text: most_recent_assistant_message }] : safeHistory;
  return Object.freeze({ contract_version: 'direct-rag-v3-proposition-test', locale: 'es-MX', session_id: sessionId, current_message, history: safeHistory, most_recent_assistant_message, semantic_context: extractSemanticContext(current_message, semanticHistory), customer_state: copy(customerState), commercial_state: { purchase_context: false, checkout_suppressed: true }, offer_version: offerVersion });
}

function validateObligations(value, currentMessage) {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw new Error('OBLIGATIONS_INVALID');
  return value.map((item, index) => {
    if (!plain(item) || (!SUBJECTS.has(item.type) && !LEGACY_RESOLVER_OBLIGATION_TYPES.has(item.type)) || typeof item.evidence !== 'string' || !currentMessage.includes(item.evidence)) throw new Error('OBLIGATIONS_INVALID');
    return { id: `o-${index + 1}`, type: item.type, evidence: item.evidence };
  });
}

function resolveObligations({ context, obligations }) {
  const semanticHistory = context.most_recent_assistant_message && context.history?.at(-1)?.text !== context.most_recent_assistant_message ? [...(context.history || []), { role: 'assistant', text: context.most_recent_assistant_message }] : context.history;
  const semantic_context = context.semantic_context || extractSemanticContext(context.current_message, semanticHistory);
  const hasCurrentFoodDecision = obligations.some(obligation => obligation.type === 'food_decision');
  const hasLegacyFoodContext = obligations.some(obligation => obligation.type === 'food_context');
  const hasFoodResolution = hasCurrentFoodDecision || hasLegacyFoodContext || obligations.some(obligation => obligation.type === 'recommendation_feedback');
  const foodDecision = hasFoodResolution ? resolveFoodDecision(context.current_message, context.most_recent_assistant_message, context.history, semantic_context, hasCurrentFoodDecision || hasLegacyFoodContext) : null;
  const contextualClaim = contextualSemanticClaim(semantic_context);
  const semanticFallbackAllowed = obligations.length === 1 && obligations[0]?.type === 'unsupported';
  let foodClaimAssigned = false;
  const results = obligations.map(obligation => {
    const food = ['food_decision', 'food_context', 'recommendation_feedback'].includes(obligation.type);
    const permitted_claims = food && !foodClaimAssigned ? foodDecision.permitted_claims : food ? [] : obligation.type === 'nutrition_support_request' ? [nutritionSupportClaim(semantic_context)] : obligation.type === 'unsupported' && semanticFallbackAllowed && contextualClaim ? [contextualClaim] : obligation.type === 'delivery_channel' ? [deliveryChannelFact(context.current_message)] : copy(FACTS[obligation.type] || FACTS.unsupported);
    if (food) foodClaimAssigned = true;
    return { obligation: copy(obligation), resolution: obligation.type === 'unsupported' ? 'bounded_unknown' : 'resolved', permitted_claims, ...(food ? { food_context: copy(foodDecision.context) } : {}), prohibited_or_boundary_claims: ['obsolete_28_day_offer', 'portal_access', 'price_149', 'four_meal_product', 'checkout', ...(obligation.type === 'medical_boundary' ? ['medication_management_advice'] : []), ...(obligation.type === 'glp1_scope' ? ['medication_sale_delivery_or_prescription'] : [])], action_authorization: null, ...(obligation.type === 'purchase_intent' ? { checkout_suppressed_reason: 'proposition_test_no_checkout' } : {}) };
  });
  const discovery = permitsFirstContactDiscoveryQuestion(context, obligations);
  const clarification_question = discovery ? null : hasCurrentFoodDecision || hasLegacyFoodContext ? foodDecision?.clarification_question || null : null;
  const required_questions = discovery ? [FIRST_CONTACT_DISCOVERY_QUESTION] : clarification_question ? [clarification_question] : [];
  return { semantic_context: copy(semantic_context), resolved_obligations: results, permitted_claims: [...results.flatMap(item => item.permitted_claims), ...(discovery ? [FIRST_CONTACT_DISCOVERY_QUESTION] : [])], authorized_action: null, checkout_suppressed_reason: results.find(item => item.checkout_suppressed_reason)?.checkout_suppressed_reason || null, conversation_policy: { discovery_question_authorized: discovery, food_clarification_authorized: Boolean(clarification_question), clarification_question, required_questions }, checkout_question_response: null };
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

module.exports = { FACTS, INTERPRETER_OBLIGATION_TYPES, OBLIGATION_TYPE_CONTRACT, GLP1_LIVE_PILOT_CHECKOUT_SUPPRESSED, FIRST_CONTACT_DISCOVERY_QUESTION, OBSOLETE_CURRENT_PRODUCT_CLAIMS, SEMANTIC_CONTEXT_VERSION, buildConversationContext, extractSemanticContext, validateInterpreterSemanticContext, reconcileWeakNutritionSupportObligations, extractFoodContext, foodContextForResolution, resolveFoodDecision, nutritionSupportClaim, contextualSemanticClaim, permitsFirstContactDiscoveryQuestion, deliveryChannelFact, validateObligations, resolveObligations, buildCompositionEnvelope, gateResponse };
