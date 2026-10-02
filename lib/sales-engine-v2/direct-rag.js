'use strict';

const productFacts = require('../../config/sales-engine-v2/product-facts.json').facts;
const factValue = key => productFacts.find(fact => fact.fact_key === key)?.value;
const offerPrice = factValue('offer.price');
const offerDuration = factValue('offer.duration_days');
// Temporary live-pilot guard. Remove this one constant and the corresponding
// resolver branch after the manually reviewed GLP-1 traffic pilot.
const GLP1_LIVE_PILOT_CHECKOUT_SUPPRESSED = true;
const PILOT_PURCHASE_CLAIMS = Object.freeze([
  'Estamos abriendo esta modalidad de Dietavity de forma gradual. Te enviaremos por WhatsApp el enlace para completar tu compra.',
  `$${offerPrice.amount} ${offerPrice.currency} · ${offerDuration} días · pago único · sin suscripción.`,
]);

// The production Sales Engine uses these small contracts directly in n8n.  The
// module is deliberately dependency-free so its rules can be reproduced in a
// Code node without giving that node filesystem or network authority.
const FACTS = Object.freeze({
  location: ['Dietavity es un servicio digital.', 'No cuenta con atención presencial ni una sucursal para clientes.'],
  price: [`El programa de ${offerDuration} días cuesta $${offerPrice.amount} ${offerPrice.currency}.`, 'Es un pago único, no una suscripción.'],
  payment_methods: ['Puedes pagar con tarjeta de crédito, tarjeta de débito, OXXO o Apple Pay.'],
  offer_contents: ['El programa incluye desayuno, comida, cena y snack para 28 días.'],
  how_it_works: ['Después del pago verificado completas la personalización.', 'Luego consultas tu programa de 28 días en el portal Dietavity.', 'Puedes elegir iniciar desde ese día y hasta 30 días después.'],
  personalization: ['La personalización se realiza después del pago con la información que compartes en el Setup.'],
  delivery_access: ['El programa se consulta en el portal Dietavity después del pago verificado y de completar la personalización.'],
  glp1_scope: ['Dietavity no vende, entrega ni prescribe medicamentos GLP-1.', 'Dietavity es un servicio de nutrición y programas de comidas.'],
  medical_boundary: ['No puedo orientarte sobre iniciar, suspender o cambiar una dosis de medicamento.', 'Consulta al profesional que te lo prescribió.'],
  acknowledgement: ['¡Con gusto! 😊'],
  unsupported: ['No tengo información confirmada para afirmar que Dietavity ofrezca eso.'],
  objection: [`Entiendo que el precio pueda parecer alto. El programa cuesta $${offerPrice.amount} ${offerPrice.currency} por ${offerDuration} días y es un pago único, sin suscripción.`],
  purchase: PILOT_PURCHASE_CLAIMS,
  // A first-contact answer needs the small, already-approved offer bundle,
  // rather than only a duration definition.  Keep price and a CTA out unless
  // the current message independently creates those obligations.
  general_information: ['Dietavity es un programa personalizado de alimentación de 28 días.', 'Incluye desayuno, comida, cena y snack para cada día.', 'Las comidas se adaptan a tus objetivos y preferencias.'],
  // GLP-1 can be customer context rather than the subject of the question.
  // This is deliberately a non-clinical product-value answer: it makes no
  // claim about the medication, appetite outcomes, or weight loss.
  glp1_nutrition_support: ['Dietavity ayuda a organizar comidas sencillas cuando tienes poco apetito.', 'El programa personalizado de 28 días incluye desayuno, comida, cena y snack, adaptados a tus objetivos y preferencias.'],
  prepared_food: ['Dietavity no entrega comida preparada; ofrece un programa de comidas para consultar en el portal.'],
  post_program: ['El programa actual es de 28 días; no tengo una continuidad automática confirmada para ofrecer.'],
  ai_value: ['Dietavity organiza un programa de comidas de 28 días a partir de la información de personalización; no es una consulta humana individual.'],
  graceful_close: ['Gracias por conocer Dietavity.'],
  deferred: ['Claro, cuando quieras retomarlo puedes escribirnos por aquí.'],
  reminder_request: ['Por ahora no puedo programar recordatorios automáticos, pero puedes escribirnos cuando quieras retomarlo.'],
  trust_credentials: ['Dietavity usa inteligencia artificial; un nutriólogo humano no elabora individualmente cada programa.'],
  human_preference: ['Entiendo tu preferencia; Dietavity no ofrece una consulta individual con un nutriólogo.'],
  portal_support: ['Durante el programa puedes pedir por WhatsApp recetas, ideas de comidas y orientación práctica.'],
  fulfillment: ['Después del pago verificado y de completar la personalización, el programa se consulta en el portal.'],
  support_limits: ['El apoyo por WhatsApp es bajo demanda durante el programa; no se envían mensajes diarios proactivos.'],
  example: ['Un ejemplo ilustrativo puede incluir desayuno, comida, cena y snack; no sustituye tu programa personalizado.'],
  practical_guidance: ['Para una duda de alimentación o medicación, busca orientación profesional adecuada; Dietavity no da tratamiento médico.'],
});

// This is the interpreter's complete public taxonomy. Keep it derived from
// resolver facts so a prompt-only type cannot silently fall into unsupported.
const INTERPRETER_OBLIGATION_TYPES = Object.freeze(Object.keys(FACTS));
const OBLIGATION_TYPE_CONTRACT = Object.freeze(Object.fromEntries(
  INTERPRETER_OBLIGATION_TYPES.map(type => [type, type === 'unsupported' ? 'bounded_unknown' : 'resolved']),
));
const SUBJECTS = new Set(Object.keys(FACTS));
const ACTIONABLE = new Set(['explicit_current_request', 'valid_current_confirmation']);
function copy(value) { return structuredClone(value); }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function practicalGuidance(message) {
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  const guidance = /\bpoco apetito|porciones? pequenas?|comer poco\b/u.test(text) ? ['Prueba una porción pequeña con una proteína y otro componente sencillo: por ejemplo, yogurt natural con fruta, huevo con tortilla, o frijoles con queso y verduras.'] :
    /\bproteina\b/u.test(text) ? ['Como ideas sencillas de proteína puedes elegir huevo, yogurt natural, frijoles, lentejas, pollo, atún o queso, según lo que te resulte práctico.'] : ['Para una comida o snack sencillo, combina una proteína con fruta, verduras, cereal o tortilla según lo que tengas disponible.'];
  if (/\b(?:dosis|medicamento|mg|suspender|iniciar|debo bajar)\b/u.test(text)) guidance.push('Para la parte de medicamentos, consulta al profesional que te lo prescribió.');
  return guidance;
}

function buildConversationContext({ currentMessage, history = [], recentAssistantMessage = '', customerState = {}, commercialState = {}, sessionId, offerVersion = '28d-149-v1' }) {
  if (typeof currentMessage !== 'string' || !currentMessage.trim() || typeof sessionId !== 'string' || !sessionId) throw new Error('CONVERSATION_CONTEXT_INVALID');
  const safeHistory = Array.isArray(history) ? history.slice(-12).map(item => ({ role: item.role === 'assistant' ? 'assistant' : 'customer', text: String(item.text || '').slice(0, 1000) })) : [];
  const expiry = typeof commercialState.commercial_context_expires_at === 'string' ? Date.parse(commercialState.commercial_context_expires_at) : NaN;
  const purchase_context = commercialState.last_question_type === 'purchase_confirmation' && Number.isFinite(expiry) && expiry > Date.now();
  return Object.freeze({ contract_version: 'direct-rag-v2', locale: 'es-MX', session_id: sessionId, current_message: currentMessage.trim().slice(0, 2000), history: safeHistory, most_recent_assistant_message: String(recentAssistantMessage || '').slice(0, 1500), customer_state: copy(customerState), commercial_state: { purchase_context }, offer_version: offerVersion });
}

function validateObligations(value, currentMessage) {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw new Error('OBLIGATIONS_INVALID');
  const ids = new Set();
  return value.map((item, index) => {
    if (!plain(item) || typeof item.type !== 'string' || !SUBJECTS.has(item.type) || typeof item.evidence !== 'string' || !currentMessage.includes(item.evidence)) throw new Error('OBLIGATIONS_INVALID');
    if (item.type === 'purchase' && item.intent !== undefined && (!ACTIONABLE.has(item.intent))) throw new Error('OBLIGATIONS_INVALID');
    const id = `o-${index + 1}`;
    if (ids.has(id)) throw new Error('OBLIGATIONS_INVALID'); ids.add(id);
    // Intent is action-authority syntax only. Descriptive intent emitted for a
    // non-purchase obligation is deliberately discarded, never authorized.
    const obligation = { id, type: item.type, evidence: item.evidence, ...(item.type === 'purchase' && typeof item.intent === 'string' ? { intent: item.intent } : {}) };
    return obligation;
  });
}

function resolveObligations({ context, obligations }) {
  const results = obligations.map(obligation => {
    const permitted_claims = obligation.type === 'practical_guidance' ? practicalGuidance(context.current_message) : copy(FACTS[obligation.type]);
    const result = { obligation: copy(obligation), resolution: obligation.type === 'unsupported' ? 'bounded_unknown' : 'resolved', permitted_claims, prohibited_or_boundary_claims: [], action_authorization: null };
    if (obligation.type === 'medical_boundary') result.prohibited_or_boundary_claims.push('medication_management_advice');
    if (obligation.type === 'glp1_scope') result.prohibited_or_boundary_claims.push('medication_sale_delivery_or_prescription');
    const validPurchase = obligation.type === 'purchase' && (obligation.intent === 'explicit_current_request' || (obligation.intent === 'valid_current_confirmation' && context.commercial_state?.purchase_context === true));
    if (validPurchase && GLP1_LIVE_PILOT_CHECKOUT_SUPPRESSED) {
      result.checkout_suppressed_reason = 'glp1_live_pilot';
    } else if (validPurchase) {
      result.action_authorization = { status: 'authorized', action: 'existing_checkout', reason: obligation.intent };
    }
    return result;
  });
  const checkout = results.find(item => item.action_authorization);
  const authorized_action = checkout?.action_authorization || null;
  const checkout_suppressed_reason = results.find(item => item.checkout_suppressed_reason)?.checkout_suppressed_reason || null;
  return { resolved_obligations: results, permitted_claims: results.flatMap(item => item.permitted_claims), authorized_action, checkout_suppressed_reason, checkout_question_response: checkout ? results.filter(item => item.obligation.type !== 'purchase').flatMap(item => item.permitted_claims).join(' ') || null : null };
}

function buildCompositionEnvelope({ context, resolution }) {
  return Object.freeze({ contract_version: 'direct-rag-v2', current_message: context.current_message, relevant_conversation_context: { history: context.history, most_recent_assistant_message: context.most_recent_assistant_message }, resolved_obligations: copy(resolution.resolved_obligations), permitted_claims: copy(resolution.permitted_claims), response_policy: { locale: 'es-MX', max_questions: 0, unsolicited_purchase_cta: false, action_authorization: copy(resolution.authorized_action) } });
}

function gateResponse({ envelope, response, coveredObligationIds, usedClaims = [] }) {
  if (!plain(envelope) || typeof response !== 'string' || !response.trim()) return { cleared: false, reason: 'STRUCTURE_INVALID' };
  const required = envelope.resolved_obligations.map(item => item.obligation.id);
  if (!Array.isArray(coveredObligationIds) || required.some(id => !coveredObligationIds.includes(id))) return { cleared: false, reason: 'OBLIGATION_COVERAGE_MISSING' };
  // `usedClaims` is audit telemetry only. Grounding is established from the
  // actual customer text: every substantive sentence must be an exact resolved
  // claim (the composer may vary only whitespace/case) or the safe fallback is used.
  if (!Array.isArray(usedClaims)) return { cleared: false, reason: 'STRUCTURE_INVALID' };
  const text = response.toLocaleLowerCase('es-MX');
  if (/\b(?:sube|baja|aumenta|reduce|cambia|ajusta|suspende|inicia)\b.{0,50}\b(?:dosis|medicamento|mg)\b/u.test(text)) return { cleared: false, reason: 'MEDICATION_GUIDANCE' };
  if (text.includes('quieres comprar') || text.includes('te envío el enlace')) return { cleared: false, reason: 'UNAUTHORIZED_CTA' };
  const canonical = value => value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('es-MX');
  const allowed = new Set(envelope.permitted_claims.map(canonical));
  const sentences = response.split(/(?<=[.!?])\s+/u).map(canonical).filter(Boolean);
  if (!sentences.length || sentences.some(sentence => !allowed.has(sentence))) return { cleared: false, reason: 'UNSUPPORTED_ACTUAL_RESPONSE' };
  return { cleared: true, reason: null };
}

module.exports = { FACTS, INTERPRETER_OBLIGATION_TYPES, OBLIGATION_TYPE_CONTRACT, GLP1_LIVE_PILOT_CHECKOUT_SUPPRESSED, buildConversationContext, practicalGuidance, validateObligations, resolveObligations, buildCompositionEnvelope, gateResponse };
