'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const knowledge = require('../lib/dietavity-knowledge');
const {
  CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE,
  CANONICAL_POST_DISCOVERY_GENERAL_INFORMATION_RESPONSE,
  decideSalesTurn,
} = require('../lib/sales-engine-v3');

const EXPECTED_OPENING = '¡Hola! 👋 En Dietavity te decimos qué comer cada día durante 28 días, con comidas fáciles, familiares y pensadas para ti. ¿Qué te gustaría conseguir principalmente con tu alimentación: comer más saludable, controlar tu peso, sentirte mejor, organizar mejor tus comidas o algo diferente?';
const workflowPath = path.join(
  __dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json',
);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const NOW = '2026-08-19T18:00:00.000Z';

function interpretation(buyerSignal, extra = {}) {
  return {
    interpretation_valid: true,
    buyer_signal: buyerSignal,
    topic: null,
    goal: null,
    goal_supplied: false,
    explicit_reminder_request: false,
    material_question: false,
    substantive_engagement: true,
    ...extra,
  };
}

function decide(message, buyerSignal = 'broad_information_request', session = {}, extra = {}) {
  return decideSalesTurn({
    message,
    interpretation: interpretation(buyerSignal, extra),
    session: { conversation_stage: 'new', ...session },
    now: NOW,
  });
}

function validateResponse(message, decision, generated = 'Respuesta generativa.') {
  const source = nodes.get('Validate Sales Response Contract').parameters.jsCode;
  const context = {
    $: (name) => ({ item: { json: name === 'Apply Deterministic Commercial Policy'
      ? decision : { chatInput: message } } }),
    $input: { first: () => ({ json: { output: generated } }) },
  };
  return vm.runInNewContext(`(function () { ${source} })()`, context)[0].json.output;
}

test('Ticket 20 uses the exact practical-positioning opening for broad first turns', () => {
  assert.equal(CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE, EXPECTED_OPENING);

  for (const message of [
    '¡Hola! Quiero más información.',
    'Hola, quisiera saber de qué se trata.',
  ]) {
    const decision = decide(message);
    assert.equal(decision.strategy, 'discovery', message);
    assert.equal(decision.next_last_question_type, 'primary_goal', message);
    assert.equal(decision.deterministic_response, EXPECTED_OPENING, message);
    assert.equal(validateResponse(message, decision), EXPECTED_OPENING, message);
  }
});

test('Ticket 20 preserves goal, price, and purchase precedence', () => {
  const goal = decide('Quiero bajar de peso.', 'broad_information_request', {}, {
    goal: 'bajar de peso', goal_supplied: true,
  });
  assert.equal(goal.strategy, 'conversational');
  assert.notEqual(validateResponse('Quiero bajar de peso.', goal), EXPECTED_OPENING);

  const price = decide('¿Cuánto cuesta?', 'question', {}, {
    topic: 'price', material_question: true,
  });
  assert.equal(price.strategy, 'answer_question');
  assert.match(validateResponse('¿Cuánto cuesta?', price), /^El programa personalizado de Dietavity cuesta \$149 MXN/);
  assert.doesNotMatch(validateResponse('¿Cuánto cuesta?', price), /comidas fáciles, familiares/);

  const purchase = decide('Quiero comprarlo.');
  assert.equal(purchase.strategy, 'direct_purchase');
  assert.equal(purchase.pending_action, 'send_checkout');
  assert.equal(purchase.checkout_authorized, true);
});

test('Ticket 20 makes practical value primary and longevity supporting in sales-only knowledge', () => {
  assert.match(knowledge.SALES_POSITIONING, /elimina la carga diaria de decidir qué comer/);
  assert.match(knowledge.SALES_POSITIONING, /comidas saludables, fáciles y familiares/);
  assert.match(knowledge.SALES_POSITIONING, /No prometas comidas en cinco minutos, instantáneas ni sin cocinar/);
  assert.match(knowledge.SALES_POSITIONING, /no el titular de venta/);
  assert.match(knowledge.SALES_POSITIONING, /No presentes el programa como una dieta mexicana/);
  assert.ok(
    knowledge.SALES_RESPONSE_KNOWLEDGE.indexOf('# Posicionamiento Comercial') <
      knowledge.SALES_RESPONSE_KNOWLEDGE.indexOf('# Rol e Identidad'),
  );
  assert.doesNotMatch(knowledge.MEAL_PROMPT_KNOWLEDGE, /# Posicionamiento Comercial/);

  const longevity = decide('¿En qué se basa Dietavity?', 'question', {}, {
    topic: 'how_it_works', material_question: true,
  });
  const supportingAnswer = 'Nuestro enfoque combina tus objetivos y preferencias con principios de alimentación presentes en algunas de las poblaciones más longevas del mundo, adaptados a comidas e ingredientes cotidianos.';
  assert.equal(validateResponse('¿En qué se basa Dietavity?', longevity, supportingAnswer), supportingAnswer);
});

test('Ticket 20 keeps the concise post-discovery explanation and generated workflow synchronized', () => {
  assert.equal(
    CANONICAL_POST_DISCOVERY_GENERAL_INFORMATION_RESPONSE,
    'Claro 😊 Dietavity es un programa personalizado de 28 días que te dice qué comer cada día. Cuesta $149 MXN en un solo pago e incluye desayuno, comida, cena y snack, además de apoyo por WhatsApp cuando lo necesites.\n\n¿Quieres que te muestre un ejemplo de cómo sería un día de comidas?',
  );

  const embeddedKnowledge = nodes.get('Build Canonical Dietavity Knowledge').parameters.jsCode;
  const embeddedPolicy = nodes.get('Apply Deterministic Commercial Policy').parameters.jsCode;
  const responsePrompt = nodes.get('Build Constrained Sales Response').parameters.jsCode;
  assert.match(embeddedKnowledge, /sales_positioning/);
  assert.match(embeddedKnowledge, /elimina la carga diaria de decidir qué comer/);
  assert.match(embeddedPolicy, /comidas fáciles, familiares y pensadas para ti/);
  assert.match(responsePrompt, /información mínima relevante/);
  assert.equal(workflow.active, false);
});
