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

test('V3.1 uses bounded low-appetite context with an inventory outside the retired recipe combinations', () => {
  const availabilityQuestion = '¿Qué alimentos tienes disponibles ahora?';
  const history = [{ role: 'customer', text: 'No tengo hambre.' }, { role: 'assistant', text: availabilityQuestion }];
  const message = 'Pescado, verduras y arroz';
  const result = run(message, [{ type: 'food_context', evidence: message }], history, availabilityQuestion);
  assert.match(result.response, /prepara pescado con verduras/u);
  assert.match(result.response, /porción pequeña y come despacio/u);
  assert.doesNotMatch(result.response, /¿Qué alimentos tienes disponibles ahora\?/u);
});
