'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const {explicitProductQuestions, multiTopicDiagnostics, hasExplicitCurrentReminderRequest} = require('../lib/sales-response-contract');
const {MULTI_TOPIC_ANSWERS} = require('../lib/dietavity-knowledge');
const {createRuntime} = require('../test-support/ticket-48/runner');
function turn(message, session = {}, interpretation = {}, source = workflow) {
  const records = {'Set Session Id':{chatInput:message,session_id:'ticket51:test'},
    'If Existing Onboarding Session':{session_id:'ticket51:test'},'Get Onboarding Session':session,
    'Parse Sales Interpretation':{interpretation_valid:true,buyer_signal:'deferred_interest',topic:'post_purchase',
      explicit_reminder_request:true,timing_iso:new Date(Date.now()+86400000).toISOString(),...interpretation}};
  const run = (name, input = {}) => vm.runInNewContext(`(function(){${source.nodes.find(n=>n.name===name).parameters.jsCode}})()`,
    {$:name=>({item:{json:records[name]||{}}}),$input:{first:()=>({json:input})}})[0].json;
  const decision = run('Apply Deterministic Commercial Policy');
  records['Apply Deterministic Commercial Policy']=decision;
  const final = run('Validate Sales Response Contract',{output:'Tu plan estará listo en unas horas, el mismo día. Te avisamos automáticamente. ¿Qué día quieres que te lo recuerde?'});
  return {decision,final};
}
const timing = ['¿Cuánto tarda en generarse mi plan?', '¿Después de pagar cuánto tarda?', '¿En cuántas horas está listo?',
 '¿Cuándo queda disponible en el portal?', '¿Cuándo puedo ver mi programa?', '¿Cuánto tarda después de pagar?',
 '¿Cuándo estará disponible?', '¿Cuándo puedo verlo en el portal?', '¿Cuánto tarda?', 'Cuánto tarda en generarse mi plan', '¿Cuándo se entrega mi programa?'];
const notification = ['¿Me avisan cuando esté listo?', '¿Cómo sé cuando ya quedó listo?', '¿Me llega algún aviso cuando esté disponible?',
 '¿Tienen soporte por WhatsApp que me avise cuando quede listo?'];
for (const [topic,messages] of [['fulfillment_timing',timing],['fulfillment_notification',notification]]) {
  for (const message of messages) test(`Ticket 51 ${topic}: ${message}`,()=>{
    assert.ok(explicitProductQuestions(message).includes(topic));
    for(const source of [workflow,require('../n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json')]) {
      const {decision,final}=turn(message,{last_question_type:'reminder_date',recent_sales_assistant_message:'¿Qué día quieres que te lo recuerde?'},{},source);
      assert.equal(decision.topic,topic);
      assert.equal(decision.pending_action,'respond');
      assert.equal(decision.checkout_authorized,false);
      assert.equal(decision.next_last_question_type,null);
      assert.equal(decision.reminder_scheduled_for,null);
      assert.ok(final.output.includes(MULTI_TOPIC_ANSWERS[topic]));
      assert.equal(final.final_answer_coverage.missing_topics.length,0);
      assert.doesNotMatch(final.output,/en unas horas|mismo día|en breve|poco después|renovación|recuerde|\?/i);
    }
  });
}
for (const message of ['Recuérdame mañana','¿Me puedes recordar el lunes?','Avísame el viernes para comprarlo','Recuérdame pagar el viernes']) test(`Ticket 51 genuine reminder ${message}`,()=>{
 assert.ok(hasExplicitCurrentReminderRequest(message));
 assert.equal(turn(message).decision.pending_action,'schedule_requested_reminder');
});
for(const message of ['No me recuerdes mañana','¿Cuánto tarda el soporte en responder?', '¿Cuánto tarda en cocinarse el pollo?', 'Mi programa favorito está listo']) test(`Ticket 51 negative ${message}`,()=>{
 assert.equal(hasExplicitCurrentReminderRequest(message),false);
 assert.ok(!explicitProductQuestions(message).some(t=>t.startsWith('fulfillment_')));
});
for(const message of ['¿Qué pasa después de los 28 días?', '¿Se renueva automáticamente?']) test(`Ticket 51 renewal ${message}`,()=>{
 const {final}=turn(message,{}, {buyer_signal:'question',explicit_reminder_request:false});
 assert.match(final.output,/renovación automática/);
});
const mixed = ['¿Puedo pagar con tarjeta o solo transferencia? ¿Cuánto tiempo tarda en generarse mi plan después del pago?',
 '¿Aceptan tarjeta y cuánto tarda en quedar listo?', '¿Puedo pagar en OXXO? ¿Cuándo aparece mi programa en el portal?',
 '¿Qué métodos de pago tienen y me avisan cuando esté listo?'];
for (const message of mixed) test(`Ticket 51 multi topic ${message}`,()=>{
 const {final}=turn(message);
 assert.deepEqual(Array.from(final.explicit_current_question_topics),['payment_methods',message.includes('avisan')?'fulfillment_notification':'fulfillment_timing']);
 assert.equal(final.final_answer_coverage.missing_topics.length,0);
 assert.equal(final.allow_purchase_cta,false);
 const d=multiTopicDiagnostics(message,final.output,MULTI_TOPIC_ANSWERS.payment_methods);
 assert.deepEqual(d.coverage_warnings,['POSSIBLE_MULTI_TOPIC_COVERAGE_LOSS']);
});
test('Ticket 51 Scenario G sequence retains current intent despite stale classifier and history',()=>{
 let session={last_question_type:'purchase_confirmation',commercial_context_expires_at:'2099-01-01',offer_version:'28d-149-v1'};
 for(const message of [mixed[0], '¿En cuántas horas suele estar listo el plan después del pago?',notification[3],notification[0]]) {
  const {decision,final}=turn(message,session);
  assert.equal(final.final_answer_coverage.missing_topics.length,0);
  assert.equal(decision.pending_action,'respond');
  assert.equal(decision.next_last_question_type,null);
  assert.equal(decision.reminder_scheduled_for,null);
  assert.doesNotMatch(final.output,/renovación|en unas horas|mismo día|recuerde/);
  session={...session,last_question_type:decision.next_last_question_type,recent_sales_assistant_message:final.output};
 }
});
test('Ticket 51 harness detects injected reminder state without current intent',()=>{
 const h=createRuntime();
 let s=h.initialize({target:'sales',scenario_ids:['context_switching_001'],max_customer_turns:12},'ticket51');
 s=h.prepareCustomer(s);
 s=h.acceptCustomer(s,{output:JSON.stringify({customer_message:s.scenario.starting_message,outcome:'continue'})});
 s=h.prepareInterpretation(s);
 s=h.decide(s,{output:JSON.stringify({buyer_signal:'question',topic:'price',interpretation_valid:true})});
 s.decision={...s.decision,strategy:'reminder',pending_action:'schedule_requested_reminder'};
 s.needs_response=false;
 s=h.capture(s,{});
 assert.ok(s.turns.at(-1).assertions.some(a=>a.name==='explicit_current_reminder_intent'&&a.status==='FAIL'));
});
for (const message of [...timing,...notification]) test(`Ticket 51 parser rejects stale reminder flag: ${message}`,()=>{
 const source=workflow.nodes.find(n=>n.name==='Parse Sales Interpretation').parameters.jsCode;
 const parsed=vm.runInNewContext(`(function(){${source}})()`,{
  $:()=>({item:{json:{chatInput:message}}}),
  $input:{first:()=>({json:{output:JSON.stringify({buyer_signal:'question',topic:'fulfillment_timing',explicit_reminder_request:true})}})}
 })[0].json;
 assert.equal(parsed.interpretation_valid,true);
 assert.equal(parsed.explicit_reminder_request,false);
});
test('Ticket 51 fulfillment supersedes stale commercial interpretations without authorizing actions',()=>{
 for(const buyer_signal of ['rejection','explicit_purchase','broad_information_request','ai_value_objection','deferred_interest']) {
  const {decision,final}=turn(timing[0],{}, {buyer_signal});
  assert.equal(decision.topic,'fulfillment_timing');
  assert.equal(decision.pending_action,'respond');
  assert.equal(decision.checkout_authorized,false);
  assert.ok(final.output.includes(MULTI_TOPIC_ANSWERS.fulfillment_timing));
 }
});
test('Ticket 51 retains safety, support, prepared food, explicit purchase and GLP1 holding precedence',()=>{
 const urgent=turn('No puedo respirar. ¿Cuánto tarda en generarse mi plan?',{}, {buyer_signal:'question'}).decision;
 assert.equal(urgent.deterministic_reason,'medication_safety');
 const support=turn('Ya pagué y no puedo entrar al portal. ¿Cuánto tarda?',{}, {buyer_signal:'support_issue'}).decision;
 assert.notEqual(support.deterministic_reason,'current_fulfillment_question');
 const food=turn('¿Me entregan comida preparada a domicilio? ¿Cuánto tarda?',{}, {buyer_signal:'question'}).decision;
 assert.equal(food.deterministic_reason,'prepared_food_delivery_clarification');
 const purchase=turn('Quiero comprarlo. ¿Cuánto tarda en generarse mi plan?',{}, {buyer_signal:'explicit_purchase'}).decision;
 assert.equal(purchase.checkout_authorized,true);
 assert.ok(purchase.checkout_question_response.includes(MULTI_TOPIC_ANSWERS.fulfillment_timing));
 const holding=turn('Quiero comprarlo. ¿Cuánto tarda en generarse mi plan?',{offer_context:'glp1_validation'}, {buyer_signal:'explicit_purchase'}).decision;
 assert.equal(holding.checkout_authorized,false);
});
test('Ticket 51 Scenario G executes canonical parser, policy, validator and harness memory across turns',async()=>{
 const {run}=require('../test-support/ticket-48/runner');
 const {scenarioGModel}=require('../test-support/ticket-51-scenario-g');
 const state=await run({target:'sales',scenario_ids:['context_switching_001'],max_customer_turns:12},scenarioGModel());
 assert.equal(state.reports.length,1);
 const report=state.reports[0];
 assert.equal(report.transcript.length,5);
 for(const turn of report.transcript.slice(1)) {
   assert.doesNotMatch(turn.final_dietavity_response,/renovación|en unas horas|recuerde|te avisaremos/);
 }
 const serialized=JSON.stringify(report);
 assert.ok(serialized.includes('fulfillment_timing'));
 assert.ok(serialized.includes('fulfillment_notification'));
 assert.ok(!serialized.includes('"status":"FAIL"'));
});
