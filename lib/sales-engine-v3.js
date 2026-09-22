'use strict';

const { OFFER_VERSION, BUSINESS_LOCATION_RESPONSE, MULTI_TOPIC_ANSWERS } = require('./dietavity-knowledge');

const { explicitProductQuestions, hasExplicitCurrentReminderRequest, currentQuestionDetails, currentQuestionClauses, canonicalClauseAnswers } = require('./sales-response-contract');
const { currentConversationalTask, taskProductMessage } = require('./sales-conversational-task');

const BUYER_SIGNALS = Object.freeze([
  'information_request', 'broad_information_request', 'positive_interest', 'question', 'objection_price',
  'objection_trust', 'objection_timing', 'deferred_interest', 'explicit_purchase',
  'contextual_affirmation', 'ambiguous_acknowledgement', 'gratitude', 'rejection',
  'ai_value_objection', 'support_issue', 'other',
]);

const RESPONSE_STRATEGIES = Object.freeze([
  'direct_purchase', 'purchase_confirmation', 'clarify', 'answer_question',
  'handle_objection', 'discovery', 'show_example', 'explain_offer', 'deferred',
  'reminder', 'graceful_close', 'acknowledgement', 'conversational',
  'answer_objection', 'broad_information',
]);

const CONVERSATION_STAGES = Object.freeze([
  'new', 'evaluating', 'offer', 'checkout_pending', 'closed',
]);

const LAST_QUESTION_TYPES = Object.freeze([
  'primary_goal', 'show_example', 'explain_offer', 'purchase_confirmation',
  'reminder_date',
]);

const MATERIAL_TOPICS = new Set([
  'payment_methods', 'payment_security', 'price', 'start_date', 'refund',
  'health_scope', 'allergies', 'privacy', 'what_is_included', 'how_it_works',
  'fulfillment_timing', 'fulfillment_notification',
  'post_purchase', 'personalization', 'diet_support', 'product_scope', 'business_location',
]);

const SECONDARY_EVENT_BY_SIGNAL = Object.freeze({
  objection_price: 'price_objection',
  objection_trust: 'trust_objection',
  objection_timing: 'timing_objection',
  deferred_interest: 'deferred_interest',
  rejection: 'rejection',
});

const CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE = '¡Hola! 👋 En Dietavity te decimos qué comer cada día durante 28 días, con comidas fáciles, familiares y pensadas para ti. ¿Qué te gustaría conseguir principalmente con tu alimentación: comer más saludable, controlar tu peso, sentirte mejor, organizar mejor tus comidas o algo diferente?';
const CANONICAL_POST_DISCOVERY_GENERAL_INFORMATION_RESPONSE = 'Claro 😊 Dietavity es un programa personalizado de 28 días que te dice qué comer cada día. Cuesta $149 MXN en un solo pago e incluye desayuno, comida, cena y snack, además de apoyo por WhatsApp cuando lo necesites.\n\n¿Quieres que te muestre un ejemplo de cómo sería un día de comidas?';
const POST_28_DAY_RESPONSE = 'Los $149 MXN cubren tu programa personalizado de 28 días y no hay renovación automática. Al terminar, si quieres continuar, puedes adquirir un nuevo programa; tú decides si hacerlo.';
const PREPARED_FOOD_DELIVERY_RESPONSE = 'Dietavity no entrega comida preparada. Te damos un programa personalizado de 28 días con qué comer cada día, recetas y acceso desde tu portal, además de apoyo por WhatsApp.';
const REPEATED_BILLING_CLARIFICATION = '¿Te refieres a si se cobra automáticamente otra vez, o a cuánto costaría continuar después de los 28 días?';

// Applied only after the existing policy has established authorized purchase intent.
function glp1PurchaseHoldingResponse(offerContext) {
  if (offerContext !== 'glp1_validation') return {};
  return {
    pending_action: 'respond',
    checkout_authorized: false,
    checkout_authorization_type: null,
    holding_page_would_be_sent: true,
    holding_page_url: 'https://dietavity.com/programa-glp1',
    deterministic_response: 'Claro 😊 Te comparto el siguiente paso:\nhttps://dietavity.com/programa-glp1',
  };
}

function detectOfferContext(message) {
  return String(message ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('es') ===
    '¡hola! quiero saber más.' ? 'glp1_validation' : null;
}

// Current-turn speech acts, shared by policy and its embedded workflow copy.
// Clinical clauses are checked before complete product/preference constructions.
function medicationIntent(message) {
  const text = normalizeMessage(message);
  if (/\b(grave|graves|intenso|intensa|no puedo respirar|desmayo|desmayando|empeora|empeorando|no puedo retener liquidos)\b/.test(text)) return 'urgent';
  if (/\b(dosis|dosificar|inyect\w*|eficacia|efectos? secundarios?|vomit\w*|nauseas|suspender\w*|suspendo|tratamiento)\b/.test(text) ||
      /\b(cuanto (?:glp[ -]?1 )?(?:debo|deberia|puedo) usar|cada cuanto|me (?:lo )?pongo|puedo usarlo(?=$| si .{0,45}(?:medicamento|tratamiento))|(?:puedo|debo|deberia) (?:dejar|cambiar|empezar) (?:el |la |mi |de |a )?(?:medicamento|medicacion|tratamiento|ozempic|wegovy|semaglutida|glp[ -]?1|tomar(?:lo)?|usar(?:lo)?)|(?:dejar|empezar) (?:de |a )?(?:usar|tomar)|(?:recomiendas?|recomiendan) empezar|que medicamento .*recomiend)\b/.test(text)) return 'management';
  if (/\b(?:medicamento|medicacion|ozempic|wegovy|semaglutida|glp[ -]?1)\b/.test(text) &&
      /\b(?:puedo|debo|deberia) (?:dejar|cambiar|empezar)\b/.test(text)) return 'management';
  // An unqualified treatment-action question remains conservative; cooking
  // objects such as 'dejar todo listo' do not match this boundary.
  if (/\b(?:puedo|debo|deberia) (?:dejar|cambiar|empezar)(?:lo|la)?$/.test(text)) return 'management';
  const medication = '(?:(?:el|los|las|un|una) )?(?:medicamentos?(?: glp[ -]?1)?|medicacion|glp[ -]?1|ozempic|wegovy|semaglutida|inyecciones)';
  const provider = '(?:(?:ustedes|dietavity) )?';
  const scope = new RegExp('^(?:hola )?' + provider + '(?:(?:me )?(?:dan|venden|entregan|recetan|mandan|envian|proporcionan|proporciona|vende|entrega|receta) ' + medication + '|(?:el programa |su programa |el precio )?(?:incluye|incluyen|es con|requiere|requieren) ' + medication + '|(?:necesito|hay que tomar|tengo que tomar) ' + medication + '|' + medication + ' (?:viene incluido|vienen incluidas|esta incluido|estan incluidas))$');
  if (scope.test(text)) return 'product_scope';
  const preference = new RegExp('^(?:(?:no |claro )*)(?:(?:me interesa|quiero)(?: algo)?(?: con| tomar)? ' + medication + '|(?:busco|prefiero|quiero) algo (?:sin ' + medication + '|que no incluya ' + medication + ')|quiero tomar nada)$');
  // Require rejection for the first construction; positive treatment interest is
  // not a product preference merely because a medicine is named.
  if (preference.test(text) && (/^(?:no )+/.test(text) || /\b(?:sin|que no incluya)\b/.test(text))) return 'preference';
  return null;
}

function glp1ProductScopeResponse(message) {
  if (medicationIntent(message) !== 'product_scope') return null;
  return 'No. Dietavity no vende, entrega ni receta medicamentos GLP-1. Somos un programa de alimentación personalizado de 28 días que te ayuda a organizar qué comer cada día. ¿Qué te gustaría saber sobre el programa?';
}

function glp1SafetyResponse(message, topic) {
  const intent = medicationIntent(message);
  if (intent === 'urgent') return 'Si tienes síntomas graves o que empeoran rápidamente, busca atención médica de inmediato. Dietavity no puede diagnosticar ni tratar estos síntomas.';
  if (intent === 'product_scope' || intent === 'preference') return null;
  if (intent === 'management' || topic === 'health_scope') {
    return 'Eso puede depender de tu tratamiento y no sería seguro que Dietavity te indicara cambios en tu medicamento. Lo adecuado es consultarlo con el profesional que te lo prescribió.';
  }
  return null;
}

// Conservative final-output guard on the canary path only. Canonical medical
// redirects do not match these patterns; unsupported generated advice fails closed.
function glp1ResponseViolatesScope(message) {
  const text = normalizeMessage(message);
  return /glp1_validation|offer_context/.test(text) ||
    /\b(sube|baja|aumenta|reduce|cambia|ajusta|suspende|inicia|empieza|deja de tomar)\b.{0,45}\b(dosis|medicamento|medicacion|tratamiento|mg)\b/.test(text) ||
    /\b\d+(?:[.,]\d+)?\s*mg\b/.test(text) ||
    /\b(previene|prevenimos|evita|evitamos|trata|tratamos|cura)\b.{0,50}\b(efectos|estrenimiento|nauseas)\b/.test(text) ||
    /\b(mejora|mejoramos|aumenta|aumentamos)\b.{0,45}\b(eficacia|efectividad)\b/.test(text) ||
    /\b(garantiza|garantizamos|asegura|aseguramos)\b.{0,70}\b(nutrientes|nutricional|musculo|masa muscular)\b/.test(text);
}

function normalizeMessage(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-MX')
    .replace(/[¡!¿?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStrongAffirmation(message) {
  return /^(si|sip|si quiero|claro|por favor|adelante)$/.test(normalizeMessage(message));
}

function isWeakAcknowledgement(message) {
  return /^(ok|okay|perfecto|vale|listo)$/.test(normalizeMessage(message));
}

function hasDeterministicBroadInformationRequest(message, session = {}) {
  const value = normalizeMessage(message);
  const explicitRequest = /^(?:realmente\s+)?todo\s+por favor$/.test(value) ||
    /^(?:realmente\s+todo|quiero\s+(?:saber|conocer)\s+todo|(?:cuentame|explicame|dime)\s+todo|me\s+interesa\s+saber\s+todo|quiero\s+mas\s+informacion|mas\s+informacion|cuentame\s+mas)$/.test(value);
  if (explicitRequest) return true;

  // A bare "todo" only means "tell me broadly" when it answers a question that
  // invited discovery or more product detail. In purchase context it stays
  // ambiguous and can never become Checkout authorization.
  return value === 'todo' &&
    ['primary_goal', 'show_example', 'explain_offer'].includes(session.last_question_type);
}

function hasExplicitComprehensiveInformationRequest(message) {
  const value = normalizeMessage(message);
  return /^(?:realmente\s+)?todo(?:\s+por favor)?$/.test(value) ||
    /\b(?:explicame|cuentame|dime|dame|quiero|quisiera)\b.{0,45}\b(?:todo|toda la informacion|bien como funciona|todo lo que incluye)\b/.test(value) ||
    /\b(?:todo|toda la informacion|todo lo que incluye)\b.{0,45}\b(?:programa|dietavity|incluye|funciona)\b/.test(value);
}

function hasDeterministicExplicitPurchase(message, session = {}, now = new Date()) {
  const value = normalizeMessage(message);
  // Negated, conditional and explicitly unresolved requests are not authorization.
  if (/\b(?:no (?:lo quiero|lo pago|quiero|deseo|voy a|me mandes|me envies)|si (?:me |nos )?(?:aceptan|tienen|hay|dan|generan|funciona|sirve|me sirve|se puede)|solo si|siempre que|no (?:ahora|todavia|aun)|todavia no|aun no|pero primero|antes de (?:comprar|pagar))\b/.test(value)) return false;
  const contextualObject = session.last_question_type === 'purchase_confirmation' &&
    validContext(session, now) &&
    /^(?:si[, ]+)?(?:mandalo|envialo|pasalo|compartelo)(?: porfa| por favor)?(?:$|[.,;? ]+(?:que|como|cuando|generan|dan|aceptan))/.test(value);
  return contextualObject || (
    /^(?:(?:si|va|bueno|bien|de acuerdo) )?lo (?:pago|quiero)(?:$| (?:porfa|por favor|ahora|pero|y|que|como|cuando|dan|generan|aceptan)\b)/.test(value) ||
    /\b(quiero|deseo|voy a)\s+(comprar(?:lo|la)?|adquirir(?:lo|la)?|pagar(?:lo|la)?)\b/.test(value) ||
    /\b(quiero|deseo)\s+(empezar|comenzar)\b/.test(value) ||
    /\b(mandame|enviame|pasame|comparteme)\b.*\b(enlace|link)\b/.test(value) ||
    /\b(?:me\s+)?(?:mandas|envias|pasas|compartes)\b.*\b(enlace|link)\b/.test(value) ||
    /\b(enlace|link)\b.*\b(pagar|pago|comprar|adquirir)\b/.test(value) ||
    /\bdonde\s+(pago|puedo pagar|lo compro)\b/.test(value) ||
    /^(?:como pago|como puedo pagar)(?: por favor)?$/.test(value) ||
    /^(?:si )?(?:quiero|deseo) contratar(?:lo|la| el (?:programa|plan))?(?: por favor)?$/.test(value)
  );
}

function hasDeterministicPortalRecoveryRequest(message) {
  const value = normalizeMessage(message);
  const accessObject = /\b(enlace|link|acceso|portal|programa|plan)\b/.test(value);
  const accessLoss = /\b(perdi|perdido|no (?:lo )?encuentro|no encuentro|necesito (?:nuevamente|de nuevo)|entrar (?:otra vez|de nuevo)|recuperar|como entro|como puedo entrar|donde (?:esta|entro|veo))\b/.test(value);
  return accessObject && accessLoss;
}

function hasDeterministicPaidAccountRequest(message) {
  const value = normalizeMessage(message);
  if (hasDeterministicPortalRecoveryRequest(message)) return true;

  const ownedProgramObject = /\b(?:mi|mis)\s+(?:programa|plan|portal|semana|comida|cena|desayuno|snack|receta|lista(?:\s+del\s+super)?)\b/.test(value);
  const scheduledMeal = /\bque\s+tengo\s+(?:de|para)\s+(?:comida|cena|desayuno|snack)(?:\s+hoy)?\b/.test(value) ||
    /\breceta\b.{0,55}\bque\s+tengo\s+hoy\b/.test(value);
  const currentMealChange = /\b(?:cambiar|reemplazar|sustituir|no puedo seguir)\b.{0,35}\besta\s+comida\b/.test(value);
  const accordingToProgram = /\b(?:segun|de acuerdo con)\s+(?:mi|el)\s+(?:plan|programa)\b/.test(value);
  const ownedShoppingList = /\b(?:mi|la)\s+lista\s+del\s+super\b/.test(value) &&
    /\b(?:donde|ver|encuentro|esta)\b/.test(value);

  return ownedProgramObject || scheduledMeal || currentMealChange ||
    accordingToProgram || ownedShoppingList;
}

function hasDeterministicAiValueObjection(message) {
  const value = normalizeMessage(message);
  const aiAlternative = /\b(ia|inteligencia artificial|chat\s*gpt|chatgpt|gemini|claude|copilot|chatbot|bot|asistente virtual|maquina)\b/;
  const humanPreference = /\b(no quiero (?:hablar|tratar) con (?:una )?(?:maquina|ia|bot)|prefiero (?:hablar|tratar) con (?:una )?(?:persona|humano|nutriologo)|(?:quiero|puedo) (?:hablar|tratar) con (?:una )?(?:persona|humano|nutriologo)|(?:atienda|atencion) (?:una )?(?:persona|humano))\b/;
  if (!aiAlternative.test(value) || humanPreference.test(value)) return false;

  return (
    /\b(mejor|para eso)\b.{0,45}\b(uso|utilizo|pregunto|consulto|pido)\b/.test(value) ||
    /\b(lo|eso)\s+(?:lo\s+)?puedo\s+(hacer|pedir|conseguir|obtener)\b/.test(value) ||
    /\bpuedo\s+(pedirle|preguntarle|consultarle)\s+(?:eso|lo mismo)\b/.test(value) ||
    /\bpor que\s+(?:deberia\s+)?pagaria\b/.test(value) ||
    /\bque diferencia (?:hay|tiene|habria)\b.{0,55}\b(usar|preguntar(?:le)?|consultar(?:le)?|pedir(?:le)?)\b/.test(value) ||
    /\bpor que no (?:hacerlo|pedirlo|preguntarlo|consultarlo)\b.{0,35}\b(directamente|gratis|por mi cuenta|yo mismo|yo misma)\b/.test(value) ||
    /\b(?:gratis|sin pagar|por mi cuenta)\b.{0,35}\b(ia|chat\s*gpt|chatgpt|chatbot|asistente virtual)\b/.test(value)
  );
}

function hasDeterministicMaterialQuestion(message) {
  const value = normalizeMessage(message);
  if (/\b(?:no (?:tengo|uso|manejo) tarjetas?|sin tarjeta|pagar sin tarjeta)\b/.test(value)) return true;
  if (/\b(?:platicas?|charlas?|consultas? por videollamada|videollamadas?|me llama un nutriologo|llamada con (?:un )?nutriologo)\b/.test(value)) return true;
  const questionLike = /[?¿]/.test(String(message || '')) ||
    /\b(aceptan|cuanto|como|cuando|cual|metodos?|formas?|reembolso|devolucion|seguro|privacidad|alerg|condicion|incluye)\b/.test(value);
  if (!questionLike) return false;
  return /\b(oxxo|apple pay|tarjeta|paypal|mercado pago|metodos?|formas?|precio|cuesta|inicio|empezar|reembolso|devolucion|salud|alerg|condicion|privacidad|seguro|incluye|personaliza)\b/.test(value);
}

// Recognize business location/modality, not customer location or portal navigation.
// The classifier handles broader paraphrases; this guard survives stale AI metadata.
function asksBusinessLocation(message) {
  const value = normalizeMessage(message);
  return /\bdonde (?:estan|se encuentran|se ubican)(?: ubicados)?(?: ustedes| dietavity)?(?:$| y\b)/.test(value) ||
    /\b(?:tienen|hay|cuentan con|donde tienen)\b.{0,25}\b(?:consultorio|sucursal|oficinas?|sede)\b/.test(value) ||
    /\b(?:es|son|servicio|atienden|atencion|consulta|programa)\b.{0,25}\b(?:presencial|fisicamente|en persona|en linea|online|digital)\b/.test(value) ||
    /\b(?:todo|funciona) (?:es )?en linea\b/.test(value);
}

function asksPost28DayContinuation(message) {
  const value = normalizeMessage(message);
  const afterPeriod = /\b(?:despues|al terminar|cuando (?:termine|acabe)|una vez (?:terminen|acabados)|pasados)\b.{0,45}\b(?:28 dias|programa|plan)\b/.test(value) ||
    /\b(?:28 dias|programa|plan)\b.{0,45}\b(?:despues|al terminar|termine|termina|acabe|continua|seguir|otro programa|que pasa|cuanto (?:pago|se paga|costaria))\b/.test(value);
  return afterPeriod;
}

function asksPreparedFoodDelivery(message) {
  const value = normalizeMessage(message);
  return /\b(?:hacen|tienen|hay)\s+entregas?\b/.test(value) ||
    /\b(?:donde|a donde|en que lugares?)\s+entregan\b/.test(value) ||
    /\bentregan\b.{0,28}\b(?:cdmx|domicilio|casa|comida|alimentos?|platillos?|menus?)\b/.test(value) ||
    /\b(?:me|nos)\s+(?:mandan|envian|llevan|entregan)\b.{0,28}\b(?:comida|alimentos?|platillos?|menus?)\b/.test(value) ||
    /\b(?:son|mandan|envian|entregan|recibo|incluye|venden)\b.{0,25}\b(?:comidas?|alimentos?|platillos?)\s+preparad[oa]s?\b/.test(value) ||
    /\bquiero\b.{0,25}\b(?:lleven|manden|envien|entreguen)\b.{0,25}\b(?:comida|menus?|platillos?)\b/.test(value);
}

function asksBasicBilling(message) {
  const value = normalizeMessage(message);
  return /\b(?:un|solo|unico)\s+(?:solo\s+)?pago\b/.test(value) ||
    /\b(?:se cobra|cobran|pago|se paga)\b.{0,18}\b(?:cada mes|mensual(?:mente)?|automaticamente|otra vez)\b/.test(value) ||
    /\b(?:renovacion|renueva|suscripcion|mensualidad)\b/.test(value);
}

function explicitlyUnresolved(message) {
  return /\b(?:sigo con (?:la )?duda|aun tengo (?:la )?duda|todavia tengo (?:la )?duda|no me queda claro|no entendi|no entiendo|no resolvio|no responde|misma duda)\b/.test(normalizeMessage(message));
}

function repeatedBillingNeedsClarification(message, previousAssistantMessage) {
  if (asksPost28DayContinuation(message)) return false;
  const previous = normalizeMessage(previousAssistantMessage);
  const alreadyAnswered = /\b(?:un solo pago|no hay renovacion automatica|sin renovacion automatica|no se renueva automaticamente)\b/.test(previous);
  return alreadyAnswered && (asksBasicBilling(message) || explicitlyUnresolved(message));
}

function hasCheckoutAlreadySent(session = {}) {
  return Boolean(session.checkout_sent_at) || session.conversation_stage === 'checkout_pending';
}

function resolveCurrentCommercialQuestions(message, session = {}) {
  const value = normalizeMessage(message);
  const asksOneTimePayment = /\b(?:un|solo|unico)\s+(?:solo\s+)?pago\b/.test(value);
  const asksRenewal = asksOneTimePayment || /\b(?:despues me cobran|cobran otra vez|se cobra.{0,18}(?:cada mes|mensual|otra vez)|renovacion|renueva|mensualidad|suscripcion)\b/.test(value);
  const asksPrice = /\b(?:cuanto (?:cuesta|vale)|que costo|precio)\b/.test(value) || asksOneTimePayment || asksRenewal;
  const asksOxxo = /\boxxo\b/.test(value);
  const asksOxxoHow = asksOxxo && (
    /\b(?:como (?:es|funciona|pago)|donde pago|pagar|pago)\b.{0,25}\boxxo\b/.test(value) ||
    /\boxxo\b.{0,25}\b(?:como|funciona|pagar|pago)\b/.test(value)
  );
  const noCard = /\b(?:no (?:tengo|uso|manejo) tarjetas?|sin tarjeta|pagar sin tarjeta)\b/.test(value);
  const asksTalks = /\b(?:platicas?|charlas?)\b/.test(value);
  const asksVideoConsultation = /\b(?:consultas? por videollamada|videollamadas?)\b/.test(value);
  const asksNutritionistCall = /\b(?:me llama un nutriologo|llamada con (?:un )?nutriologo)\b/.test(value);
  const asksHowItWorks = /\b(?:como funciona|como es el programa)\b/.test(value);
  const asksStart = /\b(?:cuando (?:empiezo|inicio|comienza|puedo (?:empezar|comenzar))|fecha de inicio)\b/.test(value);
  const asksPortal = /\b(?:donde (?:veo|recibo|consulto)|en donde (?:veo|recibo|consulto))\b.{0,35}\b(?:programa|plan)\b/.test(value);
  const unsupportedFeature = asksTalks || asksVideoConsultation || asksNutritionistCall;
  const checkoutAlreadySent = hasCheckoutAlreadySent(session);

  const businessLocation = asksBusinessLocation(message);
  const asksPayment = businessLocation && /\b(?:pago|pagar|tarjeta|metodos? de pago)\b/.test(value);
  const parts = [];
  if (businessLocation) parts.push(BUSINESS_LOCATION_RESPONSE);
  if (asksPayment && !asksOxxo && !noCard) parts.push('Aceptamos tarjeta de crédito, tarjeta de débito, OXXO y Apple Pay.');
  if (asksPrice) {
    parts.push('El programa personalizado de Dietavity cuesta $149 MXN en un solo pago.');
  }
  if (asksRenewal) {
    parts.push('No hay mensualidad ni renovación automática.');
  }
  if (unsupportedFeature) {
    const feature = asksVideoConsultation
      ? 'consultas por videollamada'
      : asksNutritionistCall
        ? 'llamadas con un nutriólogo'
        : 'pláticas programadas';
    parts.push(`No ofrecemos ${feature}: recibes tu programa personalizado en el portal y durante los 28 días puedes pedir apoyo por WhatsApp cuando lo necesites.`);
  }
  if (asksHowItWorks) {
    parts.push('Después del pago completas tu personalización, preparamos tu programa de 28 días y lo consultas en el portal Dietavity.');
  }
  if (asksStart) {
    parts.push('Puedes elegir comenzar desde hoy hasta 30 días calendario después de la compra.');
  }
  if (asksPortal) {
    parts.push('El programa se consulta en el portal Dietavity después del pago verificado y de completar tu personalización.');
  }
  if (noCard || asksOxxoHow) {
    const checkoutReference = checkoutAlreadySent
      ? 'En el enlace de Checkout que te envié, selecciona OXXO y sigue las indicaciones que aparecen ahí para completar el pago.'
      : 'En el Checkout seguro, selecciona OXXO y sigue las indicaciones que aparecen ahí para completar el pago.';
    parts.push(`No necesitas tarjeta para pagar con OXXO. ${checkoutReference}`);
  } else if (asksOxxo) {
    parts.push('Sí, aceptamos pagos en OXXO.');
  }

  const recognizedCount = [
    asksPrice, asksRenewal, unsupportedFeature, asksHowItWorks, asksStart,
    asksPortal, asksOxxo, noCard, businessLocation, asksPayment,
  ].filter(Boolean).length;
  if (!noCard && !unsupportedFeature && recognizedCount < 2 && !(asksOxxo && asksOxxoHow)) {
    return null;
  }

  return {
    response: [...new Set(parts)].join(' '),
    allow_purchase_cta: !checkoutAlreadySent && (
      !unsupportedFeature || asksPrice || asksRenewal || asksOxxo ||
      asksHowItWorks || asksStart || asksPortal
    ),
  };
}

function isInitialGenericInquiry(message) {
  const value = normalizeMessage(message);
  return /^(hola\s*)?(quiero|quisiera|me gustaria)?\s*(mas\s+)?informacion$/.test(value) ||
    /^(hola|buenos dias|buenas tardes|buenas noches)$/.test(value);
}

function isSubstantiveEngagement(message, interpretation) {
  if (interpretation?.buyer_signal === 'broad_information_request') return true;
  if (isInitialGenericInquiry(message)) return false;
  if (interpretation?.substantive_engagement === false) return false;
  return !['gratitude', 'ambiguous_acknowledgement', 'other'].includes(
    interpretation?.buyer_signal,
  );
}

function validContext(session, now) {
  const askedAt = Date.parse(session?.last_question_at || '');
  const expiresAt = Date.parse(session?.commercial_context_expires_at || '');
  const current = new Date(now).getTime();
  return session?.last_question_type === 'purchase_confirmation' &&
    session?.offer_version === OFFER_VERSION &&
    Number.isFinite(askedAt) &&
    Number.isFinite(expiresAt) &&
    current < expiresAt;
}

function validatedReminderTime(interpretation, now) {
  if (interpretation?.explicit_reminder_request !== true) return null;
  const scheduled = Date.parse(interpretation?.timing_iso || '');
  const current = new Date(now).getTime();
  if (!Number.isFinite(scheduled)) return null;
  const delta = scheduled - current;
  if (delta < 15 * 60 * 1000 || delta > 35 * 24 * 60 * 60 * 1000) return null;
  return new Date(scheduled).toISOString();
}

function topicEvent(topic) {
  if (topic === 'price') return 'price_question';
  if (topic === 'payment_methods') return 'payment_method_question';
  if (topic === 'health_scope' || topic === 'allergies') return 'health_question';
  return null;
}

function decideSalesTurn({ message, interpretation, session = {}, now = new Date() }) {
  const safeInterpretation = interpretation && interpretation.interpretation_valid !== false
    ? interpretation
    : { buyer_signal: 'other', topic: null, interpretation_valid: false };
  const currentTask = currentConversationalTask(message, safeInterpretation);
  const factualMessage = taskProductMessage(message, currentTask);
  const rawCurrentQuestionTopics = explicitProductQuestions(factualMessage);
  const resolvedCommercialQuestions = resolveCurrentCommercialQuestions(message, session);
  const continuationResponse = asksPost28DayContinuation(message) && !rawCurrentQuestionTopics.includes('fulfillment_timing') ? POST_28_DAY_RESPONSE : '';
  const unknownCurrentQuestion = currentQuestionDetails(factualMessage, MULTI_TOPIC_ANSWERS, resolvedCommercialQuestions?.response || continuationResponse || (asksPreparedFoodDelivery(message) ? PREPARED_FOOD_DELIVERY_RESPONSE : '')).some(d => d.uncertain);
  const practicalGuidance = currentQuestionDetails(factualMessage, MULTI_TOPIC_ANSWERS).some(d => d.practical);
  // The broad unknown-capability detector sees the grammatical "¿puedo...?".
  // Once the clause has been established as ordinary food-use guidance, that
  // generic marker is not a product topic.
  const currentQuestionTopics = practicalGuidance
    ? rawCurrentQuestionTopics.filter(topic => topic !== 'unconfirmed_detail')
    : rawCurrentQuestionTopics;
  // Preserve the established generic opening only before commercial context.
  const initialBroadInquiry = session.conversation_stage === 'new' &&
    !session.last_question_type && safeInterpretation.buyer_signal === 'broad_information_request' &&
    currentQuestionTopics.length === 1 && currentQuestionTopics[0] === 'how_it_works';
  const currentProductQuestion = (currentQuestionTopics.length > 0 || unknownCurrentQuestion) && !initialBroadInquiry;
  const explicitReminderRequest = hasExplicitCurrentReminderRequest(message);
  const currentBusinessLocation = asksBusinessLocation(message);
  const rawClassifiedSignal = BUYER_SIGNALS.includes(safeInterpretation.buyer_signal)
    ? safeInterpretation.buyer_signal
    : 'other';
  const classifiedSignal = currentProductQuestion && rawClassifiedSignal !== 'support_issue' ? 'question' : currentBusinessLocation ? 'question' : rawClassifiedSignal === 'broad_information_request' &&
    normalizeMessage(message) === 'todo' &&
    session.last_question_type === 'purchase_confirmation'
    ? 'ambiguous_acknowledgement'
    : rawClassifiedSignal;
  const interpretedTopic = currentTask ? null : currentProductQuestion && (safeInterpretation.topic !== 'health_scope' || unknownCurrentQuestion || currentQuestionTopics.includes('glp1_suitability'))
    ? (currentQuestionTopics[0] || 'unconfirmed_detail') : currentBusinessLocation ? 'business_location' : typeof safeInterpretation.topic === 'string'
    ? safeInterpretation.topic
    : null;
  const goal = typeof safeInterpretation.goal === 'string' && safeInterpretation.goal.trim()
    ? safeInterpretation.goal.trim().slice(0, 160)
    : null;
  const deterministicAiValueObjection = hasDeterministicAiValueObjection(message) ||
    (!currentProductQuestion && !currentBusinessLocation && safeInterpretation.buyer_signal === 'ai_value_objection');
  const deterministicExplicitPurchase = !deterministicAiValueObjection &&
    safeInterpretation.interpretation_valid !== false &&
    hasDeterministicExplicitPurchase(message, session, now);
  const strongContextualResponse = !currentProductQuestion && isStrongAffirmation(message) &&
    LAST_QUESTION_TYPES.includes(session.last_question_type);
  const weakContextualResponse = !currentProductQuestion && isWeakAcknowledgement(message) &&
    LAST_QUESTION_TYPES.includes(session.last_question_type);
  const deterministicBroadInformationRequest = !deterministicAiValueObjection &&
    !deterministicExplicitPurchase &&
    !currentProductQuestion && !currentBusinessLocation && (hasDeterministicBroadInformationRequest(message, session) ||
      classifiedSignal === 'broad_information_request');
  // A short response belongs to the latest actionable assistant question. AI topic
  // metadata from an older branch is deliberately discarded for this turn.
  const topic = deterministicAiValueObjection
    ? (['credentials', 'professional_responsibility', 'trust'].includes(interpretedTopic)
      ? interpretedTopic
      : 'ai_value_objection')
    : strongContextualResponse || weakContextualResponse
    ? null
    : interpretedTopic;
  const deterministicMaterialQuestion = hasDeterministicMaterialQuestion(message);
  const post28DayContinuation = asksPost28DayContinuation(message);
  const preparedFoodDelivery = asksPreparedFoodDelivery(message);
  const repeatedBillingClarification = repeatedBillingNeedsClarification(
    message, session.recent_sales_assistant_message,
  );
  const materialQuestion = (deterministicExplicitPurchase && currentQuestionTopics.length > 0) ||
    currentQuestionTopics.some(t => t !== 'how_it_works') || topic === 'business_location' || Boolean(resolvedCommercialQuestions) || deterministicMaterialQuestion ||
    !deterministicExplicitPurchase && (
      safeInterpretation.material_question === true ||
      MATERIAL_TOPICS.has(topic) && safeInterpretation.buyer_signal === 'question'
    );
  const explicitPurchase = deterministicExplicitPurchase;
  const signal = deterministicAiValueObjection
    ? 'ai_value_objection'
    : explicitPurchase
    ? 'explicit_purchase'
    : deterministicBroadInformationRequest
      ? 'broad_information_request'
    : strongContextualResponse
      ? 'contextual_affirmation'
      : weakContextualResponse
        ? 'ambiguous_acknowledgement'
        : classifiedSignal;
  const reminderTime = validatedReminderTime(safeInterpretation, now);
  const events = [];

  if (isSubstantiveEngagement(message, { ...safeInterpretation, buyer_signal: signal })) {
    events.push('meaningful_engagement');
  }
  const secondaryEvent = SECONDARY_EVENT_BY_SIGNAL[signal] || topicEvent(topic);
  if (secondaryEvent) events.push(secondaryEvent);

  const base = {
    historical_state_used_for_intent: !currentProductQuestion && (strongContextualResponse || weakContextualResponse ||
      (deterministicExplicitPurchase && !hasDeterministicExplicitPurchase(message, {}, now))),
    buyer_signal: signal,
    material_question: materialQuestion,
    topic,
    goal,
    strategy: 'conversational',
    pending_action: 'respond',
    conversation_stage: session.conversation_stage === 'new' ? 'evaluating' :
      (session.conversation_stage || 'evaluating'),
    checkout_authorized: false,
    checkout_authorization_type: null,
    reminder_scheduled_for: null,
    next_last_question_type: null,
    allow_purchase_cta: false,
    max_questions: 1,
    events: [...new Set(events)],
    offer_version: OFFER_VERSION,
    interpretation_valid: safeInterpretation.interpretation_valid !== false,
  };

  const offerContext = session.offer_context || detectOfferContext(message);
  if (offerContext) base.offer_context = offerContext;
  const currentMedicationIntent = medicationIntent(message);
  const medicationSafety = glp1SafetyResponse(message, topic);
  if (medicationSafety && (offerContext === 'glp1_validation' || ['management', 'urgent'].includes(currentMedicationIntent))) {
    const safeClauses = currentQuestionClauses(message).filter(clause => !['management','urgent'].includes(medicationIntent(clause)));
    // A classifier-only ambiguous safety decision has no reliable medical span;
    // retain the conservative boundary rather than treating it as product data.
    const safeAnswer = currentMedicationIntent ? canonicalClauseAnswers(safeClauses.join('? '), MULTI_TOPIC_ANSWERS) : '';
    return { ...base, goal: null, strategy: 'answer_question', topic: 'health_scope',
      buyer_signal: 'question', material_question: true, medication_intent: currentMedicationIntent,
      max_questions: 0, deterministic_reason: 'medication_safety',
      medical_clause_response: medicationSafety,
      deterministic_response: [medicationSafety, safeAnswer].filter(Boolean).join('\n\n') };
  }
  if (['product_scope', 'preference'].includes(currentMedicationIntent)) {
    return { ...base, goal: null, strategy: 'answer_question', topic: 'product_scope',
      buyer_signal: currentMedicationIntent === 'preference' ? 'rejection' : 'question',
      material_question: true, medication_intent: currentMedicationIntent,
      events: base.events.filter(event => event !== 'health_question'),
      deterministic_reason: currentMedicationIntent === 'preference' ? 'medication_preference' :
        offerContext === 'glp1_validation' ? 'glp1_product_scope' : 'medication_product_scope',
      deterministic_response: currentMedicationIntent === 'preference'
        ? 'Claro. Dietavity no vende ni receta medicamentos; es un programa de alimentación personalizado de 28 días.'
        : glp1ProductScopeResponse(message) };
  }
  if (currentTask) {
    return { ...base, current_task: currentTask, goal: null, topic: null,
      buyer_signal: 'question', strategy: 'answer_question', max_questions: 1,
      events: base.events.filter(event => event === 'meaningful_engagement'),
      historical_state_used_for_intent: false, next_last_question_type: null,
      deterministic_reason: 'current_conversational_task', allow_purchase_cta: false };
  }
  if (offerContext === 'glp1_validation') {
    base.offer_context = offerContext;
    if (detectOfferContext(message)) {
      return { ...base, goal: null, strategy: 'discovery',
        deterministic_response: '¡Hola! 😊 Claro. Dietavity te ayuda a organizar comidas sencillas y personalizadas durante 28 días, especialmente cuando estás comiendo menos. ¿Qué te gustaría saber?' };
    }
    // Practical discovery is not a commercial personalization question. Current
    // commercial requests and medical safety still take precedence over it.
    const practicalText = normalizeMessage(message);
    const practicalDifficulty = /\b(complica|cuesta|dificil|dificultad|no se|no tengo tiempo|poco apetito)\b/.test(practicalText) &&
      /\b(comer|comida|comidas|cocinar|cocina|apetito|alimentos|menu)\b/.test(practicalText);
    if (practicalDifficulty && !explicitPurchase && !deterministicAiValueObjection &&
        !currentProductQuestion && !deterministicMaterialQuestion && !resolvedCommercialQuestions &&
        !['support_issue', 'rejection'].includes(signal) &&
        !explicitReminderRequest) {
      return { ...base, topic: null, goal: null, strategy: 'conversational',
        deterministic_reason: 'glp1_practical_discovery', max_questions: 1,
        deterministic_response: 'Para facilitar tus comidas, puedes empezar con opciones sencillas: combina una fuente de proteína, como huevo o frijoles, con tortilla o arroz y alguna verdura. Puedes preparar ingredientes con anticipación y servir una cantidad que te resulte cómoda. ¿Qué comida del día se te complica más organizar?' };
    }

  }

  // A current semantic objection always outranks an old purchase question and
  // any mixed expression of interest. It can never authorize or resend Checkout.
  if (deterministicAiValueObjection) {
    return {
      ...base,
      buyer_signal: 'ai_value_objection',
      strategy: 'answer_objection',
      pending_action: 'respond',
      checkout_authorized: false,
      checkout_authorization_type: null,
      next_last_question_type: null,
      allow_purchase_cta: false,
      max_questions: 0,
      events: [...new Set([...base.events, 'ai_value_objection'])],
    };
  }

  if (explicitReminderRequest && safeInterpretation.explicit_reminder_request === true &&
      !strongContextualResponse && !weakContextualResponse) {
    if (!reminderTime) {
      return { ...base, strategy: 'clarify', next_last_question_type: 'reminder_date' };
    }
    if (session.reminder_scheduled_for && Date.parse(session.reminder_scheduled_for) > new Date(now).getTime()) {
      return { ...base, strategy: 'acknowledgement', max_questions: 0 };
    }
    return {
      ...base,
      strategy: 'reminder',
      pending_action: 'schedule_requested_reminder',
      reminder_scheduled_for: reminderTime,
      max_questions: 0,
      events: [...new Set([...base.events, 'reminder_requested'])],
    };
  }

  // Deterministic question context precedes AI topic/signal classification. This
  // prevents a stale age, personalization, or diet topic from consuming "sí".
  if (strongContextualResponse) {
    if (session.last_question_type === 'purchase_confirmation') {
      if (validContext(session, now)) {
        return {
          ...base,
          strategy: 'purchase_confirmation',
          pending_action: 'send_checkout',
          conversation_stage: 'offer',
          checkout_authorized: true,
          checkout_authorization_type: 'contextual',
          max_questions: 0,
          events: [...new Set([...base.events, 'purchase_intent'])],
          ...glp1PurchaseHoldingResponse(offerContext),
        };
      }
      return {
        ...base,
        strategy: 'clarify',
        next_last_question_type: 'purchase_confirmation',
        conversation_stage: 'offer',
      };
    }
    if (session.last_question_type === 'show_example') {
      return { ...base, strategy: 'show_example', next_last_question_type: 'explain_offer' };
    }
    if (session.last_question_type === 'explain_offer') {
      return { ...base, strategy: 'explain_offer', next_last_question_type: 'purchase_confirmation', conversation_stage: 'offer', events: [...new Set([...base.events, 'offer_presented'])] };
    }
  }

  if (isStrongAffirmation(message) && session.conversation_stage === 'checkout_pending') {
    return { ...base, strategy: 'acknowledgement', max_questions: 0 };
  }

  if (weakContextualResponse) {
    if (session.last_question_type === 'purchase_confirmation') {
      return { ...base, strategy: 'clarify', next_last_question_type: 'purchase_confirmation', conversation_stage: 'offer' };
    }
    return { ...base, strategy: 'acknowledgement', max_questions: 0 };
  }

  if (signal === 'rejection') {
    return { ...base, strategy: 'graceful_close', pending_action: 'close', conversation_stage: 'closed', max_questions: 0 };
  }

  // Preserve operational/support routing. More specific current product-scope
  // questions then outrank generic pricing and repetition handling.
  if (signal === 'support_issue') return base;

  if (unknownCurrentQuestion) {
    return { ...base, goal: null, buyer_signal: 'question', strategy: 'answer_question',
      topic: currentQuestionTopics[0] || 'unconfirmed_detail', max_questions: 0,
      deterministic_reason: 'current_question_detail', allow_purchase_cta: false, next_last_question_type: null };
  }

  // Resolve both intents from the current message. Canonical answers travel on
  // the existing Checkout reply, before its single outbound reservation.
  if (explicitPurchase && currentQuestionTopics.length && offerContext !== 'glp1_validation' &&
      !repeatedBillingClarification && !explicitlyUnresolved(message) &&
      safeInterpretation.needs_clarification !== true && topic !== 'health_scope' &&
      currentQuestionTopics.every(t => MULTI_TOPIC_ANSWERS[t])) {
    return { ...base, strategy: 'direct_purchase', pending_action: 'send_checkout',
      conversation_stage: 'offer', checkout_authorized: true, checkout_authorization_type: 'explicit',
      max_questions: 0, next_last_question_type: null,
      checkout_question_response: currentQuestionTopics.map(t => MULTI_TOPIC_ANSWERS[t]).join('\n\n'),
      events: [...new Set([...base.events, 'purchase_intent'])] };
  }

  if (post28DayContinuation && (!currentQuestionTopics.includes('fulfillment_timing') ||
      currentQuestionTopics.includes('post_purchase'))) {
    return { ...base, topic: 'post_purchase', strategy: 'answer_question',
      deterministic_reason: 'post_28_day_continuation', deterministic_response: POST_28_DAY_RESPONSE,
      allow_purchase_cta: false, next_last_question_type: null, max_questions: 0 };
  }

  if (preparedFoodDelivery) {
    return { ...base, topic: 'product_scope', strategy: 'answer_question',
      deterministic_reason: 'prepared_food_delivery_clarification', deterministic_response: PREPARED_FOOD_DELIVERY_RESPONSE,
      allow_purchase_cta: false, next_last_question_type: null, max_questions: 0 };
  }

  // Practical food-use questions are neither evidence of a Dietavity feature
  // nor authorization to make one up. Existing product facts, food-delivery
  // clarification, safety, purchase and reminder routes have already won.
  if (practicalGuidance && !currentQuestionTopics.length && !resolvedCommercialQuestions &&
      !explicitPurchase && !deterministicAiValueObjection && !explicitReminderRequest &&
      !['support_issue', 'rejection'].includes(signal)) {
    return { ...base, goal: null, topic: null, buyer_signal: 'question', strategy: 'conversational',
      deterministic_reason: 'practical_guidance', max_questions: 1,
      next_last_question_type: null, allow_purchase_cta: false,
      historical_state_used_for_intent: false };
  }

  if (topic === 'business_location') {
    return { ...base, goal: null, buyer_signal: 'question', strategy: 'answer_question',
      material_question: true, allow_purchase_cta: false, next_last_question_type: null,
      deterministic_response: resolvedCommercialQuestions?.response, max_questions: 1 };
  }

  if (repeatedBillingClarification) {
    return { ...base, topic: 'price', strategy: 'clarify',
      deterministic_reason: 'repeated_billing_ambiguity', deterministic_response: REPEATED_BILLING_CLARIFICATION,
      allow_purchase_cta: false, next_last_question_type: null, max_questions: 1 };
  }

  if (currentQuestionTopics.some(t => t === 'fulfillment_timing' || t === 'fulfillment_notification') && !explicitPurchase) {
    return { ...base, buyer_signal: 'question', topic: currentQuestionTopics.find(t => t.startsWith('fulfillment_')),
      strategy: 'answer_question', max_questions: 0, next_last_question_type: null,
      deterministic_reason: 'current_fulfillment_question',
      deterministic_response: currentQuestionTopics.map(t => MULTI_TOPIC_ANSWERS[t]).filter(Boolean).join('\n\n') };
  }

  // Explicit questions retain their current topic even when the model carries
  // commercial metadata from an earlier turn. Safety and action routes above
  // remain authoritative; canonical facts prevent stale generated answers.
  if (currentProductQuestion && !explicitPurchase && topic !== 'health_scope') {
    return { ...base, buyer_signal: 'question', strategy: 'answer_question',
      deterministic_reason: 'current_product_question',
      deterministic_response: resolvedCommercialQuestions?.response };
  }

  if (materialQuestion) {
    // Information alone never creates a purchase-confirmation context.
    const allowPurchaseCta = explicitPurchase && !hasCheckoutAlreadySent(session) &&
      !['health_scope', 'allergies', 'privacy', 'refund'].includes(topic);
    return {
      ...base,
      strategy: 'answer_question',
      allow_purchase_cta: allowPurchaseCta,
      next_last_question_type: allowPurchaseCta ? 'purchase_confirmation' : null,
      conversation_stage: allowPurchaseCta ? 'offer' : base.conversation_stage,
      deterministic_response: resolvedCommercialQuestions?.response,
    };
  }

  if (explicitPurchase) {
    return {
      ...base,
      strategy: 'direct_purchase',
      pending_action: 'send_checkout',
      conversation_stage: 'offer',
      checkout_authorized: true,
      checkout_authorization_type: 'explicit',
      max_questions: 0,
      events: [...new Set([...base.events, 'purchase_intent'])],
          ...glp1PurchaseHoldingResponse(offerContext),
    };
  }

  // Initial broad inquiries use the same deterministic discovery architecture as
  // the established canonical opening. Later broad inquiries stay contextual.
  // A supplied goal also takes precedence: asking for it again would discard the
  // customer's current intent.
  if (signal === 'broad_information_request' &&
      session.conversation_stage === 'new' &&
      !goal && safeInterpretation.goal_supplied !== true) {
    return {
      ...base,
      strategy: 'discovery',
      pending_action: 'respond',
      checkout_authorized: false,
      checkout_authorization_type: null,
      next_last_question_type: 'primary_goal',
      allow_purchase_cta: false,
      max_questions: 1,
      deterministic_response: CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE,
    };
  }

  if (goal || safeInterpretation.goal_supplied === true) {
    if (offerContext === 'glp1_validation') {
      return { ...base, strategy: 'conversational', goal: null, max_questions: 0 };
    }
    return { ...base, strategy: 'conversational', next_last_question_type: 'show_example' };
  }

  if (signal === 'broad_information_request') {
    const comprehensiveInformation = hasExplicitComprehensiveInformationRequest(message);
    return {
      ...base,
      strategy: 'broad_information',
      pending_action: 'respond',
      checkout_authorized: false,
      checkout_authorization_type: null,
      next_last_question_type: 'show_example',
      allow_purchase_cta: false,
      max_questions: 1,
      comprehensive_information: comprehensiveInformation,
      deterministic_response: comprehensiveInformation
        ? undefined
        : CANONICAL_POST_DISCOVERY_GENERAL_INFORMATION_RESPONSE,
    };
  }

  if (isWeakAcknowledgement(message) || signal === 'ambiguous_acknowledgement') {
    if (session.last_question_type === 'purchase_confirmation') {
      return { ...base, strategy: 'clarify', next_last_question_type: 'purchase_confirmation', conversation_stage: 'offer' };
    }
    return { ...base, strategy: 'acknowledgement', max_questions: 0 };
  }

  if (signal === 'contextual_affirmation' || isStrongAffirmation(message)) {
    if (session.last_question_type === 'show_example') {
      return { ...base, strategy: 'show_example', next_last_question_type: 'explain_offer' };
    }
    if (session.last_question_type === 'explain_offer') {
      return { ...base, strategy: 'explain_offer', next_last_question_type: 'purchase_confirmation', conversation_stage: 'offer', events: [...new Set([...base.events, 'offer_presented'])] };
    }
    if (validContext(session, now) && isStrongAffirmation(message)) {
      return {
        ...base,
        strategy: 'purchase_confirmation',
        pending_action: 'send_checkout',
        conversation_stage: 'offer',
        checkout_authorized: true,
        checkout_authorization_type: 'contextual',
        max_questions: 0,
        events: [...new Set([...base.events, 'purchase_intent'])],
          ...glp1PurchaseHoldingResponse(offerContext),
      };
    }
    return {
      ...base,
      strategy: 'clarify',
      next_last_question_type: 'purchase_confirmation',
      conversation_stage: 'offer',
    };
  }

  if (signal === 'objection_price' || signal === 'objection_trust' || signal === 'objection_timing') {
    return { ...base, strategy: 'handle_objection', max_questions: 0 };
  }
  if (signal === 'deferred_interest') {
    return { ...base, strategy: 'deferred', max_questions: 0 };
  }
  if (signal === 'gratitude') {
    return { ...base, strategy: 'acknowledgement', max_questions: 0 };
  }
  if (signal === 'information_request' && !goal && !session.goal) {
    return { ...base, strategy: 'discovery', next_last_question_type: 'primary_goal' };
  }
  if (signal === 'question') {
    return { ...base, strategy: 'answer_question' };
  }
  if (signal === 'positive_interest') {
    return { ...base, strategy: 'explain_offer', next_last_question_type: 'purchase_confirmation', conversation_stage: 'offer', events: [...new Set([...base.events, 'offer_presented'])] };
  }
  return base;
}

function containsInternalOfferVersion(message) {
  return /\b\d+d-\d+(?:-[a-z0-9]+)+\b/i.test(String(message || ''));
}

function questionCount(message) {
  return (String(message || '').match(/\?/g) || []).length;
}

function responseHasAmbiguousQuestion(message) {
  const questions = String(message || '').split('?').slice(0, -1);
  return questions.some((question) => {
    const normalized = normalizeMessage(question);
    const offersAlternatives = /\b(?:quieres|prefieres|te gustaria|puedo)\b.{0,100}\bo\b.{0,100}\b(?:quieres|prefieres|te explico|te cuento|te muestro|saber|ver|como|que)\b/.test(normalized);
    const actionMenu = /\bque te gustaria (?:saber|conocer)\b/.test(normalized) &&
      /(?:,|\bo\b).*(?:como funciona|que incluye|como se personaliza|comprar|precio|pago)/.test(normalized);
    return offersAlternatives || actionMenu;
  });
}

function responseViolatesContract(message, maxQuestions = 1) {
  const value = String(message || '');
  return !value.trim() ||
    questionCount(value) > maxQuestions ||
    responseHasAmbiguousQuestion(value) ||
    containsInternalOfferVersion(value) ||
    /\$\s*99|99\s*MXN|al mes|mensualidad recurrente|suscr[ií]b/i.test(value) ||
    /no aceptamos\s+(?:PayPal|OXXO)|planes? de 7 d[ií]as.*actualiz/i.test(value);
}

module.exports = {
  glp1PurchaseHoldingResponse,
  detectOfferContext,
  glp1ResponseViolatesScope,
  medicationIntent,
  glp1SafetyResponse,
  glp1ProductScopeResponse,
  BUYER_SIGNALS,
  RESPONSE_STRATEGIES,
  CONVERSATION_STAGES,
  LAST_QUESTION_TYPES,
  MATERIAL_TOPICS,
  SECONDARY_EVENT_BY_SIGNAL,
  CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE,
  CANONICAL_POST_DISCOVERY_GENERAL_INFORMATION_RESPONSE,
  POST_28_DAY_RESPONSE,
  PREPARED_FOOD_DELIVERY_RESPONSE,
  REPEATED_BILLING_CLARIFICATION,
  normalizeMessage,
  isStrongAffirmation,
  isWeakAcknowledgement,
  hasDeterministicBroadInformationRequest,
  hasExplicitComprehensiveInformationRequest,
  hasDeterministicExplicitPurchase,
  hasDeterministicPortalRecoveryRequest,
  hasDeterministicPaidAccountRequest,
  hasDeterministicAiValueObjection,
  hasDeterministicMaterialQuestion,
  asksBusinessLocation,
  asksPost28DayContinuation,
  asksPreparedFoodDelivery,
  asksBasicBilling,
  explicitlyUnresolved,
  repeatedBillingNeedsClarification,
  hasCheckoutAlreadySent,
  resolveCurrentCommercialQuestions,
  isInitialGenericInquiry,
  isSubstantiveEngagement,
  validContext,
  validatedReminderTime,
  topicEvent,
  decideSalesTurn,
  containsInternalOfferVersion,
  questionCount,
  responseHasAmbiguousQuestion,
  responseViolatesContract,
};
