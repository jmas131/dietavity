'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationEngine } = require('../lib/conversation-engine/service');
const { ConversationLlmError } = require('../lib/conversation-engine/llm-client');

const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const inventoryQuestion = [{ role: 'assistant', text: '¿Qué alimentos tienes disponibles ahora?', source_processing_order: 1 }];
function request(current_message, canonical_history = [], processing_order = 2) {
  return { contract_version: 'conversation-engine-request-v1', request_id: id(processing_order * 2), session_id: 'whatsapp:+5215550000000', inbound_message_id: id(processing_order * 2 + 1), processing_order, current_message, canonical_history };
}
function interpret(message) {
  const obligations = [];
  if (/bajar mi dosis/iu.test(message)) obligations.push({ type: 'medical_boundary', evidence: 'bajar mi dosis' });
  if (/qué puedo|qué me recomiendas/iu.test(message)) obligations.push({ type: 'food_decision', evidence: /qué puedo cenar/iu.test(message) ? 'qué puedo cenar' : /qué me recomiendas/iu.test(message) ? 'qué me recomiendas' : 'qué puedo comer' });
  return { obligations: obligations.length ? obligations : [{ type: 'acknowledgement', evidence: message }], semantic_context: { recommendation_request_evidence: null } };
}
function candidate(payload) {
  const anchors = payload.food_facts.filter(item => item.status === 'confirmed_available').slice(0, 3);
  const ids = anchors.map(item => item.id); const labels = anchors.map(item => item.label);
  return { candidate_type: 'meal_proposal', dish: { label: `plato de ${labels.join(' y ')}`, confirmed_anchor_ids: ids }, proposed_items: [], customer_response: ids.length ? `Puedes preparar un plato de ${labels.join(' y ')}: combina ${labels.join(' y ')}.` : 'Puedes pedir una sopa sencilla o comprar algo ligero para cenar.' };
}
function fixture(generate = candidate) {
  const calls = [];
  return { calls, client: {
    async interpret(input) { return interpret(input.current_message); },
    async generateRecommendationCandidate(payload) { calls.push(payload); return generate(payload); },
    async compose(envelope) { return { response: envelope.permitted_claims.join(' '), covered_obligation_ids: envelope.resolved_obligations.map(item => item.obligation.id), used_claims: envelope.permitted_claims }; },
  } };
}

test('V3 uses Ticket 84A newline inventory as open grounded references and bypasses composition', async () => {
  const mock = fixture(); const message = 'Pollo\nJitomate\nEspinaca\nArroz\nAguacate';
  const result = await createConversationEngine({ llmClient: mock.client }).resolve(request(message, inventoryQuestion));
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].current_message, message);
  assert.deepEqual(mock.calls[0].food_facts.filter(item => item.status === 'confirmed_available').map(item => item.label), ['pollo', 'jitomate', 'espinaca', 'arroz', 'aguacate']);
  assert.match(result.assistant_response, /espinaca/u);
  assert.doesNotMatch(result.assistant_response, /¿Qué alimentos tienes/u);
  assert.equal(result.diagnostics.recommendation.source, 'candidate_v3');
});

test('V3 supports non-exhaustive inventory with conditional ingredients and rejects unsafe generated prose', async () => {
  const valid = fixture(payload => {
    const egg = payload.food_facts.find(x => x.label === 'huevo').id; const tortillas = payload.food_facts.find(x => x.label === 'tortillas').id;
    return { candidate_type: 'meal_proposal', dish: { label: 'chilaquiles con huevo', confirmed_anchor_ids: [egg, tortillas] }, proposed_items: [{ id: 'proposed-1', label: 'salsa', role: 'ingredient' }], customer_response: 'Si tienes salsa, puedes hacer unos chilaquiles con huevo: baña las tortillas con la salsa y agrega el huevo al final.' };
  });
  const result = await createConversationEngine({ llmClient: valid.client }).resolve(request('Tengo huevo y tortillas, ¿qué puedo comer?'));
  assert.match(result.assistant_response, /^Si tienes salsa/u);
  for (const text of ['Con la salsa que tienes, prepara chilaquiles con huevo y tortillas.', 'Si tienes salsa, prepara chilaquiles con huevo y tortillas. Es ideal para bajar de peso mientras usas tu medicamento.']) {
    const bad = fixture(payload => ({ ...candidate(payload), dish: { label: 'chilaquiles con huevo', confirmed_anchor_ids: payload.food_facts.filter(x => x.status === 'confirmed_available').map(x => x.id) }, proposed_items: [{ id: 'proposed-1', label: 'salsa', role: 'ingredient' }], customer_response: text }));
    const rejected = await createConversationEngine({ llmClient: bad.client }).resolve(request('Tengo huevo y tortillas, ¿qué puedo comer?'));
    assert.equal(rejected.diagnostics.recommendation.status, 'rejected');
    assert.doesNotMatch(rejected.assistant_response, /medicamento|salsa que tienes/iu);
  }
});

test('V3 preserves restrictions, atomic leftovers, and separable medical boundaries', async () => {
  const restricted = fixture(payload => {
    const ids = payload.food_facts.filter(x => x.status === 'confirmed_available').map(x => x.id);
    return { candidate_type: 'meal_proposal', dish: { label: 'plato de pollo y arroz', confirmed_anchor_ids: ids }, proposed_items: [], customer_response: 'Puedes hacer un plato de pollo y arroz: sirve pollo y arroz.' };
  });
  const a = await createConversationEngine({ llmClient: restricted.client }).resolve(request('Tengo pollo y arroz, pero no puedo comer cacahuate. ¿Qué puedo comer?'));
  assert.doesNotMatch(a.assistant_response, /cacahuate/u);
  const leftovers = fixture();
  const b = await createConversationEngine({ llmClient: leftovers.client }).resolve(request('Tengo sobras de mole de ayer y tortillas, ¿qué puedo comer?'));
  assert.match(b.assistant_response, /sobras de mole de ayer/u);
  const mixed = fixture();
  const c = await createConversationEngine({ llmClient: mixed.client }).resolve(request('¿Debo bajar mi dosis? También tengo pollo y arroz, ¿qué puedo cenar?'));
  assert.match(c.assistant_response, /Consulta al profesional/u);
  assert.match(c.assistant_response, /pollo/u);
});

test('V3 malformed output and candidate transport failure never fall back to V2 or legacy recommendations', async () => {
  const malformed = fixture(() => ({ candidate_type: 'meal_proposal' }));
  const rejected = await createConversationEngine({ llmClient: malformed.client }).resolve(request('Tengo huevo, ¿qué puedo comer?'));
  assert.equal(rejected.diagnostics.recommendation.status, 'rejected');
  assert.doesNotMatch(rejected.assistant_response, /revueltos|recommendation_v2|meal_recommendation/u);
  const unavailable = fixture(() => { throw new ConversationLlmError('llm_timeout'); });
  const failed = await createConversationEngine({ llmClient: unavailable.client }).resolve(request('Tengo huevo, ¿qué puedo comer?'));
  assert.equal(failed.diagnostics.recommendation.status, 'rejected');
  assert.doesNotMatch(failed.assistant_response, /revueltos/u);
});

test('V3 can recommend an order without pantry anchors and still bypasses composition', async () => {
  const mock = fixture(() => ({
    candidate_type: 'meal_proposal', dish: { label: 'sopa minestrone', confirmed_anchor_ids: [] },
    proposed_items: [{ id: 'proposed-1', label: 'minestrone', role: 'obtain' }],
    customer_response: 'Si vas a pedir, una sopa minestrone es una opción ligera y fácil de comer.',
  }));
  const result = await createConversationEngine({ llmClient: mock.client }).resolve(request('Estoy en la oficina y voy a pedir algo. Tengo poca hambre, ¿qué me recomiendas?'));
  assert.equal(mock.calls.length, 1);
  assert.match(mock.calls[0].current_message, /oficina/u);
  assert.match(result.assistant_response, /minestrone/u);
  assert.equal(result.diagnostics.recommendation.status, 'recommendation');
});
