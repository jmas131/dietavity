'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const knowledge = require('../lib/dietavity-knowledge');
const {
  decideSalesTurn,
  containsInternalOfferVersion,
  questionCount,
  responseViolatesContract,
} = require('../lib/sales-engine-v3');

const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const NOW = '2026-08-13T18:00:00.000Z';

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

function decide(message, buyerSignal, session = {}, extra = {}) {
  return decideSalesTurn({
    message,
    interpretation: interpretation(buyerSignal, extra),
    session: { conversation_stage: 'evaluating', ...session },
    now: NOW,
  });
}

function validPurchaseContext(extra = {}) {
  return {
    conversation_stage: 'offer',
    last_question_type: 'purchase_confirmation',
    last_question_at: '2026-08-13T17:59:00.000Z',
    commercial_context_expires_at: '2026-08-13T18:29:00.000Z',
    offer_version: knowledge.OFFER_VERSION,
    ...extra,
  };
}

function validateSalesResponse(message, decision, generated = 'respuesta generada') {
  const source = nodes.get('Validate Sales Response Contract').parameters.jsCode;
  const context = {
    $: (name) => ({
      item: {
        json: name === 'Apply Deterministic Commercial Policy'
          ? decision
          : { chatInput: message },
      },
    }),
    $input: { first: () => ({ json: { output: generated } }) },
  };
  return vm.runInNewContext(`(function () { ${source} })()`, context)[0].json;
}

test('8D A: informational price does not establish purchase context; separately authorized Si still works', () => {
  const price = decide('Cuánto cuesta???', 'question', {}, {
    topic: 'price', material_question: true,
  });
  assert.equal(price.strategy, 'answer_question');
  assert.equal(price.next_last_question_type, null);
  assert.equal(price.allow_purchase_cta, false);
  const informationYes = decide('Si', 'contextual_affirmation', { last_question_type: price.next_last_question_type });
  assert.equal(informationYes.checkout_authorized, false);
  assert.equal(price.conversation_stage, 'evaluating');
  assert.equal(
    validateSalesResponse('Cuánto cuesta???', price).output,
    'El programa personalizado de Dietavity cuesta $149 MXN en un solo pago. Incluye tu programa de alimentación para 28 días y no tiene renovación automática.',
  );

  const yes = decide('Si', 'question', validPurchaseContext(), {
    topic: 'diet_support', material_question: true,
  });
  assert.equal(yes.buyer_signal, 'contextual_affirmation');
  assert.equal(yes.topic, null);
  assert.equal(yes.strategy, 'purchase_confirmation');
  assert.equal(yes.pending_action, 'send_checkout');
  assert.equal(yes.checkout_authorized, true);
  assert.equal(yes.checkout_authorization_type, 'contextual');
  assert.ok(yes.events.includes('purchase_intent'));
});

test('8D B/C: clarification refreshes context and the first strong Si cannot loop', () => {
  const clarification = decide('Ok', 'ambiguous_acknowledgement', validPurchaseContext());
  assert.equal(clarification.strategy, 'clarify');
  assert.equal(clarification.next_last_question_type, 'purchase_confirmation');
  assert.equal(
    validateSalesResponse('Ok', clarification).output,
    '¿Quieres que te envíe el enlace para adquirirlo?',
  );

  const firstYes = decide('Si', 'contextual_affirmation', validPurchaseContext());
  assert.equal(firstYes.pending_action, 'send_checkout');
  assert.equal(firstYes.max_questions, 0);

  const extraYes = decide('Si', 'contextual_affirmation', {
    conversation_stage: 'checkout_pending',
    last_question_type: null,
    commercial_context_expires_at: null,
  });
  assert.equal(extraYes.strategy, 'acknowledgement');
  assert.equal(extraYes.pending_action, 'respond');
  assert.equal(extraYes.max_questions, 0);
});

test('8D D: current purchase question overrides stale age and personalization interpretation', () => {
  const result = decide('Sí', 'question', validPurchaseContext(), {
    topic: 'personalization', material_question: true,
  });
  assert.equal(result.topic, null);
  assert.equal(result.buyer_signal, 'contextual_affirmation');
  assert.equal(result.pending_action, 'send_checkout');
});

test('8D E: weak acknowledgement is safe, but its clarification creates fresh context', () => {
  const weak = decide('Ok', 'contextual_affirmation', validPurchaseContext());
  assert.equal(weak.checkout_authorized, false);
  assert.equal(weak.pending_action, 'respond');
  assert.equal(weak.next_last_question_type, 'purchase_confirmation');
  assert.equal(decide('Sí', 'other', validPurchaseContext()).pending_action, 'send_checkout');
});

test('8D F/G: explicit purchase stays direct with the current OXXO answer (Ticket 50)', () => {
  const direct = decide(
    'Hola, quiero comprar el programa. ¿Me mandas el enlace?',
    'positive_interest',
    {},
    { topic: 'product_scope', material_question: true },
  );
  assert.equal(direct.strategy, 'direct_purchase');
  assert.equal(direct.pending_action, 'send_checkout');

  const oxxo = decide(
    'Sí quiero comprarlo, pero ¿aceptan OXXO?',
    'explicit_purchase',
    {},
    { topic: 'payment_methods', material_question: true },
  );
  assert.equal(oxxo.strategy, 'direct_purchase');
  assert.equal(oxxo.pending_action, 'send_checkout');
  assert.equal(oxxo.next_last_question_type, null);
  assert.match(oxxo.checkout_question_response, /Sí, aceptamos pagos en OXXO/);
  assert.equal(decide('Sí', 'contextual_affirmation', validPurchaseContext()).pending_action, 'send_checkout');
});

test('8D persistence uses policy metadata and trusted SQL timestamps for latest question context', () => {
  const query = nodes.get('Persist Sales Response State and Events').parameters.query;
  assert.match(query, /last_question_type = NULLIF\(decision\.payload->>'next_last_question_type'/);
  assert.match(query, /last_question_at = CASE[\s\S]*ELSE NOW\(\) END/);
  assert.match(query, /next_last_question_type' = 'purchase_confirmation'[\s\S]*NOW\(\) \+ INTERVAL '30 minutes'/);
  assert.match(query, /offer_version = CASE WHEN decision\.payload->>'next_last_question_type' = 'purchase_confirmation'/);
  assert.doesNotMatch(query, /assistant_response|output.*purchase_confirmation/i);
});

test('8D copy contract is progressive, concise, and hides internal offer versions', () => {
  const discovery = validateSalesResponse(
    '¡Hola! Quiero más información.',
    decide('¡Hola! Quiero más información.', 'information_request', {}, { substantive_engagement: false }),
  ).output;
  assert.equal(discovery, require('../lib/sales-engine-v3').CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE);
  assert.doesNotMatch(discovery, /\$149|OXXO|Apple Pay|portal|mensajes proactivos|personalización después/);

  for (const identifier of ['28d-149-v1', '30d-199-v2', '14d-99-launch-a']) {
    assert.equal(containsInternalOfferVersion(identifier), true);
    assert.equal(responseViolatesContract(`Oferta ${identifier}`), true);
  }
  assert.doesNotMatch(knowledge.SALES_RESPONSE_KNOWLEDGE, /28d-149-v1/);
  const leaked = validateSalesResponse(
    'Cuéntame más',
    decide('Cuéntame más', 'other'),
    'La versión 28d-149-v1 está disponible.',
  ).output;
  assert.doesNotMatch(leaked, /28d-149-v1/);
  assert.doesNotMatch(leaked, /\bSetup\b/);
  assert.doesNotMatch(leaked, /No prometemos mensajes proactivos diarios/i);
});

test('8D age answer is accurate and avoids unsupported nutrition-adjustment claims', () => {
  const decision = decide('Pero también depende la edad no?', 'question', {}, {
    topic: 'personalization', material_question: true,
  });
  const output = validateSalesResponse('Pero también depende la edad no?', decision).output;
  assert.match(output, /la edad es uno de los datos que se solicitan después del pago durante la personalización/);
  assert.match(output, /no sustituye atención médica profesional/);
  assert.doesNotMatch(output, /calorías|macronutrientes|micronutrientes|proteína|calcio|vitamina|B12|medicación|porciones/i);
  assert.equal(questionCount(output), 0);

  const unsupportedGenerated = validateSalesResponse(
    '¿Cómo personalizan?',
    decide('¿Cómo personalizan?', 'other'),
    'Ajustamos las calorías, porciones y distribución de macronutrientes para ti.',
  ).output;
  assert.doesNotMatch(unsupportedGenerated, /calorías|porciones|macronutrientes/i);
});

test('8D workflow artifact remains inactive and customer-visible outputs contain no offer identifier', () => {
  assert.equal(workflow.active, false);
  const customerVisible = [
    nodes.get('Validate Sales Response Contract').parameters.jsCode,
    nodes.get('Message with Stripe Payment URL').parameters.assignments.assignments[0].value,
    nodes.get('Build Constrained Sales Response').parameters.jsCode,
  ].join('\n');
  assert.doesNotMatch(customerVisible, /versión de oferta:\s*28d-149-v1/i);
  assert.match(nodes.get('Validate Sales Response Contract').parameters.jsCode, /internalOfferVersion/);
});
