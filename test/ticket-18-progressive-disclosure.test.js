'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const knowledge = require('../lib/dietavity-knowledge');
const {
  CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE,
  CANONICAL_POST_DISCOVERY_GENERAL_INFORMATION_RESPONSE,
  decideSalesTurn,
  responseHasAmbiguousQuestion,
  responseViolatesContract,
} = require('../lib/sales-engine-v3');

const workflow = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json',
), 'utf8'));
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const NOW = '2026-08-18T18:00:00.000Z';

function interpretation(buyerSignal = 'other', extra = {}) {
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

function decide(message, buyerSignal = 'other', session = {}, extra = {}) {
  return decideSalesTurn({
    message,
    interpretation: interpretation(buyerSignal, extra),
    session: { conversation_stage: 'evaluating', ...session },
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

test('Ticket 18 uses the approved concise general-information response after discovery', () => {
  const decision = decide('¿Me puedes contar más?', 'broad_information_request', {
    last_question_type: 'primary_goal',
  });

  assert.equal(decision.strategy, 'broad_information');
  assert.equal(decision.next_last_question_type, 'show_example');
  assert.equal(decision.deterministic_response, CANONICAL_POST_DISCOVERY_GENERAL_INFORMATION_RESPONSE);
  assert.equal(validateResponse('¿Me puedes contar más?', decision), CANONICAL_POST_DISCOVERY_GENERAL_INFORMATION_RESPONSE);
  assert.doesNotMatch(validateResponse('¿Me puedes contar más?', decision), /portal|30 días después|países longevos/i);
});

test('Ticket 18 contextual affirmatives have one show-example meaning', () => {
  for (const message of ['Sí', 'Sip', 'Claro', 'Por favor']) {
    const decision = decide(message, 'contextual_affirmation', {
      last_question_type: 'show_example',
    });
    assert.equal(decision.strategy, 'show_example', message);
    assert.equal(decision.pending_action, 'respond', message);
    assert.equal(decision.checkout_authorized, false, message);
  }
});

test('Ticket 18 explicit current questions override prior show-example context', () => {
  const decision = decide('¿Aceptan OXXO?', 'question', {
    last_question_type: 'show_example',
  }, { topic: 'payment_methods', material_question: true });
  const output = validateResponse('¿Aceptan OXXO?', decision);

  assert.equal(decision.strategy, 'answer_question');
  assert.equal(decision.topic, 'payment_methods');
  assert.match(output, /aceptamos pagos en OXXO/);
  assert.doesNotMatch(output, /avena|día ilustrativo|ejemplo de cómo sería/i);
});

test('Ticket 18 rejects compound or menu follow-up questions', () => {
  const compound = '¿Quieres ver un ejemplo o prefieres que te explique cómo funciona?';
  const compoundWithoutOpeningMark = 'Quieres ver un ejemplo o prefieres que te explique cómo funciona?';
  const menu = '¿Qué te gustaría saber: cómo funciona, qué incluye o cómo comprarlo?';

  assert.equal(responseHasAmbiguousQuestion(compound), true);
  assert.equal(responseHasAmbiguousQuestion(compoundWithoutOpeningMark), true);
  assert.equal(responseHasAmbiguousQuestion(menu), true);
  assert.equal(responseViolatesContract(compound, 1), true);

  const decision = decide('Dame toda la información', 'broad_information_request');
  assert.equal(decision.comprehensive_information, true);
  assert.notEqual(validateResponse('Dame toda la información', decision, compound), compound);
  assert.notEqual(validateResponse('Dame toda la información', decision, menu), menu);
});

test('Ticket 18 focused answers do not append unrelated offer details', () => {
  const cases = [
    ['¿Cuánto cuesta?', 'price', /\$149 MXN/],
    ['¿Aceptan OXXO?', 'payment_methods', /OXXO/],
  ];

  for (const [message, topic, expected] of cases) {
    const decision = decide(message, 'question', {}, { topic, material_question: true });
    const output = validateResponse(message, decision);
    assert.match(output, expected, message);
    assert.doesNotMatch(output, /portal|fecha de inicio|30 días calendario|países longevos|recetas|restaurantes/i, message);
  }
});

test('Ticket 18 still supports explicit comprehensive-information requests', () => {
  const decision = decide('Dame toda la información', 'broad_information_request');
  const fullerAnswer = 'Incluye un programa personalizado de 28 días con desayuno, comida, cena y snack. Cuesta $149 MXN en un solo pago, se consulta en el portal y cuenta con apoyo por WhatsApp.\n¿Quieres que te muestre un ejemplo de un día de comidas?';

  assert.equal(decision.strategy, 'broad_information');
  assert.equal(decision.comprehensive_information, true);
  assert.equal(decision.deterministic_response, undefined);
  assert.equal(validateResponse('Dame toda la información', decision, fullerAnswer), fullerAnswer);
});

test('Ticket 18 preserves Ticket 16 opening and integrates the response contract', () => {
  const opening = decideSalesTurn({
    message: 'Hola, quiero más información',
    interpretation: interpretation('broad_information_request'),
    session: { conversation_stage: 'new' },
    now: NOW,
  });
  const classifier = nodes.get('Interpret Sales Buyer Signal').parameters.options.systemMessage;
  const prompt = nodes.get('Build Constrained Sales Response').parameters.jsCode;
  const validator = nodes.get('Validate Sales Response Contract').parameters.jsCode;

  assert.equal(opening.deterministic_response, CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE);
  assert.equal(validateResponse('Hola, quiero más información', opening), CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE);
  assert.match(knowledge.COMMERCIAL_POLICY_FACTS, /información mínima relevante/);
  assert.match(classifier, /explicit current question always overrides/i);
  assert.match(prompt, /información mínima relevante/);
  assert.match(prompt, /comprehensive_information/);
  assert.match(validator, /responseHasAmbiguousQuestion/);
  assert.equal(workflow.active, false);
});
