'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const rag = require('../lib/sales-engine-v2/direct-rag');
const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const harness = require('../test-support/direct-rag-v2-harness');
function context(message) { return rag.buildConversationContext({ currentMessage: message, sessionId: 'session-1', commercialState: { purchase_context: false } }); }
function envelope(message, obligations) { const c = context(message); return rag.buildCompositionEnvelope({ context: c, resolution: rag.resolveObligations({ context: c, obligations: rag.validateObligations(obligations, message) }) }); }
test('direct RAG context is bounded and current-turn led', () => { const value = rag.buildConversationContext({ currentMessage: '¿Cuánto cuesta?', sessionId: 's', history: Array.from({ length: 20 }, () => ({ role: 'assistant', text: 'x'.repeat(1200) })) }); assert.equal(value.history.length, 12); assert.equal(value.current_message, '¿Cuánto cuesta?'); });
test('direct RAG resolves multiple obligations into explicit permitted claims', () => { const e = envelope('¿Cuánto cuesta y cómo funciona?', [{ type: 'price', evidence: 'Cuánto cuesta' }, { type: 'how_it_works', evidence: 'cómo funciona' }]); assert.equal(e.resolved_obligations.length, 2); assert.ok(e.permitted_claims.includes('El programa de 28 días cuesta $149 MXN.')); });
test('direct RAG regression semantics cover location, GLP-1, medication, thanks, and pilot-suppressed purchase', () => {
  assert.match(envelope('¿En dónde están ubicados?', [{ type: 'location', evidence: 'dónde están ubicados' }]).permitted_claims.join(' '), /servicio digital/);
  assert.match(envelope('¿Dan el medicamento GLP-1?', [{ type: 'glp1_scope', evidence: 'Dan el medicamento GLP-1' }]).permitted_claims.join(' '), /no vende, entrega ni prescribe/);
  assert.match(envelope('¿Debo bajar mi dosis?', [{ type: 'medical_boundary', evidence: 'bajar mi dosis' }]).permitted_claims.join(' '), /profesional/);
  assert.equal(envelope('Gracias', [{ type: 'acknowledgement', evidence: 'Gracias' }]).response_policy.unsolicited_purchase_cta, false);
  const c = rag.buildConversationContext({ currentMessage: 'Quiero comprarlo', sessionId: 's', commercialState: { purchase_context: false } });
  const resolution = rag.resolveObligations({ context: c, obligations: rag.validateObligations([{ type: 'purchase', evidence: 'Quiero comprarlo', intent: 'explicit_current_request' }], c.current_message) });
  assert.equal(resolution.authorized_action, null);
  assert.equal(resolution.checkout_suppressed_reason, 'glp1_live_pilot');
  assert.match(resolution.permitted_claims.join(' '), /abriendo esta modalidad/i);
});
test('generated interpreter, parser, and resolver enforce V3 food and safety obligations', () => {
  const node = name => workflow.nodes.find(value => value.name === name);
  const prompt = node('Interpret Sales Obligations').parameters.options.systemMessage;
  assert.match(prompt, /food_decision/);
  assert.match(prompt, /A contextual rejection is not a durable preference/);
  const parseAndResolve = (current_message, modelObligations, contextExtras = {}) => {
    const context = { current_message, commercial_state: { purchase_context: false }, offer_version: 'glp1-whatsapp-free-test-v3', ...contextExtras };
    const parsed = vm.runInNewContext(`(function(){${node('Parse Direct RAG Obligations').parameters.jsCode}})()`, {
      $: () => ({ item: { json: context } }), $input: { first: () => ({ json: { output: JSON.stringify({ obligations: modelObligations }) } }) },
    })[0].json;
    return vm.runInNewContext(`(function(){${node('Resolve Direct RAG Obligations').parameters.jsCode}})()`, { $input: { first: () => ({ json: parsed }) } })[0].json;
  };
  const intro = parseAndResolve('¡Hola! Quiero saber más.', [{ type: 'general_information', evidence: '¡Hola! Quiero saber más.' }]);
  assert.deepEqual(Array.from(intro.obligations, value => value.type), ['general_information']);
  assert.match(intro.permitted_claims.join(' '), /asistente de alimentación por WhatsApp/i);
  assert.equal(intro.permitted_claims.join(' ').split('¿Qué necesitas resolver con tu alimentación ahora?').length - 1, 1);
  const nutrition = parseAndResolve('Uso GLP-1 y casi no tengo hambre, ¿cómo me ayudaría Dietavity?', [{ type: 'food_decision', evidence: 'casi no tengo hambre' }]);
  assert.deepEqual(Array.from(nutrition.obligations, value => value.type), ['food_decision']);
  assert.match(nutrition.permitted_claims.join(' '), /porción pequeña/i);
  const medication = parseAndResolve('¿Debo bajar mi dosis si casi no tengo hambre?', [{ type: 'medical_boundary', evidence: '¿Debo bajar mi dosis si casi no tengo hambre?' }]);
  assert.deepEqual(Array.from(medication.obligations, value => value.type), ['medical_boundary']);
  assert.match(medication.permitted_claims.join(' '), /profesional/i);
  const scope = parseAndResolve('¿Dan el medicamento GLP-1?', [{ type: 'glp1_scope', evidence: '¿Dan el medicamento GLP-1?' }]);
  assert.deepEqual(Array.from(scope.obligations, value => value.type), ['glp1_scope']);
  assert.match(scope.permitted_claims.join(' '), /no vende, entrega ni receta/i);
  for (const [message, expected, contextExtras = {}] of [
    ['¿Cómo lo descargo?', 'Dietavity funciona directamente por WhatsApp; no necesitas descargar una app ni entrar a un portal para usarlo.'],
    ['¿Es este número?', 'Sí 😊 Puedes usar Dietavity directamente en este chat de WhatsApp.'],
    ['¿Aquí mismo?', 'Sí 😊 Puedes usar Dietavity directamente en este chat de WhatsApp.', { history: [{ role: 'assistant', text: 'Dietavity funciona por WhatsApp para ayudarte con decisiones de comida.' }], most_recent_assistant_message: 'Dietavity funciona por WhatsApp para ayudarte con decisiones de comida.' }],
    ['¿Se usa por WhatsApp?', 'Dietavity funciona por WhatsApp; no necesitas un portal para usarlo.'],
    ['¿Necesito entrar al portal?', 'Dietavity funciona por WhatsApp; no necesitas un portal para usarlo.'],
  ]) {
    const delivery = parseAndResolve(message, [{ type: 'delivery_channel', evidence: message }], contextExtras);
    assert.equal(delivery.permitted_claims.join(' '), expected, message);
  }
  const mixed = parseAndResolve('Uso GLP-1, ¿cuánto cuesta y cómo me ayudaría si tengo poco apetito?', [{ type: 'price', evidence: 'cuánto cuesta' }, { type: 'food_decision', evidence: 'poco apetito' }]);
  assert.deepEqual(Array.from(mixed.obligations, value => value.type), ['price', 'food_decision']);
  assert.match(mixed.permitted_claims.join(' '), /gratis/i);
  assert.match(mixed.permitted_claims.join(' '), /porción pequeña/i);
  assert.doesNotMatch(mixed.permitted_claims.join(' '), /no vende|profesional que te lo prescribió/i);
});
test('final gate rejects unsupported claims, missing coverage, medical advice, and CTA', () => { const e = envelope('¿Dan GLP-1?', [{ type: 'glp1_scope', evidence: 'Dan GLP-1' }]); const ids = ['o-1']; assert.equal(rag.gateResponse({ envelope: e, response: 'Vendemos Ozempic.', coveredObligationIds: ids, usedClaims: ['Vendemos Ozempic.'] }).reason, 'UNSUPPORTED_ACTUAL_RESPONSE'); assert.equal(rag.gateResponse({ envelope: e, response: 'Dietavity no vende GLP-1.', coveredObligationIds: [], usedClaims: [] }).reason, 'OBLIGATION_COVERAGE_MISSING'); assert.equal(rag.gateResponse({ envelope: e, response: 'Baja tu dosis a 2 mg.', coveredObligationIds: ids, usedClaims: [] }).reason, 'MEDICATION_GUIDANCE'); assert.equal(rag.gateResponse({ envelope: e, response: 'No los vendemos. ¿Quieres comprar?', coveredObligationIds: ids, usedClaims: [] }).reason, 'UNAUTHORIZED_CTA'); });
test('actual response grounding never trusts falsified used_claims', () => { const e = envelope('¿Cuánto cuesta?', [{ type: 'price', evidence: 'Cuánto cuesta' }]); const result = rag.gateResponse({ envelope: e, response: 'Dietavity incluye consultas médicas semanales y garantiza bajar 10 kg.', coveredObligationIds: ['o-1'], usedClaims: [] }); assert.equal(result.cleared, false); assert.equal(result.reason, 'UNSUPPORTED_ACTUAL_RESPONSE'); });
test('first-contact generic interest alone permits one exact grounded discovery question', () => {
  const message = '¡Hola! Quiero saber más.';
  const result = harness.run({ message, obligations: [{ type: 'general_information', evidence: message }] });
  assert.equal(result.conversation_policy.discovery_question_authorized, true);
  assert.deepEqual(result.conversation_policy.required_questions, [rag.FIRST_CONTACT_DISCOVERY_QUESTION]);
  assert.equal(result.composition_envelope.response_policy.max_questions, 1);
  assert.deepEqual(result.composition_envelope.response_policy.required_questions, [rag.FIRST_CONTACT_DISCOVERY_QUESTION]);
  assert.equal(result.final_customer_response, `Dietavity es un programa personalizado de alimentación de 28 días. Incluye desayuno, comida, cena y snack para cada día, adaptados a tus objetivos y preferencias. ${rag.FIRST_CONTACT_DISCOVERY_QUESTION}`);
  assert.equal(result.authorized_action, null);
});
test('final gate requires one exact discovery question only when response policy authorizes it', () => {
  const generic = envelope('¡Hola! Quiero saber más.', [{ type: 'general_information', evidence: '¡Hola! Quiero saber más.' }]);
  const factsOnly = generic.permitted_claims.filter(claim => claim !== rag.FIRST_CONTACT_DISCOVERY_QUESTION).join(' ');
  assert.equal(rag.gateResponse({ envelope: generic, response: factsOnly, coveredObligationIds: ['o-1'] }).reason, 'REQUIRED_QUESTION_MISSING');
  assert.equal(rag.gateResponse({ envelope: generic, response: generic.permitted_claims.join(' '), coveredObligationIds: ['o-1'] }).cleared, true);
  assert.equal(rag.gateResponse({ envelope: generic, response: `${generic.permitted_claims.join(' ')} ${rag.FIRST_CONTACT_DISCOVERY_QUESTION}`, coveredObligationIds: ['o-1'] }).cleared, false);
  const specific = envelope('¿Cómo funciona el programa?', [{ type: 'how_it_works', evidence: 'Cómo funciona el programa' }]);
  assert.equal(rag.gateResponse({ envelope: specific, response: `${specific.permitted_claims.join(' ')} ${rag.FIRST_CONTACT_DISCOVERY_QUESTION}`, coveredObligationIds: ['o-1'] }).reason, 'UNAUTHORIZED_QUESTION');
});
test('response-level discovery policy inserts the permitted question once across duplicate general-information obligations', () => {
  const message = '¡Hola! Quiero saber más. Cuéntame más.';
  const result = harness.run({ message, obligations: [{ type: 'general_information', evidence: 'Quiero saber más' }, { type: 'general_information', evidence: 'Cuéntame más' }] });
  assert.equal(result.conversation_policy.discovery_question_authorized, true);
  assert.equal(result.permitted_claims.filter(claim => claim === rag.FIRST_CONTACT_DISCOVERY_QUESTION).length, 1);
  assert.equal(result.final_customer_response.split(rag.FIRST_CONTACT_DISCOVERY_QUESTION).length - 1, 1);
});
test('generated final gate requires the response-level discovery question exactly once', () => {
  const code = name => workflow.nodes.find(node => node.name === name).parameters.jsCode;
  const input = { current_message: '¡Hola! Quiero saber más.', history: [], most_recent_assistant_message: '', commercial_state: { purchase_context: false }, obligations: [{ id: 'o-1', type: 'general_information', evidence: '¡Hola! Quiero saber más.' }] };
  const resolved = vm.runInNewContext(`(function(){${code('Resolve Direct RAG Obligations')}})()`, { $input: { first: () => ({ json: input }) } })[0].json;
  const enveloped = vm.runInNewContext(`(function(){${code('Build Direct RAG Composition Envelope')}})()`, { $input: { first: () => ({ json: resolved }) } })[0].json;
  const runGate = response => vm.runInNewContext(`(function(){${code('Final Direct RAG Customer Response Gate')}})()`, { $input: { first: () => ({ json: { output: JSON.stringify({ response, covered_obligation_ids: ['o-1'], used_claims: [] }) } }) }, $: () => ({ item: { json: enveloped } }) })[0].json;
  const question = '¿Qué necesitas resolver con tu alimentación ahora?';
  const factsOnly = resolved.permitted_claims.filter(claim => claim !== question).join(' ');
  assert.equal(runGate(factsOnly).final_gate.fallback_used, true);
  assert.equal(runGate(factsOnly).output.split(question).length - 1, 1);
  assert.equal(runGate(resolved.permitted_claims.join(' ')).final_gate.cleared, true);
  assert.equal(runGate(`${resolved.permitted_claims.join(' ')} ${question}`).final_gate.fallback_used, true);
});
test('specific information and repeated history do not enter a generic discovery loop', () => {
  const specific = harness.run({ message: '¿Cómo funciona el programa?', obligations: [{ type: 'how_it_works', evidence: 'Cómo funciona el programa' }] });
  assert.equal(specific.composition_envelope.response_policy.max_questions, 0);
  assert.doesNotMatch(specific.final_customer_response, /Qué te gustaría mejorar/i);
  const repeated = harness.run({ message: 'Quiero saber más.', obligations: [{ type: 'general_information', evidence: 'Quiero saber más.' }], history: [{ role: 'customer', text: 'Hola' }, { role: 'assistant', text: 'Dietavity es un programa personalizado de alimentación de 28 días.' }] });
  assert.equal(repeated.composition_envelope.response_policy.max_questions, 0);
  assert.doesNotMatch(repeated.final_customer_response, /Qué te gustaría mejorar/i);
});
test('generic GLP-1 first contact remains non-clinical and can use only the authorized discovery question', () => {
  const message = 'Hola, uso GLP-1 y quiero saber más.';
  const result = harness.run({ message, obligations: [{ type: 'general_information', evidence: message }] });
  assert.equal(result.composition_envelope.response_policy.max_questions, 1);
  assert.match(result.final_customer_response, /programa personalizado/i);
  assert.doesNotMatch(result.final_customer_response, /vende|entrega|prescribe|dosis|medicamento/i);
  assert.equal((result.final_customer_response.match(/[¿?]/g) || []).length, 2);
  assert.equal(result.authorized_action, null);
});
test('final gate rejects an invented or unpermitted discovery question', () => {
  const generic = envelope('¡Hola! Quiero saber más.', [{ type: 'general_information', evidence: '¡Hola! Quiero saber más.' }]);
  assert.equal(rag.gateResponse({ envelope: generic, response: 'Dietavity es un programa personalizado de alimentación de 28 días. ¿Cuál es tu meta?', coveredObligationIds: ['o-1'] }).cleared, false);
  const specific = envelope('¿Cómo funciona el programa?', [{ type: 'how_it_works', evidence: 'Cómo funciona el programa' }]);
  assert.equal(rag.gateResponse({ envelope: specific, response: `Después del pago verificado completas la personalización. ${rag.FIRST_CONTACT_DISCOVERY_QUESTION}`, coveredObligationIds: ['o-1'] }).reason, 'UNAUTHORIZED_QUESTION');
});
test('purchase confirmation remains valid for detection but is suppressed during the GLP-1 pilot', () => {
  const obligations = rag.validateObligations([{ type: 'purchase', evidence: 'Sí', intent: 'valid_current_confirmation' }], 'Sí');
  const resolve = state => rag.resolveObligations({ context: rag.buildConversationContext({ currentMessage: 'Sí', sessionId: 's', commercialState: state }), obligations }).authorized_action;
  assert.equal(resolve({ last_question_type: 'purchase_confirmation', commercial_context_expires_at: new Date(Date.now() + 60000).toISOString() }), null);
  for (const state of [{ last_question_type: 'purchase_confirmation', commercial_context_expires_at: new Date(Date.now() - 1).toISOString() }, { last_question_type: 'purchase_confirmation', commercial_context_expires_at: 'bad' }, { last_question_type: 'purchase_confirmation' }, {}]) assert.equal(resolve(state), null);
});
test('reminder requests are truthful responses and never V2 actions', () => { for (const message of ['Recuérdame mañana.', 'Recuérdame después.']) { const e = envelope(message, [{ type: 'reminder_request', evidence: message }]); assert.equal(e.response_policy.action_authorization, null); assert.match(e.permitted_claims.join(' '), /no puedo programar recordatorios/i); } });
test('GLP-1 live-pilot safeguard resolves purchases through grounded holding claims only', () => {
  const run = (message, obligations, commercialState = {}) => {
    const c = rag.buildConversationContext({ currentMessage: message, sessionId: 'pilot', commercialState });
    return rag.resolveObligations({ context: c, obligations: rag.validateObligations(obligations, message) });
  };
  for (const [message, intent] of [['Mándame el enlace.', 'explicit_current_request'], ['Quiero comprarlo.', 'explicit_current_request']]) {
    const result = run(message, [{ type: 'purchase', evidence: message.replace('.', ''), intent }]);
    assert.equal(result.resolved_obligations[0].obligation.type, 'purchase');
    assert.equal(result.authorized_action, null);
    assert.equal(result.checkout_suppressed_reason, 'glp1_live_pilot');
    assert.match(result.permitted_claims.join(' '), /Te enviaremos por WhatsApp el enlace/i);
  }
  const contextual = run('Sí', [{ type: 'purchase', evidence: 'Sí', intent: 'valid_current_confirmation' }], { last_question_type: 'purchase_confirmation', commercial_context_expires_at: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(contextual.authorized_action, null); assert.equal(contextual.checkout_suppressed_reason, 'glp1_live_pilot');
  const mixed = run('Mándame el enlace. ¿Dan el medicamento GLP-1?', [{ type: 'purchase', evidence: 'Mándame el enlace', intent: 'explicit_current_request' }, { type: 'glp1_scope', evidence: 'Dan el medicamento GLP-1' }]);
  assert.equal(mixed.authorized_action, null); assert.equal(mixed.checkout_suppressed_reason, 'glp1_live_pilot');
  assert.match(mixed.permitted_claims.join(' '), /no vende, entrega ni prescribe/i);
});
test('expanded semantic obligations resolve to bounded, specific material', () => {
  const cases = [
    ['¿Hay un nutriólogo que haga mi plan?', 'trust_credentials', /inteligencia artificial/], ['Prefiero hablar con una persona.', 'human_preference', /consulta individual/],
    ['¿Me ayudan por WhatsApp?', 'portal_support', /WhatsApp/], ['¿Cuándo estará listo mi programa?', 'fulfillment', /personalización/],
    ['¿Me pueden ayudar todos los días?', 'support_limits', /bajo demanda/], ['Muéstrame un ejemplo.', 'example', /ilustrativo/],
    ['Tengo poco apetito, ¿qué puedo comer?', 'practical_guidance', /proteína/], ['No gracias.', 'graceful_close', /Gracias/],
  ];
  for (const [message, type, pattern] of cases) { const e = envelope(message, [{ type, evidence: message }]); assert.match(e.permitted_claims.join(' '), pattern, type); }
  const medical = envelope('¿Debo bajar mi dosis?', [{ type: 'medical_boundary', evidence: 'bajar mi dosis' }]); assert.match(medical.permitted_claims.join(' '), /profesional/);
});
test('bounded practical guidance is food-focused and keeps medication boundary separate', () => {
  const c = rag.buildConversationContext({ currentMessage: 'Tengo poco apetito, ¿qué puedo comer?', sessionId: 's' });
  const r = rag.resolveObligations({ context: c, obligations: rag.validateObligations([{ type: 'practical_guidance', evidence: c.current_message }], c.current_message) });
  assert.match(r.permitted_claims.join(' '), /yogurt|huevo|frijoles/i);
  const mixed = rag.practicalGuidance('Tengo poco apetito. ¿Debo bajar mi dosis?').join(' ');
  assert.match(mixed, /profesional/); assert.doesNotMatch(mixed, /baja tu dosis/i);
});
test('generated workflow enters direct RAG, preserves action routes, and has a grounded final gate', () => {
  const names = new Set(workflow.nodes.map(node => node.name)); const outputs = name => (workflow.connections[name]?.main || []).flat().map(edge => edge.node);
  assert.deepEqual(outputs('If Existing Onboarding Session')[0], 'Get Direct RAG Conversation History');
  assert.ok(!outputs('If Existing Onboarding Session').includes('Build Canonical Dietavity Knowledge'));
  assert.deepEqual(outputs('Interpret Sales Obligations'), ['Parse Direct RAG Obligations']);
  assert.deepEqual(workflow.connections['Sales Obligations Model'].ai_languageModel, [[{ node: 'Interpret Sales Obligations', type: 'ai_languageModel', index: 0 }]]);
  assert.equal(workflow.connections['Interpret Sales Obligations'].ai_languageModel, undefined);
  assert.deepEqual(outputs('Parse Direct RAG Obligations'), ['Resolve Direct RAG Obligations']);
  assert.deepEqual(outputs('Build Direct RAG Composition Envelope'), ['Compose Grounded Sales Response']);
  assert.deepEqual(workflow.connections['Grounded Sales Response Model'].ai_languageModel, [[{ node: 'Compose Grounded Sales Response', type: 'ai_languageModel', index: 0 }]]);
  assert.equal(workflow.connections['Compose Grounded Sales Response'].ai_languageModel, undefined);
  assert.deepEqual(outputs('Final Direct RAG Customer Response Gate'), ['Build Sales Response Persistence Envelope']);
  assert.deepEqual(outputs('Validate Sales Response Contract'), ['Build Sales Response Persistence Envelope']);
  assert.deepEqual(outputs('Build Sales Response Persistence Envelope'), ['Reserve Sales Reply']);
  assert.match(workflow.nodes.find(node => node.name === 'Persist Sales Response State and Events').parameters.options.queryReplacement, /Build Sales Response Persistence Envelope/);
  assert.doesNotMatch(workflow.nodes.find(node => node.name === 'Persist Sales Response State and Events').parameters.options.queryReplacement, /Validate Sales Response Contract/);
  const route = workflow.connections['Route Direct RAG Authorized Action'].main;
  assert.deepEqual(route[0], []); assert.deepEqual(route[1], []);
  const reachable = start => {
    const seen = new Set([start]); const queue = [start];
    while (queue.length) for (const branch of Object.values(workflow.connections[queue.shift()] || {}).flat()) for (const edge of branch) if (!seen.has(edge.node)) { seen.add(edge.node); queue.push(edge.node); }
    return seen;
  };
  assert.equal(reachable('Resolve Direct RAG Obligations').has('Reserve Scheduled Reminder'), false);
  assert.equal(reachable('Resolve Direct RAG Obligations').has('Persist Checkout Authorization v3'), false);
  assert.ok(names.has('Persist Checkout Authorization v3'));
  assert.ok((workflow.connections['Route Authorized Sales Action']?.main || []).flat().some(edge => edge.node === 'Persist Checkout Authorization v3'));
  const gate = workflow.nodes.find(node => node.name === 'Final Direct RAG Customer Response Gate').parameters.jsCode;
  assert.match(gate, /obsolete_claims_rejected/); assert.match(gate, /allowed\.has\(canonical\(parsed\.response\)\)/); assert.doesNotMatch(gate, /used_claims\.every/);
  const history = workflow.nodes.find(node => node.name === 'Get Direct RAG Conversation History').parameters.query;
  assert.match(history, /message_kind IN \('sales_deterministic', 'sales_ai', 'checkout'\)/); assert.match(history, /provider_acceptance_evidence/); assert.doesNotMatch(history, /'scheduled'/);
  assert.match(history, /message\.processing_order < current_inbound\.processing_order/);
  assert.match(history, /replied_inbound\.id = message\.in_reply_to_id/);
  assert.match(history, /replied_inbound\.processing_order < current_inbound\.processing_order/);
  assert.doesNotMatch(workflow.nodes.find(node => node.name === 'Reserve Checkout Reply').parameters.options.queryReplacement, /Apply Deterministic Commercial Policy/);
  assert.ok([...names].every(name => !/ticket[ -]?75|shadow/i.test(name)));
  const resolver = workflow.nodes.find(node => node.name === 'Resolve Direct RAG Obligations').parameters.jsCode;
  assert.doesNotMatch(resolver, /validatedReminderTime|reminder_at|existing_reminder|schedule_requested_reminder/);
});
test('direct history query excludes later queued turns and replies to them', () => {
  const query = workflow.nodes.find(node => node.name === 'Get Direct RAG Conversation History').parameters.query;
  assert.match(query, /message\.direction = 'inbound'\s+AND message\.processing_order < current_inbound\.processing_order/);
  assert.match(query, /replied_inbound\.id = message\.in_reply_to_id/);
  assert.match(query, /replied_inbound\.processing_order < current_inbound\.processing_order/);
  assert.match(query, /message\.id <> current_inbound\.id/);
  assert.match(query, /ORDER BY message\.timestamp DESC, message\.id DESC\s+LIMIT 12/);
  assert.match(query, /COALESCE\(\s*jsonb_agg\(entry ORDER BY timestamp ASC, id ASC\),\s*'\[\]'::jsonb\s*\) AS history/);
  assert.match(query, /FROM eligible_history/);
});
test('dedicated no-side-effect harness runs controlled V2 fixtures', () => {
  const cases = [['¿En dónde están ubicados?', 'location'], ['¿Cuánto cuesta?', 'price'], ['¿Cómo arman el plan?', 'how_it_works'], ['¿Dan el medicamento GLP-1?', 'glp1_scope'], ['Tengo poco apetito, ¿qué puedo comer?', 'practical_guidance'], ['Recuérdame mañana.', 'reminder_request'], ['No gracias.', 'graceful_close']];
  for (const [message, type] of cases) { const output = harness.run({ message, obligations: [{ type, evidence: message }] }); assert.ok(output.gate_result.cleared); assert.equal(output.authorized_action, null); }
  const checkout = harness.run({ message: 'Mándame el enlace.', obligations: [{ type: 'purchase', evidence: 'Mándame el enlace', intent: 'explicit_current_request' }] }); assert.equal(checkout.authorized_action, null); assert.equal(checkout.checkout_suppressed_reason, 'glp1_live_pilot');
});
test('dedicated V2 harness covers all controlled conversations with material outcomes', () => {
  const cases = [
    ['¿En dónde están ubicados?', [['location']], /servicio digital/i, null],
    ['¿Cuánto cuesta?', [['price']], /149 MXN/, null],
    ['¿Cómo arman el plan?', [['how_it_works']], /personalización/i, null],
    ['¿Dan el medicamento GLP-1?', [['glp1_scope']], /no vende, entrega ni prescribe/i, null],
    ['¿Debo bajar mi dosis?', [['medical_boundary']], /profesional/i, null],
    ['Gracias', [['acknowledgement']], /con gusto/i, null],
    ['Mándame el enlace.', [['purchase', 'explicit_current_request']], /abriendo esta modalidad/i, null],
    ['Mándame el enlace. ¿Dan factura?', [['purchase', 'explicit_current_request'], ['unsupported']], /no tengo información confirmada/i, null],
    ['¿Ustedes mandan la comida?', [['prepared_food']], /no entrega comida preparada/i, null],
    ['¿Por qué pagaría si puedo usar ChatGPT?', [['ai_value']], /28 días/i, null],
    ['¿Hay un nutriólogo que haga mi plan?', [['trust_credentials']], /inteligencia artificial/i, null],
    ['Prefiero hablar con una persona.', [['human_preference']], /consulta individual/i, null],
    ['¿Me ayudan por WhatsApp?', [['portal_support']], /WhatsApp/i, null],
    ['¿Cuándo estará listo mi programa?', [['fulfillment']], /pago verificado/i, null],
    ['¿Me pueden ayudar todos los días?', [['support_limits']], /bajo demanda/i, null],
    ['Muéstrame un ejemplo.', [['example']], /ilustrativo/i, null],
    ['Tengo poco apetito, ¿qué puedo comer?', [['practical_guidance']], /yogurt|huevo|frijoles/i, null],
    ['Tengo poco apetito. ¿Debo bajar mi dosis?', [['practical_guidance'], ['medical_boundary']], /profesional/i, null],
    ['Recuérdame mañana.', [['reminder_request']], /no puedo programar recordatorios/i, null],
    ['Recuérdame la próxima semana.', [['reminder_request']], /no puedo programar recordatorios/i, null],
    ['En dos semanas recuérdame.', [['reminder_request']], /no puedo programar recordatorios/i, null],
    ['Recuérdame después.', [['reminder_request']], /no puedo programar recordatorios/i, null],
    ['No gracias.', [['graceful_close']], /Gracias/i, null],
    ['¿Cuánto cuesta y cómo funciona?', [['price'], ['how_it_works']], /149 MXN/, null],
    ['¿Y qué incluye?', [['offer_contents']], /desayuno, comida, cena y snack/i, null, [{ role: 'assistant', text: 'El programa de 28 días cuesta $149 MXN.' }]],
  ];
  for (const [message, definitions, claimPattern, action, history] of cases) {
    const obligations = definitions.map(([type, intent]) => ({ type, evidence: type === 'purchase' ? 'Mándame el enlace' : message, ...(intent ? { intent } : {}) }));
    const result = harness.run({ message, obligations, history });
    assert.deepEqual(result.validated_obligations.map(item => item.type), definitions.map(item => item[0]), message);
    assert.equal(result.authorized_action?.action || null, action, message);
    if (claimPattern) assert.match(result.permitted_claims.join(' '), claimPattern, message);
    if (message.startsWith('Recuérdame') || message.startsWith('En dos semanas')) {
      assert.equal(result.authorized_action, null, message);
      assert.equal(Object.hasOwn(result.composition_envelope, 'reminder_scheduled_for'), false, message);
      assert.doesNotMatch(result.final_customer_response, /\b(?:mañana|semana|fecha|hora)\b/i, message);
    }
    if (!action || claimPattern) assert.ok(result.gate_result.cleared || result.fallback_used, message);
  }
});
test('generated parser rejects retired reminder and purchase action fields', () => {
  const code = name => workflow.nodes.find(node => node.name === name).parameters.jsCode;
  const context = { current_message: 'Recuérdame mañana.', commercial_state: { purchase_context: false }, offer_version: 'glp1-whatsapp-free-test-v3' };
  const parse = vm.runInNewContext(`(function(){${code('Parse Direct RAG Obligations')}})()`, { $: () => ({ item: { json: context } }), $input: { first: () => ({ json: { output: JSON.stringify({ obligations: [{ type: 'reminder_request', evidence: 'Recuérdame mañana.', reminder_at: '2099-01-01T00:00:00Z' }] }) } }) } });
  assert.equal(parse[0].json.obligations[0].type, 'unsupported');
  const arbitraryIntent = vm.runInNewContext(`(function(){${code('Parse Direct RAG Obligations')}})()`, { $: () => ({ item: { json: context } }), $input: { first: () => ({ json: { output: JSON.stringify({ obligations: [{ type: 'purchase', evidence: 'Recuérdame mañana.', intent: 'model_says_checkout' }] }) } }) } });
  assert.equal(arbitraryIntent[0].json.obligations[0].type, 'unsupported');
});
test('generated parser isolates malformed sibling evidence and keeps purchase fail-closed', () => {
  const code = name => workflow.nodes.find(node => node.name === name).parameters.jsCode;
  const parse = (current_message, obligations) => vm.runInNewContext(`(function(){${code('Parse Direct RAG Obligations')}})()`, {
    $: () => ({ item: { json: { current_message, commercial_state: { purchase_context: false }, offer_version: 'glp1-whatsapp-free-test-v3' } } }),
    $input: { first: () => ({ json: { output: JSON.stringify({ obligations }) } }) },
  })[0].json;
  const message = 'Uso GLP-1, ¿cuánto cuesta y cómo me ayudaría si tengo poco apetito?';
  const malformedSibling = parse(message, [
    { type: 'price', evidence: '¿cuánto cuesta' },
    { type: 'food_decision', evidence: 'Uso GLP-1, ¿... cómo me ayudaría si tengo poco apetito?' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(malformedSibling.obligations)), [{ id: 'o-1', type: 'price', evidence: '¿cuánto cuesta' }]);
  const resolvedSibling = vm.runInNewContext(`(function(){${code('Resolve Direct RAG Obligations')}})()`, { $input: { first: () => ({ json: malformedSibling }) } })[0].json;
  assert.equal(resolvedSibling.authorized_action, null); assert.equal(resolvedSibling.checkout_authorized, false);
  const allMalformed = parse(message, [{ type: 'food_decision', evidence: '¿... poco apetito?' }]);
  assert.equal(allMalformed.obligations[0].type, 'unsupported');
  const validMixed = parse(message, [{ type: 'price', evidence: '¿cuánto cuesta' }, { type: 'food_decision', evidence: 'cómo me ayudaría si tengo poco apetito?' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(validMixed.obligations.map(value => value.type))), ['price', 'food_decision']);
  const malformedPurchase = parse('Quiero comprarlo.', [{ type: 'purchase_intent', evidence: 'Quiero ... comprarlo.' }]);
  assert.equal(malformedPurchase.obligations[0].type, 'unsupported');
  const resolvedPurchase = vm.runInNewContext(`(function(){${code('Resolve Direct RAG Obligations')}})()`, { $input: { first: () => ({ json: malformedPurchase }) } })[0].json;
  assert.equal(resolvedPurchase.authorized_action, null); assert.equal(resolvedPurchase.checkout_authorized, false);
});
test('interpreter taxonomy, parser allowlist, and resolver contract stay in parity', () => {
  const v3 = require('../lib/sales-engine-v2/direct-rag-v3');
  const types = v3.INTERPRETER_OBLIGATION_TYPES;
  assert.ok(types.every(type => ['food_decision', 'food_context', 'recommendation_feedback'].includes(type) || Object.hasOwn(v3.FACTS, type)));
  for (const type of types) {
    assert.ok(['resolved', 'bounded_unknown'].includes(v3.OBLIGATION_TYPE_CONTRACT[type]), type);
  }
  assert.equal(v3.OBLIGATION_TYPE_CONTRACT.unsupported, 'bounded_unknown');
  const prompt = workflow.nodes.find(node => node.name === 'Interpret Sales Obligations').parameters.options.systemMessage;
  const listed = prompt.match(/Allowed type values: ([^.]+)\./)[1].split(', ');
  assert.deepEqual(listed, types);
});
test('generated parser and resolver retain general_information despite descriptive non-purchase intent', () => {
  const code = name => workflow.nodes.find(node => node.name === name).parameters.jsCode;
  const context = { current_message: '¡Hola! Quiero saber más.', commercial_state: { purchase_context: false }, offer_version: 'glp1-whatsapp-free-test-v3' };
  const parsed = vm.runInNewContext(`(function(){${code('Parse Direct RAG Obligations')}})()`, {
    $: () => ({ item: { json: context } }),
    $input: { first: () => ({ json: { output: JSON.stringify({ obligations: [{ type: 'general_information', evidence: '¡Hola! Quiero saber más.', intent: 'request_information' }] }) } }) },
  })[0].json;
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.obligations)), [{ id: 'o-1', type: 'general_information', evidence: '¡Hola! Quiero saber más.' }]);
  const resolved = vm.runInNewContext(`(function(){${code('Resolve Direct RAG Obligations')}})()`, { $input: { first: () => ({ json: parsed }) } })[0].json;
  assert.equal(resolved.resolved_obligations[0].resolution, 'resolved');
  assert.match(resolved.permitted_claims.join(' '), /asistente de alimentación por WhatsApp/i);
});
test('generated history aggregate contract always supplies one explicit bounded history array to context', () => {
  const code = workflow.nodes.find(node => node.name === 'Build Direct RAG Conversation Context').parameters.jsCode;
  const current = { id: 'current', session_id: 's', body: '¿Y qué incluye?', processing_order: 20 };
  const run = history => vm.runInNewContext(`(function(){${code}})()`, {
    Date, $input: { first: () => ({ json: { history } }) },
    $: name => ({ item: { json: name === 'Claim Next Session Inbound' ? current : name === 'Get Onboarding Session' ? {} : name === 'Get User from Supabase' ? { is_active: false } : {} } }),
  })[0].json;
  const firstContact = run([]);
  assert.equal(firstContact.current_message, current.body);
  assert.deepEqual(firstContact.history, []);
  const exchange = [
    { direction: 'inbound', body: '¿Cuánto cuesta?', timestamp: '2026-01-01T00:00:00.000Z' },
    { direction: 'outbound', body: 'El programa cuesta $149 MXN.', timestamp: '2026-01-01T00:01:00.000Z' },
  ];
  const withExchange = run(exchange);
  assert.deepEqual(withExchange.history.map(item => item.text), exchange.map(item => item.body));
  assert.equal(withExchange.most_recent_assistant_message, exchange[1].body);
  const bounded = run(Array.from({ length: 13 }, (_, index) => ({ direction: 'inbound', body: `mensaje ${index + 1}` })));
  assert.equal(bounded.history.length, 12);
  assert.equal(bounded.history[0].text, 'mensaje 2');
});
test('generated V3.1 resolver uses the immediate availability question only after explicit food semantics', () => {
  const code = workflow.nodes.find(node => node.name === 'Resolve Direct RAG Obligations').parameters.jsCode;
  const resolve = (current_message, most_recent_assistant_message = '', history = []) => vm.runInNewContext(`(function(){${code}})()`, {
    $input: { first: () => ({ json: {
      current_message, most_recent_assistant_message, history,
      commercial_state: { purchase_context: false }, offer_version: 'glp1-whatsapp-free-test-v3',
      obligations: [{ id: 'o-1', type: 'food_context', evidence: current_message }],
    } }) },
  })[0].json;
  const question = '¿Qué alimentos tienes disponibles ahora?';
  const answered = resolve('Huevos pollo pechuga vegetales arroz', question);
  assert.deepEqual(JSON.parse(JSON.stringify(answered.resolved_obligations[0].food_context.available_foods)), ['huevos', 'pollo', 'pechuga', 'verduras', 'arroz']);
  assert.equal(answered.conversation_policy.food_clarification_authorized, false);
  assert.doesNotMatch(answered.permitted_claims.join(' '), /¿Qué alimentos tienes disponibles ahora\?/u);

  const breakfast = resolve('2 huevos con tocino, aguacate, y un café sin azúcar de desayuno', question);
  assert.deepEqual(JSON.parse(JSON.stringify(breakfast.resolved_obligations[0].food_context.recently_consumed)), ['huevos', 'aguacate', 'tocino', 'cafe']);
  assert.deepEqual(JSON.parse(JSON.stringify(breakfast.resolved_obligations[0].food_context.available_foods)), []);

  const noContext = resolve('Huevos pollo pechuga vegetales arroz');
  assert.deepEqual(JSON.parse(JSON.stringify(noContext.resolved_obligations[0].food_context.available_foods)), []);
});
test('generated resolver, envelope, and gate execute with deterministic VM fixtures', () => {
  const code = name => workflow.nodes.find(node => node.name === name).parameters.jsCode;
  const input = { current_message: '¿Cuánto cuesta?', commercial_state: { purchase_context: false }, offer_version: 'glp1-whatsapp-free-test-v3', obligations: [{ id: 'o-1', type: 'price', evidence: 'Cuánto cuesta' }] };
  const resolved = vm.runInNewContext(`(function(){${code('Resolve Direct RAG Obligations')}})()`, { $input: { first: () => ({ json: input }) } })[0].json;
  assert.equal(resolved.checkout_authorized, false); assert.match(resolved.permitted_claims.join(' '), /gratis/i);
  const enveloped = vm.runInNewContext(`(function(){${code('Build Direct RAG Composition Envelope')}})()`, { $input: { first: () => ({ json: resolved }) } })[0].json;
  const candidate = { output: JSON.stringify({ response: resolved.permitted_claims.join(' '), covered_obligation_ids: ['o-1'], used_claims: [] }) };
  const gated = vm.runInNewContext(`(function(){${code('Final Direct RAG Customer Response Gate')}})()`, { $input: { first: () => ({ json: candidate }) }, $: name => ({ item: { json: name === 'Build Direct RAG Composition Envelope' ? enveloped : {} } }) })[0].json;
  assert.equal(gated.final_gate.cleared, true); assert.equal(gated.output, resolved.permitted_claims.join(' '));
  const pilotInput = { current_message: 'Mándame el enlace.', commercial_state: { purchase_context: false }, offer_version: 'glp1-whatsapp-free-test-v3', obligations: [{ id: 'o-1', type: 'purchase_intent', evidence: 'Mándame el enlace' }] };
  const pilotResolved = vm.runInNewContext(`(function(){${code('Resolve Direct RAG Obligations')}})()`, { $input: { first: () => ({ json: pilotInput }) } })[0].json;
  assert.equal(pilotResolved.authorized_action, null); assert.equal(pilotResolved.checkout_authorized, false); assert.equal(pilotResolved.checkout_suppressed_reason, 'proposition_test_no_checkout');
  assert.match(pilotResolved.permitted_claims.join(' '), /prueba gratuita/i);
});
test('generated shared persistence envelope makes the Direct RAG delivery tail independent of legacy validation', () => {
  const code = workflow.nodes.find(node => node.name === 'Build Sales Response Persistence Envelope').parameters.jsCode;
  const run = value => vm.runInNewContext(`(function(){${code}})()`, {
    $input: { first: () => ({ json: value }) },
    $: () => ({ item: { json: { session_id: 'session-1', provider_message_sid: 'SM0123456789abcdef0123456789abcdef' } } }),
  })[0].json;
  const direct = run({ output: 'Respuesta final.', pending_action: 'respond', buyer_signal: 'obligation_resolution', strategy: 'direct_rag_response', events: [] });
  assert.equal(direct.session_id, 'session-1'); assert.equal(direct.pending_action, 'respond'); assert.deepEqual(direct.events, []);
  const retained = run({ session_id: 'legacy-session', inbound_message_sid: 'SMlegacy', pending_action: 'close', strategy: 'graceful_close', events: ['rejection'] });
  assert.equal(retained.session_id, 'legacy-session'); assert.equal(retained.pending_action, 'close'); assert.deepEqual(retained.events, ['rejection']);
  const next = name => (workflow.connections[name]?.main || []).flat().map(edge => edge.node);
  assert.deepEqual(next('Reserve Sales Reply'), ['Respond to Chat']);
  assert.deepEqual(next('Respond to Chat'), ['Update Sales Reply Delivery']);
  assert.deepEqual(next('Update Sales Reply Delivery'), ['Assert Sales Reply Accepted']);
  assert.deepEqual(next('Assert Sales Reply Accepted'), ['Persist Sales Response State and Events']);
  assert.deepEqual(next('Persist Sales Response State and Events'), ['Mark Session Inbound Complete']);
});
test('generated final gate rejects adversarial actual prose despite falsified used_claims', () => {
  const code = workflow.nodes.find(node => node.name === 'Final Direct RAG Customer Response Gate').parameters.jsCode;
  const base = envelope('¿Cuánto cuesta y cómo funciona?', [{ type: 'price', evidence: 'Cuánto cuesta' }, { type: 'how_it_works', evidence: 'cómo funciona' }]);
  const runGate = candidate => vm.runInNewContext(`(function(){${code}})()`, {
    $input: { first: () => ({ json: { output: JSON.stringify(candidate) } }) },
    $: () => ({ item: { json: base } }),
  })[0].json;
  const attacks = [
    'Tenemos una sucursal en Polanco.', 'Incluye consultas médicas semanales.', 'Un nutriólogo humano hará tu plan.',
    'Garantizamos bajar 10 kg.', 'Baja tu dosis a 2 mg.', 'Cuesta $999 MXN.', '¿Quieres comprar?',
    'Aceptamos transferencia bancaria.',
  ];
  for (const response of attacks) {
    const result = runGate({ response, covered_obligation_ids: ['o-1', 'o-2'], used_claims: [] });
    assert.equal(result.final_gate.fallback_used, true, response);
    assert.notEqual(result.output, response, response);
  }
  const omitted = runGate({ response: base.permitted_claims.join(' '), covered_obligation_ids: ['o-1'], used_claims: base.permitted_claims });
  assert.equal(omitted.final_gate.fallback_used, true);
});

test('V3.2B Patch 1 generated parser validates semantic context separately from response obligations', () => {
  const node = name => workflow.nodes.find(value => value.name === name);
  const prompt = node('Interpret Sales Obligations').parameters.options.systemMessage;
  assert.match(prompt, /nutrition_support_request/);
  assert.match(prompt, /semantic context, not response obligations/i);
  const parser = node('Parse Direct RAG Obligations').parameters.jsCode;
  const parse = (current_message, output, history = []) => vm.runInNewContext(`(function(){${parser}})()`, {
    $: () => ({ item: { json: { current_message, history, commercial_state: { purchase_context: false }, offer_version: 'glp1-whatsapp-free-test-v3' } } }),
    $input: { first: () => ({ json: { output: JSON.stringify(output) } }) },
  })[0].json;
  const prepared = parse('Me preparé un arroz chino con pollo y verduras', { obligations: [{ type: 'acknowledgement', evidence: 'Me preparé' }], semantic_context: { recommendation_request_evidence: null } });
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.semantic_context.food_context.available_foods)), []);
  assert.equal(prepared.semantic_context.food_context.recent_food_events[0].kind, 'prepared');
  const negated = parse('No tengo pollo, pero comí pollo ayer', { obligations: [{ type: 'acknowledgement', evidence: 'comí pollo' }], semantic_context: { recommendation_request_evidence: null } });
  assert.deepEqual(JSON.parse(JSON.stringify(negated.semantic_context.food_context.available_foods)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(negated.semantic_context.food_context.recently_consumed)), ['pollo']);
  const request = parse('Tengo pechuga y verduras. ¿Qué me puedo hacer?', { obligations: [{ type: 'food_decision', evidence: '¿Qué me puedo hacer?' }], semantic_context: { recommendation_request_evidence: '¿Qué me puedo hacer?' } });
  assert.equal(request.semantic_context.recommendation_request.current_food_decision, true);
  const support = parse('Me pueden ayudar', { obligations: [{ type: 'nutrition_support_request', evidence: 'Me pueden ayudar' }], semantic_context: { recommendation_request_evidence: null } }, [{ role: 'customer', text: 'Me están inyectando Mounjaro' }]);
  assert.equal(support.obligations[0].type, 'nutrition_support_request');
  assert.deepEqual(JSON.parse(JSON.stringify(support.semantic_context.glp1_context)), { mentioned: true, usage_reported: true, source: 'history' });
  const professionalMention = parse('Mi nutrióloga no tiene idea qué es Mounjaro', { obligations: [{ type: 'acknowledgement', evidence: 'Mi nutrióloga' }], semantic_context: { recommendation_request_evidence: null } });
  assert.deepEqual(JSON.parse(JSON.stringify(professionalMention.semantic_context.glp1_context)), { mentioned: true, usage_reported: false, source: null });
  assert.equal(professionalMention.semantic_context.professional_support_context.dissatisfaction_reported, true);
  for (const message of ['¿Qué puedo comer para la cena?', 'Quiero preparar pollo para la comida', 'Nunca comí pollo', 'No cené pollo']) {
    const result = parse(message, { obligations: [{ type: 'acknowledgement', evidence: message }], semantic_context: { recommendation_request_evidence: null } });
    assert.deepEqual(JSON.parse(JSON.stringify(result.semantic_context.food_context.recent_food_events)), [], message);
  }
  const positive = parse('Cené pollo y tengo verduras', { obligations: [{ type: 'food_decision', evidence: 'Cené pollo' }], semantic_context: { recommendation_request_evidence: null } });
  assert.deepEqual(JSON.parse(JSON.stringify(positive.semantic_context.food_context.recently_consumed)), ['pollo']);
  assert.deepEqual(JSON.parse(JSON.stringify(positive.semantic_context.food_context.available_foods)), ['verduras']);
  for (const [message, available, consumed, eventFoods] of [
    ['Tengo pollo y verduras', ['pollo', 'verduras'], [], []],
    ['Tengo pollo y no verduras', ['pollo'], [], []],
    ['Tengo pollo, pero no verduras', ['pollo'], [], []],
    ['No tengo pollo, pero tengo verduras', ['verduras'], [], []],
    ['No tengo pollo ni verduras', [], [], []],
    ['Comí pollo y verduras', [], ['pollo', 'verduras'], ['pollo', 'verduras']],
    ['Comí pollo y no verduras', [], ['pollo'], ['pollo']],
    ['Comí pollo, pero no verduras', [], ['pollo'], ['pollo']],
    ['No comí pollo, pero comí verduras', [], ['verduras'], ['verduras']],
    ['Nunca comí pollo', [], [], []],
    ['Jamás comí pollo', [], [], []],
    ['Me preparé arroz con pollo', [], [], ['pollo', 'arroz']],
    ['Me preparé arroz y no pollo', [], [], ['arroz']],
  ]) {
    const result = parse(message, { obligations: [{ type: 'acknowledgement', evidence: message }], semantic_context: { recommendation_request_evidence: null } });
    assert.deepEqual(JSON.parse(JSON.stringify(result.semantic_context.food_context.available_foods)), available, message);
    assert.deepEqual(JSON.parse(JSON.stringify(result.semantic_context.food_context.recently_consumed)), consumed, message);
    assert.deepEqual(JSON.parse(JSON.stringify(result.semantic_context.food_context.recent_food_events.map(event => event.foods))), eventFoods.length ? [eventFoods] : [], message);
  }
  for (const message of ['¿Cené pollo ayer?', '¿Comí pollo ayer?', '¿Me preparé pollo ayer?']) {
    const result = parse(message, { obligations: [{ type: 'acknowledgement', evidence: message }], semantic_context: { recommendation_request_evidence: null } });
    assert.deepEqual(JSON.parse(JSON.stringify(result.semantic_context.food_context.recent_food_events)), [], message);
  }
  const inventoryQuestion = parse('¿Tengo pollo?', { obligations: [{ type: 'acknowledgement', evidence: '¿Tengo pollo?' }], semantic_context: { recommendation_request_evidence: null } });
  assert.deepEqual(JSON.parse(JSON.stringify(inventoryQuestion.semantic_context.food_context.available_foods)), []);
  const mixedQuestion = parse('Comí pollo. ¿Qué puedo comer ahora?', { obligations: [{ type: 'food_decision', evidence: '¿Qué puedo comer ahora?' }], semantic_context: { recommendation_request_evidence: '¿Qué puedo comer ahora?' } });
  assert.deepEqual(JSON.parse(JSON.stringify(mixedQuestion.semantic_context.food_context.recently_consumed)), ['pollo']);
  const separated = parse('No cené pollo, pero comí huevos y tengo verduras', { obligations: [{ type: 'acknowledgement', evidence: 'No cené pollo' }], semantic_context: { recommendation_request_evidence: null } });
  assert.deepEqual(JSON.parse(JSON.stringify(separated.semantic_context.food_context.recently_consumed)), ['huevos']);
  assert.deepEqual(JSON.parse(JSON.stringify(separated.semantic_context.food_context.available_foods)), ['verduras']);
  const legacyContextObligation = parse('Comí pollo', { obligations: [{ type: 'food_context', evidence: 'Comí pollo' }], semantic_context: { recommendation_request_evidence: null } });
  assert.equal(legacyContextObligation.obligations[0].type, 'unsupported');
  const malformed = parse('¿Qué puedo comer?', { obligations: [{ type: 'food_decision', evidence: '¿Qué puedo comer?' }], semantic_context: { recommendation_request_evidence: 'inventado' } });
  assert.equal(malformed.obligations[0].type, 'unsupported');
});

test('V3.2B generated parser reconciles a weak support classification across the canonical two-turn history boundary', () => {
  const node = name => workflow.nodes.find(value => value.name === name);
  const contextCode = node('Build Direct RAG Conversation Context').parameters.jsCode;
  const parserCode = node('Parse Direct RAG Obligations').parameters.jsCode;
  const resolverCode = node('Resolve Direct RAG Obligations').parameters.jsCode;
  const buildContext = (current_message, history) => vm.runInNewContext(`(function(){${contextCode}})()`, {
    $input: { first: () => ({ json: { history } }) },
    $: name => ({ item: { json: name === 'Claim Next Session Inbound' ? { id: 'inbound-2', session_id: 'production-boundary', provider_message_sid: 'SM00000000000000000000000000000000', body: current_message } : name === 'Get Onboarding Session' ? {} : name === 'Get User from Supabase' ? { is_active: false } : {} } }),
  })[0].json;
  const parse = (context, obligations) => vm.runInNewContext(`(function(){${parserCode}})()`, {
    $: () => ({ item: { json: context } }),
    $input: { first: () => ({ json: { output: JSON.stringify({ obligations, semantic_context: { recommendation_request_evidence: null } }) } }) },
  })[0].json;
  const resolve = parsed => vm.runInNewContext(`(function(){${resolverCode}})()`, { $input: { first: () => ({ json: parsed }) } })[0].json;
  const canonicalHistory = [
    { direction: 'inbound', body: 'Me están inyectando Mounjaro' },
    { direction: 'outbound', body: '¡Con gusto! 😊' },
  ];
  const context = buildContext('¿Me pueden ayudar?', canonicalHistory);
  assert.deepEqual(JSON.parse(JSON.stringify(context.semantic_context.glp1_context)), { mentioned: true, usage_reported: true, source: 'history' });
  const reconciled = parse(context, [{ type: 'general_information', evidence: '¿Me pueden ayudar?' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(reconciled.obligations)), [{ id: 'o-1', type: 'nutrition_support_request', evidence: '¿Me pueden ayudar?' }]);
  const resolved = resolve(reconciled);
  assert.match(resolved.permitted_claims.join(' '), /mientras usas GLP-1/i);
  assert.doesNotMatch(resolved.permitted_claims.join(' '), /Dietavity es un asistente de alimentación/u);
  assert.equal(resolved.conversation_policy.food_clarification_authorized, false);

  for (const priorInbound of ['No uso Mounjaro', '¿Qué es Mounjaro?', 'Mi hermana usa Mounjaro']) {
    const noUsageContext = buildContext('¿Me pueden ayudar?', [{ direction: 'inbound', body: priorInbound }, { direction: 'outbound', body: '¡Con gusto! 😊' }]);
    const retained = parse(noUsageContext, [{ type: 'general_information', evidence: '¿Me pueden ayudar?' }]);
    assert.equal(retained.semantic_context.glp1_context.usage_reported, false, priorInbound);
    assert.equal(retained.obligations[0].type, 'general_information', priorInbound);
  }

  const medicalContext = buildContext('¿Me puedes ayudar a bajar mi dosis?', canonicalHistory);
  const medical = parse(medicalContext, [{ type: 'medical_boundary', evidence: 'bajar mi dosis' }]);
  assert.equal(medical.obligations[0].type, 'medical_boundary');
  assert.match(resolve(medical).permitted_claims.join(' '), /Consulta al profesional/u);
  const foodContext = buildContext('¿Me ayudas a decidir qué comer?', canonicalHistory);
  const food = parse(foodContext, [{ type: 'food_decision', evidence: 'decidir qué comer' }]);
  assert.equal(food.obligations[0].type, 'food_decision');
});

test('V3.2B Patch 2 generated resolver consumes semantic context and limits inventory clarification', () => {
  const node = name => workflow.nodes.find(value => value.name === name);
  const parser = node('Parse Direct RAG Obligations').parameters.jsCode;
  const resolver = node('Resolve Direct RAG Obligations').parameters.jsCode;
  const resolve = (current_message, obligations, history = []) => {
    const context = { current_message, history, most_recent_assistant_message: history.at(-1)?.role === 'assistant' ? history.at(-1).text : '', commercial_state: { purchase_context: false }, offer_version: 'glp1-whatsapp-free-test-v3' };
    const parsed = vm.runInNewContext(`(function(){${parser}})()`, {
      $: () => ({ item: { json: context } }), $input: { first: () => ({ json: { output: JSON.stringify({ obligations, semantic_context: { recommendation_request_evidence: null } }) } }) },
    })[0].json;
    return vm.runInNewContext(`(function(){${resolver}})()`, { $input: { first: () => ({ json: parsed }) } })[0].json;
  };
  const support = resolve('¿Me pueden ayudar?', [{ type: 'nutrition_support_request', evidence: '¿Me pueden ayudar?' }], [{ role: 'customer', text: 'Me están inyectando Mounjaro' }]);
  assert.match(support.permitted_claims.join(' '), /mientras usas GLP-1/i);
  assert.equal(support.conversation_policy.food_clarification_authorized, false);
  const appetite = resolve('Me da mucha hambre por momentos y cuando como, como poco.', [{ type: 'unsupported', evidence: 'Me da mucha hambre por momentos y cuando como, como poco.' }]);
  assert.match(appetite.permitted_claims.join(' '), /mucha hambre/i);
  assert.equal(appetite.conversation_policy.food_clarification_authorized, false);
  const decision = resolve('¿Qué puedo comer ahora?', [{ type: 'food_decision', evidence: '¿Qué puedo comer ahora?' }]);
  assert.equal(decision.conversation_policy.food_clarification_authorized, true);
  assert.match(decision.permitted_claims.join(' '), /¿Qué alimentos tienes disponibles ahora\?/u);
});
