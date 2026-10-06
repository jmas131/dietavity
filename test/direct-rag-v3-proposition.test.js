'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rag = require('../lib/sales-engine-v2/direct-rag-v3');

function run(message, obligations, history = [], recentAssistantMessage = '') {
  const context = rag.buildConversationContext({ currentMessage: message, sessionId: 'v3-test', history, recentAssistantMessage });
  const resolution = rag.resolveObligations({ context, obligations: rag.validateObligations(obligations, message) });
  const envelope = rag.buildCompositionEnvelope({ context, resolution });
  const response = resolution.permitted_claims.join(' ');
  return { resolution, envelope, response, gate: rag.gateResponse({ envelope, response, coveredObligationIds: obligations.map((_, index) => `o-${index + 1}`), usedClaims: [] }) };
}

test('V3 acceptance contract covers proposition, food use, safety, and checkout suppression', () => {
  const opener = run('¡Hola! Quiero saber más.', [{ type: 'general_information', evidence: '¡Hola! Quiero saber más.' }]);
  assert.match(opener.response, /asistente de alimentación por WhatsApp para personas que usan GLP-1/u);
  assert.equal(opener.response.split(rag.FIRST_CONTACT_DISCOVERY_QUESTION).length - 1, 1);
  assert.equal(opener.gate.cleared, true);
  assert.equal(run('¿Cómo funciona?', [{ type: 'how_it_works', evidence: 'Cómo funciona' }]).response.includes(rag.FIRST_CONTACT_DISCOVERY_QUESTION), false);
  assert.match(run('¿Cuánto cuesta?', [{ type: 'price', evidence: 'Cuánto cuesta' }]).response, /gratis/u);
  assert.match(run('Tengo poca hambre, ¿qué puedo comer?', [{ type: 'food_decision', evidence: 'poca hambre' }]).response, /porción pequeña/u);
  assert.match(run('Tengo huevos, tortillas y aguacate.', [{ type: 'food_context', evidence: 'huevos, tortillas y aguacate' }]).response, /2 huevos revueltos con una tortilla y un poco de aguacate/u);
  assert.match(run('No se me antoja eso.', [{ type: 'recommendation_feedback', evidence: 'No se me antoja eso' }]).response, /para este momento/u);
  assert.match(run('¿Me dan Ozempic?', [{ type: 'glp1_scope', evidence: 'Me dan Ozempic' }]).response, /no vende, entrega ni receta/u);
  assert.match(run('¿Debo bajar mi dosis?', [{ type: 'medical_boundary', evidence: 'bajar mi dosis' }]).response, /Consulta al profesional/u);
  const purchase = run('Quiero contratarlo.', [{ type: 'purchase_intent', evidence: 'Quiero contratarlo' }]);
  assert.equal(purchase.resolution.checkout_suppressed_reason, 'proposition_test_no_checkout');
});

test('delivery-channel obligations answer install and current-chat questions directly', () => {
  const cases = [
    ['¿Cómo lo descargo?', 'Dietavity funciona directamente por WhatsApp; no necesitas descargar una app ni entrar a un portal para usarlo.'],
    ['¿Tengo que descargar una app?', 'Dietavity funciona directamente por WhatsApp; no necesitas descargar una app ni entrar a un portal para usarlo.'],
    ['¿Es este número?', 'Sí 😊 Puedes usar Dietavity directamente en este chat de WhatsApp.'],
    ['¿Es por este número?', 'Sí 😊 Puedes usar Dietavity directamente en este chat de WhatsApp.'],
    ['¿Aquí mismo?', 'Sí 😊 Puedes usar Dietavity directamente en este chat de WhatsApp.', [{ role: 'assistant', text: 'Dietavity funciona por WhatsApp para ayudarte con decisiones de comida.' }]],
    ['¿Tienen app?', 'Dietavity funciona por WhatsApp; no necesitas un portal para usarlo.'],
    ['¿Se usa por WhatsApp?', 'Dietavity funciona por WhatsApp; no necesitas un portal para usarlo.'],
    ['¿Necesito entrar al portal?', 'Dietavity funciona por WhatsApp; no necesitas un portal para usarlo.'],
  ];
  for (const [message, expected, history = []] of cases) {
    const result = run(message, [{ type: 'delivery_channel', evidence: message }], history);
    assert.equal(result.response, expected, message);
    assert.equal(result.envelope.response_policy.max_questions, 0, message);
    assert.equal(result.gate.cleared, true, message);
  }
});

test('V3 gate rejects obsolete, unsupported, and medical-management claims while preserving mixed obligations', () => {
  const mixed = run('Quiero contratarlo y ¿me dan Ozempic? ¿Debo bajar mi dosis?', [
    { type: 'purchase_intent', evidence: 'Quiero contratarlo' },
    { type: 'glp1_scope', evidence: 'me dan Ozempic' },
    { type: 'medical_boundary', evidence: 'bajar mi dosis' },
  ]);
  assert.equal(mixed.resolution.resolved_obligations.length, 3);
  for (const obsolete of ['Cuesta $149 MXN.', 'Incluye 28 días.', 'Lo consultas en el portal.', 'Incluye desayuno, comida, cena y snack.', 'Te envío el checkout.']) {
    assert.equal(rag.gateResponse({ envelope: mixed.envelope, response: obsolete, coveredObligationIds: ['o-1', 'o-2', 'o-3'], usedClaims: [] }).reason, 'OBSOLETE_CURRENT_PRODUCT_CLAIM', obsolete);
  }
  assert.equal(rag.gateResponse({ envelope: mixed.envelope, response: 'Baja tu dosis a 2 mg.', coveredObligationIds: ['o-1', 'o-2', 'o-3'], usedClaims: [] }).reason, 'MEDICATION_GUIDANCE');
});

test('V3 explicitly authorizes one necessary food clarification and rejects substitutions or duplicates', () => {
  const lowAppetite = run('Tengo poca hambre, ¿qué puedo comer?', [{ type: 'food_decision', evidence: 'poca hambre' }]);
  const question = '¿Qué alimentos tienes disponibles ahora?';
  assert.equal(lowAppetite.resolution.conversation_policy.food_clarification_authorized, true);
  assert.equal(lowAppetite.envelope.response_policy.question_authorization.food_clarification, true);
  assert.equal(lowAppetite.envelope.response_policy.question_authorization.authorized_food_clarification_question, question);
  assert.equal(lowAppetite.gate.cleared, true);
  for (const response of [
    'Si tienes poco apetito, empieza con una porción pequeña que aporte proteína. ¿Qué se te antoja?',
    `Si tienes poco apetito, empieza con una porción pequeña que aporte proteína. ${question} ${question}`,
    `Si tienes poco apetito, empieza con una porción pequeña que aporte proteína. ${question} ¿Tienes tiempo para cocinar?`,
  ]) {
    assert.equal(rag.gateResponse({ envelope: lowAppetite.envelope, response, coveredObligationIds: ['o-1'], usedClaims: [] }).cleared, false, response);
  }
});

test('V3 separates recently consumed food from available food before recommending', () => {
  const available = run('Tengo huevos, tortillas y aguacate.', [{ type: 'food_context', evidence: 'Tengo huevos, tortillas y aguacate' }]);
  assert.deepEqual(available.resolution.resolved_obligations[0].food_context, { recently_consumed: [], available_foods: ['huevos', 'tortillas', 'aguacate'], appetite: null, contextual_rejection: false });
  assert.match(available.response, /2 huevos revueltos con una tortilla y un poco de aguacate/u);
  assert.equal(available.gate.cleared, true);

  const consumed = run('Ya comí huevos, tortillas y aguacate.', [{ type: 'food_context', evidence: 'Ya comí huevos, tortillas y aguacate' }]);
  assert.deepEqual(consumed.resolution.resolved_obligations[0].food_context.available_foods, []);
  assert.deepEqual(consumed.resolution.resolved_obligations[0].food_context.recently_consumed, ['huevos', 'tortillas', 'aguacate']);
  assert.doesNotMatch(consumed.response, /2 huevos revueltos/u);
  assert.match(consumed.response, /¿Qué alimentos tienes disponibles ahora\?/u);

  const mixed = run('Desayuné huevos, pero tengo pollo, tortillas y aguacate.', [{ type: 'food_context', evidence: 'Desayuné huevos' }, { type: 'food_decision', evidence: 'tengo pollo, tortillas y aguacate' }]);
  const foodContext = mixed.resolution.resolved_obligations[0].food_context;
  assert.deepEqual(foodContext.recently_consumed, ['huevos']);
  assert.deepEqual(foodContext.available_foods, ['pollo', 'tortillas', 'aguacate']);
  assert.doesNotMatch(mixed.response, /2 huevos revueltos/u);
  assert.match(mixed.response, /tortilla con pollo y un poco de aguacate/u);
  assert.equal(mixed.gate.cleared, true);
});

test('V3.1 interprets an availability-question answer without repeating the availability loop', () => {
  const availabilityQuestion = '¿Qué alimentos tienes disponibles ahora?';
  const cases = [
    ['Huevos pollo pechuga vegetales arroz', ['huevos', 'pollo', 'pechuga', 'verduras', 'arroz']],
    ['Huevos\nVegetales\nPollo\nPescado\nArroz', ['huevos', 'pollo', 'verduras', 'arroz', 'pescado']],
    ['Huevo, carne, leche verduras', ['huevos', 'verduras', 'carne', 'leche']],
    ['Huevos, carne, verduras, leche y fruta', ['huevos', 'verduras', 'carne', 'leche', 'fruta']],
  ];
  for (const [message, foods] of cases) {
    const result = run(message, [{ type: 'food_context', evidence: message }], [], availabilityQuestion);
    const context = result.resolution.resolved_obligations[0].food_context;
    assert.deepEqual(context.available_foods, foods, message);
    assert.deepEqual(context.recently_consumed, [], message);
    assert.equal(result.resolution.conversation_policy.food_clarification_authorized, false, message);
    assert.doesNotMatch(result.response, /¿Qué alimentos tienes disponibles ahora\?/u, message);
    assert.match(result.response, /^Con lo que tienes, prepara /u, message);
    assert.equal(result.gate.cleared, true, message);
  }
});

test('V3.1 gives explicit current consumption precedence over availability-question inference', () => {
  const availabilityQuestion = 'Para recomendarte algo concreto, ¿Qué alimentos tienes disponibles ahora?';
  const breakfast = '2 huevos con tocino, aguacate, y un café sin azúcar de desayuno';
  const result = run(breakfast, [{ type: 'food_context', evidence: breakfast }], [], availabilityQuestion);
  const context = result.resolution.resolved_obligations[0].food_context;
  assert.deepEqual(context.recently_consumed, ['huevos', 'aguacate', 'tocino', 'cafe']);
  assert.deepEqual(context.available_foods, []);
  assert.match(result.response, /¿Qué alimentos tienes disponibles ahora\?/u);

  const mixedMessage = 'Desayuné huevos, pero tengo pollo, tortillas y aguacate.';
  const mixed = run(mixedMessage, [{ type: 'food_context', evidence: 'Desayuné huevos' }, { type: 'food_decision', evidence: 'tengo pollo, tortillas y aguacate' }], [], availabilityQuestion);
  const mixedContext = mixed.resolution.resolved_obligations[0].food_context;
  assert.deepEqual(mixedContext.recently_consumed, ['huevos']);
  assert.deepEqual(mixedContext.available_foods, ['pollo', 'tortillas', 'aguacate']);
  assert.match(mixed.response, /tortilla con pollo y un poco de aguacate/u);
});

test('V3.1 leaves a bare food list unclassified without the immediately preceding availability question', () => {
  const message = 'Huevos pollo pechuga vegetales arroz';
  const result = run(message, [{ type: 'food_context', evidence: message }]);
  const context = result.resolution.resolved_obligations[0].food_context;
  assert.deepEqual(context.available_foods, []);
  assert.deepEqual(context.recently_consumed, []);
  assert.equal(result.resolution.conversation_policy.food_clarification_authorized, true);
});

test('V3.2B does not carry transient appetite into a later inventory recommendation', () => {
  const availabilityQuestion = '¿Qué alimentos tienes disponibles ahora?';
  const history = [{ role: 'customer', text: 'No tengo hambre.' }, { role: 'assistant', text: availabilityQuestion }];
  const message = 'Pescado, verduras y arroz';
  const result = run(message, [{ type: 'food_context', evidence: message }], history, availabilityQuestion);
  assert.match(result.response, /prepara pescado con verduras/u);
  assert.doesNotMatch(result.response, /porción pequeña y come despacio/u);
  assert.doesNotMatch(result.response, /¿Qué alimentos tienes disponibles ahora\?/u);
});

test('V3.2B Patch 1 extracts bounded semantic context without promoting observations to obligations', () => {
  const prepared = rag.extractSemanticContext('Me preparé un arroz chino con pollo y verduras con salsa de soya');
  assert.deepEqual(prepared.food_context.available_foods, []);
  assert.deepEqual(prepared.food_context.recent_food_events, [{ kind: 'prepared', foods: ['pollo', 'verduras', 'arroz'], evidence: 'me prepare' }]);
  assert.deepEqual(prepared.food_context.recently_consumed, []);

  const consumed = rag.extractSemanticContext('No tengo pollo, pero comí pollo ayer');
  assert.deepEqual(consumed.food_context.available_foods, []);
  assert.deepEqual(consumed.food_context.recently_consumed, ['pollo']);

  const appetite = rag.extractSemanticContext('Me da hambre por momentos mucha hambre y cuando como poco');
  assert.deepEqual(appetite.food_context.appetite_observation, { kind: 'variable_hunger_with_small_intake', evidence: 'current_turn' });

  const professional = rag.extractSemanticContext('Estoy yendo con una nutrióloga que no tiene idea qué es Mounjaro');
  assert.deepEqual(professional.glp1_context, { mentioned: true, usage_reported: false, source: null });
  assert.deepEqual(professional.professional_support_context, { mentioned: true, dissatisfaction_reported: true });
  for (const message of ['¿Qué es Mounjaro?', 'No uso Mounjaro', 'Mi hermana usa Mounjaro', 'Antes usaba Mounjaro']) {
    const context = rag.extractSemanticContext(message);
    assert.equal(context.glp1_context.mentioned, true, message);
    assert.equal(context.glp1_context.usage_reported, false, message);
  }
  for (const message of ['Uso Mounjaro', 'Me están inyectando Mounjaro', 'Tomo semaglutida']) {
    const context = rag.extractSemanticContext(message);
    assert.equal(context.glp1_context.usage_reported, true, message);
    assert.equal(context.glp1_context.source, 'current_turn', message);
  }
  assert.equal(rag.INTERPRETER_OBLIGATION_TYPES.includes('medical_boundary'), true);
  assert.equal(rag.INTERPRETER_OBLIGATION_TYPES.includes('food_context'), false);
  assert.equal(rag.INTERPRETER_OBLIGATION_TYPES.includes('nutrition_support_request'), true);
});

test('V3.2B Patch 1 history is bounded context, never current inventory or durable preference', () => {
  const context = rag.extractSemanticContext('Me pueden ayudar', [{ role: 'customer', text: 'Hola, me están inyectando Mounjaro' }]);
  assert.deepEqual(context.glp1_context, { mentioned: true, usage_reported: true, source: 'history' });
  assert.deepEqual(context.food_context.available_foods, []);
  const negatedGlp1History = rag.extractSemanticContext('Me pueden ayudar', [{ role: 'customer', text: 'No uso Mounjaro' }]);
  assert.deepEqual(negatedGlp1History.glp1_context, { mentioned: true, usage_reported: false, source: null });
  const foodHistory = rag.extractSemanticContext('¿Qué puedo comer?', [{ role: 'customer', text: 'Ayer comí pollo y arroz' }]);
  assert.deepEqual(foodHistory.food_context.available_foods, []);
  assert.deepEqual(foodHistory.food_context.recently_consumed, []);
});

test('V3.2B reconciles only weak generic support classifications with affirmative GLP-1 context', () => {
  const usedGlp1 = rag.extractSemanticContext('¿Me pueden ayudar?', [{ role: 'customer', text: 'Me están inyectando Mounjaro' }]);
  for (const message of ['¿Me pueden ayudar?', '¿Me puedes ayudar?', '¿Me ayudas?', 'Necesito ayuda', 'Necesito ayuda con mi alimentación', 'Busco ayuda']) {
    const reconciled = rag.reconcileWeakNutritionSupportObligations([{ type: 'general_information', evidence: message }], message, usedGlp1);
    assert.deepEqual(reconciled, [{ type: 'nutrition_support_request', evidence: message }], message);
  }
  for (const history of ['No uso Mounjaro', '¿Qué es Mounjaro?', 'Mi hermana usa Mounjaro']) {
    const context = rag.extractSemanticContext('¿Me pueden ayudar?', [{ role: 'customer', text: history }]);
    const retained = rag.reconcileWeakNutritionSupportObligations([{ type: 'general_information', evidence: '¿Me pueden ayudar?' }], '¿Me pueden ayudar?', context);
    assert.deepEqual(retained, [{ type: 'general_information', evidence: '¿Me pueden ayudar?' }], history);
  }
  const medical = [{ type: 'medical_boundary', evidence: 'bajar mi dosis' }];
  assert.equal(rag.reconcileWeakNutritionSupportObligations(medical, '¿Me puedes ayudar a bajar mi dosis?', usedGlp1), medical);
  const food = [{ type: 'food_decision', evidence: 'decidir qué comer' }];
  assert.equal(rag.reconcileWeakNutritionSupportObligations(food, '¿Me ayudas a decidir qué comer?', usedGlp1), food);
});

test('V3.2B reconciles standalone appetite observations without erasing current obligations', () => {
  const standaloneMessage = 'Me da mucha hambre por momentos y cuando como, como poco.';
  const standaloneContext = rag.extractSemanticContext(standaloneMessage, [{ role: 'customer', text: 'Me están inyectando Mounjaro' }]);
  const fallback = rag.reconcileStandaloneAppetiteObservationObligations([{ type: 'nutrition_support_request', evidence: standaloneMessage }], standaloneMessage, standaloneContext);
  assert.deepEqual(fallback, [{ type: 'unsupported', evidence: standaloneMessage }]);
  assert.match(rag.contextualSemanticClaim(standaloneContext), /mucha hambre/u);
  for (const [message, obligation] of [
    ['Tengo poco apetito, ¿me pueden ayudar?', { type: 'nutrition_support_request', evidence: '¿me pueden ayudar?' }],
    ['Tengo poco apetito, ¿qué puedo comer?', { type: 'food_decision', evidence: '¿qué puedo comer?' }],
    ['Tengo poco apetito, ¿debo bajar mi dosis?', { type: 'medical_boundary', evidence: 'bajar mi dosis' }],
    ['Tengo poco apetito, ¿cuánto cuesta?', { type: 'price', evidence: 'cuánto cuesta' }],
    ['Tengo poco apetito, ¿es por WhatsApp?', { type: 'delivery_channel', evidence: 'WhatsApp' }],
  ]) {
    const context = rag.extractSemanticContext(message, [{ role: 'customer', text: 'Me están inyectando Mounjaro' }]);
    assert.equal(rag.reconcileStandaloneAppetiteObservationObligations([obligation], message, context)[0].type, obligation.type, message);
  }
});

test('V3.2B Patch 1 distinguishes future meal language and consumption negation from actual food events', () => {
  for (const message of ['¿Qué puedo comer para la cena?', '¿Qué me recomiendas para desayunar?', 'Quiero preparar pollo para la comida', 'Voy a cenar pollo', 'Nunca comí pollo', 'Jamás comí pollo', 'No cené pollo', 'No desayuné huevos']) {
    const context = rag.extractSemanticContext(message);
    assert.deepEqual(context.food_context.recent_food_events, [], message);
    assert.deepEqual(context.food_context.recently_consumed, [], message);
  }
  for (const [message, kind, foods] of [
    ['Cené pollo', 'consumed', ['pollo']],
    ['Comí pollo en la cena', 'consumed', ['pollo']],
    ['Para desayunar comí huevos', 'consumed', ['huevos']],
    ['Me preparé arroz con pollo', 'prepared', ['pollo', 'arroz']],
  ]) {
    const context = rag.extractSemanticContext(message);
    assert.equal(context.food_context.recent_food_events[0].kind, kind, message);
    assert.deepEqual(context.food_context.recent_food_events[0].foods, foods, message);
  }
  const mixed = rag.extractSemanticContext('No cené pollo, pero comí huevos y tengo verduras');
  assert.deepEqual(mixed.food_context.recently_consumed, ['huevos']);
  assert.deepEqual(mixed.food_context.available_foods, ['verduras']);
});

test('V3.2B semantic food assertions keep polarity per item and exclude interrogative events', () => {
  const availability = [
    ['Tengo pollo y verduras', ['pollo', 'verduras']],
    ['Tengo pollo y no verduras', ['pollo']],
    ['Tengo pollo, pero no verduras', ['pollo']],
    ['No tengo pollo, pero tengo verduras', ['verduras']],
    ['No tengo pollo ni verduras', []],
  ];
  for (const [message, expected] of availability) {
    assert.deepEqual(rag.extractSemanticContext(message).food_context.available_foods, expected, message);
  }

  const consumption = [
    ['Comí pollo y verduras', ['pollo', 'verduras']],
    ['Comí pollo y no verduras', ['pollo']],
    ['Comí pollo, pero no verduras', ['pollo']],
    ['No comí pollo, pero comí verduras', ['verduras']],
    ['Nunca comí pollo', []],
    ['Jamás comí pollo', []],
  ];
  for (const [message, expected] of consumption) {
    assert.deepEqual(rag.extractSemanticContext(message).food_context.recently_consumed, expected, message);
  }

  const prepared = rag.extractSemanticContext('Me preparé arroz y no pollo');
  assert.deepEqual(prepared.food_context.recent_food_events, [{ kind: 'prepared', foods: ['arroz'], evidence: 'me prepare' }]);
  assert.deepEqual(prepared.food_context.recently_consumed, []);
  assert.deepEqual(rag.extractSemanticContext('No preparé pollo, pero preparé arroz').food_context.recent_food_events, [{ kind: 'prepared', foods: ['arroz'], evidence: 'prepare' }]);

  for (const message of ['¿Cené pollo ayer?', '¿Comí pollo ayer?', '¿Me preparé pollo ayer?']) {
    assert.deepEqual(rag.extractSemanticContext(message).food_context.recent_food_events, [], message);
  }
  assert.deepEqual(rag.extractSemanticContext('¿Tengo pollo?').food_context.available_foods, []);
  const mixedTurn = rag.extractSemanticContext('Comí pollo. ¿Qué puedo comer ahora?');
  assert.deepEqual(mixedTurn.food_context.recently_consumed, ['pollo']);
  assert.deepEqual(rag.extractSemanticContext('Tengo pollo. ¿Qué me recomiendas?').food_context.available_foods, ['pollo']);
  const crossed = rag.extractSemanticContext('No tengo pollo, pero comí pollo ayer');
  assert.deepEqual(crossed.food_context.available_foods, []);
  assert.deepEqual(crossed.food_context.recently_consumed, ['pollo']);
  const multiAssertion = rag.extractSemanticContext('No cené pollo, pero comí huevos y tengo verduras');
  assert.deepEqual(multiAssertion.food_context.recently_consumed, ['huevos']);
  assert.deepEqual(multiAssertion.food_context.available_foods, ['verduras']);
});

test('V3.2B Patch 2 resolves support and semantic context without inventory leakage', () => {
  const glpHistory = [{ role: 'customer', text: 'Hola, a mí me están inyectando Mounjaro' }, { role: 'assistant', text: 'Gracias por contármelo.' }];
  const support = run('¿Me pueden ayudar?', [{ type: 'nutrition_support_request', evidence: '¿Me pueden ayudar?' }], glpHistory);
  assert.match(support.response, /mientras usas GLP-1/i);
  assert.match(support.response, /No doy indicaciones sobre dosis/i);
  assert.equal(support.resolution.conversation_policy.food_clarification_authorized, false);
  assert.doesNotMatch(support.response, /¿Qué alimentos tienes disponibles ahora\?/u);

  const professional = run('Estoy yendo con una nutrióloga que no tiene idea qué es Mounjaro', [{ type: 'nutrition_support_request', evidence: 'Estoy yendo con una nutrióloga' }]);
  assert.match(professional.response, /buscas apoyo claro/i);
  assert.doesNotMatch(professional.response, /no tiene idea|incompetente|superior/i);
  assert.equal(professional.resolution.conversation_policy.food_clarification_authorized, false);

  const appetite = run('Me da mucha hambre por momentos y cuando como, como poco.', [{ type: 'unsupported', evidence: 'Me da mucha hambre por momentos y cuando como, como poco.' }]);
  assert.match(appetite.response, /mucha hambre/i);
  assert.equal(appetite.resolution.conversation_policy.food_clarification_authorized, false);
  assert.doesNotMatch(appetite.response, /¿Qué alimentos tienes disponibles ahora\?/u);

  const prepared = run('Me preparé un arroz con pollo y verduras', [{ type: 'unsupported', evidence: 'Me preparé un arroz con pollo y verduras' }]);
  assert.match(prepared.response, /preparaste una comida/i);
  assert.doesNotMatch(prepared.response, /Con lo que tienes|¿Qué alimentos tienes disponibles/u);
  assert.equal(prepared.resolution.semantic_context.food_context.recently_consumed.length, 0);

  const laterDecision = run('¿Qué puedo comer ahora?', [{ type: 'food_decision', evidence: '¿Qué puedo comer ahora?' }], [{ role: 'customer', text: 'Comí pollo y arroz' }, { role: 'assistant', text: 'Gracias por contármelo.' }]);
  assert.match(laterDecision.response, /¿Qué alimentos tienes disponibles ahora\?/u);
  assert.doesNotMatch(laterDecision.response, /pollo con arroz|arroz con pollo/i);

  const availabilityAnswer = run('Huevos pollo pechuga vegetales arroz', [{ type: 'food_decision', evidence: 'Huevos pollo pechuga vegetales arroz' }], [{ role: 'assistant', text: '¿Qué alimentos tienes disponibles ahora?' }]);
  assert.match(availabilityAnswer.response, /^Con lo que tienes, prepara /u);
  assert.equal(availabilityAnswer.resolution.conversation_policy.food_clarification_authorized, false);

  const explicitInventory = run('Tengo pechuga asada, verduras y huevo. ¿Qué me puedo hacer?', [{ type: 'food_decision', evidence: '¿Qué me puedo hacer?' }]);
  assert.match(explicitInventory.response, /^Con lo que tienes, prepara /u);

  const medication = run('¿Debo bajar mi dosis?', [{ type: 'medical_boundary', evidence: '¿Debo bajar mi dosis?' }], glpHistory);
  assert.match(medication.response, /Consulta al profesional/u);
  assert.doesNotMatch(medication.response, /mientras usas GLP-1/i);

  const negatedUsage = run('¿Me pueden ayudar?', [{ type: 'nutrition_support_request', evidence: '¿Me pueden ayudar?' }], [{ role: 'customer', text: 'No uso Mounjaro' }]);
  assert.match(negatedUsage.response, /^Puedo ayudarte con decisiones prácticas/u);
  assert.doesNotMatch(negatedUsage.response, /mientras usas GLP-1/i);

  const future = run('¿Qué puedo comer para la cena?', [{ type: 'food_decision', evidence: '¿Qué puedo comer para la cena?' }]);
  assert.deepEqual(future.resolution.semantic_context.food_context.recent_food_events, []);
  assert.match(future.response, /¿Qué alimentos tienes disponibles ahora\?/u);

  const mixedUnsupported = run('Me da mucha hambre. ¿Pueden hacer videollamada?', [{ type: 'unsupported', evidence: 'videollamada' }, { type: 'nutrition_support_request', evidence: 'Me da mucha hambre' }]);
  assert.match(mixedUnsupported.response, /No tengo información confirmada/u);
  assert.doesNotMatch(mixedUnsupported.response, /por momentos tienes mucha hambre/u);
});
