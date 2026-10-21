'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v3 = require('../lib/recommendation-candidate-v3');
const { RECOMMENDATION_CANDIDATE_SYSTEM_PROMPT } = require('../lib/conversation-engine/prompts');

function trusted(facts) { return v3.buildTrustedInput({ ledger: facts.map((fact, index) => ({ id: `food-${index + 1}`, provenance: 'current_turn', ...fact })), appetite: 'unknown' }); }
function proposal(overrides = {}) {
  return {
    candidate_type: 'meal_proposal',
    dish: { label: 'chilaquiles con huevo', confirmed_anchor_ids: ['food-1', 'food-2'] },
    proposed_items: [{ id: 'proposed-1', label: 'salsa', role: 'ingredient' }],
    customer_response: 'Si tienes salsa, puedes hacer unos chilaquiles con huevo: baña las tortillas con la salsa y agrega el huevo al final.',
    ...overrides,
  };
}

test('V3 accepts open dish labels while grounding confirmed anchors', () => {
  const input = trusted([{ label: 'huevo', status: 'confirmed_available' }, { label: 'tortillas', status: 'confirmed_available' }]);
  const result = v3.selectRecommendation(proposal(), input);
  assert.equal(result.valid, true);
  assert.match(result.response, /chilaquiles/u);
});

test('V3 rejects proposal-local possession, prohibited claims, and blocked foods', () => {
  const input = trusted([{ label: 'huevo', status: 'confirmed_available' }, { label: 'tortillas', status: 'confirmed_available' }, { label: 'cacahuate', status: 'restricted' }]);
  for (const [response, reason] of [
    ['Con la salsa que tienes, prepara chilaquiles con huevo y tortillas.', 'conditional_possession_claim'],
    ['Tienes salsa, prepara chilaquiles con huevo y tortillas.', 'conditional_possession_claim'],
    ['Si tienes salsa, prepara chilaquiles con huevo y tortillas. Es ideal para bajar de peso mientras usas tu medicamento.', 'response_prohibited_content'],
    ['Si tienes salsa, prepara chilaquiles con huevo, tortillas y cacahuate.', 'blocked_food_rendered'],
  ]) assert.equal(v3.selectRecommendation(proposal({ customer_response: response }), input).reason, reason, response);
});

test('V3 permits natural open-world complement wording without reparsing culinary prose', () => {
  const huauzontles = trusted([{ label: 'huauzontles', status: 'confirmed_available' }, { label: 'tortillas', status: 'confirmed_available' }]);
  const huauzontlesResult = v3.selectRecommendation({
    candidate_type: 'meal_proposal',
    dish: { label: 'tacos de huauzontles', confirmed_anchor_ids: ['food-1', 'food-2'] },
    proposed_items: [{ id: 'proposed-1', label: 'queso', role: 'ingredient' }],
    customer_response: 'Hazte unos tacos de huauzontles: cuécelos hasta que estén suaves y calienta las tortillas. Si tienes queso o puedes conseguirlo, añade un poco para darles un toque cremoso.',
  }, huauzontles);
  assert.equal(huauzontlesResult.valid, true);

  const egg = trusted([{ label: 'huevo', status: 'confirmed_available' }]);
  const eggResult = v3.selectRecommendation({
    candidate_type: 'meal_proposal',
    dish: { label: 'huevos a la mexicana', confirmed_anchor_ids: ['food-1'] },
    proposed_items: [
      { id: 'proposed-1', label: 'jitomate', role: 'ingredient' },
      { id: 'proposed-2', label: 'cebolla', role: 'ingredient' },
      { id: 'proposed-3', label: 'chile', role: 'ingredient' },
    ],
    customer_response: 'Puedes hacer huevos a la mexicana. Para prepararlos necesitarías jitomate, cebolla y chile; añade un poco de cada uno al huevo.',
  }, egg);
  assert.equal(eggResult.valid, true);
});

test('V3 rejects hostile shapes, unknown IDs, duplicates, and blocked proposed ingredients', () => {
  const input = trusted([{ label: 'huevo', status: 'confirmed_available' }, { label: 'tortillas', status: 'confirmed_available' }, { label: 'salsa', status: 'unavailable' }]);
  assert.equal(v3.selectRecommendation({ ...proposal(), extra: true }, input).reason, 'candidate_shape_invalid');
  assert.equal(v3.selectRecommendation(proposal({ dish: { label: 'x', confirmed_anchor_ids: ['food-9'] } }), input).reason, 'anchor_not_confirmed');
  assert.equal(v3.selectRecommendation(proposal({ proposed_items: [{ id: 'proposed-1', label: 'salsa', role: 'ingredient' }] }), input).reason, 'proposed_blocked');
  const hostile = proposal(); Object.setPrototypeOf(hostile.proposed_items[0], null);
  assert.equal(v3.selectRecommendation(hostile, trusted([{ label: 'huevo', status: 'confirmed_available' }, { label: 'tortillas', status: 'confirmed_available' }])).reason, 'proposed_item_invalid');
});

test('V3 keeps restricted and unavailable foods blocked when proposed for obtain', () => {
  const input = trusted([{ label: 'cacahuate', status: 'restricted' }, { label: 'salsa', status: 'unavailable' }]);
  for (const label of ['cacahuate', 'salsa']) {
    assert.equal(v3.validateProposal({
      candidate_type: 'meal_proposal', dish: { label: 'plato sencillo', confirmed_anchor_ids: [] },
      proposed_items: [{ id: 'proposed-1', label, role: 'obtain' }],
      customer_response: 'Puedes pedir algo sencillo.',
    }, input).reason, 'proposed_blocked');
  }
});

test('V3 accepts atomic leftovers and unknown regional foods without ontology admission', () => {
  const input = trusted([{ label: 'sobras de mole de ayer', status: 'confirmed_available' }, { label: 'tortillas', status: 'confirmed_available' }]);
  const result = v3.selectRecommendation({
    candidate_type: 'meal_proposal', dish: { label: 'tacos de mole', confirmed_anchor_ids: ['food-1', 'food-2'] }, proposed_items: [],
    customer_response: 'Puedes hacer tacos de mole: calienta las sobras de mole de ayer y las tortillas.',
  }, input);
  assert.equal(result.valid, true);
});

test('V3 permits qualitative protein and natural grounded responses without repeating the internal dish label', () => {
  const input = trusted([{ label: 'huevo', status: 'confirmed_available' }, { label: 'tortillas', status: 'confirmed_available' }]);
  const response = 'Si tienes salsa, puedes preparar las tortillas con salsa y agregar huevo. El huevo aporta proteína.';
  const result = v3.selectRecommendation(proposal({ customer_response: response }), input);
  assert.equal(result.valid, true);
  assert.doesNotMatch(response, /chilaquiles con huevo/iu);
  assert.equal(v3.selectRecommendation(proposal({ customer_response: 'Si tienes salsa, prepara tortillas con salsa y huevo. Esta opción tiene 25 g de proteína.' }), input).reason, 'response_prohibited_content');
});

test('V3 accepts harmless open dish punctuation while rejecting markup and prohibited dish content', () => {
  const input = trusted([{ label: 'huevo', status: 'confirmed_available' }, { label: 'tortillas', status: 'confirmed_available' }]);
  const accepted = v3.selectRecommendation(proposal({
    dish: { label: 'Huevos & tortillas (rápidos): sartén', confirmed_anchor_ids: ['food-1', 'food-2'] },
    customer_response: 'Si tienes salsa, puedes preparar las tortillas con salsa y agregar huevo.',
  }), input);
  assert.equal(accepted.valid, true);
  assert.equal(v3.validateProposal(proposal({ dish: { label: 'Huevos <script>', confirmed_anchor_ids: ['food-1', 'food-2'] } }), input).reason, 'dish_invalid');
  assert.equal(v3.validateProposal(proposal({ dish: { label: 'Huevos con medicamento', confirmed_anchor_ids: ['food-1', 'food-2'] } }), input).reason, 'dish_invalid');
});

test('V3 prompt states assistant perspective, explicit bounds, and qualitative protein policy', () => {
  assert.match(RECOMMENDATION_CANDIDATE_SYSTEM_PROMPT, /TO the user/iu);
  assert.match(RECOMMENDATION_CANDIDATE_SYSTEM_PROMPT, /Do not speak as the user/iu);
  assert.match(RECOMMENDATION_CANDIDATE_SYSTEM_PROMPT, /no more than 3 sentences and 90 words/iu);
  assert.match(RECOMMENDATION_CANDIDATE_SYSTEM_PROMPT, /qualitative protein language is allowed/iu);
  assert.match(RECOMMENDATION_CANDIDATE_SYSTEM_PROMPT, /not an exhaustive pantry/iu);
  assert.match(RECOMMENDATION_CANDIDATE_SYSTEM_PROMPT, /proposed_items/iu);
});

test('V3 permits open meal conception and natural proposal-local complements without false possession', () => {
  const input = trusted([{ label: 'huevo', status: 'confirmed_available' }, { label: 'tortillas', status: 'confirmed_available' }]);
  const result = v3.selectRecommendation(proposal({
    proposed_items: [{ id: 'proposed-1', label: 'jitomate', role: 'ingredient' }],
    customer_response: 'Puedes hacer huevos rancheros con huevo y tortillas; para la salsa necesitarías jitomate.',
  }), input);
  assert.equal(result.valid, true);
  assert.equal(v3.selectRecommendation(proposal({
    proposed_items: [{ id: 'proposed-1', label: 'jitomate', role: 'ingredient' }],
    customer_response: 'Haz huevos rancheros con huevo y tortillas. Usa el jitomate que tienes para la salsa.',
  }), input).reason, 'conditional_possession_claim');
});

test('V3 permits zero-anchor obtain and restaurant recommendations without culinary mechanics', () => {
  const input = trusted([]);
  const order = v3.selectRecommendation({
    candidate_type: 'meal_proposal', dish: { label: 'sopa italiana ligera', confirmed_anchor_ids: [] },
    proposed_items: [{ id: 'proposed-1', label: 'minestrone', role: 'obtain' }],
    customer_response: 'Si vas a pedir, una sopa minestrone es una opción ligera y fácil de comer.',
  }, input);
  assert.equal(order.valid, true);
  const restaurant = v3.selectRecommendation({
    candidate_type: 'meal_proposal', dish: { label: 'pasta al pomodoro', confirmed_anchor_ids: [] },
    proposed_items: [{ id: 'proposed-1', label: 'pasta al pomodoro', role: 'obtain' }],
    customer_response: 'Una pasta al pomodoro puede ser una opción sencilla si la ves en el menú.',
  }, input);
  assert.equal(restaurant.valid, true);
  assert.equal(v3.selectRecommendation({
    candidate_type: 'meal_proposal', dish: { label: 'tacos de pollo', confirmed_anchor_ids: [] },
    proposed_items: [{ id: 'proposed-1', label: 'tacos de pollo', role: 'obtain' }],
    operations: [], customer_response: 'Puedes pedir tacos de pollo.',
  }, input).reason, 'candidate_shape_invalid');
});

test('V3 keeps a used confirmed food trusted without requiring every confirmed food as an anchor', () => {
  const input = trusted([
    { label: 'pollo', status: 'confirmed_available' }, { label: 'tortillas', status: 'confirmed_available' },
    { label: 'aguacate', status: 'confirmed_available' }, { label: 'jitomate', status: 'confirmed_available' },
    { label: 'frijoles', status: 'confirmed_available' },
  ]);
  const valid = proposal({
    dish: { label: 'tacos de pollo', confirmed_anchor_ids: ['food-1', 'food-2', 'food-3', 'food-4'] },
    proposed_items: [],
    customer_response: 'Haz tacos de pollo con tortillas, aguacate y jitomate; acompáñalos con frijoles.',
  });
  assert.equal(v3.selectRecommendation(valid, input).valid, true);
  assert.equal(v3.selectRecommendation(proposal({
    dish: valid.dish,
    proposed_items: [{ id: 'proposed-1', label: 'frijoles', role: 'ingredient' }],
    customer_response: valid.customer_response,
  }), input).reason, 'proposed_duplicates_confirmed');
});
