'use strict';

// Self-contained for embedding in the canonical n8n validator. Policy remains
// the only source of strategy, side-effect authorization and safety overrides.
function repairInformationalResponse(text, decision) {
  if (decision.strategy !== 'answer_question' || decision.deterministic_response) return text;
  const sentences = String(text || '').match(/[\s\S]+?(?:[!?](?=\s|$)|\.(?=\s|$)|\n|$)/g) || [];
  const unsupported = /(?:basamos|personalizamos|usamos|recogemos|solicitamos).{0,35}objetivos|horarios|n[uú]mero de comidas|cu[aá]ntas comidas|frecuencia de pescado|(?:fuentes|preferencias) de prote[ií]na|si cocinas en casa|tiempo disponible|porciones habituales|(?:mantener|preservar|garantiza\w*) (?:tu |la )?masa muscular|no (?:pedimos|solicitamos) (?:datos|detalles) m[eé]dicos|nutri[oó]logo.{0,30}(?:revisa|elabora)|(?:ajustamos|calculamos|prescribimos).{0,35}(?:calor[ií]as|macros|macronutrientes)/i;
  const sensitiveRequest = /(?:¿\s*(?:cu[aá]nto|cu[aá]l|qu[eé]|tienes|tomas|usas|padeces)\b[^?]*|^\s*(?:dime|comparte|indica|cu[eé]ntame)\b[^.!?]*)(?:peso|pesas|estatura|mides|edad|alergias|condiciones m[eé]dicas|medicamentos|medicaci[oó]n|diagn[oó]stico|restricciones)/i;
  const safe = sentences.filter(sentence => !unsupported.test(sentence) && !sensitiveRequest.test(sentence));
  return safe.length === sentences.length ? text : safe.join('').trim();
}

function constrainInformationalCta(text, decision) {
  if (decision.strategy !== 'answer_question' || decision.allow_purchase_cta === true || decision.checkout_authorized === true) return text;
  // Remove whole action clauses, including generated links and imperative CTAs.
  const sentences = String(text || '').match(/[\s\S]+?(?:[!?](?=\s|$)|\.(?=\s|$)|\n|$)/g) || [];
  const safe = sentences.filter(sentence => !/https?:|www\.|(?:(?:¿|^\s*)(?:quieres|te gustar[ií]a|puedo)|te (?:env[ií]o|mando|comparto)).{0,80}(?:enlace|link|comprar|adquirir|contratar|pagar|comenzar|empezar)|(?:compra|paga|contrata|adquiere|comienza|empieza|entra|visita|haz clic)\b.{0,60}(?:ahora|aqu[ií]|programa|enlace|link|pago)|programa-glp1/i.test(sentence));
  return safe.length === sentences.length ? text : safe.join('').trim();
}

module.exports = { repairInformationalResponse, constrainInformationalCta };

// Topic-specific factual boundary, not a replacement sales strategy. Preserve
// natural digital-service answers; reject unsupported premises/coverage and
// unrelated commercial/discovery content even if it contains the word "portal".
function preserveBusinessLocationResponse(text) {
  const value = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const answersModality = /\b(?:digital|en linea|online|por internet)\b/.test(value) ||
    /\bno (?:tenemos|contamos con|ofrecemos|hay)\b.{0,35}\b(?:consultorio|sucursal|oficina|atencion presencial)\b/.test(value);
  const unsupported = /\b(?:estamos|nos encontramos|ubicados|ubicada|direccion|calle|avenida|colonia|visitanos|acude|cobertura|paises|ciudades|todo el mundo|toda la republica|disponible en|atendemos en)\b|\b(?:tenemos|contamos con|ofrecemos)\b.{0,25}\b(?:sucursal|oficina|consultorio|clinica|atencion presencial|consulta presencial)\b|\b(?:entregamos|enviamos|llevamos)\b.{0,25}\bcomida\b/;
  const unrelated = /\$|\b(?:mxn|oxxo|apple pay|tarjeta|checkout|precio|cuesta|pagar|pago|comprar|objetivo|conseguir|bajar de peso)\b/;
  // Negative premises statements are supported; positive premises are not.
  const positiveClaims = value.replace(/\bno (?:tenemos|contamos con|ofrecemos|hay)\b/g, '');
  return answersModality && !unsupported.test(positiveClaims) && !unrelated.test(value);
}
module.exports.preserveBusinessLocationResponse = preserveBusinessLocationResponse;

// Current-message-only diagnostic extraction. This is deliberately independent
// of the single classifier topic; it never authorizes an action. Matching is
// bounded to explicit questions/requests, not conversational profile statements.
function explicitProductQuestions(message) {
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Preview requests can be imperative and omit punctuation. Require a viewing
  // request plus a meal/day object, or an otherwise unqualified sample request.
  const sampleText = text.replace(/\bpor ejemplo\b/g, '');
  const sampleRequest = /\b(?:ver|verlo|muestra\w*|ensena\w*|ejemplo)\b/.test(sampleText) && (
    /\b(?:ejemplo|muestra)\b.{0,35}\b(?:plan|menu|dia|comidas?|alimentacion)\b|\b(?:plan|menu|dia)\b.{0,35}\b(?:ejemplo|muestra|para ver)\b|\b(?:ensena\w*|muestra\w*|ver)\b.{0,30}\b(?:como (?:seria|es|se ve) un dia|que comidas|que ponen)\b/.test(sampleText) ||
    /\b(?:ver|mostrar|ensename|muestrame)(?:me)? (?:(?:un|una|algun|alguna) )?(?:ejemplo|muestra)(?:[?.,!\s]|$)/.test(sampleText) &&
      !/\b(?:ejemplo|muestra)\s+(?:de|sobre|para)\s+(?!plan\b|menu\b|un dia\b|comidas?\b)/.test(sampleText)
  );
  const asks = sampleRequest || /[?¿]|\b(?:quisiera saber|quiero (?:saber|aclarar)|dime|explica\w*|contesta|aclarar|dudas|aceptan|(?:dan|generan|emiten) (?:factura|cfdi)|cuando (?:empiezo|comienzo)|como (?:lo )?personaliz\w*|cuanto cuesta|como funciona|que incluye|cuanto tarda|en cuantas horas|cuando|como se)\b/.test(text);
  if (!asks) return [];
  if (/^\s*¿?(?:y )?como funciona (?:eso|esto)\s*\??$/.test(text)) return []; // Referent requires conversational history.
  const patterns = {
    sample_plan: sampleRequest ? /\b(?:ejemplo|muestra|menu|dia|comidas)\b/ : /(?!)/,
    invoice: /\b(?:factura\w*|cfdi)\b/,
    guarantee: /\b(?:garantia|garantizan|garantizado\w*)\b/,
    business_location: /\b(?:presencial|fisicamente|en linea|online|digital|consultorio|sucursal|oficinas?|ubicad\w*|donde estan|ir a (?:un|una|sus?)|atencion fisica)\b/,
    credentials: /\b(?:nutriolog\w*|nutricionist\w*|humano|persona o ia|persona real|inteligencia artificial|ia|quien (?:me |lo |nos )?(?:crea|hace|arma|disena|elabora|prepara)|credenciales|certificacion)\b/,
    personalization: /\b(?:personaliz\w*|alergias|preferencias|restricciones|alimentos (?:que evito|a evitar)|gustos|(?:adaptan|ajustan).{0,30}(?:lo que|alimentos)|(?:no puedo|evito) comer)\b/,
    glp1_suitability: /\b(?:plan|programa|comidas|dietavity)\b.{0,100}\b(?:glp[ \u2010-\u2015-]?1|semaglutida|ozempic)\b/,
    portal: /\b(?:accedo|acceder|entro|entrar|acceso|consulto|veo|consultar)\b.{0,35}\bportal\b/,
    medication_scope: /\b(?:incluye[n]?|venden|dan|recetan|necesito|requiere[n]?).{0,25}(?:medicamento|glp[ -]?1|ozempic|semaglutida)\b/,
    trial_promotion: /\b(?:prueba|probarlo|probar|promocion\w*|descuento\w*|gratis|gratuita|cupon\w*)\b/,
    fulfillment_timing: /\b(?:cuanto (?:tiempo )?(?:suelen? )?(?:tardar|demorar|tardan?|demoran?)|en cuant[oa]s? (?:horas|dias)|cuando (?:va a estar|estara|esta|queda|quedara|puedo verlo|puedo ver|puedo acceder|podre acceder|aparece|se genera|se entrega|recibo))\b/,
    fulfillment_notification: /\b(?:me (?:avisan|avisaran|avisas|avisa|avise|notifican|notificaran)|me llega (?:algun |un )?aviso|como se)\b.{0,70}\b(?:listo|disponible|generad[oa]|quedo|portal)\b/,
    payment_methods: /\b(?:metodos? de pago|formas? de pago|como (?:puedo )?pagar|(?:puedo |se puede )?pagar con|aceptan|tarjeta\w*|oxxo|apple pay|paypal|transferencia)\b/,
    refund: /\b(?:reembolso\w*|devolucion\w*|devuelven|devolver.*dinero|regresan.*dinero)\b/,
    WhatsApp_assistance: /\b(?:whatsapp|apoyo|soporte|ayuda (?:durante|por)|recetas a demanda)\b/,
    support_limits: /\b(?:limite|limites|maximo)\b.{0,45}\b(?:mensajes|consultas)\b|\blimite\b.{0,60}\bwhatsapp\b/,
    support_timing: /\b(?:tiempo (?:estimado )?de respuesta|cuanto (?:tardan|demoran) en (?:contestar|responder)|respond(?:e|en|er) (?:rapido|en)|24\s*\/\s*7|horario de (?:atencion|soporte))\b/,
    price: /\b(?:cuanto cuesta|cuanto (?:vale|cobran)|precio|costo|coste)\b/,
    billing: /\b(?:suscripcion|mensualidad|renueva|renovacion|recurrente|cada mes|por mes|paga[rs]? una vez|pago unico|un solo pago)\b/,
    prepared_food: /\b(?:comidas? preparadas?|comidas? listas?|platos listos|(?:mandan|entregan|envian|llevan|traen).{0,35}(?:comida|platillos|platos)|a domicilio|(?:comidas?|platillos) a casa)\b/,
    what_is_included: /\b(?:que incluye|que recibo|que viene incluido|inclusiones|cuantas comidas)\b/,
    how_it_works: /\b(?:como funciona|como (?:se usa|uso el)|en que (?:se basan?|consiste)|como arman)\b/,
    start_date: /\b(?:cuando (?:puedo )?(?:empezar|comenzar|empiezo|comienzo)|fecha de inicio|elegir (?:el inicio|cuando empezar))\b/,
    after_payment: /\b(?:despues de (?:pagar|la compra|comprar|completar el pago)|tras (?:pagar|el pago)|que (?:pasa|sigue) (?:al|cuando) (?:pago|pagar))\b/,
    post_purchase: /\b(?:despues de (?:los )?28 dias|al (?:terminar|acabar) (?:el programa|los 28 dias))\b/,
    testimonials: /\b(?:testimonios|resenas|casos de exito|opiniones de clientes)\b/,
    international_pricing: /\b(?:dolares|usd|euros|extranjero|otro pais|fuera de mexico|precio internacional)\b/,
    setup_data: /\b(?:datos medicos|formulario|setup)\b/,
    shopping_list: /\blistas? (?:de (?:compras?|super)|semanal(?:es)?)\b/,
    support_contact: /\b(?:contacto|email|correo|telefono|con quien hablo)\b/,
    privacy: /\b(?:privacidad|datos personales|datos sensibles|protegen (?:mi|la) informacion)\b/,
  };
  const durationClauses = text.split(/[?;\n]/).filter(clause => patterns.fulfillment_timing.test(clause));
  if (!durationClauses.some(clause =>
    /\b(?:plan|programa|portal|generar\w*|pagar|pago|personalizacion|listo|disponible|acceder)\b/.test(clause) ||
    /^\s*¿?(?:despues de pagar )?(?:cuanto (?:tiempo )?(?:suelen? )?(?:tardar|demorar|tardan?|demoran?)|en cuantas horas (?:esta|queda) listo|cuando estara disponible)\s*$/.test(clause))) patterns.fulfillment_timing = /(?!)/;
  const topics = Object.entries(patterns).map(([topic, re]) => ({topic, index: text.search(re)}))
    .filter(match => match.index >= 0).sort((a, b) => a.index - b.index).map(match => match.topic);
  const unconfirmedQuestion = text.split(/[?;\n]/).some(clause =>
    /¿\s*(?:tienen|ofrecen|hacen|hay|puedo|la app|su app|el programa)/.test(clause) &&
    !Object.values(patterns).some(re => re.test(clause)));
  if (topics.includes('fulfillment_timing')) {
    const index = topics.indexOf('after_payment');
    if (index >= 0) topics.splice(index, 1);
  }
  if (unconfirmedQuestion) topics.push('unconfirmed_detail');
  return topics;
}

// Coverage means detectable semantic coverage, NOT factual correctness. Report
// both layers so a truthful deterministic repair isn't confused with model trust.
function productAnswerCoverage(topics, answer) {
  const text = String(answer || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const patterns = {
    sample_plan: /ejemplo ilustrativo|muestra ilustrativa/,
    invoice: /(?:no tengo|no hay).{0,50}(?:confirmad).{0,40}(?:factura|cfdi)/,
    guarantee: /no.{0,50}garantia/,
    after_payment: /despues del pago.{0,40}personalizacion/,
    business_location: /digital|en linea|online|no.{0,25}presencial/,
    credentials: /inteligencia artificial|nutriologo humano|no.{0,20}persona/,
    personalization: /alergias|alimentos a evitar|estilo de alimentacion|personalizacion/,
    trial_promotion: /prueba|promocion|descuento|cupon/,
    glp1_suitability: /adultos.{0,70}glp[ -]?1|glp[ -]?1.{0,70}supervision medica/,
    portal: /portal dietavity/,
    medication_scope: /no.{0,30}(?:vende|receta).{0,25}medicamento/,
    unconfirmed_detail: /(?:otra funcion|otro detalle).{0,35}(?:confirmad|definid)|informacion confirmada sobre esa otra/,
    fulfillment_timing: /(?:genera\w*|disponible|listo|consult\w*).{0,100}portal|portal.{0,100}(?:genera\w*|disponible|listo)|(?:tiempo|plazo).{0,35}(?:exacto|confirmado)/,
    fulfillment_notification: /(?:aviso|notificacion|avisen|notifiquen).{0,100}(?:listo|disponible|generad)|(?:listo|disponible).{0,100}(?:aviso|notificacion)/,
    payment_methods: /oxxo|apple pay|tarjeta/,
    refund: /reembolso|devolucion/,
    WhatsApp_assistance: /whatsapp|apoyo bajo demanda/,
    support_limits: /no tengo un limite de mensajes o consultas confirmado/,
    support_timing: /tiempo.{0,25}respuesta|plazo.{0,25}respuesta|horario.{0,25}(?:atencion|soporte)|24\s*\/\s*7/,
    price: /149|precio|cuesta|costo/,
    billing: /pago unico|un solo pago|suscripcion|renovacion|mensualidad/,
    prepared_food: /comida preparada|platillos.{0,20}(?:casa|domicilio)|tu (?:la )?preparas/,
    what_is_included: /desayuno.{0,50}(?:snack|colacion)|cuatro comidas diarias/,
    how_it_works: /despues del pago|portal|programa de 28 dias|armamos el plan con inteligencia artificial|principios de alimentacion/,
    start_date: /fecha.{0,20}inicio|comenzar.{0,30}30 dias/,
    post_purchase: /terminar.{0,20}28 dias|despues.{0,20}28 dias|otro programa/,
    testimonials: /testimonios|resenas/,
    international_pricing: /precio.{0,25}(?:internacional|otra moneda)|dolares|euros/,
    setup_data: /despues del pago.{0,70}consentimiento|datos.{0,80}personalizacion/,
    shopping_list: /lista.{0,35}(?:compras|super)|ingredientes.{0,50}categorias/,
    support_contact: /soporte@dietavity\.com/,
    privacy: /aviso de privacidad|datos personales|datos sensibles/,
  };
  const covered_topics = topics.filter(topic => patterns[topic]?.test(text));
  return {covered_topics, missing_topics: topics.filter(topic => !covered_topics.includes(topic)),
    covered_count: covered_topics.length, requested_count: topics.length};
}
function multiTopicDiagnostics(message, generated, final, decision = {}) {
  const topics = explicitProductQuestions(message);
  const generatedCoverage = productAnswerCoverage(topics, generated);
  const finalCoverage = productAnswerCoverage(topics, final);
  const lost = generatedCoverage.covered_topics.filter(topic => !finalCoverage.covered_topics.includes(topic));
  return {historical_state_used_for_intent: decision.historical_state_used_for_intent === true,
    explicit_current_questions_present: topics.length > 0, explicit_current_question_topics: topics,
    multi_topic_turn: topics.length > 1, generated_answer_coverage: generatedCoverage, final_answer_coverage: finalCoverage,
    coverage_warnings: topics.length > 1 && generatedCoverage.covered_count >= 2 && lost.length > 0
      ? ['POSSIBLE_MULTI_TOPIC_COVERAGE_LOSS'] : []};
}

// Free-form clause entailment cannot be established reliably with regexes.
// Reconstruct only the explicitly requested supported fact units, rather than
// trusting a plausible draft or losing all but the primary topic. Medical policy
// and action routes stay authoritative and never enter this answer-only path.
function canonicalMultiTopicResponse(message, decision, facts) {
  const topics = explicitProductQuestions(message);
  if ((topics.length < 2 && !topics.some(t => ['sample_plan', 'invoice', 'guarantee', 'fulfillment_timing', 'fulfillment_notification'].includes(t))) || decision.strategy !== 'answer_question' || decision.pending_action !== 'respond' ||
      decision.checkout_authorized || decision.holding_page_would_be_sent || decision.topic === 'health_scope' ||
      ['management', 'urgent'].includes(decision.medication_intent) || decision.deterministic_reason === 'medication_safety') return null;
  const answers = topics.map(topic => facts[topic]).filter(Boolean);
  if (answers.length !== topics.length) return null; // Unknown contract never invents facts.
  if (answers.length === 1) return answers[0];
  return answers.map((answer, index) => `${index + 1}. ${answer}`).join('\n\n');
}
module.exports.explicitProductQuestions = explicitProductQuestions;
module.exports.productAnswerCoverage = productAnswerCoverage;
module.exports.multiTopicDiagnostics = multiTopicDiagnostics;
module.exports.canonicalMultiTopicResponse = canonicalMultiTopicResponse;

// Current text is necessary evidence; model flags and prior turns cannot grant
// reminder intent. Readiness notification questions are a separate contract.
function hasExplicitCurrentReminderRequest(message) {
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\bno\s+(?:(?:me|quiero|necesito|que)\s+)*(?:recuerd\w*|record\w*|avis\w*)/.test(text)) return false;
  return /\b(?:recuerdame|recordarme|me (?:puedes |podrias |podrian |pueden )?recordar)\b/.test(text) ||
    /\b(?:avisame|me (?:puedes |podrias )?avisar)\b.{0,45}\b(?:manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|en \w+ (?:dias|semanas)|el \d+)\b/.test(text) &&
    !/\b(?:listo|disponible|generad[oa])\b/.test(text);
}
module.exports.hasExplicitCurrentReminderRequest = hasExplicitCurrentReminderRequest;

// A topic match is not evidence that all requested details are known. Keep the
// actual request units, including modifiers outside the canonical vocabulary.
// This lexical guard is deliberately conservative: it can decline an uncertain
// detail, but never licenses a new fact or a customer side effect.
function currentQuestionUnits(message) {
  const text = String(message || '').slice(0, 4000);
  const units = [];
  for (const part of text.split(/(?<=[?])|[\n.!;]+/)) {
    const value = part.trim().replace(/^(?:y |además,? |entonces,? |si no,? )/i, '');
    if (!value || /^(?:hola|gracias|ok|perfecto|si|sí|no|como funciona eso|cómo funciona eso)$/i.test(value)) continue;
    const start = value.search(/\b(?:qu[eé]|qui[eé]n|c[oó]mo|cu[aá]nt\w*|cu[aá]l\w*|cu[aá]ndo|d[oó]nde|necesitan|requieren|incluy\w*|aceptan|ofrecen|tienen|pued\w*|dan|hay|me (?:das|dan|pasas|pasan)|dame|mu[eé]strame|confir\w*|quiero saber|quisiera saber)\b/i);
    if (start < 0 && !/[¿?]/.test(value)) continue;
    const request = value.replace(/[¿?]/g, '').trim();
    // Unqualified discovery and referential follow-ups remain contextual.
    if (/^(?:y )?(?:quiero saber m[aá]s|qu[eé] ofrecen|qu[eé] es dietavity|c[oó]mo funciona (?:eso|esto)|me das informaci[oó]n)$/i.test(request)) continue;
    if (/^(?:si|sí|ok|okay|perfecto|vale|listo|gracias|no|como|cómo|y)$/i.test(request)) continue;
    units.push(request);
  }
  return [...new Set(units)];
}

function currentQuestionClauses(message) {
  return currentQuestionUnits(message).flatMap(unit => unit.split(/\s+(?:y|adem[aá]s|tambi[eé]n)\s+(?=(?:(?:yo|me|ustedes)\s+)?(?:pued\w*|debo|deber[ií]a|quier\w*|necesit\w*|hay|tienen|ofrecen|incluy\w*|aceptan|das|dan|dame|mu[eé]strame|cu[aá]nt\w*|c[oó]mo|qu[eé]\s|qui[eé]n|confir\w*))/i))
    .map(clause => clause.trim()).filter(Boolean);
}

function constrainedSampleRequest(subject) {
  const text = String(subject).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return /\b(?:vegetarian\w*|vegan\w*|gluten|intoleran\w*|alerg\w*|celiac\w*|sin (?!pagar|comprar|datos|pedir)\w+|segun mi|para mi (?:alergia|condicion|tratamiento))\b/.test(text);
}

// A practical question asks how the customer can use ordinary food or meals.
// It is deliberately narrower than a product question: once the clause names
// Dietavity/the service or asks whether it includes, supports, adapts or
// guarantees something, the normal canonical-fact path remains authoritative.
// The vocabulary identifies speech-act/object classes, not named recipes,
// weekdays or a particular meal-prep technique.
function practicalGuidanceQuestion(subject) {
  const text = String(subject || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!text) return false;
  const providerOrCapability = /\b(?:dietavity|programa|plan|servicio|soporte|app|portal|ustedes|incluye|ofrece|ofrecen|tienen|garantiza\w*|adapta\w*|confirma\w*|pueden)\b/;
  if (providerOrCapability.test(text)) return false;
  const foodObject = /\b(?:comidas?|recetas?|ingredientes?|porciones?|cocina|sesion(?:es)?|cenas?|almuerzos?|desayunos?|platos?|alimentos?)\b/;
  const practicalAction = /\b(?:organiz\w*|prepar\w*|cocin\w*|guard\w*|conserv\w*|congel\w*|recal\w*|dur\w*|escal\w*|multiplic\w*|divid\w*|combin\w*|sustitu\w*|planific\w*|mov\w*|cambi\w*|ajust\w*)\b/;
  // Cooking and portioning are themselves unambiguous food-use objects, even
  // when a pronoun such as "lo" carries the meal referent from the turn.
  return (foodObject.test(text) || /\b(?:cocin\w*|porcion\w*)\b/.test(text)) && practicalAction.test(text);
}

function currentQuestionDetails(message, facts, confirmedResponse = '') {
  // Grammatical words and request verbs convey speech acts, not product facts.
  const grammar = new Set(`
    informacion menus a al algo algun alguna algunos algunas ante antes con contra cual cuales cuando cuanto cuanta cuantos cuantas
    como de del desde donde puedes contamos veo ver cobrar mes mensual paga despues contar mas el ella
    ellos en entre es esa esas ese eso esos esta estas este esto estos exactamente forma hay la
    las le les lo los me mi mis muy no nos o para por porque que quien quienes
    se si sin sobre su sus te tienen tiene tener tu tus un una unos unas ustedes y
    ya yo usted puedo puede pueden podria podrian quiero quisiera saber dime dame dar da dan das mostrar
    muestra muestrame mostrarme verlo ejemplo ejemplos incluye incluyen incluyes incluido incluida recibo recibir necesito necesitan requiere requieren ser
    seria son sera hacer hace hacen haceis funciona funcionan funcionar confirmar confirman confirmen confirmenme confirma confirmacion realmente real
    favor gracias ahora entonces ademas tambien solo solamente durante inicio empezar comenzar estar estara quede quedo queda entrega
    aparece llega suele suelen alimentacion personalmente ir verlos toman consideran respetan base basa basan ensenas ensena ensename ensenar
    buenas tardes hola buenos noches cuentame explicame trata interesa conocer dieta metodo depende edad cobro cobra cobran otra
    cada sigo duda sucede detalladamente detalles mandame mandas enviame enlace link comprarlo contratarlo pero muestras completa completo todo
    toda todos todas normalmente pasa tengo avise avisaran dias manana respecto acerca costo cuesta cuestan precio pago pagar
    plan programa dietavity servicio comidas comida menu dia
  `.trim().split(/\s+/));
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const terms = value => (normalize(value).match(/[a-z0-9]+/g) || []).filter(t => t.length > 2 && !grammar.has(t));
  const stem = t => t.length > 5 ? t.slice(0,5) : t;
  return currentQuestionClauses(message).map(subject => {
    const topics = explicitProductQuestions(subject + '?').filter(t => t !== 'unconfirmed_detail');
    const confirmed = topics.map(t => facts[t] || '').join(' ') + ' ' + confirmedResponse;
    const vocabulary = new Set(terms(confirmed).map(stem));
    const topicAliases = new Set([
      ...(topics.some(t => ['glp1_suitability','medication_scope'].includes(t)) ? ['glp1','estoy','usando','usan','uso','pensado','pensada','personas','adultos'] : []),
      ...(topics.includes('support_timing') ? ['rapido','rapidez','responder','correo'] : []),
    ]);
    const missing = terms(subject.replace(/\bentregas? en\s+[\p{L}]+$/iu, 'entrega').replace(/\bd[oó]nde entregan$/iu, 'entrega')).filter(t => !topicAliases.has(t) && !vocabulary.has(stem(t)) && !explicitProductQuestions(t + '?').some(topic => topics.includes(topic)));
    // Canonical aliases name the same fact, not an additional requested feature.
    const aliases = /^(?:funcion\w*|arma\w*|crea\w*|elabor\w*|disena\w*|tard\w*|demor\w*|atiend\w*|lleven|gener\w*|entrega\w*|manda\w*|paga\w*|empiezo|comienzo|domicilio|cierto|listo|lista|listos|listas|personaliz\w*|informacion|factura|cfdi|acepta\w*|ubicad\w*|estan|digital|presencial|linea|metodo\w*|forma\w*|pago\w*|tarjeta\w*|transferencia|suscripcion|mensualidad|renovacion|recurrente\w*|unico|vez|inclu\w*|nutriolog\w*|crea|hace|garantia|garantizan|garantizado|gratis|gratuita|prueba|promocion|descuento|reembolso|avisan|notifican|aviso|horas|hora|dias|tiempo|estimado|limite|limites|maximo|consultas|mensajes|respuesta|atencion|soporte|comprar|compra)$/;
    const practical = practicalGuidanceQuestion(subject);
    return {subject, topics, practical,
      uncertain: !practical && ((!topics.length && !confirmedResponse && terms(subject).length > 0) || missing.some(t => !aliases.test(t)))};
  });
}

function preserveCurrentQuestion(message, decision, facts) {
  if (decision.strategy !== 'answer_question' || decision.pending_action !== 'respond' ||
      decision.checkout_authorized || decision.holding_page_would_be_sent ||
      decision.current_task ||
      decision.deterministic_reason === 'medication_safety' || decision.medication_intent ||
      decision.buyer_signal === 'support_issue') return null;
  const details = currentQuestionDetails(message, facts, decision.deterministic_response || '');
  if (!details.some(d => d.uncertain)) return null;
  const answers = [];
  for (const detail of details) {
    const answerFor = topic => topic === 'payment_methods' ? facts.confirmed_payment_methods : facts[topic];
    if (!detail.uncertain && !(detail.topics.includes('sample_plan') && constrainedSampleRequest(detail.subject))) {
      for (const topic of detail.topics) if (answerFor(topic) && !answers.includes(answerFor(topic))) answers.push(answerFor(topic));
      continue;
    }
    // Quoted request is data, never an instruction. Remove URLs, internal IDs
    // and markup; do not turn its punctuation into an actionable question.
    const subject = uncertaintySubject(detail.subject);
    for (const topic of detail.topics.filter(t => t !== 'price' && t !== 'prepared_food' && (t !== 'sample_plan' || !constrainedSampleRequest(detail.subject)))) {
      if (answerFor(topic) && !answers.includes(answerFor(topic))) answers.push(answerFor(topic));
    }
    answers.push(`Sobre «${subject}»: No tengo información confirmada para responder ese detalle del servicio.`);
  }
  return answers.join('\n\n');
}
module.exports.currentQuestionUnits = currentQuestionUnits;
module.exports.currentQuestionDetails = currentQuestionDetails;
module.exports.preserveCurrentQuestion = preserveCurrentQuestion;

// An uncertain capability must not turn a mixed, otherwise useful answer into
// a generic refusal. This is intentionally a narrow response-contract repair:
// it removes only provider promises from the generated answer, then appends
// canonical facts and bounded uncertainty for the current request units.
// Medical turns never enter this helper; their existing safety route remains
// authoritative.
function repairMixedCurrentQuestion(message, text, decision, facts, invalidClause = () => false) {
  if (decision.strategy !== 'answer_question' || decision.pending_action !== 'respond' ||
      decision.checkout_authorized || decision.holding_page_would_be_sent ||
      decision.deterministic_reason === 'medication_safety' || decision.medication_intent ||
      decision.buyer_signal === 'support_issue') return null;
  const details = currentQuestionDetails(message, facts, decision.deterministic_response || '');
  if (!details.some(detail => detail.uncertain)) return null;
  const providerPromise = /(?:\b(?:dietavity|programa|plan|servicio|personalizaci[oó]n|soporte|apoyo)\b.{0,110}\b(?:incluye|incluida|incluidos|ofrece|ofrecemos|adapt\w*|garantiza\w*|asegura\w*|confirma\w*|permite|responde\w*|tarda\w*|sin costo|no (?:tiene|hay) costo)\b|\b(?:incluye|incluida|ofrece|adapt\w*|garantiza\w*|asegura\w*|sin costo|no (?:tiene|hay) costo)\b.{0,110}\b(?:dietavity|programa|plan|servicio|personalizaci[oó]n|soporte|apoyo)\b)/i;
  const unsafe = /(?:\b(?:garantiza\w*|asegura\w*)\b|\b(?:sube|baja|aumenta|reduce|cambia|ajusta|duplic\w*)\b.{0,45}\b(?:dosis|medicamento|medicaci[oó]n|tratamiento|mg)\b|\b\d+(?:[.,]\d+)?\s*mg\b|MARCADOR_NO_SOPORTADO|\b(?:offer_context|glp1_validation|checkout_authorized)\b)/i;
  // These are capability/SLA assertions even when the draft omits the product
  // name. They are not practical food-use guidance and must not survive merely
  // because another clause is useful.
  const unsupportedCapability = /(?:\b(?:sincroniz\w*|integraci[oó]n|exportaci[oó]n|csv|xml|videollamada\w*|consulta privada)\b|\b(?:te )?avis(?:amos|aremos)\b.{0,45}\b(?:autom[aá]tic\w*|listo|disponible)\b|\b(?:estar[aá]|queda)\b.{0,35}\b(?:en unas horas|mismo d[ií]a|en breve|poco despu[eé]s)\b|\b(?:en unas horas|mismo d[ií]a|en breve|poco despu[eé]s)\b|\b(?:responde(?:mos)?|contest(?:amos|aremos))\b.{0,35}\b(?:minutos?|horas?)\b|(?:ajustamos|calculamos|prescribimos).{0,35}(?:calor[ií]as|porciones|macros|macronutrientes)\b)/i;
  const unknownQualifiedPrice = details.some(detail => detail.uncertain && /\b(?:consulta privada|pdf|imprim\w*|exportaci[oó]n|csv|xml)\b/i.test(detail.subject));
  const units = String(text || '').match(/[\s\S]+?(?:[.!?](?=\s|$)|\n|$)/g) || [];
  const kept = units.filter(unit => unit.trim() && !invalidClause(unit) && !unsafe.test(unit) && !providerPromise.test(unit) &&
    !unsupportedCapability.test(unit) && !(unknownQualifiedPrice && /\$\s*\d+|\b\d+\s*mxn\b/i.test(unit)));
  // A fully unsafe draft must still take the established safe fallback path.
  if (!kept.length) return preserveCurrentQuestion(message, decision, facts);
  const practicalDraft = /\b(?:guarda|recalienta|cocina|prepara|organiza|conserva|congela|divide|multiplica)\w*/i.test(kept.join(' '));
  const explicitBasePrice = /(?:\$\s*149\b|\b149\s*mxn\b)/i.test(String(message));
  const independentKnownTopics = explicitProductQuestions(message).filter(topic =>
    topic !== 'unconfirmed_detail' && !['support_timing', 'support_limits', 'fulfillment_timing', 'fulfillment_notification'].includes(topic));
  // A pure unknown-service answer still uses the mature bounded fallback. The
  // exception is a genuinely mixed food-use answer or an explicit known base
  // price paired with an unknown inclusion/capability.
  if (details.every(detail => detail.uncertain) && !practicalDraft && !explicitBasePrice && independentKnownTopics.length < 2) return preserveCurrentQuestion(message, decision, facts);
  let output = kept.join('').trim();
  const answerFor = topic => topic === 'payment_methods' ? facts.confirmed_payment_methods : facts[topic];
  const appended = [];
  for (const detail of details) {
    if (!detail.uncertain) {
      for (const topic of detail.topics) {
        const answer = answerFor(topic);
        if (answer && !productAnswerCoverage([topic], output).covered_topics.includes(topic) && !appended.includes(answer)) appended.push(answer);
      }
    }
    if (detail.uncertain) {
      const uncertainty = `Sobre «${uncertaintySubject(detail.subject)}»: No tengo información confirmada para responder ese detalle del servicio.`;
      if (!output.includes(uncertainty) && !appended.includes(uncertainty)) appended.push(uncertainty);
    }
  }
  if (appended.length) output += `${output ? '\n\n' : ''}${appended.join('\n\n')}`;
  // This early contract path normally bypasses the later question guard. Honor
  // the deterministic policy's limit without touching answer clauses or the
  // bounded-uncertainty additions above.
  const questions = output.match(/¿[^?]*\?/g) || [];
  const maxQuestions = Number.isInteger(decision.max_questions) ? decision.max_questions : 1;
  if (questions.length > maxQuestions) {
    output = output.replace(/¿[^?]*\?/g, '').replace(/\s+\n/g, '\n').trim();
    if (maxQuestions > 0) output += `\n\n${questions.slice(0, maxQuestions).join('\n')}`;
  }
  return output;
}
module.exports.repairMixedCurrentQuestion = repairMixedCurrentQuestion;

// Deterministic composition for the safe clauses of a mixed medical turn.
// Never accepts a generated draft; only current clauses and canonical facts.
function canonicalClauseAnswers(message, facts) {
  const decision = {strategy:'answer_question',pending_action:'respond'};
  const preserved = preserveCurrentQuestion(message, decision, facts);
  if (preserved !== null) return preserved;
  const topics = [...new Set(currentQuestionClauses(message).flatMap(clause => explicitProductQuestions(clause + '?')))];
  return topics.map(topic => topic === 'payment_methods' ? facts.confirmed_payment_methods : facts[topic]).filter(Boolean).join('\n\n');
}
module.exports.currentQuestionClauses = currentQuestionClauses;
module.exports.constrainedSampleRequest = constrainedSampleRequest;
module.exports.practicalGuidanceQuestion = practicalGuidanceQuestion;
module.exports.canonicalClauseAnswers = canonicalClauseAnswers;

// Keep the quotation boundary identical in production and coverage checks. A
// subject quote on its own is not an answer; it must carry explicit uncertainty.
function uncertaintySubject(subject) {
  return String(subject).replace(/https?:\/\/\S+|www\.\S+|\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b|\b\w*(?:__harness|offer_context|buyer_signal|checkout_authorized|glp1_validation)\w*\b|28d-149-v1/gi,'[dato omitido]')
    .replace(/[«»<>`*_{}\[\]¿?]/g,'').slice(0,500);
}

function currentClauseCoverage(message, answer, medicalIntent, facts) {
  const output = String(answer || '');
  const clauses = currentQuestionClauses(message).map((subject,index) => {
    const medical = medicalIntent(subject);
    if (['management','urgent'].includes(medical)) {
      const covered = medical === 'urgent' ? /busca atención médica de inmediato/.test(output) :
        /profesional que te lo prescribió|busca atención médica de inmediato/.test(output);
      return {clause:index+1,kind:'medical',required_topics:[],covered};
    }
    const detail = currentQuestionDetails(subject + '?',facts)[0];
    if (!detail || (!detail.topics.length && !detail.uncertain)) return null;
    const required = detail.topics.filter(topic => !(topic === 'sample_plan' && constrainedSampleRequest(subject)) &&
      !(['price','prepared_food'].includes(topic) && detail.uncertain));
    const coverage = productAnswerCoverage(required,output);
    const explicitUncertainty = output.includes(`Sobre «${uncertaintySubject(subject)}»: No tengo información confirmada para responder ese detalle del servicio.`);
    return {clause:index+1,kind:'product',required_topics:required,
      missing_topics:coverage.missing_topics,uncertainty_answered:explicitUncertainty,
      covered:coverage.missing_topics.length === 0 && (!detail.uncertain || explicitUncertainty)};
  }).filter(Boolean);
  return {clauses,requested_count:clauses.length,answered_count:clauses.filter(c=>c.covered).length,
    current_questions_answered:clauses.every(c=>c.covered),
    missing_clause_indices:clauses.filter(c=>!c.covered).map(c=>c.clause)};
}
module.exports.uncertaintySubject = uncertaintySubject;
module.exports.currentClauseCoverage = currentClauseCoverage;
