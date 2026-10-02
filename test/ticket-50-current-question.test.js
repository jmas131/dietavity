'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const workflow = require(process.env.DIETAVITY_TICKET50_ARTIFACT || '../n8n/Dietavity Sales Engine (Ticket 10).json');
const {explicitProductQuestions, productAnswerCoverage} = require('../lib/sales-response-contract');
const {decideSalesTurn, hasDeterministicExplicitPurchase} = require('../lib/sales-engine-v3');
const {MULTI_TOPIC_ANSWERS} = require('../lib/dietavity-knowledge');
const {createRuntime, judgeFixture} = require('../test-support/ticket-48/runner');
const json = x => JSON.parse(JSON.stringify(x));
const current = () => ({last_question_type:'purchase_confirmation',last_question_at:new Date().toISOString(),
  commercial_context_expires_at:'2099-01-01',offer_version:'28d-149-v1'});
function turn(message, session = {}, interpretation = {}, source = workflow) {
  const records = {'Set Session Id':{chatInput:message,session_id:'ticket50:test'},
    'If Existing Onboarding Session':{session_id:'ticket50:test'},'Get Onboarding Session':session,
    'Parse Sales Interpretation':{interpretation_valid:true,buyer_signal:'question',topic:'payment_methods',...interpretation}};
  const run = (name, input = {}) => vm.runInNewContext(`(function(){${source.nodes.find(n=>n.name===name).parameters.jsCode}})()`,
    {$:name=>({item:{json:records[name]||{}}}),$input:{first:()=>({json:input})}})[0].json;
  const decision = run('Apply Deterministic Commercial Policy',{recent_sales_assistant_message:session.recent_sales_assistant_message});
  records['Apply Deterministic Commercial Policy']=decision;
  const validated = run('Validate Sales Response Contract',{output:'Sí, emitimos CFDI. Mándanos tu RFC y razón social; llega en 24 horas. Aceptamos tarjeta. ¿Quieres el enlace?'});
  return {decision, validated};
}
const previews = ['¿Puedo ver un ejemplo?', '¿Tienen algún menú de muestra?', '¿Me enseñas cómo sería un día?',
  'Quiero ver más o menos qué comidas ponen.', '¿Hay alguna muestra del plan antes de pagar?',
  '¿Dónde puedo ver un ejemplo del menú?', '¿me enseñas un día de ejemplo?', '¿tienen algún menú para ver antes?'];
for (const message of previews) test(`Ticket 50 canonical illustrative sample: ${message}`, () => {
  assert.deepEqual(explicitProductQuestions(message), ['sample_plan']);
  const {decision, validated} = turn(message);
  assert.equal(decision.pending_action,'respond');
  assert.match(validated.output,/ejemplo ilustrativo/);
  assert.match(validated.output,/desayuno.*comida.*cena.*snack/);
  assert.match(validated.output,/No es un plan personalizado/);
  assert.match(validated.output,/después de completar tu compra y personalización/);
  assert.doesNotMatch(validated.output,/CFDI|RFC|https?:|\.pdf|otra función|\?/);
});
test('Ticket 50 sample recognition excludes unrelated examples and personal statements',()=>{
  for(const message of ['Por ejemplo, ¿aceptan OXXO?', '¿Puedo ver un ejemplo de factura?',
    '¿Me das un ejemplo de cómo funciona el reembolso?', 'Por ejemplo, ¿qué comidas incluye?',
    '¿El plan permite, por ejemplo, evitar pollo?', 'Mi menú favorito es el de casa', 'Uso IA y tengo alergias'])
    assert.ok(!explicitProductQuestions(message).includes('sample_plan'),message);
});
test('Ticket 50 preview synonyms are recognized without treating discourse examples as preview requests',()=>{
  for(const message of ['¿Puedo ver una muestra?', 'Me muestras cómo es un día?', 'Quiero ver cómo se ve un día']) {
    assert.deepEqual(explicitProductQuestions(message),['sample_plan']);
    assert.match(turn(message).validated.output,/ejemplo ilustrativo/);
  }
});
for(const [message,topics] of [
  ['¿Puedo ver un ejemplo del plan/menú antes de pagar? ¿Hay reembolso si no me funciona?', ['sample_plan','refund']],
  ['¿Puedo ver un ejemplo y hay reembolso?', ['sample_plan','refund']],
  ['¿Hay reembolso? ¿Puedo ver un ejemplo?', ['refund','sample_plan']],
  ['¿Me enseñas un día de ejemplo? ¿Hay prueba gratuita o garantía?', ['sample_plan','trial_promotion','guarantee']],
]) test(`Ticket 50 sample plus commercial uncertainty: ${message}`,()=>{
  const {validated} = turn(message);
  assert.deepEqual(json(validated.explicit_current_question_topics),topics);
  assert.equal(validated.explicit_current_questions_present,true);
  assert.equal(validated.multi_topic_turn,true);
  assert.deepEqual(json(validated.final_answer_coverage.missing_topics),[]);
  for(const topic of topics) assert.ok(validated.output.includes(MULTI_TOPIC_ANSWERS[topic]));
  assert.doesNotMatch(validated.output,/otra función|CFDI|RFC|https?:/);
});
const purchases = [
  ['Sí mándame el enlace de compra. ¿Qué métodos de pago aceptan?', 'payment_methods'],
  ['mándame el link y aceptan oxxo?', 'payment_methods'],
  ['mándame el enlace y aceptan oxxo', 'payment_methods'],
  ['quiero comprarlo dan factura', 'invoice'],
  ['va, lo pago. ¿dan factura?', 'invoice'],
  ['quiero comprarlo, ¿cuándo empiezo?', 'start_date'],
  ['sí lo quiero pero ¿cómo lo personalizan?', 'personalization'],
  ['Quiero pagar. ¿Qué pasa después de pagar?', 'after_payment'],
  ['Quiero comprarlo. ¿Cómo funciona?', 'how_it_works'],
  ['Mándame el enlace. ¿Puedo ver un ejemplo?', 'sample_plan'],
  ['Quiero comprarlo. ¿Se renueva automáticamente?', 'billing'],
];
for (const [message,topic] of purchases) test(`Ticket 50 current purchase and ${topic} coexist`,()=>{
  for(const source of [workflow,require('../n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json')]) {
    const {decision}=turn(message,{recent_sales_assistant_message:'Aceptamos tarjeta. ¿Quieres el enlace?'},{},source);
    assert.equal(decision.buyer_signal,'explicit_purchase');
    assert.equal(decision.pending_action,'send_checkout');
    assert.equal(decision.checkout_authorized,true);
    assert.equal(decision.checkout_authorization_type,'explicit');
    assert.equal(decision.material_question,true);
    assert.equal(decision.next_last_question_type,null);
    assert.equal(decision.allow_purchase_cta,false);
    assert.ok(decision.checkout_question_response.includes(MULTI_TOPIC_ANSWERS[topic]));
    assert.doesNotMatch(decision.checkout_question_response,/RFC|razón social|24 horas|https?:|\?/);
  }
});
test('Ticket 50 contextual object resolves only against active purchase confirmation; stale payment topic cannot erase invoice',()=>{
  const message='Sí, mándalo porfa. ¿Generan factura con el pago?';
  const {decision}=turn(message,current());
  assert.equal(decision.checkout_authorized,true);
  assert.deepEqual(explicitProductQuestions(message),['invoice']);
  assert.equal(decision.checkout_question_response,MULTI_TOPIC_ANSWERS.invoice);
  for(const session of [{},{...current(),last_question_type:'show_example'}, {...current(),commercial_context_expires_at:'2000-01-01'}]) {
    const {decision,validated}=turn(message,session);
    assert.equal(decision.checkout_authorized,false);
    assert.equal(validated.output,MULTI_TOPIC_ANSWERS.invoice);
  }
  assert.equal(turn('sí',current()).decision.checkout_authorized,true);
});
test('Ticket 50 weak, negated, conditional, medical and unresolved turns never gain purchase authorization',()=>{
  for(const message of ['ok','okay','perfecto','vale','listo','gracias','No lo quiero. ¿Dan factura?',
    'No quiero comprarlo. ¿Aceptan OXXO?', 'Lo quiero ver antes. ¿Dan factura?',
    'Lo pago si funciona. ¿Hay garantía?', 'Lo quiero pero no ahora. ¿Dan factura?',
    'Quiero comprarlo si me dan factura. ¿La generan?', 'Si dan factura, quiero comprarlo. ¿La generan?',
    'Mándame el enlace pero primero aclara el precio. ¿Cuánto cuesta?',
    'Quiero comprarlo. No puedo respirar.', 'Quiero comprarlo. ¿Debo bajar mi dosis?',
    'Quiero comprarlo, no entiendo el cobro. ¿Es un solo pago?']) {
    const {decision}=turn(message,current());
    assert.equal(decision.checkout_authorized,false,message);
  }
  assert.equal(turn('Mándame el enlace. ¿Aceptan OXXO?',{}, {needs_clarification:true}).decision.checkout_authorized,false);
  for(const message of ['No lo pago','Lo quiero ver','Lo quiero en español']) assert.equal(hasDeterministicExplicitPurchase(message),false);
});
test('Ticket 50 GLP-1 holding and material-question precedence are unchanged',()=>{
  const session={offer_context:'glp1_validation'};
  const direct=turn('Quiero comprarlo',session,{topic:null}).decision;
  assert.equal(direct.checkout_authorized,false);assert.equal(direct.holding_page_would_be_sent,true);
  const mixed=turn('Quiero comprarlo. ¿Aceptan OXXO?',session).decision;
  assert.equal(mixed.checkout_authorized,false);assert.equal(mixed.pending_action,'respond');
});
test('Ticket 50 invoice answer discards invented fiscal claims and records coverage without fake capabilities',()=>{
  const {validated}=turn('¿Generan factura con el pago?');
  assert.equal(validated.output,MULTI_TOPIC_ANSWERS.invoice);
  assert.deepEqual(json(validated.explicit_current_question_topics),['invoice']);
  assert.deepEqual(json(validated.final_answer_coverage.missing_topics),[]);
  assert.equal(productAnswerCoverage(['invoice'],'Sí, emitimos CFDI.').covered_count,0);
});
test('Ticket 50 production reply prepends canonical answer before existing ledger reservation',()=>{
  const reserve=workflow.nodes.find(n=>n.name==='Reserve Checkout Reply').parameters;
  const expression=reserve.options.queryReplacement;
  const decision=turn('Mándame el enlace. ¿Dan factura?').decision;
  // Evaluate the exact reservation payload, using a non-URL sentinel for the
  // already-composed Checkout message. No provider session is manufactured.
  const render = decision => JSON.parse(vm.runInNewContext(expression.slice(3,-2), {
    $:name=>({item:{json:name==='Resolve Direct RAG Obligations'?decision:{}}}),
    $json:{message:'CHECKOUT_BODY_SENTINEL'}, $execution:{id:'test'},
  })).body;
  assert.equal(render(decision),MULTI_TOPIC_ANSWERS.invoice+'\n\nCHECKOUT_BODY_SENTINEL');
  assert.equal(render({}),'CHECKOUT_BODY_SENTINEL');
  assert.equal(workflow.connections['Message with Stripe Payment URL'].main[0][0].node,'Reserve Checkout Reply');
  assert.match(reserve.query,/ON CONFLICT \(idempotency_key\)/);
});
function intercepted(message, removeAnswer=false) {
  const h=createRuntime();
  let s=h.initialize({target:'sales',scenario_ids:['context_switching_001'],max_customer_turns:4},'ticket50');
  s.scenario.starting_message=message;
  s=h.prepareCustomer(s);
  s=h.acceptCustomer(s,{output:JSON.stringify({customer_message:message,outcome:'continue'})});
  s=h.prepareInterpretation(s);
  s=h.decide(s,{output:JSON.stringify({buyer_signal:'explicit_purchase',topic:'payment_methods',material_question:false})});
  assert.equal(s.needs_response,false);
  if(removeAnswer) delete s.decision.checkout_question_response;
  s=h.capture(s,null);
  assert.equal(s.termination_reason,removeAnswer?'sales_engine_failure':'purchase_intent');
  s=h.prepareJudge(s);
  return {h,s,payload:JSON.parse(s.model_input)};
}
test('Ticket 50 intercepted Checkout is visible to Judge without implying a Session, URL or payment',()=>{
  for(const message of ['Porfa mándame el enlace','Mándame el enlace. ¿Generan factura?']) {
    const {s,payload}=intercepted(message);
    const visible=payload.transcript[0];
    assert.deepEqual(visible.customer_visible_action,{type:'checkout_link',status:'intercepted',would_execute_in_production:true});
    assert.equal(visible.final_dietavity_response,message.includes('factura')?MULTI_TOPIC_ANSWERS.invoice:null);
    assert.deepEqual(Object.keys(visible).sort(),['customer_message','customer_visible_action','final_dietavity_response']);
    assert.doesNotMatch(JSON.stringify(visible),/https?:|cs_test|cs_live|pagado|RFC/);
    assert.match(s.model_system,/not customer-visible silence/);
    assert.match(s.model_system,/Evaluate every accompanying material question independently/);
    assert.equal(payload.scenario.scenario_id,'context_switching_001');
    assert.equal(payload.current_question_facts.invoice,MULTI_TOPIC_ANSWERS.invoice);
    assert.ok(s.turns[0].assertions.every(a=>a.status==='PASS'));
  }
});
test('Ticket 50 Judge contract preserves an unanswered accompanying question despite intercepted purchase',()=>{
  const {h,s,payload}=intercepted('Mándame el enlace. ¿Generan factura?',true);
  // Model-boundary fixture: verify evidence survives validation/reporting. This
  // is not a claim that a live Judge model was executed or agreed.
  const judged={...judgeFixture(payload),current_questions_answered:false,
    evidence:[{turn:1,observation:'La acción interceptada satisface el enlace; la pregunta de factura no tiene respuesta.'}]};
  const accepted=h.acceptJudge(s,{output:JSON.stringify(judged)});
  const finished=h.finish(accepted);
  const report=h.batchReport(finished).reports[0];
  assert.equal(report.judge.current_questions_answered,false);
  assert.ok(report.potential_defects.some(d=>d.finding==='current_questions_unanswered'));
});
