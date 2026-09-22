'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE,
  CANONICAL_POST_DISCOVERY_GENERAL_INFORMATION_RESPONSE,
  decideSalesTurn,
} = require('../lib/sales-engine-v3');

const workflow = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json',
), 'utf8'));
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const NOW = '2026-08-18T18:00:00.000Z';

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

function validateResponse(message, decision, generated = 'Una respuesta generativa variable.') {
  const source = nodes.get('Validate Sales Response Contract').parameters.jsCode;
  const context = {
    $: (name) => ({ item: { json: name === 'Apply Deterministic Commercial Policy'
      ? decision : { chatInput: message } } }),
    $input: { first: () => ({ json: { output: generated } }) },
  };
  return vm.runInNewContext(`(function () { ${source} })()`, context)[0].json.output;
}

test('Ticket 16 semantic broad-information variants use the exact initial canonical opening', () => {
  for (const message of [
    '¡Hola! Quiero más información.',
    'Hola, quiero información',
    '¿Cómo funciona?',
    'Quisiera saber de qué se trata',
    'Vi Dietavity y quiero más información',
    '¿Me pueden contar más?',
    'Me interesa Dietavity, quisiera saber cómo funciona',
  ]) {
    const decision = decide(message);
    assert.equal(decision.buyer_signal, 'broad_information_request', message);
    assert.equal(decision.strategy, 'discovery', message);
    assert.equal(decision.next_last_question_type, 'primary_goal', message);
    assert.equal(decision.deterministic_response, CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE, message);
    assert.equal(validateResponse(message, decision), CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE, message);
  }
});

test('Ticket 16 specific first-turn commercial questions take precedence', () => {
  const price = decide('Hola, quiero más información. ¿Cuánto cuesta?', 'broad_information_request', {}, {
    topic: 'price', material_question: true,
  });
  assert.equal(price.strategy, 'answer_question');
  assert.match(validateResponse('Hola, quiero más información. ¿Cuánto cuesta?', price), /\$149 MXN/);

  const payment = decide('Me interesa. ¿Aceptan OXXO?', 'broad_information_request', {}, {
    topic: 'payment_methods', material_question: true,
  });
  assert.equal(payment.strategy, 'answer_question');
  assert.match(validateResponse('Me interesa. ¿Aceptan OXXO?', payment), /aceptamos pagos en OXXO/);

  const product = decide('¿Ustedes entregan la comida?', 'question', {}, {
    topic: 'product_scope', material_question: true,
  });
  assert.equal(product.strategy, 'answer_question');
});

test('Ticket 16 supplied goal and explicit purchase retain precedence', () => {
  const goal = decide('Quiero bajar de peso.', 'broad_information_request', {}, {
    goal: 'bajar de peso', goal_supplied: true,
  });
  assert.equal(goal.strategy, 'conversational');
  assert.notEqual(validateResponse('Quiero bajar de peso.', goal), CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE);
  assert.doesNotMatch(validateResponse('Quiero bajar de peso.', goal), /Qué te gustaría conseguir principalmente/);

  const purchase = decide('Quiero comprar el programa.');
  assert.equal(purchase.strategy, 'direct_purchase');
  assert.equal(purchase.pending_action, 'send_checkout');
  assert.equal(purchase.checkout_authorized, true);
});

test('Ticket 16 does not restart the canonical introduction in an existing conversation', () => {
  const decision = decide('¿Me puedes dar más información?', 'broad_information_request', {
    conversation_stage: 'evaluating', last_question_type: 'show_example',
  });
  assert.equal(decision.strategy, 'broad_information');
  assert.equal(decision.deterministic_response, CANONICAL_POST_DISCOVERY_GENERAL_INFORMATION_RESPONSE);
  assert.notEqual(validateResponse('¿Me puedes dar más información?', decision), CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE);
});

test('Ticket 16 workflow keeps deterministic output and canonical ledger persistence integrated', () => {
  const classifier = nodes.get('Interpret Sales Buyer Signal').parameters.options.systemMessage;
  const policy = nodes.get('Apply Deterministic Commercial Policy').parameters.jsCode;
  const validator = nodes.get('Validate Sales Response Contract').parameters.jsCode;
  const reserve = nodes.get('Reserve Sales Reply').parameters.options.queryReplacement;

  assert.match(classifier, /broad_information_request/);
  assert.match(classifier, /specific actionable question/i);
  assert.match(policy, /session\.conversation_stage === 'new'/);
  assert.match(policy, /CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE/);
  assert.match(validator, /decision\.deterministic_response \|\| repairInformationalResponse\(generated, decision\)/);
  assert.match(reserve, /body: \$json\.output/);
  assert.match(reserve, /'sales_deterministic'/);
  assert.equal(workflow.active, false);
});
