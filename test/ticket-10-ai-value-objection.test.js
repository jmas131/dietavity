'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {
  decideSalesTurn,
  hasDeterministicAiValueObjection,
  questionCount,
} = require('../lib/sales-engine-v3');

const workflow = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json',
), 'utf8'));
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const NOW = '2026-08-15T18:00:00.000Z';

function interpretation(buyerSignal = 'other', extra = {}) {
  return {
    interpretation_valid: true, buyer_signal: buyerSignal, topic: null, goal: null,
    goal_supplied: false, explicit_reminder_request: false,
    material_question: false, substantive_engagement: true, ...extra,
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

function validateResponse(message, decision, generated = 'respuesta incorrecta') {
  const source = nodes.get('Validate Sales Response Contract').parameters.jsCode;
  const context = {
    $: (name) => ({ item: { json: name === 'Apply Deterministic Commercial Policy'
      ? decision : { chatInput: message } } }),
    $input: { first: () => ({ json: { output: generated } }) },
  };
  return vm.runInNewContext(`(function () { ${source} })()`, context)[0].json.output;
}

test('production AI substitution statement answers the objection without Checkout or discovery', () => {
  const decision = decide('Mejor le pregunto a la IA desde mi celular', 'information_request', {
    conversation_stage: 'offer', last_question_type: 'purchase_confirmation',
    last_question_at: '2026-08-15T17:59:00.000Z',
    commercial_context_expires_at: '2026-08-15T18:29:00.000Z',
    offer_version: '28d-149-v1',
  });

  assert.equal(decision.buyer_signal, 'ai_value_objection');
  assert.equal(decision.topic, 'ai_value_objection');
  assert.equal(decision.strategy, 'answer_objection');
  assert.equal(decision.pending_action, 'respond');
  assert.equal(decision.checkout_authorized, false);
  assert.equal(decision.checkout_authorization_type, null);
  assert.equal(decision.next_last_question_type, null);
  assert.deepEqual(decision.events.sort(), ['ai_value_objection', 'meaningful_engagement']);

  const output = validateResponse('Mejor le pregunto a la IA desde mi celular', decision);
  assert.match(output, /también puedes usar una IA directamente/i);
  assert.match(output, /programa completo de 28 días/i);
  assert.match(output, /portal/i);
  assert.match(output, /WhatsApp/i);
  assert.equal(questionCount(output), 0);
  assert.doesNotMatch(output, /qué te interesa|quieres comprar|enlace|cuánto pesas|enfermedades|medicamentos/i);
});

test('AI-value variants override classifier mistakes and never authorize Checkout', () => {
  for (const message of [
    'Entonces mejor uso ChatGPT',
    'Eso lo puedo hacer con IA gratis',
    '¿Por qué pagaría si puedo preguntarle a una IA?',
    '¿Y qué diferencia hay con preguntarle a ChatGPT?',
    'Si lo hace una máquina mejor uso ChatGPT',
    'Para eso consulto un asistente virtual',
  ]) {
    assert.equal(hasDeterministicAiValueObjection(message), true, message);
    const decision = decide(message, 'contextual_affirmation');
    assert.equal(decision.strategy, 'answer_objection', message);
    assert.equal(decision.pending_action, 'respond', message);
    assert.equal(decision.checkout_authorized, false, message);
    assert.ok(decision.events.includes('ai_value_objection'), message);
  }
});

test('mixed interest is answered first and later explicit purchase still works', () => {
  const mixed = decide('Sí me interesa, pero ¿qué diferencia tiene con usar ChatGPT?', 'positive_interest');
  assert.equal(mixed.strategy, 'answer_objection');
  assert.equal(mixed.checkout_authorized, false);

  const purchase = decide('Está bien, quiero comprarlo. Mándame el enlace.', 'other');
  assert.equal(purchase.strategy, 'direct_purchase');
  assert.equal(purchase.pending_action, 'send_checkout');
  assert.equal(purchase.checkout_authorized, true);
});

test('AI information, human preference, credentials, purchase, and weak acknowledgements remain distinct', () => {
  for (const message of [
    '¿Usan inteligencia artificial?', '¿Cómo usan la IA?', '¿La IA hace mi programa?',
    '¿Es un nutriólogo o una IA?', 'No quiero hablar con una máquina',
    'Prefiero hablar con una persona', 'Quiero que me atienda un humano',
    '¿Puedo hablar con un nutriólogo?', '¿Quién es responsable del programa?',
    '¿Qué respaldo tienen las recomendaciones?',
  ]) assert.equal(hasDeterministicAiValueObjection(message), false, message);

  assert.equal(decide('Quiero comprar el programa', 'explicit_purchase').strategy, 'direct_purchase');
  for (const message of ['ok', 'okay', 'perfecto', 'vale', 'listo', 'gracias']) {
    const signal = message === 'gracias' ? 'gratitude' : 'ambiguous_acknowledgement';
    assert.notEqual(decide(message, signal).buyer_signal, 'ai_value_objection');
  }
});

test('mixed trust and AI-value concern answers both without fabricated credentials', () => {
  const decision = decide(
    '¿Lo hace un nutriólogo? ¿Qué diferencia hay con preguntarle a ChatGPT?',
    'ai_value_objection', {}, { topic: 'credentials', material_question: true },
  );
  assert.equal(decision.topic, 'credentials');
  const output = validateResponse('mensaje mixto', decision);
  assert.match(output, /usa inteligencia artificial/i);
  assert.match(output, /un nutriólogo humano no elabora individualmente/i);
  assert.doesNotMatch(output, /supervisad|clínicamente valid|doctor/i);
  assert.equal(questionCount(output), 0);
});

test('workflow preserves canonical ledger and retry-safe, privacy-minimized events', () => {
  assert.equal(workflow.active, false);
  const policySource = nodes.get('Apply Deterministic Commercial Policy').parameters.jsCode;
  const persistence = nodes.get('Persist Sales Response State and Events').parameters.query;
  const classifier = nodes.get('Interpret Sales Buyer Signal').parameters.options.systemMessage;
  assert.match(policySource, /hasDeterministicAiValueObjection/);
  assert.match(classifier, /ai_value_objection/);
  assert.match(persistence, /event_names\.event_type \|\| ':' \|\| updated_session\.session_id \|\| ':'/);
  assert.match(persistence, /inbound_message_sid/);
  assert.match(persistence, /jsonb_strip_nulls\(jsonb_build_object\('offer_context', offer_context\)\)/);
  assert.doesNotMatch(persistence, /chatInput|customer_message|full_message/);
  assert.ok(nodes.has('Reserve Canonical Inbound Message'));
  assert.ok(nodes.has('Reserve Sales Reply'));
});
