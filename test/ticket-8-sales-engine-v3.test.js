'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadWorkflow } = require('../test-support/workflow-fixture');
const knowledge = require('../lib/dietavity-knowledge');
const {
  BUYER_SIGNALS,
  RESPONSE_STRATEGIES,
  decideSalesTurn,
  questionCount,
  responseViolatesContract,
} = require('../lib/sales-engine-v3');

const root = path.resolve(__dirname, '..');
const workflow = loadWorkflow();
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const migration = fs.readFileSync(path.join(
  root, 'database/migrations/20260811_ticket_8_sales_engine_v3.sql'
), 'utf8');
const preflight = fs.readFileSync(path.join(root, 'database/preflight-ticket-8.sql'), 'utf8');

function outputs(name, index = 0) {
  return (workflow.connections[name]?.main?.[index] || []).map((edge) => edge.node);
}

function reverseEdges() {
  const incoming = new Map();
  for (const [source, groups] of Object.entries(workflow.connections)) {
    for (const outputs of groups.main || []) {
      for (const edge of outputs || []) {
        if (!incoming.has(edge.node)) incoming.set(edge.node, []);
        incoming.get(edge.node).push(source);
      }
    }
  }
  return incoming;
}

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

function decide(message, signal, session = {}, extra = {}, now = '2026-08-11T18:00:00.000Z') {
  return decideSalesTurn({
    message,
    interpretation: interpretation(signal, extra),
    session: { conversation_stage: 'evaluating', ...session },
    now,
  });
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

test('Ticket 8 installs the deliberately small durable taxonomies', () => {
  assert.deepEqual(BUYER_SIGNALS, [
    'information_request', 'broad_information_request', 'positive_interest', 'question', 'objection_price',
    'objection_trust', 'objection_timing', 'deferred_interest', 'explicit_purchase',
    'contextual_affirmation', 'ambiguous_acknowledgement', 'gratitude', 'rejection',
    'ai_value_objection', 'support_issue', 'other',
  ]);
  assert.deepEqual(RESPONSE_STRATEGIES, [
    'direct_purchase', 'purchase_confirmation', 'clarify', 'answer_question',
    'handle_objection', 'discovery', 'show_example', 'explain_offer', 'deferred',
    'reminder', 'graceful_close', 'acknowledgement', 'conversational',
    'answer_objection', 'broad_information',
  ]);
  assert.match(migration, /conversation_stage IN \('new', 'evaluating', 'offer', 'checkout_pending', 'closed'\)/);
  assert.doesNotMatch(migration, /ADD COLUMN IF NOT EXISTS buyer_signal/);
  assert.doesNotMatch(migration, /ADD COLUMN IF NOT EXISTS strategy/);
});

test('explicit purchase phrases authorize Checkout without redundant confirmation', () => {
  for (const message of [
    'Quiero comprar el programa.',
    'Quiero comprarlo.',
    'Mándame el enlace.',
    'Mándame el enlace para pagar.',
    'Pásame el link para pagar.',
    '¿Dónde pago?',
  ]) {
    const result = decide(message, 'explicit_purchase');
    assert.equal(result.pending_action, 'send_checkout', message);
    assert.equal(result.strategy, 'direct_purchase', message);
    assert.equal(result.buyer_signal, 'explicit_purchase', message);
    assert.equal(result.checkout_authorized, true, message);
    assert.equal(result.checkout_authorization_type, 'explicit', message);
    assert.ok(result.events.includes('purchase_intent'));
  }
});

test('live explicit-purchase failure takes the deterministic direct Checkout fast path', () => {
  const message = 'Hola, quiero comprar el programa. ¿Me mandas el enlace?';
  const result = decide(
    message,
    'positive_interest',
    {},
    { topic: 'product_scope', material_question: true },
  );

  assert.equal(result.buyer_signal, 'explicit_purchase');
  assert.equal(result.strategy, 'direct_purchase');
  assert.equal(result.pending_action, 'send_checkout');
  assert.equal(result.checkout_authorized, true);
  assert.equal(result.checkout_authorization_type, 'explicit');
  assert.equal(result.max_questions, 0);
  assert.ok(result.events.includes('purchase_intent'));
});

test('only strong affirmation in current purchase context authorizes contextual Checkout', () => {
  const validSession = {
    conversation_stage: 'offer',
    last_question_type: 'purchase_confirmation',
    last_question_at: '2026-08-11T17:45:00.000Z',
    commercial_context_expires_at: '2026-08-11T18:15:00.000Z',
    offer_version: knowledge.OFFER_VERSION,
  };
  const result = decide('Sí.', 'contextual_affirmation', validSession);
  assert.equal(result.pending_action, 'send_checkout');
  assert.equal(result.strategy, 'purchase_confirmation');
  assert.equal(result.checkout_authorization_type, 'contextual');

  for (const weak of ['Ok.', 'Perfecto.', 'Vale.', 'Listo.']) {
    const rejected = decide(weak, 'ambiguous_acknowledgement', validSession);
    assert.notEqual(rejected.pending_action, 'send_checkout', weak);
    assert.equal(rejected.strategy, 'clarify', weak);
  }
});

test('contextual yes respects question type, offer version, and 30-minute expiry', () => {
  for (const questionType of ['show_example', 'explain_offer']) {
    const result = decide('Sí.', 'contextual_affirmation', {
      last_question_type: questionType,
      last_question_at: '2026-08-11T17:50:00.000Z',
      commercial_context_expires_at: '2026-08-11T18:20:00.000Z',
      offer_version: knowledge.OFFER_VERSION,
    });
    assert.notEqual(result.pending_action, 'send_checkout');
  }

  for (const session of [
    {
      last_question_type: 'purchase_confirmation',
      last_question_at: '2026-08-11T17:20:00.000Z',
      commercial_context_expires_at: '2026-08-11T17:50:00.000Z',
      offer_version: knowledge.OFFER_VERSION,
    },
    {
      last_question_type: 'purchase_confirmation',
      last_question_at: '2026-08-11T17:50:00.000Z',
      commercial_context_expires_at: '2026-08-11T18:20:00.000Z',
      offer_version: 'obsolete-offer',
    },
  ]) {
    assert.notEqual(decide('Sí.', 'contextual_affirmation', session).pending_action, 'send_checkout');
  }
});

test('Ticket 50 answers a material question alongside an explicit purchase', () => {
  const result = decide(
    'Sí quiero comprarlo, pero ¿aceptan OXXO?',
    'explicit_purchase',
    {},
    { topic: 'payment_methods', material_question: true },
  );
  assert.equal(result.checkout_authorized, true);
  assert.match(result.checkout_question_response, /Sí, aceptamos pagos en OXXO/);
  assert.equal(result.strategy, 'direct_purchase');
  assert.equal(result.pending_action, 'send_checkout');
  assert.equal(result.next_last_question_type, null);
});

test('specific supported payment-method questions are answered directly and cannot trigger Checkout', () => {
  const cases = new Map([
    ['¿Aceptan OXXO?', 'Sí, aceptamos pagos en OXXO. También puedes pagar con tarjeta de crédito, tarjeta de débito y Apple Pay.\n¿Quieres que te envíe el enlace?'],
    ['¿Puedo pagar con Apple Pay?', 'Sí, aceptamos pagos con Apple Pay. También puedes pagar con tarjeta de crédito, tarjeta de débito y OXXO.\n¿Quieres que te envíe el enlace?'],
    ['¿Aceptan tarjeta de crédito?', 'Sí, aceptamos pagos con tarjeta de crédito. También puedes pagar con tarjeta de débito, OXXO y Apple Pay.\n¿Quieres que te envíe el enlace?'],
    ['¿Puedo pagar con tarjeta de débito?', 'Sí, aceptamos pagos con tarjeta de débito. También puedes pagar con tarjeta de crédito, OXXO y Apple Pay.\n¿Quieres que te envíe el enlace?'],
  ]);

  for (const [message, expected] of cases) {
    const decision = decide(message, 'question', {}, {
      topic: 'payment_methods', material_question: true,
    });
    assert.equal(decision.pending_action, 'respond', message);
    assert.equal(decision.checkout_authorized, false, message);
    assert.equal(decision.checkout_authorization_type, null, message);
    assert.equal(validateSalesResponse(message, decision).output, expected, message);
  }
});

test('AI failure and conversational fallback are always non-consequential', () => {
  const failed = decideSalesTurn({
    message: 'Mándame el link',
    interpretation: { interpretation_valid: false, buyer_signal: 'explicit_purchase' },
    session: {},
    now: new Date('2026-08-11T18:00:00Z'),
  });
  assert.equal(failed.pending_action, 'respond');
  assert.equal(failed.checkout_authorized, false);
  assert.equal(decide('Algo distinto', 'other').pending_action, 'respond');
});

test('conversation routing covers discovery, known goal, questions, objections, deferral, rejection, and gratitude', () => {
  const generic = decide('Hola, quiero más información.', 'information_request', {}, { substantive_engagement: false });
  assert.equal(generic.strategy, 'discovery');
  assert.ok(!generic.events.includes('meaningful_engagement'));

  const goal = decide('Quiero comer más saludable.', 'positive_interest', {}, { goal: 'comer más saludable', goal_supplied: true });
  assert.equal(goal.next_last_question_type, 'show_example');

  assert.equal(decide('¿Cuánto cuesta?', 'question', {}, { topic: 'price', material_question: true }).strategy, 'answer_question');
  assert.equal(decide('Se me hace caro.', 'objection_price').strategy, 'handle_objection');
  assert.equal(decide('Estoy de viaje; regreso en dos semanas.', 'objection_timing').pending_action, 'respond');
  assert.equal(decide('Déjame pensarlo.', 'deferred_interest').strategy, 'deferred');
  assert.equal(decide('No gracias.', 'rejection').pending_action, 'close');
  assert.equal(decide('Gracias.', 'gratitude').strategy, 'acknowledgement');
});

test('sensitive questions do not receive a forced purchase CTA', () => {
  for (const topic of ['health_scope', 'allergies', 'privacy', 'refund']) {
    const result = decide('Tengo una pregunta sensible', 'question', {}, { topic, material_question: true });
    assert.equal(result.strategy, 'answer_question');
    assert.equal(result.allow_purchase_cta, false);
    assert.equal(result.next_last_question_type, null);
  }
});

test('explicit reminders require resolvable timing and deduplicate an active reminder', () => {
  const scheduled = decide(
    'Recuérdame en dos semanas.', 'deferred_interest', {},
    { explicit_reminder_request: true, timing_iso: '2026-08-25T18:00:00.000Z' },
  );
  assert.equal(scheduled.pending_action, 'schedule_requested_reminder');
  assert.equal(scheduled.strategy, 'reminder');

  const unclear = decide(
    'Recuérdame después.', 'deferred_interest', {},
    { explicit_reminder_request: true, timing_iso: null },
  );
  assert.equal(unclear.pending_action, 'respond');
  assert.equal(unclear.next_last_question_type, 'reminder_date');

  const duplicate = decide(
    'Recuérdame en dos semanas.', 'deferred_interest',
    { reminder_scheduled_for: '2026-08-25T18:00:00.000Z' },
    { explicit_reminder_request: true, timing_iso: '2026-08-25T18:00:00.000Z' },
  );
  assert.notEqual(duplicate.pending_action, 'schedule_requested_reminder');

  assert.notEqual(
    decide('Regreso en dos semanas.', 'deferred_interest').pending_action,
    'schedule_requested_reminder',
  );
});

test('response contract enforces at most one question and rejects obsolete sales facts', () => {
  assert.equal(questionCount('¿Quieres saber más?'), 1);
  assert.equal(responseViolatesContract('¿Cuál es tu objetivo? ¿Qué se te dificulta?'), true);
  assert.equal(responseViolatesContract('Cuesta $99 MXN al mes.'), true);
  assert.equal(responseViolatesContract('Cuesta $149 MXN en un solo pago.'), false);
  const validator = nodes.get('Validate Sales Response Contract').parameters.jsCode;
  assert.match(validator, /outputQuestions > decision\.max_questions/);
  assert.match(validator, /\$149 MXN en un solo pago/);
});

test('unknown users enter v3 while known users retain the paid assistant', () => {
  assert.deepEqual(outputs('If Identify User State', 0), ['Detect Intent and Entities']);
  assert.deepEqual(outputs('If Identify User State', 1), ['Set Session Id']);
  assert.deepEqual(outputs('If Existing Onboarding Session', 0), ['Build Canonical Dietavity Knowledge']);
  assert.deepEqual(outputs('If Existing Onboarding Session', 1), ['Initialize Sales Lead v3']);
  for (const removed of [
    'Build Welcome Prompt', 'Build Pitch Prompt', 'Detect Affirmative',
    'Detect Negative', 'Detect Thank You', 'If CTA Sent and not Ask Subscription',
    'Set State Ask Subscription', 'Set State Subscription Deferred', 'Set Payment Pending',
    'Onboarding Manager', 'Onboarding Agent',
  ]) assert.ok(!nodes.has(removed), removed);
});

test('Checkout has one deterministic ingress and fallback cannot reach it', () => {
  const incoming = reverseEdges();
  assert.deepEqual(incoming.get('Add whatsapp_id'), ['Persist Checkout Authorization v3']);
  assert.deepEqual(incoming.get('LIVE Stripe Checkout Session Payment'), ['Add whatsapp_id']);
  assert.deepEqual(outputs('Route Authorized Sales Action', 0), ['Persist Checkout Authorization v3']);
  assert.deepEqual(outputs('Route Authorized Sales Action', 4), ['Build Constrained Sales Response']);
  assert.match(nodes.get('Persist Checkout Authorization v3').parameters.query, /pending_action' = 'send_checkout'/);
  assert.match(nodes.get('Persist Checkout Authorization v3').parameters.query, /strategy' IN \('direct_purchase', 'purchase_confirmation'\)/);
  assert.match(nodes.get('Persist Checkout Authorization v3').parameters.query, /28d-149-v1/);
});

test('Checkout ordering persists evidence and marks pending only after message acceptance', () => {
  assert.deepEqual(outputs('LIVE Stripe Checkout Session Payment'), ['Persist Checkout Session Evidence v3']);
  assert.deepEqual(outputs('Persist Checkout Session Evidence v3'), ['Message with Stripe Payment URL']);
  assert.deepEqual(outputs('Message with Stripe Payment URL'), ['Respond to Chat Subscription']);
  assert.deepEqual(outputs('Respond to Chat Subscription'), ['Mark Checkout Sent v3']);
  assert.match(nodes.get('Mark Checkout Sent v3').parameters.query, /conversation_stage = 'checkout_pending'/);
  assert.match(nodes.get('Mark Checkout Sent v3').parameters.query, /checkout_sent:/);
  assert.match(nodes.get('Message with Stripe Payment URL').parameters.assignments.assignments[0].value, /\$149 MXN en un solo pago/);
});

test('Checkout URL message ends with the 24-hour expiration notice and no question', () => {
  const checkout = nodes.get('LIVE Stripe Checkout Session Payment');
  const parameterNames = checkout.parameters.bodyParameters.parameters.map(({ name }) => name);
  const message = nodes.get('Message with Stripe Payment URL').parameters.assignments.assignments[0].value;

  // Stripe Checkout defaults to 24 hours when expires_at is omitted.
  assert.ok(!parameterNames.includes('expires_at'));
  assert.match(message, /\{\{ \$\('LIVE Stripe Checkout Session Payment'\)\.item\.json\.url \}\}\nEl enlace sólo estará activo durante 24 horas\.$/);
  assert.equal(questionCount(message), 0);
});

test('Sales Engine v3 customer-facing copy uses personalización instead of Setup', () => {
  assert.doesNotMatch(knowledge.SALES_RESPONSE_KNOWLEDGE, /\bSetup\b/);

  const showExampleDecision = decide('Sí.', 'contextual_affirmation', {
    last_question_type: 'show_example',
  });
  const showExample = validateSalesResponse('Sí.', showExampleDecision).output;
  assert.match(showExample, /Tu programa se personaliza después del pago con la información que nos compartas durante la personalización\./);
  assert.doesNotMatch(showExample, /\bSetup\b/);

  const offerDecision = decide('Sí.', 'contextual_affirmation', {
    last_question_type: 'explain_offer',
  });
  const offer = validateSalesResponse('Sí.', offerDecision).output;
  assert.match(offer, /28 días/);
  assert.match(offer, /\$149 MXN en un solo pago/);
  assert.doesNotMatch(offer, /portal Dietavity|desayuno, comida, cena y snack|WhatsApp/);
  assert.doesNotMatch(offer, /\bSetup\b/);

  const startDateDecision = decide('¿Cuándo puedo comenzar?', 'question', {}, {
    topic: 'start_date', material_question: true,
  });
  const startDate = validateSalesResponse('¿Cuándo puedo comenzar?', startDateDecision).output;
  assert.match(startDate, /hasta 30 días calendario después/);

  const validator = nodes.get('Validate Sales Response Contract').parameters.jsCode;
  assert.doesNotMatch(validator, /\bSetup\b/);
});

test('approved-template reminder path is isolated and fails closed', () => {
  const reminder = nodes.get('Schedule Requested WhatsApp Reminder');
  const fields = Object.fromEntries(reminder.parameters.bodyParameters.parameters.map((field) => [field.name, field.value]));
  assert.equal(fields.ScheduleType, 'fixed');
  assert.match(fields.SendAt, /reminder_scheduled_for/);
  assert.match(fields.ContentSid, /TWILIO_SALES_REMINDER_CONTENT_SID/);
  assert.match(fields.MessagingServiceSid, /TWILIO_MESSAGING_SERVICE_SID/);
  assert.ok(!fields.Body);
  assert.match(nodes.get('Validate Scheduled Reminder').parameters.jsCode, /status !== 'scheduled'/);
  assert.deepEqual(outputs('Route Authorized Sales Action', 1), ['Schedule Requested WhatsApp Reminder']);
});

test('canonical identity, product facts, and localization are shared across executable AI prompts', () => {
  assert.match(knowledge.ROLE_AND_IDENTITY, /asistente de nutrición de Dietavity/);
  assert.doesNotMatch(knowledge.ROLE_AND_IDENTITY, /Eres la nutricionista/);
  assert.match(knowledge.PRODUCT_FACTS, /\$149 MXN/);
  assert.match(knowledge.PRODUCT_FACTS, /tarjeta de crédito, tarjeta de débito, OXXO y Apple Pay/);
  assert.match(knowledge.MEAL_PROMPT_KNOWLEDGE, /contexto cotidiano de México/);
  assert.match(knowledge.MEAL_PROMPT_KNOWLEDGE, /no organices el programa como una rotación de cocinas/);
  assert.match(knowledge.MEAL_PROMPT_KNOWLEDGE, /sin convertir cada comida en tacos/);

  for (const name of ['Build Nutrition Prompt', 'Build Regeneration Prompt', 'Build Weekly Update Prompt']) {
    const source = nodes.get(name).parameters.jsCode;
    assert.match(source, /asistente de nutrición de Dietavity/, name);
    assert.match(source, /México y Latinoamérica/, name);
    assert.match(source, /mediterránea, japonesa, nórdica/, name);
  }
  const swap = nodes.get('Meal Plan Swap Chat Completions').parameters.jsonBody;
  assert.match(swap, /asistente de nutrición de Dietavity/);
  assert.doesNotMatch(swap, /Eres una nutricionista experta/);
  const paid = nodes.get('Dietavity Nutrition Model').parameters.responses.values[0].content;
  assert.match(paid, /asistente de nutrición de Dietavity/);
});

test('funnel milestones are idempotent, linked through purchase, and privacy-minimized', () => {
  assert.match(nodes.get('Initialize Sales Lead v3').parameters.query, /lead_started:/);
  assert.match(nodes.get('Persist Sales Response State and Events').parameters.query, /meaningful_engagement/);
  assert.match(nodes.get('Persist Sales Response State and Events').parameters.query, /offer_presented/);
  assert.match(nodes.get('Persist Checkout Authorization v3').parameters.query, /purchase_intent:/);
  assert.match(nodes.get('Mark Checkout Sent v3').parameters.query, /checkout_sent:/);
  const purchaseSql = nodes.get('Resolve User and Persist Purchase').parameters.query;
  assert.match(purchaseSql, /purchase_completed:/);
  assert.match(purchaseSql, /SET user_id = resolved_user\.id/);
  assert.match(nodes.get('Plan New Program Week 1').parameters.query, /program_ready:/);
  assert.match(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), /setup_completed:/);
  assert.match(migration, /sales_funnel_events_event_key_uidx/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.sales_funnel_events FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(
    [
      nodes.get('Resolve User and Persist Purchase').parameters.query,
      nodes.get('Plan New Program Week 1').parameters.query,
      nodes.get('Persist Sales Response State and Events').parameters.query,
    ].join('\n'),
    /medical_conditions|allerg(?:y|ies)|full prompt|assistant_response|portal_token.*metadata/i,
  );
});

test('migration preserves historical state and resets unmatched legacy leads without Checkout authority', () => {
  assert.match(migration, /RENAME COLUMN onboarding_state TO legacy_onboarding_state/);
  assert.match(migration, /TICKET_8_UNKNOWN_LEGACY_ONBOARDING_STATE/);
  assert.match(
    migration,
    /SET conversation_stage = 'evaluating'[\s\S]*legacy_onboarding_state IN \([\s\S]*'lead'[\s\S]*'ask_subscription'[\s\S]*'subscription_deferred'[\s\S]*'payment_pending'[\s\S]*AND NOT EXISTS/,
  );
  assert.doesNotMatch(
    migration,
    /legacy_onboarding_state = 'payment_pending'[\s\S]{0,100}conversation_stage = 'checkout_pending'/,
  );

  for (const field of [
    'last_question_type', 'last_question_at', 'offer_version',
    'commercial_context_expires_at', 'checkout_authorization_type',
    'checkout_authorized_at', 'checkout_session_id', 'checkout_sent_at',
  ]) {
    assert.match(migration, new RegExp(`${field} = NULL`), field);
  }
});

test('migration keeps every existing user outside Sales Engine v3', () => {
  assert.match(
    migration,
    /SET conversation_stage = NULL[\s\S]*WHERE EXISTS \([\s\S]*app_user\.whatsapp_id = session\.session_id/,
  );
  assert.match(
    migration,
    /legacy_onboarding_state = 'closed'[\s\S]*AND NOT EXISTS/,
  );
});

test('preflight locks the reviewed production snapshot and previews linkage-aware mapping', () => {
  for (const expected of [
    /'lead'::text, 287::bigint, 0::bigint/,
    /'ask_subscription', 48, 0/,
    /'subscription_deferred', 8, 0/,
    /'payment_pending', 49, 1/,
    /'subscriber', 0, 1/,
  ]) assert.match(preflight, expected);
  assert.match(preflight, /STOP_AND_REVIEW/);
  assert.match(preflight, /WHEN app_user\.id IS NOT NULL THEN NULL/);
  assert.match(
    preflight,
    /'lead', 'ask_subscription', 'subscription_deferred', 'payment_pending'[\s\S]*THEN 'evaluating'/,
  );
});

test('repository contains no fabricated Meta attribution mapping', () => {
  const leadSql = nodes.get('Initialize Sales Lead v3').parameters.query;
  assert.doesNotMatch(leadSql, /campaign_id|adset_id|ad_id|ctwa_clid|referral_id/);
  assert.match(nodes.get('Initialize Sales Lead v3').notes, /no verified real CTWA payload field fixture/i);
});

test('canonical workflow stays inactive and rollback artifact is exact', () => {
  assert.equal(workflow.active, false);
  const rollback = fs.readFileSync(path.join(root, 'archive/Dietavity live 2.5.1 pre-ticket-8.json'), 'utf8');
  const prior = fs.readFileSync(path.join(root, 'archive/Dietavity live 2.5.1 (Ticket 6).json'), 'utf8');
  assert.deepEqual(JSON.parse(rollback), JSON.parse(prior));
});
