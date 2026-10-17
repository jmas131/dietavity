'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationEngine } = require('../lib/conversation-engine/service');
const { ConversationLlmError } = require('../lib/conversation-engine/llm-client');

const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const inventoryQuestion = [{ role: 'assistant', text: '¿Qué alimentos tienes disponibles ahora?', source_processing_order: 1 }];
function request(current_message, canonical_history = inventoryQuestion, processing_order = 2) {
  return { contract_version: 'conversation-engine-request-v1', request_id: id(processing_order * 2), session_id: 'whatsapp:+5215550000000', inbound_message_id: id(processing_order * 2 + 1), processing_order, current_message, canonical_history };
}
function interpretation(message) {
  return { obligations: [{ type: /dosis|mounjaro/iu.test(message) ? 'medical_boundary' : 'acknowledgement', evidence: message }], semantic_context: { recommendation_request_evidence: null } };
}
function refFor(payload, surface) { return payload.availability.references.find(value => value.surface === surface)?.id; }
function candidateFor(message, payload) {
  if (payload.availability.scope === 'broad') return { candidates: [{ selected_foods: [{ id: 'selected-1', label: 'pollo' }, { id: 'selected-2', label: 'tortillas' }], pantry_ids: [], actions: [{ kind: 'cook', refs: ['selected-1'] }, { kind: 'serve', refs: ['selected-1', 'selected-2'] }], portion: payload.appetite === 'low' ? 'small' : 'normal' }] };
  const refs = payload.availability.references;
  const all = refs.map(value => value.id);
  const pick = (...surfaces) => surfaces.map(surface => refFor(payload, surface)).filter(Boolean);
  let required = all; let actions = [{ kind: 'mix', refs: all }]; let pantry_ids = [];
  if (/carne molida/iu.test(message)) { required = pick('carne molida', 'verduras'); actions = [{ kind: 'cook', refs: [required[0]] }, { kind: 'saute', refs: [...required, 'cooking_oil'] }]; pantry_ids = ['cooking_oil']; }
  if (/pollo y frijoles/iu.test(message)) { required = pick('frijoles', 'tortillas'); actions = [{ kind: 'heat', refs: required }]; }
  if (/pollo y tortillas, pero no aguacate/iu.test(message)) { required = pick('pollo', 'tortillas'); actions = [{ kind: 'cook', refs: [required[0]] }, { kind: 'heat', refs: [required[1]] }]; }
  if (/^verduras$/iu.test(message)) { required = pick('verduras'); actions = [{ kind: 'saute', refs: required }]; }
  if (/pollo, aguacate y tortillas/iu.test(message)) { actions = [{ kind: 'cook', refs: [all[0]] }, { kind: 'serve', refs: all }]; }
  return { candidates: [{ required_refs: required, pantry_ids, actions, portion: payload.appetite === 'low' ? 'small' : 'normal' }] };
}
function fixture(candidate) {
  const calls = [];
  return {
    calls,
    client: {
      async interpret(input) { return interpretation(input.current_message); },
      async generateRecommendationCandidates(payload) { calls.push(payload); return candidate(payload); },
      async compose(envelope) { return { response: envelope.permitted_claims.join(' '), covered_obligation_ids: envelope.resolved_obligations.map(item => item.obligation.id), used_claims: envelope.permitted_claims }; },
    },
  };
}

test('81F invokes one untrusted candidate call only for authoritative constrained/broad food decisions and serializes its validated winner', async () => {
  const cases = [
    ['Carne molida y verduras', inventoryQuestion, true, 'Te recomiendo preparar carne molida y las verduras que tengas. Cocina carne molida. Saltea carne molida, las verduras que tengas y un poco de aceite.'],
    ['Salmón y espárragos', inventoryQuestion, true, 'Te recomiendo preparar salmón y espárragos. Mezcla salmón y espárragos.'],
    ['Yogur, fresas y nueces', inventoryQuestion, true, 'Te recomiendo preparar yogur, fresas y nueces. Mezcla yogur, fresas y nueces.'],
    ['Pechuga de pavo y queso', inventoryQuestion, true, 'Te recomiendo preparar pechuga de pavo y queso. Mezcla pechuga de pavo y queso.'],
    ['Huevos', inventoryQuestion, true, 'Te recomiendo preparar huevos. Mezcla huevos.'],
    ['Arroz y verduras', inventoryQuestion, true, 'Te recomiendo preparar arroz y las verduras que tengas. Mezcla arroz y las verduras que tengas.'],
    ['Atún y jitomate y tortillas', inventoryQuestion, true, 'Te recomiendo preparar atún, jitomate y tortillas. Mezcla atún, jitomate y tortillas.'],
    ['Tengo poca hambre, pollo, aguacate y tortillas', inventoryQuestion, true, 'Te recomiendo preparar pollo, aguacate y tortillas. Cocina pollo. Sirve pollo, aguacate y tortillas. Empieza con una porción pequeña y come despacio.'],
    ['Pollo y frijoles y tortillas', [{ role: 'customer', text: 'Comí pollo', source_processing_order: 1 }, ...inventoryQuestion], true, 'Te recomiendo preparar frijoles y tortillas. Calienta frijoles y tortillas.'],
    ['Tengo pollo y tortillas, pero no aguacate', inventoryQuestion, true, 'Te recomiendo preparar pollo y tortillas. Cocina pollo. Calienta tortillas.'],
    ['Verduras', inventoryQuestion, true, 'Te recomiendo preparar las verduras que tengas. Saltea las verduras que tengas.'],
    ['Todos', inventoryQuestion, true, 'Te recomiendo preparar pollo y tortillas. Cocina pollo. Sirve pollo y tortillas.'],
    ['De todo', inventoryQuestion, true, 'Te recomiendo preparar pollo y tortillas. Cocina pollo. Sirve pollo y tortillas.'],
    ['Tengo de todo', inventoryQuestion, true, 'Te recomiendo preparar pollo y tortillas. Cocina pollo. Sirve pollo y tortillas.'],
    ['Nada', inventoryQuestion, false, 'Entiendo. Si ahora no tienes alimentos disponibles, no te voy a recomendar una comida que no tienes. Cuando tengas algo a la mano, puedo ayudarte a decidir qué preparar.'],
    ['Lo que sea', inventoryQuestion, false, '¡Con gusto! 😊'],
    ['Todos', [], false, '¡Con gusto! 😊'],
    ['Comí salmón y espárragos', inventoryQuestion, false, '¡Perfecto! 😊 Ya sé qué comiste. Cuando quieras decidir qué comer después, dime cuánto apetito tienes o qué alimentos tienes disponibles y te ayudo a elegir.'],
  ];
  for (const [message, history, called, expected] of cases) {
    const mock = fixture(payload => candidateFor(message, payload));
    const response = await createConversationEngine({ llmClient: mock.client }).resolve(request(message, history));
    assert.equal(mock.calls.length, called ? 1 : 0, message);
    assert.equal(response.assistant_response, expected, message);
    if (called) {
      const candidatePayload = mock.calls[0];
      assert.equal(candidatePayload.contract_version, 'recommendation-candidate-v1');
      assert.ok(['constrained', 'broad'].includes(candidatePayload.availability.scope));
      assert.doesNotMatch(JSON.stringify(candidatePayload), /permitted_claim|customer.?response/iu);
      assert.equal(response.diagnostics.recommendation.source, 'structured_candidate_policy');
    }
  }
});

test('81F medical precedence prevents candidate invocation even with low appetite', async () => {
  const mock = fixture(() => { throw new Error('must not be called'); });
  const response = await createConversationEngine({ llmClient: mock.client }).resolve(request('Tengo poca hambre. ¿Debería bajar mi dosis de Mounjaro?', []));
  assert.equal(mock.calls.length, 0);
  assert.match(response.assistant_response, /Consulta al profesional/u);
  assert.doesNotMatch(response.assistant_response, /baja tu dosis/iu);
});

test('81F adversarial candidate output, malformed generator output, and candidate failure always retain the bounded 81C fallback', async () => {
  const adversarial = [
    { candidates: [{ required_refs: ['food-99'], pantry_ids: [], actions: [{ kind: 'cook', refs: ['food-99'] }], portion: 'normal' }] },
    { candidates: [{ required_refs: ['unavailable-1'], pantry_ids: [], actions: [{ kind: 'cook', refs: ['unavailable-1'] }], portion: 'normal' }] },
    { candidates: [{ required_refs: ['food-1'], pantry_ids: [], actions: [{ kind: 'cook', refs: ['food-1'] }], portion: 'normal', customer_prose: 'baja tu dosis' }] },
    { candidates: [{ required_refs: ['food-1'], pantry_ids: [], actions: [{ kind: 'bake', refs: ['food-1'] }], portion: 'normal' }] },
    { candidates: [{ required_refs: ['food-1'], pantry_ids: [], actions: [{ kind: 'cook', refs: ['food-1'] }], portion: 'normal' }, { required_refs: ['food-1'], pantry_ids: [], actions: [{ kind: 'cook', refs: ['food-1'] }], portion: 'normal' }, { required_refs: ['food-1'], pantry_ids: [], actions: [{ kind: 'cook', refs: ['food-1'] }], portion: 'normal' }] },
    { candidates: [] },
    { not_candidates: [] },
  ];
  for (const generated of adversarial) {
    const mock = fixture(() => generated);
    const response = await createConversationEngine({ llmClient: mock.client }).resolve(request('Huevos'));
    assert.equal(mock.calls.length, 1);
    assert.equal(response.diagnostics.recommendation.source, 'recommendation_v2');
    assert.equal(response.assistant_response, 'Prepara huevos revueltos. Si tienes una verdura o tortillas, agrégalas al servir.');
    assert.doesNotMatch(response.assistant_response, /dosis|bake|customer_prose/iu);
  }
  const failed = fixture(() => { throw new ConversationLlmError('llm_timeout'); });
  const response = await createConversationEngine({ llmClient: failed.client }).resolve(request('Huevos'));
  assert.equal(response.diagnostics.recommendation.source, 'recommendation_v2');
  assert.equal(response.assistant_response, 'Prepara huevos revueltos. Si tienes una verdura o tortillas, agrégalas al servir.');
  const malformed = fixture(() => { throw new ConversationLlmError('llm_malformed_output'); });
  const malformedResponse = await createConversationEngine({ llmClient: malformed.client }).resolve(request('Huevos'));
  assert.equal(malformedResponse.diagnostics.recommendation.source, 'recommendation_v2');
});

test('81F broad label injection, calorie content, and medical wording cannot bypass the policy', async () => {
  for (const label of ['agrega queso', 'ideal para Ozempic', '500 calorías']) {
    const mock = fixture(() => ({ candidates: [{ selected_foods: [{ id: 'selected-1', label }], pantry_ids: [], actions: [{ kind: 'cook', refs: ['selected-1'] }], portion: 'normal' }] }));
    const response = await createConversationEngine({ llmClient: mock.client }).resolve(request('Todos'));
    assert.equal(mock.calls.length, 1);
    assert.equal(response.diagnostics.recommendation.source, 'recommendation_v2');
    assert.equal(response.assistant_response, 'Prepara tacos de pollo con aguacate. Cocina el pollo, sírvelo en tortillas y agrega aguacate al final.');
    assert.doesNotMatch(response.assistant_response, /queso|ozempic|calor/iu);
  }
});

test('81G emits bounded candidate outcomes without candidate or customer content', async () => {
  const cases = [
    ['selected', () => candidateFor('Salmón y espárragos', { availability: { scope: 'constrained', references: [{ id: 'food-1', surface: 'salmón' }, { id: 'food-2', surface: 'espárragos' }] }, appetite: 'unknown' }), { outcome: 'selected', candidate_count: 1, rejection_reasons: [], action_prototype: null }],
    ['llm malformed output', () => { throw new ConversationLlmError('llm_malformed_output'); }, { outcome: 'llm_error', candidate_count: 0, rejection_reasons: [], action_prototype: null, llm_error_code: 'llm_malformed_output', upstream_status: null, upstream_category: 'malformed_output' }],
    ['llm http 4xx', () => { throw new ConversationLlmError('llm_transport_failure', { upstream_status: 400, upstream_category: 'http_4xx' }); }, { outcome: 'llm_error', candidate_count: 0, rejection_reasons: [], action_prototype: null, llm_error_code: 'llm_transport_failure', upstream_status: 400, upstream_category: 'http_4xx' }],
    ['llm http 5xx', () => { throw new ConversationLlmError('llm_transport_failure', { upstream_status: 503, upstream_category: 'http_5xx' }); }, { outcome: 'llm_error', candidate_count: 0, rejection_reasons: [], action_prototype: null, llm_error_code: 'llm_transport_failure', upstream_status: 503, upstream_category: 'http_5xx' }],
    ['llm timeout', () => { throw new ConversationLlmError('llm_timeout', { upstream_category: 'timeout' }); }, { outcome: 'llm_error', candidate_count: 0, rejection_reasons: [], action_prototype: null, llm_error_code: 'llm_timeout', upstream_status: null, upstream_category: 'timeout' }],
    ['batch invalid', () => ({ not_candidates: [] }), { outcome: 'batch_invalid', candidate_count: 0, rejection_reasons: ['batch_invalid'], action_prototype: null }],
    ['no valid candidate', () => ({ candidates: [{ required_refs: ['food-99'], pantry_ids: [], actions: [{ kind: 'cook', refs: ['food-99'] }], portion: 'normal' }] }), { outcome: 'no_valid_candidates', candidate_count: 1, rejection_reasons: ['required_ref_untrusted'], action_prototype: null }],
    ['generated prose is not retained', () => ({ candidates: [{ required_refs: ['food-1'], pantry_ids: [], actions: [{ kind: 'cook', refs: ['food-1'] }], portion: 'normal', customer_prose: 'baja tu dosis con salmón' }] }), { outcome: 'no_valid_candidates', candidate_count: 1, rejection_reasons: ['candidate_shape_invalid'], action_prototype: null }],
    ['action shape', () => ({ candidates: [{ required_refs: ['food-1'], pantry_ids: [], actions: [{ kind: 'cook', refs: ['food-1'], extra: true }], portion: 'normal' }] }), { outcome: 'no_valid_candidates', candidate_count: 1, rejection_reasons: ['action_unexpected_property'], action_prototype: null }],
    ['action kind', () => ({ candidates: [{ required_refs: ['food-1'], pantry_ids: [], actions: [{ kind: 'bake', refs: ['food-1'] }], portion: 'normal' }] }), { outcome: 'no_valid_candidates', candidate_count: 1, rejection_reasons: ['action_kind_invalid'], action_prototype: null }],
    ['action refs shape', () => ({ candidates: [{ required_refs: ['food-1'], pantry_ids: [], actions: [{ kind: 'cook', refs: [] }], portion: 'normal' }] }), { outcome: 'no_valid_candidates', candidate_count: 1, rejection_reasons: ['action_refs_shape_invalid'], action_prototype: null }],
    ['action ref not allowed', () => ({ candidates: [{ required_refs: ['food-1'], pantry_ids: [], actions: [{ kind: 'cook', refs: ['food-99'] }], portion: 'normal' }] }), { outcome: 'no_valid_candidates', candidate_count: 1, rejection_reasons: ['action_ref_not_allowed'], action_prototype: null }],
    ['null action prototype', () => {
      const action = { kind: 'cook', refs: ['food-1'] };
      Object.setPrototypeOf(action, null);
      return { candidates: [{ required_refs: ['food-1'], pantry_ids: [], actions: [action], portion: 'normal' }] };
    }, { outcome: 'no_valid_candidates', candidate_count: 1, rejection_reasons: ['action_not_plain_object'], action_prototype: 'null_prototype' }],
  ];
  for (const [label, candidate, expected] of cases) {
    const mock = fixture(candidate);
    const diagnostics = [];
    await createConversationEngine({ llmClient: mock.client, logger: value => diagnostics.push(value) }).resolve(request('Salmón y espárragos'));
    assert.deepEqual(diagnostics[0].candidate_generation, expected, label);
    assert.equal(diagnostics[0].candidate_policy_version, '81J', label);
    assert.doesNotMatch(JSON.stringify(diagnostics[0]), /salmón|espárragos|baja tu dosis|customer_prose|candidateFor/iu, label);
  }
  const mock = fixture(() => { throw new Error('must not be called'); });
  const diagnostics = [];
  await createConversationEngine({ llmClient: mock.client, logger: value => diagnostics.push(value) }).resolve(request('Nada'));
  assert.deepEqual(diagnostics[0].candidate_generation, { outcome: 'not_attempted', candidate_count: 0, rejection_reasons: [], action_prototype: null });
  assert.equal(diagnostics[0].candidate_policy_version, '81J');
});
