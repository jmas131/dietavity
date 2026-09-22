'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {
  decideSalesTurn,
  hasDeterministicBroadInformationRequest,
  questionCount,
} = require('../lib/sales-engine-v3');

const workflow = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json',
), 'utf8'));
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const NOW = '2026-08-16T18:00:00.000Z';

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

function validateResponse(message, decision, generated) {
  const source = nodes.get('Validate Sales Response Contract').parameters.jsCode;
  const context = {
    $: (name) => ({ item: { json: name === 'Apply Deterministic Commercial Policy'
      ? decision : { chatInput: message } } }),
    $input: { first: () => ({ json: { output: generated } }) },
  };
  return vm.runInNewContext(`(function () { ${source} })()`, context)[0].json.output;
}

const discoveryContext = { last_question_type: 'show_example' };

test('10A production incident is substantive and its valid contextual response survives validation', () => {
  const decision = decide('Realmente todo', 'ambiguous_acknowledgement', discoveryContext, {
    substantive_engagement: false,
  });
  assert.equal(decision.buyer_signal, 'broad_information_request');
  assert.equal(decision.strategy, 'broad_information');
  assert.equal(decision.pending_action, 'respond');
  assert.equal(decision.checkout_authorized, false);
  assert.equal(decision.allow_purchase_cta, false);
  assert.ok(decision.events.includes('meaningful_engagement'));

  const generated = 'Claro 😊 Además de organizar tus 28 días en el portal, Dietavity adapta desayuno, comida, cena y snack con la información de tu personalización. Durante el programa también puedes pedir orientación práctica por WhatsApp. ¿Quieres ver un día ilustrativo?';
  assert.equal(validateResponse('Realmente todo', decision, generated), generated);
  assert.equal(questionCount(generated), 1);
});

test('10A broad-information variants cannot collapse to acknowledgement-only output', () => {
  for (const message of [
    'Todo', 'Todo por favor', 'Quiero saber todo', 'Cuéntame todo',
    'Explícame todo', 'Dime todo', 'Quiero más información', 'Cuéntame más',
  ]) {
    const decision = decide(message, 'ambiguous_acknowledgement', discoveryContext);
    assert.equal(decision.buyer_signal, 'broad_information_request', message);
    assert.equal(decision.strategy, 'broad_information', message);
    assert.equal(decision.checkout_authorized, false, message);
    const output = validateResponse(message, decision, '¡Con gusto! 😊');
    assert.notEqual(output, '¡Con gusto! 😊', message);
    assert.match(output, /Dietavity|programa/i, message);
    assert.ok(questionCount(output) <= 1, message);
  }
});

test('10A bare todo is contextual and never authorizes Checkout from purchase context', () => {
  assert.equal(hasDeterministicBroadInformationRequest('Todo', { last_question_type: 'primary_goal' }), true);
  assert.equal(hasDeterministicBroadInformationRequest('Todo', { last_question_type: 'purchase_confirmation' }), false);
  assert.equal(hasDeterministicBroadInformationRequest('Todo', {}), false);

  const purchaseContext = {
    conversation_stage: 'offer',
    last_question_type: 'purchase_confirmation',
    last_question_at: '2026-08-16T17:59:00.000Z',
    commercial_context_expires_at: '2026-08-16T18:29:00.000Z',
    offer_version: '28d-149-v1',
  };
  const ambiguous = decide('Todo', 'ambiguous_acknowledgement', purchaseContext);
  assert.equal(ambiguous.strategy, 'clarify');
  assert.equal(ambiguous.checkout_authorized, false);
  assert.notEqual(ambiguous.pending_action, 'send_checkout');

  const classifierMistake = decide('Todo', 'broad_information_request', purchaseContext);
  assert.equal(classifierMistake.buyer_signal, 'ambiguous_acknowledgement');
  assert.equal(classifierMistake.strategy, 'clarify');
  assert.equal(classifierMistake.checkout_authorized, false);
  assert.notEqual(classifierMistake.pending_action, 'send_checkout');
});

test('10A preserves material-question, AI-objection, purchase, affirmation, and weak-ack precedence', () => {
  const material = decide('Todo, pero ¿aceptan OXXO?', 'broad_information_request', {}, {
    topic: 'payment_methods', material_question: true,
  });
  assert.equal(material.strategy, 'answer_question');
  assert.equal(material.topic, 'payment_methods');

  assert.equal(decide('Para eso mejor uso ChatGPT', 'broad_information_request').strategy, 'answer_objection');
  assert.equal(decide('Quiero comprarlo. Mándame el enlace.', 'broad_information_request').pending_action, 'send_checkout');

  const purchaseContext = {
    last_question_type: 'purchase_confirmation',
    last_question_at: '2026-08-16T17:59:00.000Z',
    commercial_context_expires_at: '2026-08-16T18:29:00.000Z',
    offer_version: '28d-149-v1',
  };
  assert.equal(decide('Sí', 'broad_information_request', purchaseContext).pending_action, 'send_checkout');
  for (const message of ['Gracias', 'Ok', 'Perfecto', 'Está bien', 'Vale']) {
    const signal = message === 'Gracias' ? 'gratitude' : 'ambiguous_acknowledgement';
    assert.notEqual(decide(message, signal).buyer_signal, 'broad_information_request', message);
  }
});

test('10A validator retains deterministic safety overrides for broad answers', () => {
  const decision = decide('Quiero saber todo', 'broad_information_request');
  for (const unsafe of [
    'Cuesta $99 MXN y te cuento todo.',
    'Tu oferta es 28d-149-v1 y te cuento todo.',
    'Ajustamos las calorías para tu tratamiento y te cuento todo.',
    'Primero, ¿qué buscas? Después, ¿quieres un ejemplo?',
  ]) {
    const output = validateResponse('Quiero saber todo', decision, unsafe);
    assert.notEqual(output, unsafe);
    assert.match(output, /Dietavity|programa/i);
    assert.ok(questionCount(output) <= 1);
  }
});

test('10A workflow classifier, prompt, policy, validator, and ledger stay integrated', () => {
  const classifier = nodes.get('Interpret Sales Buyer Signal').parameters.options.systemMessage;
  const policy = nodes.get('Apply Deterministic Commercial Policy').parameters.jsCode;
  const prompt = nodes.get('Build Constrained Sales Response').parameters.jsCode;
  const validator = nodes.get('Validate Sales Response Contract').parameters.jsCode;
  const reserve = nodes.get('Reserve Sales Reply').parameters.options.queryReplacement;

  assert.match(classifier, /broad_information_request/);
  assert.match(classifier, /latest actionable assistant question/);
  assert.match(policy, /hasDeterministicBroadInformationRequest/);
  assert.match(prompt, /3-5 datos comercialmente relevantes/);
  assert.match(validator, /acknowledgementOnly/);
  assert.match(validator, /fallback\.broad_information/);
  assert.match(reserve, /body: \$json\.output/);
  assert.equal(workflow.active, false);
});
