'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {buildHarness, serialize, CANONICAL_NODES, FAKE_IDENTITIES} = require('../scripts/generate-ticket-41a-chat-harness');
const production = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const harness = require('../n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json');
const byName = (name, workflow = harness) => workflow.nodes.find(n => n.name === name);
const run = (name, input, records = {}) => vm.runInNewContext(`(function(){${byName(name).parameters.jsCode}})()`, {
  $input: {first: () => ({json: input})}, $: name => ({item: {json: records[name] || {}}}),
})[0].json;
const outputs = name => harness.connections[name]?.main?.flat().map(edge => edge.node) || [];

test('harness generator is synchronized, deterministic and leaves all production sources untouched', () => {
  const original = serialize(production);
  const result = buildHarness(production);
  assert.equal(serialize(result), fs.readFileSync(path.join(__dirname, '../n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json'), 'utf8'));
  assert.equal(serialize(result), serialize(buildHarness(production)));
  assert.equal(serialize(production), original);
  assert.equal(result.active, false);
  assert.deepEqual(result.pinData, {});
});
test('manual-only Chat Trigger returns last-node output with no error workflow or external delivery node', () => {
  const trigger = byName('When chat message received');
  assert.equal(trigger.type, '@n8n/n8n-nodes-langchain.chatTrigger');
  assert.equal(trigger.typeVersion, 1.1);
  assert.equal(trigger.parameters.public, false);
  assert.equal(trigger.parameters.options.responseMode, 'lastNode');
  assert.equal(harness.settings.errorWorkflow, undefined);
  const allowed = new Set(['@n8n/n8n-nodes-langchain.chatTrigger', 'n8n-nodes-base.code', 'n8n-nodes-base.set',
    'n8n-nodes-base.postgres', 'n8n-nodes-base.if', 'n8n-nodes-base.switch',
    '@n8n/n8n-nodes-langchain.agent', '@n8n/n8n-nodes-langchain.lmChatOpenAi', '@n8n/n8n-nodes-langchain.memoryPostgresChat']);
  for (const node of harness.nodes) {
    assert.ok(allowed.has(node.type), node.name);
    assert.equal(node.onError, undefined);
    assert.equal(node.continueOnFail, undefined);
    for (const credential of Object.values(node.credentials || {})) {
      assert.equal(credential.id, undefined);
      assert.match(credential.name, /^Dietavity Conversation Harness /);
    }
  }
  const source = JSON.stringify(harness);
  assert.doesNotMatch(source, /\$env\.|api\.twilio|api\.stripe|smtp|n8n-nodes-base\.executeWorkflow/);
});
test('canonical classifier, knowledge, policy, response builder and validator are used without prompt or policy forks', () => {
  for (const name of CANONICAL_NODES.filter(name => !['Initialize Sales Lead v3', 'Postgres Chat Memory'].includes(name))) {
    assert.deepEqual(byName(name).parameters, byName(name, production).parameters, name);
    assert.equal(byName(name).typeVersion, byName(name, production).typeVersion, name);
  }
  const originalInit = byName('Initialize Sales Lead v3', production).parameters.query;
  assert.equal(byName('Initialize Sales Lead v3').parameters.query,
    originalInit.slice(0, originalInit.indexOf('), inserted_event AS (')) + ')\nSELECT * FROM inserted_session;');
  const originalState = byName('Persist Sales Response State and Events', production).parameters.query;
  assert.ok(byName('Persist Harness Response State').parameters.query.startsWith(originalState.slice(0, originalState.indexOf('), event_names AS ('))));
});
test('both fake identities are scoped and untrusted Chat fields cannot select a real session or provider identity', () => {
  for (const fake of FAKE_IDENTITIES) {
    const input = run('Set Session Id', {fake_whatsapp_id: fake}, {'When chat message received': {
      chatInput: '¡Hola! Quiero saber más.', action: 'sendMessage', sessionId: '+5215512345678',
      session_id: '+5215512345678', fake_whatsapp_id: '+5215512345678', inbound_message_sid: 'SM' + 'a'.repeat(32),
    }});
    assert.equal(input.session_id, `ticket41a:${fake}`);
    assert.equal(input.fake_whatsapp_id, fake);
    assert.equal(input.inbound_message_sid, undefined);
  }
  for (const fake of ['+5215512345678', "'+5215554111111'", '', null]) {
    assert.throws(() => run('Set Session Id', {fake_whatsapp_id: fake}, {'When chat message received': {chatInput:'hello'}}), /HARNESS_FAKE_IDENTITY_REQUIRED/);
  }
  for (const chat of [{chatInput: ''}, {chatInput: {query:'bad'}}, {chatInput:'x'.repeat(4097)}, {chatInput:'hello',action:'loadPreviousSession'}]) {
    assert.throws(() => run('Set Session Id', {fake_whatsapp_id: FAKE_IDENTITIES[0]}, {'When chat message received':chat}), /HARNESS_(TEXT_MESSAGE_REQUIRED|SEND_MESSAGE_ONLY)/);
  }
});
test('every edge and runtime expression reference resolves inside the isolated harness', () => {
  const names = new Set(harness.nodes.map(n => n.name));
  assert.equal(names.size, harness.nodes.length);
  for (const [source, ports] of Object.entries(harness.connections)) {
    assert.ok(names.has(source));
    for (const edges of Object.values(ports)) for (const edge of edges.flat()) assert.ok(names.has(edge.node), edge.node);
  }
  for (const node of harness.nodes) for (const match of JSON.stringify(node.parameters).matchAll(/\$\('([^']+)'\)/g)) {
    assert.ok(names.has(match[1]), `${node.name}: ${match[1]}`);
  }
  // Follow every connection, including AI model/memory edges, to detect dangling or orphan code.
  const connected = new Set(['When chat message received']);
  for (let i = 0; i < harness.nodes.length; i++) for (const [source, ports] of Object.entries(harness.connections)) {
    for (const [port, groups] of Object.entries(ports)) for (const edge of groups.flat()) {
      if (connected.has(source) || (port !== 'main' && connected.has(edge.node))) { connected.add(source); connected.add(edge.node); }
    }
  }
  assert.equal(connected.size, harness.nodes.length);
  assert.deepEqual(outputs('Set Session Id'), ['Get Onboarding Session']);
  assert.deepEqual(outputs('Parse Sales Interpretation'), ['Get Recent Sales Clarification Context']);
  assert.deepEqual(outputs('Validate Sales Response Contract'), ['Persist Harness Response State']);
  assert.deepEqual(outputs('Persist Harness Response State'), ['Return Chat Response']);
  assert.deepEqual(outputs('Return Chat Response'), []);
  assert.deepEqual(outputs('Intercept External Action'), []);
});
test('Checkout and reminder routes terminate before all side effects and expose explicit inspection results', () => {
  const routes = harness.connections['Route Authorized Sales Action'].main;
  assert.equal(routes[0][0].node, 'Intercept External Action');
  assert.equal(routes[1][0].node, 'Intercept External Action');
  const records = {'Set Session Id': {session_id:'ticket41a:+5215554111111',fake_whatsapp_id:FAKE_IDENTITIES[0],chatInput:'Quiero comprarlo.'}};
  for (const pending_action of ['send_checkout', 'schedule_requested_reminder']) {
    const report = run('Intercept External Action', {pending_action,checkout_authorized:pending_action === 'send_checkout',offer_version:'28d-149-v1',offer_context:'glp1_validation',buyer_signal:'explicit_purchase',strategy:'direct_purchase'}, records);
    assert.equal(report.checkout_would_be_created,pending_action === 'send_checkout');
    assert.equal(report.offer_version,'28d-149-v1');
    assert.equal(report.intercepted_action,pending_action);
    assert.match(report.output,/TEST ONLY/);
    assert.equal(report.checkout_url,undefined);
  }
  assert.throws(() => run('Intercept External Action', {pending_action:'send_checkout',checkout_authorized:false}, records), /HARNESS_UNAUTHORIZED_CHECKOUT/);
});
test('database changes are limited to canonical test sessions and AI memory, with no ledger or business events', () => {
  const sqlNodes = harness.nodes.filter(n => n.type === 'n8n-nodes-base.postgres');
  assert.equal(sqlNodes.length, 4);
  for (const node of sqlNodes) {
    assert.doesNotMatch(node.parameters.query, /public\.(messages|users|purchases|sales_funnel_events)|CREATE |DROP |DELETE /i);
    assert.match(node.parameters.options.queryReplacement, /JSON.stringify/);
  }
  assert.equal(byName('Postgres Chat Memory').parameters.tableName,'onboarding_chat_memory');
  assert.equal(byName('Postgres Chat Memory').parameters.sessionKey,"={{ $('Set Session Id').item.json.session_id }}");
  assert.match(byName('Get Recent Sales Clarification Context').parameters.query,/ticket41a_final/);
});
test('output uses final validated response only and fails if memory persistence was not confirmed', () => {
  const decision = {session_id:'ticket41a:+5215554111111',output:'¡Hola! 😊 Claro. ¿Qué se te complica?',offer_context:'glp1_validation',buyer_signal:'question',strategy:'discovery',offer_version:'28d-149-v1',internal_secret:'must not appear'};
  const records = {'Validate Sales Response Contract':decision,'Set Session Id':{session_id:decision.session_id,fake_whatsapp_id:FAKE_IDENTITIES[0],chatInput:'hello'}};
  const report = run('Return Chat Response', {session_id:decision.session_id,harness_memory_updated:1}, records);
  assert.equal(report.assistant_response,decision.output);
  assert.equal(report.output,decision.output);
  assert.equal(report.checkout_would_be_created,false);
  assert.equal(report.internal_secret,undefined);
  assert.doesNotMatch(report.output,/must not appear/);
  assert.throws(() => run('Return Chat Response', {session_id:decision.session_id,harness_memory_updated:0}, records), /HARNESS_FINAL_MEMORY_NOT_PERSISTED/);
});

test('Ticket 43 GLP-1 introduction and subsequent turns preserve the harness conversation path', () => {
  let session = {conversation_stage:'new'};
  const turns = [
    ['¡Hola! Quiero saber más.', '¡Hola! 😊 Claro. Dietavity te ayuda a organizar comidas sencillas y personalizadas durante 28 días, especialmente cuando estás comiendo menos. ¿Qué te gustaría saber?'],
    ['No sé qué comer.', /huevo o frijoles/],
    ['¿Cuánto cuesta?', /149 MXN/],
    ['¿Qué incluye?', /28 días/],
    ['Dan el medicamento glp1?', 'No. Dietavity no vende, entrega ni receta medicamentos GLP-1. Somos un programa de alimentación personalizado de 28 días que te ayuda a organizar qué comer cada día. ¿Qué te gustaría saber sobre el programa?'],
    ['¿Debo bajar mi dosis?', /profesional que te lo prescribió/],
    ['Quiero comprar', /https:\/\/dietavity.com\/programa-glp1/],
  ];
  for (const [message, expected] of turns) {
    const records = {'Set Session Id':{chatInput:message,session_id:'ticket41a:'+FAKE_IDENTITIES[0]},
      'If Existing Onboarding Session':{session_id:'ticket41a:'+FAKE_IDENTITIES[0]},
      'Get Onboarding Session':session,
      'Parse Sales Interpretation':{interpretation_valid:true,buyer_signal:'question',
        topic:message === '¿Cuánto cuesta?' ? 'price' : message === '¿Qué incluye?' ? 'inclusions' : null,
        material_question:['¿Cuánto cuesta?', '¿Qué incluye?'].includes(message)}};
    const decision = run('Apply Deterministic Commercial Policy', {}, records);
    records['Apply Deterministic Commercial Policy'] = decision;
    const validated = run('Validate Sales Response Contract', {output:'El programa incluye menú personalizado durante 28 días y cuesta $149 MXN en un pago único.'}, records);
    records['Validate Sales Response Contract'] = validated;
    const report = run('Return Chat Response', {session_id:decision.session_id,harness_memory_updated:1}, records);
    if (typeof expected === 'string') assert.equal(report.assistant_response, expected);
    else assert.match(report.assistant_response, expected);
    assert.equal(decision.offer_context, 'glp1_validation');
    assert.equal(decision.offer_version, '28d-149-v1');
    assert.equal(decision.pending_action, 'respond');
    assert.equal(report.checkout_would_be_created, false);
    assert.equal(report.holding_page_would_be_sent, message === 'Quiero comprar');
    session = {...session, offer_context:decision.offer_context, conversation_stage:decision.conversation_stage,
      last_question_type:decision.next_last_question_type};
  }
});
test('Ticket 45 harness exposes generated/final responses and current authorization without side effects', () => {
  const session_id = 'ticket41a:+5215554111111';
  const decision = {session_id,strategy:'answer_question',buyer_signal:'question',output:'En Dietavity armamos el programa con inteligencia artificial.',checkout_authorized:false,allow_purchase_cta:false,next_last_question_type:null};
  const generated = decision.output + ' ¿Quieres que te envíe el enlace?';
  const report = run('Return Chat Response', {session_id,harness_memory_updated:1}, {
    'Set Session Id':{session_id,chatInput:'Cómo arman el plan de alimentación?'},
    'Generate Sales Response v3':{output:generated},
    'Validate Sales Response Contract':decision,
  });
  assert.equal(report.generated_response,generated);
  assert.equal(report.final_validated_response,decision.output);
  assert.equal(report.assistant_response,decision.output);
  assert.equal(report.checkout_authorized,false);
  assert.equal(report.allow_purchase_cta,false);
  assert.equal(report.next_last_question_type,null);
  assert.equal(report.checkout_would_be_created,false);
  assert.equal(report.holding_page_would_be_sent,false);
});
