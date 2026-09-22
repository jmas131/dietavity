'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { decideSalesTurn, questionCount } = require('../lib/sales-engine-v3');

const workflow = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json',
), 'utf8'));
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));

function decide(message, session = {}, extra = {}) {
  return decideSalesTurn({
    message,
    interpretation: {
      interpretation_valid: true,
      buyer_signal: 'question',
      topic: 'price',
      material_question: true,
      substantive_engagement: true,
      ...extra,
    },
    session: { conversation_stage: 'evaluating', ...session },
    now: '2026-08-19T18:00:00.000Z',
  });
}

function response(message, decision, generated = 'respuesta generada') {
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
  return vm.runInNewContext(`(function () { ${source} })()`, context)[0].json.output;
}

test('Ticket 23 explains OXXO and resolves the no-card constraint before advancing', () => {
  for (const message of ['¿Cómo es en OXXO?', 'No tengo tarjeta', 'No tengo tarjetas', '¿Puedo pagar sin tarjeta?']) {
    const decision = decide(message, {}, { topic: 'payment_methods' });
    const output = response(message, decision);
    assert.equal(decision.strategy, 'answer_question', message);
    assert.equal(decision.pending_action, 'respond', message);
    assert.match(output, /No necesitas tarjeta para pagar con OXXO/, message);
    assert.match(output, /Checkout seguro.*selecciona OXXO.*indicaciones/, message);
    assert.doesNotMatch(output, /También puedes pagar con tarjeta|tarjeta de crédito, tarjeta de débito/, message);
    assert.equal(questionCount(output), 0, message);
  }
});

test('Ticket 23 uses already-sent Checkout context without requesting another link', () => {
  const session = {
    conversation_stage: 'checkout_pending',
    checkout_sent_at: '2026-08-19T17:55:00.000Z',
  };
  const output = response('No tengo tarjeta', decide('No tengo tarjeta', session, {
    buyer_signal: 'other', topic: null, material_question: false,
  }));

  assert.match(output, /enlace de Checkout que te envié/);
  assert.match(output, /selecciona OXXO/);
  assert.doesNotMatch(output, /¿Quieres que te envíe el enlace\?/);
  assert.equal(questionCount(output), 0);

  const reservation = nodes.get('Reserve Checkout Reply').parameters.options.queryReplacement;
  assert.match(reservation, /message_kind:\s*["']checkout["']/);
  assert.match(nodes.get('Mark Checkout Sent v3').parameters.query, /checkout_sent_at = NOW\(\)/);
});

test('Ticket 23 answers every supported part of common multi-part questions', () => {
  const cases = [
    ['¿Cuánto cuesta y cómo funciona?', [/\$149 MXN/, /Después del pago completas tu personalización/, /portal Dietavity/]],
    ['¿Cuánto cuesta y aceptan OXXO?', [/\$149 MXN/, /aceptamos pagos en OXXO/]],
    ['¿Cuánto cuesta y después me cobran otra vez?', [/\$149 MXN/, /No hay mensualidad ni renovación automática/]],
    ['¿Cuándo empiezo y cuánto cuesta?', [/\$149 MXN/, /comenzar desde hoy hasta 30 días/]],
    ['¿Dónde veo el programa y aceptan OXXO?', [/portal Dietavity/, /aceptamos pagos en OXXO/]],
  ];

  for (const [message, expectedParts] of cases) {
    const output = response(message, decide(message));
    for (const expected of expectedParts) assert.match(output, expected, message);
    assert.equal(questionCount(output), 0, message);
  }
});

test('Ticket 23 clarifies unsupported talks while also retaining a price question', () => {
  const combined = response(
    'Buenas tardes, ¿cuándo son las pláticas y qué costo tiene?',
    decide('Buenas tardes, ¿cuándo son las pláticas y qué costo tiene?'),
  );
  assert.match(combined, /\$149 MXN en un solo pago/);
  assert.match(combined, /No ofrecemos pláticas programadas/);
  assert.match(combined, /portal/);
  assert.match(combined, /apoyo por WhatsApp/);
  assert.doesNotMatch(combined, /¿Quieres que te envíe el enlace\?/);
  assert.equal(questionCount(combined), 0);

  const unsupported = response(
    '¿Cuándo son las pláticas?',
    decide('¿Cuándo son las pláticas?', {}, { topic: 'product_scope' }),
  );
  assert.match(unsupported, /No ofrecemos pláticas programadas/);
  assert.doesNotMatch(unsupported, /horario|lunes|martes|videollamada/i);
});

test('Ticket 23 preserves direct purchase and concise simple-price behavior', () => {
  const purchase = decideSalesTurn({
    message: 'Quiero comprarlo',
    interpretation: { interpretation_valid: true, buyer_signal: 'explicit_purchase' },
    session: { conversation_stage: 'evaluating' },
    now: '2026-08-19T18:00:00.000Z',
  });
  assert.equal(purchase.pending_action, 'send_checkout');
  assert.equal(purchase.checkout_authorized, true);

  const price = response('¿Cuánto cuesta?', decide('¿Cuánto cuesta?'));
  assert.equal(
    price,
    'El programa personalizado de Dietavity cuesta $149 MXN en un solo pago. Incluye tu programa de alimentación para 28 días y no tiene renovación automática.',
  );
});

test('Ticket 23 generated workflow retains its source functions and remains inactive', () => {
  const policySource = nodes.get('Apply Deterministic Commercial Policy').parameters.jsCode;
  assert.match(policySource, /function resolveCurrentCommercialQuestions/);
  assert.match(policySource, /function hasCheckoutAlreadySent/);
  assert.match(policySource, /No necesitas tarjeta para pagar con OXXO/);
  assert.equal(workflow.active, false);
});
