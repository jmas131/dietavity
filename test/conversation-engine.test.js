'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationEngine, __testOnly } = require('../lib/conversation-engine/service');
const { ConversationRequestError } = require('../lib/conversation-engine/contracts');
const { ConversationLlmError } = require('../lib/conversation-engine/llm-client');

const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const request = ({ requestId = id(1), inboundId = id(2), processingOrder = 1, currentMessage, history = [] }) => ({
  contract_version: 'conversation-engine-request-v1', request_id: requestId, session_id: 'whatsapp:+5215550000000', inbound_message_id: inboundId,
  processing_order: processingOrder, current_message: currentMessage, canonical_history: history,
});
const historyEntry = (role, text, source_processing_order) => ({ role, text, source_processing_order });

function fixtureLlm(outputs) {
  let call = 0;
  return {
    async interpret() { return outputs[call++]; },
    async compose(envelope) { return { response: envelope.permitted_claims.join(' '), covered_obligation_ids: envelope.resolved_obligations.map(item => item.obligation.id), used_claims: envelope.permitted_claims }; },
  };
}

function parsedAvailability(currentMessage, history = []) {
  return __testOnly.parsedContext({ current_message: currentMessage, canonical_history: history, processing_order: history.length + 1 }, {
    obligations: [{ type: 'unsupported', evidence: currentMessage }], semantic_context: { recommendation_request_evidence: null },
  }).semanticContext.food_availability;
}

test('Node conversation engine executes the five-turn Direct RAG contract with real semantic and V1.3 modules', async () => {
  const diagnostics = [];
  const engine = createConversationEngine({ logger: value => diagnostics.push(value), llmClient: fixtureLlm([
    { obligations: [{ type: 'food_decision', evidence: '¿Qué me recomiendas?' }], semantic_context: { recommendation_request_evidence: '¿Qué me recomiendas?' } },
    { obligations: [{ type: 'acknowledgement', evidence: 'También tengo tortillas, aguacate y jitomate.' }], semantic_context: { recommendation_request_evidence: null } },
    { obligations: [{ type: 'food_decision', evidence: '¿Qué puedo comer ahora?' }], semantic_context: { recommendation_request_evidence: '¿Qué puedo comer ahora?' } },
    { obligations: [{ type: 'acknowledgement', evidence: 'Tengo poca hambre.' }], semantic_context: { recommendation_request_evidence: null } },
    { obligations: [{ type: 'medical_boundary', evidence: '¿Debería bajar mi dosis de Mounjaro si estoy comiendo poco?' }], semantic_context: { recommendation_request_evidence: null } },
  ]) });

  const firstMessage = 'Tengo pollo. ¿Qué me recomiendas?';
  const first = await engine.resolve(request({ currentMessage: firstMessage }));
  assert.equal(first.diagnostics.recommendation.source, 'meal_recommendation_engine_v1_3');
  assert.notEqual(first.diagnostics.recommendation.status, 'integration_failure');
  assert.match(first.assistant_response, /Con pollo, arma un plato sencillo/u);

  const secondMessage = 'También tengo tortillas, aguacate y jitomate.';
  const second = await engine.resolve(request({ requestId: id(3), inboundId: id(4), processingOrder: 2, currentMessage: secondMessage, history: [historyEntry('customer', firstMessage, 1), historyEntry('assistant', first.assistant_response, 1)] }));
  assert.equal(second.persistence.topic, 'food_decision');
  assert.equal(second.diagnostics.recommendation.source, 'meal_recommendation_engine_v1_3');
  assert.equal(second.diagnostics.recommendation.status, 'recommendation');
  assert.doesNotMatch(second.assistant_response, /^¡Con gusto! 😊$/u);
  assert.match(second.assistant_response, /taco de pollo con aguacate/u);

  const thirdMessage = 'Ya comí pollo. ¿Qué puedo comer ahora?';
  const third = await engine.resolve(request({ requestId: id(5), inboundId: id(6), processingOrder: 3, currentMessage: thirdMessage, history: [historyEntry('customer', firstMessage, 1), historyEntry('assistant', first.assistant_response, 1), historyEntry('customer', secondMessage, 2), historyEntry('assistant', second.assistant_response, 2)] }));
  assert.equal(third.diagnostics.recommendation.source, 'meal_recommendation_engine_v1_3');
  assert.notEqual(third.diagnostics.recommendation.status, 'integration_failure');
  assert.match(third.assistant_response, /¿Qué alimentos tienes disponibles ahora\?/u);
  assert.deepEqual(diagnostics[2].food.available_food_ids, ['tortillas', 'aguacate', 'jitomate']);
  assert.deepEqual(diagnostics[2].food.recently_consumed_ids, ['pollo']);

  const appetite = await engine.resolve(request({ requestId: id(7), inboundId: id(8), processingOrder: 4, currentMessage: 'Tengo poca hambre.' }));
  assert.match(appetite.assistant_response, /Entiendo que tienes poco apetito/u);

  const medication = await engine.resolve(request({ requestId: id(9), inboundId: id(10), processingOrder: 5, currentMessage: '¿Debería bajar mi dosis de Mounjaro si estoy comiendo poco?' }));
  assert.match(medication.assistant_response, /Consulta al profesional/u);
  assert.doesNotMatch(medication.assistant_response, /baja tu dosis|reduce tu dosis/iu);
  assert.equal(diagnostics[4].medical_boundary_applied, true);
});

test('conversation engine closes the semantic trust boundary before any LLM call', async () => {
  let called = false;
  const engine = createConversationEngine({ llmClient: { async interpret() { called = true; return {}; }, async compose() { return {}; } } });
  for (const field of ['semantic_context', 'inventory', 'obligations', 'recommendation', 'permitted_claims', 'safety']) {
    const payload = request({ currentMessage: 'Tengo pollo. ¿Qué me recomiendas?' });
    payload[field] = { forged: true };
    await assert.rejects(engine.resolve(payload), error => error instanceof ConversationRequestError);
  }
  await assert.rejects(engine.resolve(request({ currentMessage: 'Tengo pollo.', history: Array.from({ length: 13 }, () => historyEntry('customer', 'x', 1)) })), error => error instanceof ConversationRequestError);
  await assert.rejects(engine.resolve(request({ currentMessage: 'x'.repeat(8001) })), error => error instanceof ConversationRequestError);
  await assert.rejects(engine.resolve(request({ currentMessage: 'Tengo pollo.', history: [historyEntry('customer', 'x', 1), historyEntry('assistant', 'y', 1), historyEntry('customer', 'z', 1)] })), error => error instanceof ConversationRequestError);
  assert.equal(called, false);
});

test('same inbound identity may be retried with a different correlation request ID and no delivery side effect', async () => {
  const engine = createConversationEngine({ llmClient: fixtureLlm([
    { obligations: [{ type: 'acknowledgement', evidence: 'Gracias' }], semantic_context: { recommendation_request_evidence: null } },
    { obligations: [{ type: 'acknowledgement', evidence: 'Gracias' }], semantic_context: { recommendation_request_evidence: null } },
  ]) });
  const base = { inboundId: id(44), processingOrder: 8, currentMessage: 'Gracias' };
  const first = await engine.resolve(request({ ...base, requestId: id(45) }));
  const second = await engine.resolve(request({ ...base, requestId: id(46) }));
  assert.equal(first.request_id, id(45));
  assert.equal(second.request_id, id(46));
  assert.equal(first.assistant_response, second.assistant_response);
  assert.equal(first.resolution.delivery_permitted, true);
});

test('Conversation Engine logs one bounded obligations-stage LLM failure without customer data', async () => {
  const events = [];
  const ticks = [0, 10, 35];
  const engine = createConversationEngine({
    clock: () => ticks.shift(),
    logger: value => events.push(value),
    llmClient: { async interpret() { throw new ConversationLlmError('llm_timeout'); }, async compose() { throw new Error('not reached'); } },
  });
  const currentMessage = 'contenido privado que no debe registrarse';
  await assert.rejects(engine.resolve(request({ requestId: id(47), currentMessage })), error => error instanceof ConversationLlmError && error.code === 'llm_timeout');
  assert.deepEqual(events, [{
    event: 'conversation_engine_llm_failure', request_id: id(47), engine_version: 'direct-rag-v3-v1_3', llm_stage: 'obligations', llm_error_code: 'llm_timeout', upstream_status: null, upstream_category: 'timeout', llm_latency_ms: 25, total_latency_ms: 35,
  }]);
  assert.doesNotMatch(JSON.stringify(events), /contenido privado|whatsapp|inbound_message_id/u);
});

test('Conversation Engine logs one bounded composition-stage LLM failure with sanitized upstream status', async () => {
  const events = [];
  const ticks = [0, 10, 15, 20, 50, 60, 90];
  const message = 'Gracias';
  const engine = createConversationEngine({
    clock: () => ticks.shift(),
    logger: value => events.push(value),
    llmClient: {
      async interpret() { return { obligations: [{ type: 'acknowledgement', evidence: message }], semantic_context: { recommendation_request_evidence: null } }; },
      async compose() { throw new ConversationLlmError('llm_transport_failure', { upstream_status: 503, upstream_category: 'http_5xx' }); },
    },
  });
  await assert.rejects(engine.resolve(request({ requestId: id(48), currentMessage: message })), error => error instanceof ConversationLlmError && error.code === 'llm_transport_failure');
  assert.deepEqual(events, [{
    event: 'conversation_engine_llm_failure', request_id: id(48), engine_version: 'direct-rag-v3-v1_3', llm_stage: 'composition', llm_error_code: 'llm_transport_failure', upstream_status: 503, upstream_category: 'http_5xx', llm_latency_ms: 30, total_latency_ms: 90,
  }]);
});

test('Ticket 77 production incident: activation meal report is acknowledged without treating it as an unsupported Dietavity claim', async () => {
  const activation = 'Dietavity es un asistente de alimentación por WhatsApp para personas que usan GLP-1. Puedes contarme qué has comido, cuánto apetito tienes o qué alimentos tienes disponibles, y te ayudo a decidir qué comer. Puedes probarlo gratis. ¿Qué necesitas resolver con tu alimentación ahora?';
  const message = 'Desayuno ensalada de nopales con tres huevos cocidos';
  const engine = createConversationEngine({ llmClient: fixtureLlm([
    { obligations: [{ type: 'acknowledgement', evidence: message }], semantic_context: { recommendation_request_evidence: null } },
  ]) });

  const result = await engine.resolve(request({
    requestId: id(51), inboundId: id(52), processingOrder: 2, currentMessage: message,
    history: [historyEntry('assistant', activation, 1)],
  }));

  assert.equal(result.assistant_response, '¡Perfecto! 😊 Ya sé qué desayunaste. Cuando quieras decidir qué comer después, dime cuánto apetito tienes o qué alimentos tienes disponibles y te ayudo a elegir.');
  assert.doesNotMatch(result.assistant_response, /No tengo información confirmada/u);
  assert.equal(result.diagnostics.recommendation.source, null);
  assert.equal(result.resolution.status, 'resolved');
});

test('Ticket 77 recognizes bounded natural declarative meal reports and leaves unsafe variants fail-closed', async () => {
  const reports = [
    ['Desayuné huevos con nopales.', '¡Perfecto! 😊 Ya sé qué desayunaste. Cuando quieras decidir qué comer después, dime cuánto apetito tienes o qué alimentos tienes disponibles y te ayudo a elegir.'],
    ['Comí pollo con arroz.', '¡Perfecto! 😊 Ya sé qué comiste. Cuando quieras decidir qué comer después, dime cuánto apetito tienes o qué alimentos tienes disponibles y te ayudo a elegir.'],
    ['Hoy desayuné tres huevos.', '¡Perfecto! 😊 Ya sé qué desayunaste. Cuando quieras decidir qué comer después, dime cuánto apetito tienes o qué alimentos tienes disponibles y te ayudo a elegir.'],
    ['Acabo de comer ensalada.', '¡Perfecto! 😊 Ya sé qué comiste. Cuando quieras decidir qué comer después, dime cuánto apetito tienes o qué alimentos tienes disponibles y te ayudo a elegir.'],
    ['En la mañana comí huevos y tortillas.', '¡Perfecto! 😊 Ya sé qué comiste. Cuando quieras decidir qué comer después, dime cuánto apetito tienes o qué alimentos tienes disponibles y te ayudo a elegir.'],
  ];
  for (const [index, [message, expected]] of reports.entries()) {
    const engine = createConversationEngine({ llmClient: fixtureLlm([
      { obligations: [{ type: 'acknowledgement', evidence: message }], semantic_context: { recommendation_request_evidence: null } },
    ]) });
    const result = await engine.resolve(request({ requestId: id(60 + index), inboundId: id(70 + index), currentMessage: message }));
    assert.equal(result.assistant_response, expected, message);
  }

  for (const message of ['¿Desayuné huevos con nopales?', 'No desayuné huevos.', 'Tal vez comí ensalada.', 'Según Ana comí ensalada.', 'Desayuno ensalada de nopales.']) {
    const engine = createConversationEngine({ llmClient: fixtureLlm([
      { obligations: [{ type: 'unsupported', evidence: message }], semantic_context: { recommendation_request_evidence: null } },
    ]) });
    const result = await engine.resolve(request({ requestId: id(80 + message.length), inboundId: id(100 + message.length), currentMessage: message }));
    assert.equal(result.assistant_response, 'No tengo información confirmada para afirmar que Dietavity ofrezca eso.', message);
  }
});

test('Ticket 77B recognizes bounded explicit meal labels without activation context', async () => {
  const breakfast = '¡Perfecto! 😊 Ya sé qué desayunaste. Cuando quieras decidir qué comer después, dime cuánto apetito tienes o qué alimentos tienes disponibles y te ayudo a elegir.';
  const meal = '¡Perfecto! 😊 Ya sé qué comiste. Cuando quieras decidir qué comer después, dime cuánto apetito tienes o qué alimentos tienes disponibles y te ayudo a elegir.';
  const reports = [
    ['Desayuno: huevos con nopales', breakfast],
    ['Comida: pollo con arroz', meal],
    ['Cena: ensalada con atún', meal],
    ['Mi desayuno: huevos con nopales', breakfast],
    ['Mi comida: pollo con arroz', meal],
    ['Mi cena: ensalada con atún', meal],
    ['Mi desayuno fue huevos con nopales', breakfast],
    ['Mi comida fue pollo con arroz', meal],
    ['Mi cena fue ensalada con atún', meal],
    ['Desayuno huevos con nopales', breakfast],
    ['Desayuno huevo y tortilla', breakfast],
    ['Cena ensalada con atún', meal],
    ['Cena sopa, pollo y arroz', meal],
  ];
  for (const [index, [message, expected]] of reports.entries()) {
    const engine = createConversationEngine({ llmClient: fixtureLlm([
      { obligations: [{ type: 'unsupported', evidence: message }], semantic_context: { recommendation_request_evidence: null } },
    ]) });
    const result = await engine.resolve(request({ requestId: id(200 + index), inboundId: id(300 + index), currentMessage: message }));
    assert.equal(result.assistant_response, expected, message);
    assert.equal(result.diagnostics.recommendation.source, null, message);
  }
});

test('Ticket 77B keeps ambiguous, planned, and general meal labels fail-closed', async () => {
  const messages = [
    '¿Qué me recomiendas para el desayuno?',
    '¿Qué puedo comer de desayuno?',
    'No desayuné.',
    'No cené.',
    'Mañana de comida quiero pollo.',
    'Para la cena tengo pollo.',
    'Quiero huevos para el desayuno.',
    'El desayuno es importante.',
    'Ideas para la cena.',
    '¿Cena?',
    'Desayuno a las 8.',
    'Mi desayuno será huevos con nopales.',
    'La comida de mañana será pollo con arroz.',
    'Comida pollo con arroz.',
    'Desayuno huevos revueltos.',
    'Cena será ensalada con atún.',
  ];
  for (const [index, message] of messages.entries()) {
    const engine = createConversationEngine({ llmClient: fixtureLlm([
      { obligations: [{ type: 'unsupported', evidence: message }], semantic_context: { recommendation_request_evidence: null } },
    ]) });
    const result = await engine.resolve(request({ requestId: id(400 + index), inboundId: id(500 + index), currentMessage: message }));
    assert.equal(result.assistant_response, 'No tengo información confirmada para afirmar que Dietavity ofrezca eso.', message);
  }
});

test('Ticket 77A reconstructs bounded meal-report context from canonical history for a later food decision without inventing inventory', async () => {
  const activation = 'Dietavity es un asistente de alimentación por WhatsApp para personas que usan GLP-1. Puedes contarme qué has comido, cuánto apetito tienes o qué alimentos tienes disponibles, y te ayudo a decidir qué comer. Puedes probarlo gratis.';
  const breakfast = 'Desayuno ensalada de nopales con tres huevos cocidos';
  const acknowledgement = '¡Perfecto! 😊 Ya sé qué desayunaste. Cuando quieras decidir qué comer después, dime cuánto apetito tienes o qué alimentos tienes disponibles y te ayudo a elegir.';
  const followup = 'Tengo poca hambre, ¿qué puedo comer?';
  const diagnostics = [];
  const engine = createConversationEngine({
    logger: value => diagnostics.push(value),
    llmClient: fixtureLlm([{ obligations: [{ type: 'food_decision', evidence: '¿qué puedo comer?' }], semantic_context: { recommendation_request_evidence: '¿qué puedo comer?' } }]),
  });
  const result = await engine.resolve(request({
    requestId: id(91), inboundId: id(92), processingOrder: 3, currentMessage: followup,
    history: [historyEntry('assistant', activation, 1), historyEntry('customer', breakfast, 2), historyEntry('assistant', acknowledgement, 2)],
  }));

  assert.equal(result.assistant_response, 'Tomando en cuenta que ya desayunaste y tienes poca hambre, para recomendarte algo concreto, ¿Qué alimentos tienes disponibles ahora?');
  assert.equal(result.diagnostics.recommendation.status, 'needs_clarification');
  assert.deepEqual(diagnostics[0].food.available_food_ids, []);
  assert.deepEqual(diagnostics[0].food.recently_consumed_ids, []);
  assert.doesNotMatch(result.assistant_response, /nopales|ensalada|huevos/u);
});

test('Ticket 77B reconstructs colon and possessive meal reports from canonical history without inventing foods', async () => {
  const acknowledgement = '¡Perfecto! 😊 Ya sé qué comiste. Cuando quieras decidir qué comer después, dime cuánto apetito tienes o qué alimentos tienes disponibles y te ayudo a elegir.';
  const reports = [
    ['Desayuno: ensalada de nopales con tres huevos cocidos', 'Tomando en cuenta que ya desayunaste y tienes poca hambre, para recomendarte algo concreto, ¿Qué alimentos tienes disponibles ahora?'],
    ['Mi cena fue ensalada de nopales con tres huevos cocidos', 'Tomando en cuenta que ya comiste y tienes poca hambre, para recomendarte algo concreto, ¿Qué alimentos tienes disponibles ahora?'],
  ];
  for (const [index, [mealReport, expected]] of reports.entries()) {
    const diagnostics = [];
    const engine = createConversationEngine({
      logger: value => diagnostics.push(value),
      llmClient: fixtureLlm([{ obligations: [{ type: 'food_decision', evidence: '¿qué puedo comer?' }], semantic_context: { recommendation_request_evidence: '¿qué puedo comer?' } }]),
    });
    const result = await engine.resolve(request({
      requestId: id(600 + index), inboundId: id(700 + index), processingOrder: 3, currentMessage: 'Tengo poca hambre, ¿qué puedo comer?',
      history: [historyEntry('customer', mealReport, 1), historyEntry('assistant', acknowledgement, 1)],
    }));
    assert.equal(result.assistant_response, expected, mealReport);
    assert.equal(result.diagnostics.recommendation.status, 'needs_clarification', mealReport);
    assert.deepEqual(diagnostics[0].food.available_food_ids, [], mealReport);
    assert.deepEqual(diagnostics[0].food.recently_consumed_ids, [], mealReport);
    assert.doesNotMatch(result.assistant_response, /nopales|ensalada|huevos/u, mealReport);
  }
});

test('Ticket 79 treats a closed ingredient-only activation reply as available foods and gives a grounded recommendation', async () => {
  const activation = 'Dietavity es un asistente de alimentación por WhatsApp para personas que usan GLP-1. Puedes contarme qué has comido, cuánto apetito tienes o qué alimentos tienes disponibles, y te ayudo a decidir qué comer.';
  const message = 'Carne molida y verdura';
  const diagnostics = [];
  const engine = createConversationEngine({
    logger: value => diagnostics.push(value),
    llmClient: fixtureLlm([{ obligations: [{ type: 'unsupported', evidence: message }], semantic_context: { recommendation_request_evidence: null } }]),
  });

  const result = await engine.resolve(request({
    requestId: id(800), inboundId: id(801), processingOrder: 2, currentMessage: message,
    history: [historyEntry('assistant', activation, 1)],
  }));

  assert.equal(result.assistant_response, 'Haz un salteado de carne molida con las verduras que tengas. Cocina primero la carne y luego agrega las verduras hasta que queden suaves.');
  assert.equal(result.persistence.topic, 'food_decision');
  assert.equal(result.diagnostics.recommendation.source, 'recommendation_v2');
  assert.equal(result.diagnostics.recommendation.status, 'recommendation');
  assert.doesNotMatch(result.assistant_response, /No tengo información confirmada|¿Qué alimentos tienes disponibles ahora\?/u);
  assert.deepEqual(diagnostics[0].food.available_food_ids, ['carne', 'verduras']);

  const followupEngine = createConversationEngine({ llmClient: fixtureLlm([
    { obligations: [{ type: 'acknowledgement', evidence: message }], semantic_context: { recommendation_request_evidence: null } },
  ]) });
  const followup = await followupEngine.resolve(request({
    requestId: id(802), inboundId: id(803), processingOrder: 2, currentMessage: message,
    history: [historyEntry('assistant', '¿Que alimentos tienes disponibles ahora?', 1)],
  }));
  assert.equal(followup.assistant_response, 'Haz un salteado de carne molida con las verduras que tengas. Cocina primero la carne y luego agrega las verduras hasta que queden suaves.');
});

test('Ticket 80 activation asks one inventory question and treats its immediate replies as inventory', async () => {
  const activation = 'Dietavity es un asistente de alimentación por WhatsApp para personas que usan GLP-1. Te ayuda a decidir qué comer de acuerdo con tu apetito y lo que tienes a la mano. Puedes probarlo gratis. ¿Qué alimentos tienes disponibles ahora?';
  const activationEngine = createConversationEngine({ llmClient: fixtureLlm([
    { obligations: [{ type: 'general_information', evidence: '¡Hola! Quiero saber más.' }], semantic_context: { recommendation_request_evidence: null } },
  ]) });
  const activationResult = await activationEngine.resolve(request({ currentMessage: '¡Hola! Quiero saber más.' }));
  assert.equal(activationResult.assistant_response, activation);
  const priorHistory = [
    historyEntry('customer', 'Desayuné huevos con nopales.', 1),
    historyEntry('assistant', '¡Perfecto! 😊 Ya sé qué desayunaste.', 1),
  ];
  const historicalActivationEngine = createConversationEngine({ llmClient: fixtureLlm([
    { obligations: [{ type: 'general_information', evidence: '¡Hola! Quiero saber más.' }], semantic_context: { recommendation_request_evidence: null } },
  ]) });
  const historicalActivation = await historicalActivationEngine.resolve(request({
    requestId: id(828), inboundId: id(829), processingOrder: 2, currentMessage: '¡Hola! Quiero saber más.', history: priorHistory,
  }));
  assert.equal(historicalActivation.assistant_response, activation);
  const ordinaryInformationEngine = createConversationEngine({ llmClient: fixtureLlm([
    { obligations: [{ type: 'general_information', evidence: 'Hola, me das información?' }], semantic_context: { recommendation_request_evidence: null } },
  ]) });
  const ordinaryInformation = await ordinaryInformationEngine.resolve(request({
    requestId: id(826), inboundId: id(827), processingOrder: 2, currentMessage: 'Hola, me das información?', history: priorHistory,
  }));
  assert.equal(ordinaryInformation.assistant_response, 'Dietavity es un asistente de alimentación por WhatsApp para personas que usan GLP-1. Te ayuda a decidir qué comer de acuerdo con tu apetito y lo que tienes a la mano. Puedes probarlo gratis.');
  assert.doesNotMatch(ordinaryInformation.assistant_response, /Puedes contarme qué has comido, cuánto apetito tienes o qué alimentos tienes disponibles/u);
  const mealReport = 'Desayuné huevos con nopales.';
  const inventoryQuestion = 'Tomando en cuenta que ya desayunaste, para recomendarte algo concreto, ¿Qué alimentos tienes disponibles ahora?';
  const ingredientMessage = 'Carne molida y verduras';
  const ingredientEngine = createConversationEngine({ llmClient: fixtureLlm([
    { obligations: [{ type: 'unsupported', evidence: ingredientMessage }], semantic_context: { recommendation_request_evidence: null } },
  ]) });
  const ingredientResult = await ingredientEngine.resolve(request({
    requestId: id(830), inboundId: id(831), processingOrder: 3, currentMessage: ingredientMessage,
    history: [historyEntry('assistant', activation, 1), historyEntry('customer', mealReport, 2), historyEntry('assistant', inventoryQuestion, 2)],
  }));
  assert.equal((activation.match(/¿/gu) || []).length, 1);
  assert.equal((activation.match(/\?/gu) || []).length, 1);
  assert.equal(ingredientResult.assistant_response, 'Haz un salteado de carne molida con las verduras que tengas. Cocina primero la carne y luego agrega las verduras hasta que queden suaves.');
  assert.equal(ingredientResult.diagnostics.recommendation.source, 'recommendation_v2');
  assert.doesNotMatch(ingredientResult.assistant_response, /ya desayunaste|¿Qué alimentos tienes disponibles ahora\?/u);

  const historicalFollowupEngine = createConversationEngine({ llmClient: fixtureLlm([
    { obligations: [{ type: 'unsupported', evidence: ingredientMessage }], semantic_context: { recommendation_request_evidence: null } },
  ]) });
  const historicalFollowup = await historicalFollowupEngine.resolve(request({
    requestId: id(832), inboundId: id(833), processingOrder: 3, currentMessage: ingredientMessage,
    history: [...priorHistory, historyEntry('customer', '¡Hola! Quiero saber más.', 2), historyEntry('assistant', activation, 2)],
  }));
  assert.equal(historicalFollowup.assistant_response, 'Haz un salteado de carne molida con las verduras que tengas. Cocina primero la carne y luego agrega las verduras hasta que queden suaves.');
  assert.doesNotMatch(historicalFollowup.assistant_response, /ya desayunaste|¿Qué alimentos tienes disponibles ahora\?/u);

  for (const [index, message] of ['Nada', 'No tengo nada'].entries()) {
    const engine = createConversationEngine({ llmClient: fixtureLlm([
      { obligations: [{ type: 'unsupported', evidence: message }], semantic_context: { recommendation_request_evidence: null } },
    ]) });
    const result = await engine.resolve(request({
      requestId: id(840 + index), inboundId: id(850 + index), processingOrder: 2, currentMessage: message,
      history: [historyEntry('assistant', activation, 1)],
    }));
    assert.equal(result.assistant_response, 'Entiendo. Si ahora no tienes alimentos disponibles, no te voy a recomendar una comida que no tienes. Cuando tengas algo a la mano, puedo ayudarte a decidir qué preparar.', message);
    assert.equal(result.diagnostics.recommendation.source, 'contextual_empty_inventory_reply', message);
    assert.equal(result.diagnostics.recommendation.status, 'no_available_foods', message);
    assert.doesNotMatch(result.assistant_response, /No tengo información confirmada|¿Qué alimentos tienes disponibles ahora\?/u, message);
  }
});

test('Ticket 79 keeps ingredient-only completion bounded to the active inventory context', async () => {
  const inventoryQuestion = '¿Qué alimentos tienes disponibles ahora?';
  const rejected = [
    'No carne molida y verdura',
    '¿Carne molida y verdura?',
    'Tal vez carne molida y verdura',
    'Mañana carne molida y verdura',
    'Carne extraña y verdura',
  ];
  for (const [index, message] of rejected.entries()) {
    const engine = createConversationEngine({ llmClient: fixtureLlm([
      { obligations: [{ type: 'unsupported', evidence: message }], semantic_context: { recommendation_request_evidence: null } },
    ]) });
    const result = await engine.resolve(request({
      requestId: id(810 + index), inboundId: id(820 + index), processingOrder: 2, currentMessage: message,
      history: [historyEntry('assistant', inventoryQuestion, 1)],
    }));
    assert.equal(result.assistant_response, 'No tengo información confirmada para afirmar que Dietavity ofrezca eso.', message);
  }

  const standalone = 'Carne molida y verdura';
  const engine = createConversationEngine({ llmClient: fixtureLlm([
    { obligations: [{ type: 'unsupported', evidence: standalone }], semantic_context: { recommendation_request_evidence: null } },
  ]) });
  const result = await engine.resolve(request({ currentMessage: standalone }));
  assert.equal(result.assistant_response, 'No tengo información confirmada para afirmar que Dietavity ofrezca eso.');
});

test('Ticket 81B derives bounded partial-availability context without creating a pantry', async () => {
  const inventoryQuestion = [historyEntry('assistant', '¿Qué alimentos tienes disponibles ahora?', 1)];
  const constrained = parsedAvailability('Carne molida y verduras', inventoryQuestion);
  assert.deepEqual(constrained, {
    scope: 'constrained', authority: { kind: 'active_inventory_reply', evidence: 'Carne molida y verduras' },
    confirmed_foods: [{ surface: 'carne molida', concept: 'ground_meat', specificity: 'generic' }],
    underspecified_groups: [{ surface: 'verduras', concept: 'vegetables' }], currently_unavailable_foods: [],
  });

  for (const message of ['Todos', 'De todo', 'Tengo de todo']) {
    const broad = parsedAvailability(message, inventoryQuestion);
    assert.deepEqual(broad, {
      scope: 'broad', authority: { kind: 'active_inventory_reply', evidence: message },
      confirmed_foods: [], underspecified_groups: [], currently_unavailable_foods: [],
    }, message);
  }

  for (const message of ['Nada', 'No tengo nada']) assert.deepEqual(parsedAvailability(message, inventoryQuestion), {
    scope: 'none', authority: { kind: 'active_inventory_reply', evidence: message },
    confirmed_foods: [], underspecified_groups: [], currently_unavailable_foods: [],
  }, message);

  assert.deepEqual(parsedAvailability('Huevos', inventoryQuestion), {
    scope: 'constrained', authority: { kind: 'active_inventory_reply', evidence: 'Huevos' },
    confirmed_foods: [{ surface: 'huevos', concept: 'egg' }], underspecified_groups: [], currently_unavailable_foods: [],
  });
  assert.deepEqual(parsedAvailability('Verduras', inventoryQuestion), {
    scope: 'constrained', authority: { kind: 'active_inventory_reply', evidence: 'Verduras' },
    confirmed_foods: [], underspecified_groups: [{ surface: 'verduras', concept: 'vegetables' }], currently_unavailable_foods: [],
  });

  for (const [message, history] of [['Lo que sea', inventoryQuestion], ['Todos', []], ['Comí carne molida y verduras', inventoryQuestion]]) {
    assert.equal(parsedAvailability(message, history).scope, 'unknown', message);
  }
  const consumed = __testOnly.parsedContext({ current_message: 'Comí carne molida y verduras', canonical_history: [], processing_order: 1 }, {
    obligations: [{ type: 'unsupported', evidence: 'Comí carne molida y verduras' }], semantic_context: { recommendation_request_evidence: null },
  });
  assert.deepEqual(consumed.mealReport, { meal: 'meal', evidence: 'Comí carne molida y verduras' });

  assert.deepEqual(parsedAvailability('Tengo pollo y tortillas, pero no aguacate'), {
    scope: 'constrained', authority: { kind: 'explicit_current_availability', evidence: 'Tengo pollo y tortillas, pero no aguacate' },
    confirmed_foods: [{ surface: 'pollo', concept: 'chicken' }, { surface: 'tortillas', concept: 'corn_tortilla' }],
    underspecified_groups: [], currently_unavailable_foods: [{ surface: 'aguacate', concept: 'avocado' }],
  });
  assert.equal(parsedAvailability('Tengo carne molida y algunas verduras, no sé cuáles usar').scope, 'unknown');

  const lexicalMentions = surfaces => ({ structured_food_mentions: surfaces.map(surface => ({ surface, relation: 'mentioned', polarity: 'affirmed', temporal_scope: 'unknown' })) });
  const scannerRecognizedUnknownList = __testOnly.deriveFoodAvailability('Salmón y espárragos', inventoryQuestion, lexicalMentions(['Salmón', 'espárragos']), null, false);
  assert.deepEqual(scannerRecognizedUnknownList, {
    scope: 'constrained', authority: { kind: 'active_inventory_reply', evidence: 'Salmón y espárragos' },
    confirmed_foods: [{ surface: 'salmón', concept: 'salmón' }, { surface: 'espárragos', concept: 'espárragos' }], underspecified_groups: [], currently_unavailable_foods: [],
  });
  assert.equal(__testOnly.deriveFoodAvailability('Carne extraña y verdura', inventoryQuestion, lexicalMentions(['Carne', 'verdura']), null, false).scope, 'unknown');
});

test('Ticket 81B promotes only authoritative constrained or broad inventory replies to food decisions', async () => {
  const inventoryQuestion = historyEntry('assistant', '¿Qué alimentos tienes disponibles ahora?', 1);
  for (const [index, message] of ['Todos', 'De todo', 'Tengo de todo', 'Huevos', 'Verduras'].entries()) {
    const engine = createConversationEngine({ llmClient: fixtureLlm([
      { obligations: [{ type: 'acknowledgement', evidence: message }], semantic_context: { recommendation_request_evidence: null } },
    ]) });
    const result = await engine.resolve(request({ requestId: id(900 + index), inboundId: id(920 + index), processingOrder: 2, currentMessage: message, history: [inventoryQuestion] }));
    assert.equal(result.persistence.topic, 'food_decision', message);
    assert.doesNotMatch(result.assistant_response, /^¡Con gusto! 😊$/u, message);
    if (['Todos', 'De todo', 'Tengo de todo'].includes(message)) {
      assert.deepEqual(parsedAvailability(message, [inventoryQuestion]), {
        scope: 'broad', authority: { kind: 'active_inventory_reply', evidence: message },
        confirmed_foods: [], underspecified_groups: [], currently_unavailable_foods: [],
      }, message);
      assert.deepEqual(result.diagnostics.recommendation, { source: 'recommendation_v2', status: 'recommendation', failure_code: null }, message);
      assert.match(result.assistant_response, /^Prepara tacos de pollo con aguacate\./u, message);
    }
  }
  const standalone = createConversationEngine({ llmClient: fixtureLlm([
    { obligations: [{ type: 'acknowledgement', evidence: 'Todos' }], semantic_context: { recommendation_request_evidence: null } },
  ]) });
  const result = await standalone.resolve(request({ requestId: id(940), inboundId: id(941), currentMessage: 'Todos' }));
  assert.equal(result.persistence.topic, 'acknowledgement');
});

test('Ticket 81C renders one grounded deterministic recommendation from bounded availability', async () => {
  const question = historyEntry('assistant', '¿Qué alimentos tienes disponibles ahora?', 2);
  const cases = [
    ['Carne molida y verduras', [], 'Haz un salteado de carne molida con las verduras que tengas. Cocina primero la carne y luego agrega las verduras hasta que queden suaves.'],
    ['Pollo, tortillas, aguacate y jitomate', [], 'Haz tacos de pollo con aguacate y jitomate. Cocina el pollo, sírvelo en las tortillas y agrega lo fresco al final.'],
    ['Huevos y nopales', [], 'Prepara huevos revueltos con nopales. Cocina los nopales y agrega los huevos al final para que queden suaves.'],
    ['Atún, jitomate y tortillas', [], 'Haz tacos de atún con jitomate. Calienta las tortillas y sirve el atún encima.'],
    ['Huevos', [], 'Prepara huevos revueltos. Si tienes una verdura o tortillas, agrégalas al servir.'],
    ['Arroz y verduras', [], 'Haz arroz salteado con las verduras que tengas. Cocina el arroz y mézclalo con las verduras; si tienes una proteína, puedes agregarla.'],
    ['Tengo poca hambre, pollo, aguacate y tortillas', [], 'Haz tacos de pollo con aguacate. Cocina el pollo, sírvelo en las tortillas y agrega lo fresco al final. Empieza con una porción pequeña y come despacio.'],
    ['Pollo, tortillas y jitomate', [historyEntry('customer', 'Comí huevos.', 1)], 'Haz tacos de pollo y jitomate. Cocina el pollo, sírvelo en las tortillas y agrega lo fresco al final.'],
    ['Pollo, frijoles y tortillas', [historyEntry('customer', 'Comí pollo.', 1)], 'Haz tacos de frijoles. Calienta los frijoles y sírvelos en las tortillas.'],
    ['Brócoli, calabacita y zanahoria', [], 'Saltea brócoli, calabacita y zanahoria con un poco de agua o aceite. Si tienes huevo, pollo o frijoles, puedes agregarlos para hacerlo más completo.'],
    ['Tengo pollo y tortillas, pero no aguacate', [], 'Haz tacos de pollo. Cocina el pollo, sírvelo en las tortillas y agrega lo fresco al final.'],
    ['Todos', [], 'Prepara tacos de pollo con aguacate. Cocina el pollo, sírvelo en tortillas y agrega aguacate al final.'],
    ['De todo', [], 'Prepara tacos de pollo con aguacate. Cocina el pollo, sírvelo en tortillas y agrega aguacate al final.'],
    ['Tengo de todo', [], 'Prepara tacos de pollo con aguacate. Cocina el pollo, sírvelo en tortillas y agrega aguacate al final.'],
  ];
  for (const [index, [message, prior, expected]] of cases.entries()) {
    const engine = createConversationEngine({ llmClient: fixtureLlm([
      { obligations: [{ type: 'acknowledgement', evidence: message }], semantic_context: { recommendation_request_evidence: null } },
    ]) });
    const result = await engine.resolve(request({ requestId: id(1000 + index), inboundId: id(1100 + index), processingOrder: 3, currentMessage: message, history: [...prior, question] }));
    assert.equal(result.assistant_response, expected, message);
    assert.deepEqual(result.diagnostics.recommendation, { source: 'recommendation_v2', status: 'recommendation', failure_code: null }, message);
  }

  for (const [index, message] of ['Nada', 'No tengo nada'].entries()) {
    const engine = createConversationEngine({ llmClient: fixtureLlm([{ obligations: [{ type: 'unsupported', evidence: message }], semantic_context: { recommendation_request_evidence: null } }]) });
    const result = await engine.resolve(request({ requestId: id(1200 + index), inboundId: id(1300 + index), processingOrder: 3, currentMessage: message, history: [question] }));
    assert.equal(result.diagnostics.recommendation.status, 'no_available_foods', message);
  }
  const medication = '¿Debería bajar mi dosis de Mounjaro si tengo poca hambre?';
  const medicalEngine = createConversationEngine({ llmClient: fixtureLlm([{ obligations: [{ type: 'medical_boundary', evidence: medication }], semantic_context: { recommendation_request_evidence: null } }]) });
  const medical = await medicalEngine.resolve(request({ requestId: id(1400), inboundId: id(1401), currentMessage: medication }));
  assert.match(medical.assistant_response, /Consulta al profesional/u);
  assert.equal(medical.diagnostics.recommendation.source, null);
});
