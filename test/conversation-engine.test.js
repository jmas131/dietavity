'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationEngine } = require('../lib/conversation-engine/service');
const { ConversationRequestError } = require('../lib/conversation-engine/contracts');

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
  await assert.rejects(engine.resolve(request({ currentMessage: 'x'.repeat(2001) })), error => error instanceof ConversationRequestError);
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

  assert.equal(result.assistant_response, 'Gracias por contarme tu desayuno.');
  assert.doesNotMatch(result.assistant_response, /No tengo información confirmada/u);
  assert.equal(result.diagnostics.recommendation.source, null);
  assert.equal(result.resolution.status, 'resolved');
});

test('Ticket 77 recognizes bounded natural declarative meal reports and leaves unsafe variants fail-closed', async () => {
  const reports = [
    ['Desayuné huevos con nopales.', 'Gracias por contarme tu desayuno.'],
    ['Comí pollo con arroz.', 'Gracias por contarme lo que comiste.'],
    ['Hoy desayuné tres huevos.', 'Gracias por contarme tu desayuno.'],
    ['Acabo de comer ensalada.', 'Gracias por contarme lo que comiste.'],
    ['En la mañana comí huevos y tortillas.', 'Gracias por contarme lo que comiste.'],
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
