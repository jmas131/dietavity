'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const production = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const workflow = require('../n8n/Dietavity Direct RAG Chat Harness.json');
const { buildHarness, serialize, DIRECT_RAG_NODES, TEST_SESSION_ID } = require('../scripts/generate-direct-rag-chat-harness');

const byName = name => workflow.nodes.find(node => node.name === name);
const outputs = name => (workflow.connections[name]?.main || []).flat().map(edge => edge.node);
const run = (name, input, records = {}) => vm.runInNewContext(`(function(){${byName(name).parameters.jsCode}})()`, {
  $input: { first: () => ({ json: input }) },
  $: key => ({ item: { json: records[key] || {} } }),
});

test('generated Direct RAG Chat harness is synchronized with the current Ticket 10 artifact', () => {
  assert.equal(serialize(buildHarness(production)), fs.readFileSync(path.join(__dirname, '../n8n/Dietavity Direct RAG Chat Harness.json'), 'utf8'));
  for (const name of DIRECT_RAG_NODES) {
    const generated = byName(name); const current = production.nodes.find(node => node.name === name);
    assert.equal(generated.type, current.type, name);
    assert.equal(generated.typeVersion, current.typeVersion, name);
    if (!['Sales Obligations Model', 'Grounded Sales Response Model', 'Parse Direct RAG Obligations'].includes(name)) assert.deepEqual(generated.parameters, current.parameters, name);
  }
  const parser = byName('Parse Direct RAG Obligations').parameters.jsCode;
  assert.match(parser, /Build Direct RAG Test Context/);
  assert.doesNotMatch(parser, /Build Direct RAG Conversation Context/);
});

test('Chat workflow is private, inactive, compact, and has no production side-effect nodes', () => {
  const trigger = byName('When Chat Message Received');
  assert.equal(workflow.active, false); assert.equal(trigger.parameters.public, false); assert.equal(trigger.parameters.options.responseMode, 'lastNode');
  assert.deepEqual(outputs('When Chat Message Received'), ['Prepare Test Turn']);
  assert.deepEqual(outputs('Resolve Direct RAG Obligations'), ['Assert No External Action']);
  assert.deepEqual(outputs('Assert No External Action'), ['Build Direct RAG Composition Envelope']);
  assert.deepEqual(outputs('Final Direct RAG Customer Response Gate'), ['Persist Test Conversation']);
  assert.deepEqual(outputs('Reset Test Conversation'), ['Clear Test Conversation']);
  const source = JSON.stringify(workflow);
  assert.doesNotMatch(source, /twilio|stripe|Reserve Sales Reply|Persist Checkout Authorization|sales_funnel_events|public\.messages/i);
  for (const name of ['Get Test Conversation History', 'Clear Test Conversation']) {
    const sql = byName(name).parameters.query;
    assert.match(sql, /session_id = \$1::jsonb->>'session_id'/, name);
    assert.doesNotMatch(sql, new RegExp(TEST_SESSION_ID), name);
    assert.doesNotMatch(sql, /"direct-rag-chat-harness:v1:synthetic-dietavity-customer"/, name);
  }
  assert.match(byName('Get Test Conversation History').parameters.options.queryReplacement, /Prepare Test Turn/);
  assert.match(byName('Clear Test Conversation').parameters.options.queryReplacement, new RegExp(TEST_SESSION_ID));
});

test('synthetic identity and bounded memory are isolated from Chat payload identity and real sessions', () => {
  const prepared = run('Prepare Test Turn', {}, { 'When Chat Message Received': { chatInput: '¡Hola! Quiero saber más.', sessionId: '+5215555555555', inbound_message_sid: 'SM' + 'a'.repeat(32) } })[0].json;
  assert.deepEqual(JSON.parse(JSON.stringify(prepared)), { session_id: TEST_SESSION_ID, current_message: '¡Hola! Quiero saber más.' });
  assert.throws(() => run('Prepare Test Turn', {}, { 'When Chat Message Received': { chatInput: '', action: 'sendMessage' } }), /TEXT_REQUIRED/);
  assert.throws(() => run('Prepare Test Turn', {}, { 'When Chat Message Received': { chatInput: 'Hola', action: 'loadPreviousSession' } }), /SEND_MESSAGE_ONLY/);
  const query = byName('Get Test Conversation History').parameters.query;
  assert.match(query, /onboarding_chat_memory/); assert.match(query, /LIMIT 12/); assert.match(query, /harness_sequence DESC/); assert.match(query, /jsonb_agg\(entry ORDER BY harness_sequence ASC\)/); assert.doesNotMatch(query, new RegExp(TEST_SESSION_ID));
  assert.doesNotMatch(query, /public\.messages|onboarding_sessions|sales_funnel_events/);
  const context = run('Build Direct RAG Test Context', { history: [{ role: 'customer', text: '¿Cuánto cuesta?' }, { role: 'assistant', text: 'Cuesta $149 MXN.' }] }, { 'Prepare Test Turn': prepared })[0].json;
  assert.equal(context.session_id, TEST_SESSION_ID); assert.equal(context.customer_state.paid, false); assert.equal(context.commercial_state.purchase_context, false);
  assert.equal(context.most_recent_assistant_message, 'Cuesta $149 MXN.'); assert.equal(context.history.length, 2);
});

test('harness history SQL selects the latest synthetic turns and returns causal order', () => {
  const query = byName('Get Test Conversation History').parameters.query;
  const persist = byName('Persist Test Conversation').parameters.query;
  assert.match(query, /message->'data'->>'harness_sequence'/);
  assert.match(query, /ORDER BY harness_sequence DESC\s+LIMIT 12/);
  assert.match(query, /jsonb_agg\(entry ORDER BY harness_sequence ASC\)/);
  assert.match(persist, /pg_advisory_xact_lock/);
  assert.match(persist, /last_sequence \+ 1/); assert.match(persist, /last_sequence \+ 2/);
  const history = [
    { role: 'customer', text: 'customer1' }, { role: 'assistant', text: 'assistant1' },
    { role: 'customer', text: 'customer2' }, { role: 'assistant', text: 'assistant2' },
  ];
  const context = run('Build Direct RAG Test Context', { history }, { 'Prepare Test Turn': { session_id: TEST_SESSION_ID, current_message: 'turn 3' } })[0].json;
  assert.deepEqual(JSON.parse(JSON.stringify(context.history)), history);
  assert.equal(context.most_recent_assistant_message, 'assistant2');
  const sequences = Array.from({ length: 16 }, (_, index) => ({ harness_sequence: index + 1, role: index % 2 ? 'assistant' : 'customer', text: `turn-${index + 1}` }));
  const selectedChronologically = sequences.slice(-12).map(({ role, text }) => ({ role, text }));
  const bounded = run('Build Direct RAG Test Context', { history: selectedChronologically }, { 'Prepare Test Turn': { session_id: TEST_SESSION_ID, current_message: 'turn 9' } })[0].json;
  assert.deepEqual(JSON.parse(JSON.stringify(bounded.history)), selectedChronologically);
  assert.equal(bounded.history[0].text, 'turn-5'); assert.equal(bounded.history.at(-1).text, 'turn-16');
});

test('the no-action guard preserves the GLP-1 pilot safeguard before memory persistence', () => {
  const input = { authorized_action: null, checkout_authorized: false, pending_action: 'respond' };
  assert.deepEqual(run('Assert No External Action', input)[0].json, input);
  assert.throws(() => run('Assert No External Action', { authorized_action: { action: 'existing_checkout' }, checkout_authorized: true, pending_action: 'send_checkout' }), /EXTERNAL_ACTION_BLOCKED/);
  const resolver = byName('Resolve Direct RAG Obligations').parameters.jsCode;
  const result = vm.runInNewContext(`(function(){${resolver}})()`, { $input: { first: () => ({ json: { current_message: 'Quiero comprarlo.', commercial_state: { purchase_context: false }, obligations: [{ id: 'o-1', type: 'purchase_intent', evidence: 'Quiero comprarlo' }] } }) } })[0].json;
  assert.equal(result.checkout_authorized, false); assert.equal(result.authorized_action, null); assert.equal(result.checkout_suppressed_reason, 'proposition_test_no_checkout');
});

test('required manual prompt cases map to the current Direct RAG resolver and never execute Checkout', () => {
  const resolver = byName('Resolve Direct RAG Obligations').parameters.jsCode;
  const cases = [
    ['¡Hola! Quiero saber más.', 'general_information', /asistente de alimentación por WhatsApp/i], ['¿Cuánto cuesta?', 'price', /probar Dietavity gratis/i], ['Tengo poca hambre, ¿qué puedo comer?', 'food_decision', /¿Qué alimentos tienes disponibles ahora\?/i], ['¿Dan el medicamento GLP-1?', 'glp1_scope', /no vende, entrega ni receta/i], ['¿Debo bajar mi dosis?', 'medical_boundary', /profesional/i], ['¿Cómo funciona?', 'how_it_works', /recomendación práctica/i], ['Gracias', 'acknowledgement', /con gusto/i], ['Quiero comprarlo.', 'purchase_intent', /prueba gratuita/i],
  ];
  for (const [message, type, match] of cases) {
    const result = vm.runInNewContext(`(function(){${resolver}})()`, { $input: { first: () => ({ json: { current_message: message, commercial_state: { purchase_context: false }, obligations: [{ id: 'o-1', type, evidence: message.replace(/[¿?.!¡]/g, '') || message, ...(type === 'purchase' ? { intent: 'explicit_current_request' } : {}) }] } }) } })[0].json;
    assert.match(result.permitted_claims.join(' '), match, message); assert.equal(result.checkout_authorized, false, message); assert.equal(result.authorized_action, null, message);
  }
});

test('harness cloned parser and resolver preserve food context and mixed obligations', () => {
  const parser = byName('Parse Direct RAG Obligations').parameters.jsCode;
  const resolver = byName('Resolve Direct RAG Obligations').parameters.jsCode;
  const runPath = (current_message, obligations) => {
    const context = { current_message, commercial_state: { purchase_context: false }, offer_version: 'glp1-whatsapp-free-test-v3' };
    const parsed = vm.runInNewContext(`(function(){${parser}})()`, {
      $: () => ({ item: { json: context } }), $input: { first: () => ({ json: { output: JSON.stringify({ obligations }) } }) },
    })[0].json;
    return vm.runInNewContext(`(function(){${resolver}})()`, { $input: { first: () => ({ json: parsed }) } })[0].json;
  };
  const nutrition = runPath('Uso GLP-1 y casi no tengo hambre, ¿cómo me ayudaría Dietavity?', [{ type: 'food_decision', evidence: 'casi no tengo hambre' }]);
  assert.deepEqual(Array.from(nutrition.obligations, value => value.type), ['food_decision']);
  assert.match(nutrition.permitted_claims.join(' '), /¿Qué alimentos tienes disponibles ahora\?/i);
  assert.doesNotMatch(nutrition.permitted_claims.join(' '), /no vende|profesional que te lo prescribió/i);
  const mixed = runPath('Uso GLP-1, ¿cuánto cuesta y cómo me ayudaría si tengo poco apetito?', [{ type: 'price', evidence: 'cuánto cuesta' }, { type: 'food_decision', evidence: 'poco apetito' }]);
  assert.deepEqual(Array.from(mixed.obligations, value => value.type), ['price', 'food_decision']);
  assert.match(mixed.permitted_claims.join(' '), /probar Dietavity gratis/i);
  assert.doesNotMatch(mixed.permitted_claims.join(' '), /no vende|profesional que te lo prescribió/i);
});
