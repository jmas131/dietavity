'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../lib/sales-engine-v3');

const root = path.join(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json'), 'utf8'));
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));

function decide(message, extra = {}, session = {}) {
  return policy.decideSalesTurn({
    message,
    interpretation: { interpretation_valid: true, buyer_signal: 'question', topic: null,
      material_question: false, substantive_engagement: true, ...extra },
    session: { conversation_stage: 'evaluating', ...session },
    now: '2026-09-10T18:00:00Z',
  });
}

function output(message, decision, generated = 'respuesta generada') {
  const source = nodes.get('Validate Sales Response Contract').parameters.jsCode;
  return vm.runInNewContext(`(function(){${source}})()`, {
    $: (name) => ({ item: { json: name === 'Apply Deterministic Commercial Policy' ? decision : { chatInput: message } } }),
    $input: { first: () => ({ json: { output: generated } }) },
  })[0].json.output;
}

test('one-time and monthly billing questions keep established truthful behavior', () => {
  for (const message of ['¿Es un solo pago?', '¿Se cobra cada mes?', '¿Se renueva automáticamente?']) {
    const decision = decide(message, { topic: 'price', material_question: true });
    const text = output(message, decision);
    assert.equal(decision.strategy, 'answer_question');
    assert.match(text, /\$149 MXN en un solo pago/);
    assert.match(text, /no (?:hay|tiene)(?: mensualidad ni)? renovación automática/i);
  }
});

test('post-28-day questions resolve continuation without inventing future pricing', () => {
  for (const message of ['¿Qué pasa después de los 28 días?', 'Después de los 28 días cuánto se paga?', 'Al terminar el programa, ¿qué sucede?']) {
    const decision = decide(message, { topic: 'price', material_question: true });
    const text = output(message, decision);
    assert.equal(decision.topic, 'post_purchase');
    assert.equal(decision.deterministic_reason, 'post_28_day_continuation');
    assert.equal(text, policy.POST_28_DAY_RESPONSE);
    assert.match(text, /puedes adquirir un nuevo programa; tú decides/);
    assert.doesNotMatch(text, /nuevo programa (?:cuesta|costará)|suscripción|membresía|upgrade/i);
  }
});

test('a narrower second turn outranks generic prior pricing context', () => {
  const session = { recent_sales_assistant_message: 'El programa cuesta $149 MXN en un solo pago y no hay renovación automática.' };
  const second = decide('Sigo con la duda, después de esos 28 días cuánto se paga?',
    { topic: 'price', material_question: true }, session);
  assert.equal(output('Sigo con la duda, después de esos 28 días cuánto se paga?', second), policy.POST_28_DAY_RESPONSE);
});

test('same or unresolved billing repetition receives one narrow clarification, not repeated copy', () => {
  const previous = 'El programa personalizado de Dietavity cuesta $149 MXN en un solo pago. No hay renovación automática.';
  for (const message of ['¿Es un solo pago?', 'Sigo con la duda']) {
    const decision = decide(message, { topic: 'price', material_question: true }, { recent_sales_assistant_message: previous });
    const text = output(message, decision);
    assert.equal(decision.strategy, 'clarify');
    assert.equal(decision.deterministic_reason, 'repeated_billing_ambiguity');
    assert.equal(text, policy.REPEATED_BILLING_CLARIFICATION);
    assert.notEqual(text, previous);
    assert.equal(policy.questionCount(text), 1);
  }
});

test('physical prepared-food expectations receive service-scope clarification', () => {
  for (const message of ['¿Tienen entregas en CDMX?', '¿Me mandan la comida preparada?', '¿Son comidas preparadas?', '¿Dónde entregan?', 'Quiero que me lleven mis menús']) {
    const decision = decide(message, { topic: 'product_scope', material_question: true });
    assert.equal(decision.topic, 'product_scope', message);
    assert.equal(decision.deterministic_reason, 'prepared_food_delivery_clarification', message);
    assert.equal(output(message, decision), policy.PREPARED_FOOD_DELIVERY_RESPONSE, message);
  }
});

test('delivery detector avoids recipe, ordinary menu and meal-help false positives', () => {
  for (const message of ['¿Qué puedo cenar hoy?', 'Dame una receta con atún', '¿Qué incluye el programa?', 'Entrégame una receta de atún', 'Dame recetas de comidas preparadas con atún']) {
    const decision = decide(message, { topic: message.includes('incluye') ? 'what_is_included' : 'diet_support', material_question: true });
    assert.notEqual(decision.deterministic_reason, 'prepared_food_delivery_clarification', message);
    assert.notEqual(output(message, decision), policy.PREPARED_FOOD_DELIVERY_RESPONSE, message);
  }
});

test('strong purchase and support retain precedence', () => {
  const purchase = decide('Quiero comprar el programa', { buyer_signal: 'explicit_purchase' });
  assert.equal(purchase.strategy, 'direct_purchase');
  assert.equal(purchase.pending_action, 'send_checkout');
  const support = decide('No puedo entrar a mi portal', { buyer_signal: 'support_issue', topic: 'post_purchase', material_question: true });
  assert.equal(support.buyer_signal, 'support_issue');
  assert.notEqual(support.deterministic_reason, 'post_28_day_continuation');
});

test('canonical broad opening and existing taxonomy remain unchanged and unique', () => {
  const broad = decide('Quiero más información', { buyer_signal: 'broad_information_request' }, { conversation_stage: 'new' });
  assert.equal(output('Quiero más información', broad), policy.CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE);
  assert.equal(new Set(policy.BUYER_SIGNALS).size, policy.BUYER_SIGNALS.length);
  assert.equal(new Set(policy.RESPONSE_STRATEGIES).size, policy.RESPONSE_STRATEGIES.length);
  assert.ok(!policy.BUYER_SIGNALS.includes('post_28_day_continuation'));
  assert.ok(!policy.RESPONSE_STRATEGIES.includes('prepared_food_delivery'));
});

test('generated workflow reads only accepted canonical sales context and remains synchronized/inactive', () => {
  const context = nodes.get('Get Recent Sales Clarification Context');
  assert.ok(context);
  assert.match(context.parameters.query, /message_kind IN \('sales_deterministic', 'sales_ai', 'checkout'\)/);
  assert.match(context.parameters.query, /delivery_status IN \('accepted', 'scheduled', 'sent', 'delivered'\)/);
  assert.match(context.parameters.query, /inbound\.id = \(input\.payload->>'inbound_id'\)::uuid/);
  assert.match(context.parameters.query, /inbound\.session_id = input\.payload->>'session_id'/);
  assert.match(context.parameters.query, /outbound\.timestamp >= current_inbound\.timestamp - INTERVAL '7 days'/);
  assert.match(context.parameters.query, /prior_inbound\.id = outbound\.in_reply_to_id/);
  assert.match(context.parameters.query, /NOT EXISTS[\s\S]*intervening\.processing_order/);
  assert.match(context.parameters.options.queryReplacement, /Claim Next Session Inbound[\s\S]*inbound_id/);
  assert.match(nodes.get('Apply Deterministic Commercial Policy').parameters.jsCode, /recent_sales_assistant_message/);
  assert.match(nodes.get('Reserve Sales Reply').parameters.options.queryReplacement, /deterministic_reason/);
  assert.deepEqual(workflow.connections['Parse Sales Interpretation'].main[0][0].node, context.name);
  assert.equal(workflow.active, false);
});
