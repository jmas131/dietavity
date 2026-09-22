'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const policy = require('../lib/sales-engine-v3');
const knowledge = require('../lib/dietavity-knowledge');
const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const node = name => workflow.nodes.find(n => n.name === name);
const icebreaker = '¡Hola! Quiero saber más.';
const interpret = { interpretation_valid: true, buyer_signal: 'question', substantive_engagement: true };
const decide = (message, session = {}, interpretation = interpret) => policy.decideSalesTurn({ message, session, interpretation });
function run(name, records, input = {}) {
  return vm.runInNewContext(`(function(){${node(name).parameters.jsCode}})()`, {
    $: name => ({item: {json: records[name] || {}}}), $input: {first: () => ({json: input})},
  })[0].json;
}
function validated(message, decision, output = 'Sube tu dosis y compra ahora.') {
  return run('Validate Sales Response Contract', {
    'Apply Deterministic Commercial Policy': decision, 'Set Session Id': {chatInput: message},
  }, {output}).output;
}
test('exact campaign detection conserves punctuation and accents while normalizing case, Unicode and whitespace', () => {
  for (const value of [icebreaker, '  ¡HOLA!  Quiero\n saber más. ', icebreaker.normalize('NFD')]) {
    assert.equal(policy.detectOfferContext(value), 'glp1_validation');
  }
  for (const value of ['¡Hola! Quiero más información.', 'Hola quiero saber mas', '¡Hola! Quiero saber más', `${icebreaker} ¿Cuánto cuesta?`, 'Uso GLP-1', '', null]) {
    assert.equal(policy.detectOfferContext(value), null);
  }
});
test('Ticket 43 opening introduces the service even with invalid or falsely purchase-positive AI output', () => {
  for (const interpretation of [{interpretation_valid: false}, { ...interpret, buyer_signal: 'explicit_purchase', goal: 'GLP-1'}]) {
    const decision = decide(icebreaker, {conversation_stage: 'new'}, interpretation);
    assert.equal(decision.offer_context, 'glp1_validation');
    assert.equal(decision.offer_version, '28d-149-v1');
    assert.equal(decision.checkout_authorized, false);
    assert.equal(decision.pending_action, 'respond');
    assert.equal(decision.goal, null);
    assert.equal(validated(icebreaker, decision), '¡Hola! 😊 Claro. Dietavity te ayuda a organizar comidas sencillas y personalizadas durante 28 días, especialmente cuando estás comiendo menos. ¿Qué te gustaría saber?');
    assert.doesNotMatch(validated(icebreaker, decision), /149|checkout/i);
    assert.equal((validated(icebreaker, decision).match(/¿/g) || []).length, 1);
    assert.equal((validated(icebreaker, decision).match(/\?/g) || []).length, 1);
    assert.ok(validated(icebreaker, decision).endsWith('¿Qué te gustaría saber?'));
  }
});
test('later price, inclusion, purchase and weak acknowledgements retain context and intercept only authorized purchase intent', () => {
  const session = { offer_context: 'glp1_validation', conversation_stage: 'evaluating' };
  for (const message of ['¿Cuánto cuesta?', '¿Qué incluye?', 'Quiero comprar', 'ok']) {
    const decision = decide(message, session);
    assert.equal(decision.offer_context, 'glp1_validation');
    assert.equal(decision.offer_version, '28d-149-v1');
    assert.equal(decision.checkout_authorized, false);
    assert.equal(decision.holding_page_would_be_sent === true, message === 'Quiero comprar');
  }
  assert.match(validated('¿Cuánto cuesta?', decide('¿Cuánto cuesta?', session, {...interpret, topic: 'price', material_question: true})), /149 MXN/);
});
test('medication questions override explicit purchase, with prescriber referral and no medical advice', () => {
  for (const message of ['Quiero comprar, ¿qué dosis uso?', '¿Debo suspender el medicamento?', '¿Puedo empezar a usarlo?', '¿Cómo cambio mi tratamiento?']) {
    const decision = decide(message, {offer_context: 'glp1_validation'}, {...interpret, buyer_signal: 'explicit_purchase'});
    assert.equal(decision.checkout_authorized, false);
    assert.equal(decision.max_questions, 0);
    assert.match(validated(message, decision), /profesional que te lo prescribió/);
    assert.doesNotMatch(validated(message, decision), /Sube tu dosis|compra ahora/);
  }
  const message = 'Tengo dolor intenso y empeora rápidamente';
  assert.match(validated(message, decide(message, {offer_context: 'glp1_validation'})), /atención médica de inmediato/);
});
test('NULL context keeps a representative generic conversation byte-for-byte equivalent', () => {
  for (const message of ['¡Hola! Quiero más información.', '¿Cuánto cuesta?', '¿Qué incluye?', 'Quiero comprar', 'ok']) {
    assert.deepEqual(decide(message, {offer_context: null}), decide(message));
  }
});
test('generated knowledge is conditional and uses unchanged canonical product identity', () => {
  const plain = run('Build Canonical Dietavity Knowledge', {}, {offer_context: null});
  const glp1 = run('Build Canonical Dietavity Knowledge', {}, {offer_context: 'glp1_validation'});
  assert.equal(plain.sales_response_knowledge, knowledge.SALES_RESPONSE_KNOWLEDGE);
  assert.equal(glp1.sales_response_knowledge, knowledge.SALES_RESPONSE_KNOWLEDGE + '\n\n' + knowledge.GLP1_SALES_KNOWLEDGE);
  assert.equal(glp1.offer_version, '28d-149-v1');
  assert.match(glp1.sales_response_knowledge, /La persona prepara su comida/);
});
test('embedded production policy and validator execute with durable context on both session branches', () => {
  for (const existing of [true, false]) {
    const session = {offer_context: 'glp1_validation', conversation_stage: 'new'};
    const decision = run('Apply Deterministic Commercial Policy', {
      'Set Session Id': {chatInput: icebreaker, session_id: '+5215555555555', inbound_message_sid: 'SM' + 'a'.repeat(32)},
      'Parse Sales Interpretation': interpret,
      'If Existing Onboarding Session': existing ? {session_id: '+5215555555555'} : {},
      'Get Onboarding Session': existing ? session : {},
      'Initialize Sales Lead v3': session,
    });
    assert.equal(decision.offer_context, 'glp1_validation');
    assert.equal(decision.checkout_authorized, false);
    assert.equal(validated(icebreaker, decision), decide(icebreaker, session).deterministic_response);
  }
});
test('workflow detection runs before AI, is parameterized, and preserves error behavior and runtime', () => {
  const get = node('Get Onboarding Session');
  assert.equal(get.type, node('Initialize Sales Lead v3').type);
  assert.equal(get.typeVersion, node('Initialize Sales Lead v3').typeVersion);
  assert.equal(get.alwaysOutputData, true);
  assert.notEqual(get.onError, 'continueRegularOutput');
  for (const name of ['Get Onboarding Session', 'Initialize Sales Lead v3']) {
    const expression = node(name).parameters.options.queryReplacement;
    const result = vm.runInNewContext(expression.slice(3, -2), {$: () => ({item: {json: {chatInput: icebreaker, session_id: "test'quoted"}}})});
    assert.deepEqual(JSON.parse(result), {session_id: "test'quoted", offer_context: 'glp1_validation'});
  }
  assert.equal(workflow.connections['Set Session Id'].main[0][0].node, 'Get Onboarding Session');
  assert.equal(workflow.active, false);
});
test('practical discovery follow-up uses contextual knowledge without health-goal storage or a stale question', () => {
  const message = 'Me cuesta organizar comidas con poco apetito';
  const decision = decide(message, {offer_context:'glp1_validation'}, {...interpret, buyer_signal:'information_request', goal_supplied:true, goal:'poco apetito'});
  assert.equal(decision.strategy,'conversational');
  assert.equal(decision.next_last_question_type,null);
  assert.equal(decision.goal,null);
  assert.equal(decision.max_questions,1);
  const response = 'Podemos ayudarte a organizar comidas sencillas y nutritivas para tu día a día.';
  assert.equal(validated(message,decision,response),decision.deterministic_response);
  assert.doesNotMatch(validated(message,decision,response), /enlace|preferencias|restricciones/);
});
test('canary output guard rejects unsupported medication advice, promises and internal identifiers', () => {
  const decision = decide('Estoy pensando', {offer_context:'glp1_validation'}, {...interpret,buyer_signal:'other'});
  for (const response of ['Sube tu dosis.', 'Usa 2 mg por semana.', 'Dietavity previene efectos secundarios.', 'Garantizamos preservar tu masa muscular.', 'Mejoramos la eficacia del medicamento.', 'Tu offer_context es glp1_validation.']) {
    assert.match(validated('Me cuesta organizar comidas',decision,response),/no tratamiento médico/);
  }
  assert.equal(policy.glp1ResponseViolatesScope('No cambies tu medicamento; consulta al profesional que te lo prescribió.'),false);
});

test('Ticket 41B practical difficulties outrank generic diet classification through the final validator', () => {
  for (const message of [
    'Se me complica saber qué comer porque tengo poco apetito.',
    'Me cuesta organizar mis comidas.',
    'No tengo tiempo para cocinar.',
    'No sé qué alimentos preparar.',
  ]) for (const interpretation of [
    {...interpret, topic:'diet_support', material_question:true},
    {...interpret, topic:'personalization', material_question:true},
    {...interpret, buyer_signal:'explicit_purchase'},
    {interpretation_valid:false},
  ]) {
    const decision = decide(message, {offer_context:'glp1_validation',last_question_type:'purchase_confirmation'}, interpretation);
    assert.equal(decision.deterministic_reason, 'glp1_practical_discovery');
    assert.equal(decision.checkout_authorized, false);
    assert.equal(decision.allow_purchase_cta, false);
    assert.equal(decision.next_last_question_type, null);
    assert.equal(decision.goal, null);
    for (const raw of ['', 'Durante la personalización puedes indicar preferencias y restricciones. ¿Quieres el enlace?', 'Sube tu dosis.']) {
      const output = validated(message, decision, raw);
      assert.equal(output, decision.deterministic_response);
      assert.match(output, /huevo o frijoles/);
      assert.equal((output.match(/\?/g) || []).length, 1);
      assert.doesNotMatch(output, /enlace|Checkout|preferencias|restricciones|dosis/);
    }
  }
});
test('Ticket 41B preserves medical, commercial, purchase and generic paths', () => {
  for (const message of ['Me cuesta comer y tengo dolor intenso', 'Me cuesta comer, ¿debo bajar mi dosis?',
    'Me cuesta cocinar, ¿cuánto cuesta?', 'Me cuesta cocinar, ¿qué incluye?', 'Me cuesta cocinar y quiero comprarlo.', 'ok', 'gracias']) {
    assert.notEqual(decide(message, {offer_context:'glp1_validation'}).deterministic_reason, 'glp1_practical_discovery');
  }
  assert.equal(decide('Me cuesta cocinar y quiero comprarlo.', {offer_context:'glp1_validation'}).holding_page_would_be_sent, true);
  assert.notEqual(decide('Me cuesta cocinar').deterministic_reason, 'glp1_practical_discovery');
});

test('Ticket 43 generic icebreaker retains the previous policy and never receives the GLP-1 introduction', () => {
  const message = '¡Hola! Quiero más información.';
  assert.equal(decide(message).offer_context, undefined);
  assert.notEqual(validated(message, decide(message)), decide(icebreaker).deterministic_response);
});
