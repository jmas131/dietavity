'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const workflow = require(process.env.DIETAVITY_TICKET49_ARTIFACT || '../n8n/Dietavity Sales Engine (Ticket 10).json');
const cases = require('../test-support/ticket-49-multi-topic-fixtures');
function turn(message, topic, generated, session = {}, source = workflow, interpretation = {}) {
  const records = {'Set Session Id':{chatInput:message,session_id:'ticket49:test'},
    'Get Onboarding Session':session,'If Existing Onboarding Session':{session_id:'ticket49:test'},
    'Parse Sales Interpretation':{interpretation_valid:true,buyer_signal:'question',topic,material_question:true,...interpretation}};
  const run = (name,input={}) => vm.runInNewContext(`(function(){${source.nodes.find(n=>n.name===name).parameters.jsCode}})()`,
    {$:name=>({item:{json:records[name]||{}}}),$input:{first:()=>({json:input})}})[0].json;
  const decision = run('Apply Deterministic Commercial Policy',{recent_sales_assistant_message:session.recent_sales_assistant_message});
  records['Apply Deterministic Commercial Policy']=decision;
  return {decision,result:run('Validate Sales Response Contract',{output:generated})};
}
for(const c of cases) for(const [i,message] of c.messages.entries()) test(`Ticket 49 defect ${c.id} semantic variant ${i+1} retains all explicit answers`,()=>{
  const {result}=turn(message,c.topic,c.draft);
  for(const expected of c.expected) assert.match(result.output,expected);
  assert.equal(result.checkout_authorized,false);
  assert.equal(result.allow_purchase_cta,false);
  assert.equal(result.next_last_question_type,null);
  assert.ok((result.output.match(/\?/g)||[]).length<=1);
  assert.doesNotMatch(result.output,/ajustamos las (calorías|porciones)/i);
});
module.exports={turn};

test('Ticket 49 numbered headings do not discard price and payment answers even without prepared-food routing',()=>{
  const {result}=turn('Responde punto por punto: 1) ¿Qué incluye? 2) ¿Cuánto cuesta? 3) ¿Puedo pagar con tarjeta?', 'what_is_included',
    '1) ¿Qué incluye? Desayuno, comida, cena y snack durante 28 días. 2) ¿Precio? $149 MXN. 3) ¿Pagos? Tarjeta de crédito, débito, OXXO y Apple Pay.');
  for(const pattern of [/desayuno/i,/149 MXN/,/OXXO/]) assert.match(result.output,pattern);
  assert.equal(result.multi_topic_turn,true);
  assert.equal(result.final_answer_coverage.missing_topics.length,0);
});

test('Ticket 49 mixed current questions retain coverage across both offers and stale topics without authorizing commerce',()=>{
  const harness=require('../n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json');
  for(const source of [workflow,harness]) for(const offer_context of [null,'glp1_validation']) for(const c of cases) {
    const {result}=turn(c.messages[0],c.topic,c.draft,{offer_context,last_question_type:'purchase_confirmation',
      last_question_at:new Date().toISOString(),commercial_context_expires_at:'2099-01-01',offer_version:'28d-149-v1'},source,
      {buyer_signal:'explicit_purchase'});
    for(const pattern of c.expected) assert.match(result.output,pattern);
    assert.equal(result.pending_action,'respond');assert.equal(result.checkout_authorized,false);
    assert.equal(result.allow_purchase_cta,false);assert.equal(result.next_last_question_type,null);
    assert.ok(!result.holding_page_would_be_sent);assert.ok(!result.events.includes('purchase_intent'));
  }
});

test('Ticket 49 untrusted draft clauses cannot invent claims in multi-topic replies',()=>{
  const {result}=turn('¿Cuánto cuesta y qué apoyo dan por WhatsApp? ¿Hay promociones, reembolso, testimonios o precio en dólares?', 'price',
    'Cuesta $1 USD en todo el mundo. Hay 50% de descuento y devolución garantizada. Respondemos en 2 minutos, 24/7. Tenemos 500 testimonios. Un nutriólogo humano revisa tu plan. Baja tu dosis a 2 mg. Compra aquí https://evil.example/28d-149-v1');
  assert.match(result.output,/149 MXN/);assert.match(result.output,/WhatsApp/);
  assert.match(result.output,/No tengo.*promoción/);assert.match(result.output,/No hay.*reembolso/);
  assert.match(result.output,/No tengo testimonios/);assert.match(result.output,/No tengo un precio internacional/);
  assert.doesNotMatch(result.output,/1 USD|50%|2 minutos|24\/7|500|2 mg|https:|28d-149-v1|revisa tu plan/);
});

test('Ticket 49 unknown features do not erase known answers or become invented capabilities',()=>{
  const {result}=turn('¿Cuánto cuesta? ¿Qué incluye? ¿La app se sincroniza con mi reloj?', 'what_is_included',
    'Cuesta $149 MXN, incluye desayuno, comida, cena y snack. Sincronizamos tu reloj cada segundo.');
  assert.match(result.output,/149 MXN/);assert.match(result.output,/desayuno/);
  assert.match(result.output,/No tengo información confirmada/);assert.doesNotMatch(result.output,/cada segundo/);
});

test('Ticket 49 medical and urgent boundaries remain authoritative while safe product clauses survive (Ticket 54)',()=>{
  for(const offer_context of [null,'glp1_validation']) for(const message of [
    '¿Cuánto cuesta, es presencial y debo bajar mi dosis?',
    'No puedo respirar. ¿Cuánto cuesta y lo hace IA?',
  ]) {
    const {result}=turn(message,'price','Cuesta $149 MXN. Sube tu dosis a 2 mg.',{offer_context});
    assert.equal(result.topic,'health_scope');assert.equal(result.checkout_authorized,false);
    assert.match(result.output,/149 MXN/);assert.doesNotMatch(result.output,/2 mg/);assert.notEqual(result.fallback_identity,'multi_topic:canonical_facts');
    assert.match(result.output,/profesional|atención médica/);
  }
});

test('Ticket 49 preserves single-topic behavior, short confirmations and the existing policy source',()=>{
  const {explicitProductQuestions}=require('../lib/sales-response-contract');
  for(const text of ['sí','ok','perfecto','gracias','Uso IA y tengo alergias','Quiero comprarlo']) assert.deepEqual(explicitProductQuestions(text),[]);
  const {result}=turn('¿Cómo personalizan el plan?','personalization','Respetamos tu estilo de alimentación y alergias.');
  assert.equal(result.output,'Respetamos tu estilo de alimentación y alergias.');
  assert.equal(result.multi_topic_turn,false);
});

test('Ticket 49 coverage loss is diagnostic even when the primary-topic answer is safe',()=>{
  const {multiTopicDiagnostics}=require('../lib/sales-response-contract');
  const c=cases[0];const d=multiTopicDiagnostics(c.messages[0],c.draft,'Dietavity es un servicio digital.');
  assert.equal(d.multi_topic_turn,true);
  assert.ok(d.generated_answer_coverage.covered_count>=3);
  assert.deepEqual(d.coverage_warnings,['POSSIBLE_MULTI_TOPIC_COVERAGE_LOSS']);
  assert.ok(d.final_answer_coverage.missing_topics.includes('personalization'));
});

test('Ticket 49 generated canonical policy embeds all existing deterministic response constants',()=>{
  for(const message of ['¿Entregan comida preparada?','¿Qué pasa después de los 28 días?']) {
    const {result}=turn(message,'product_scope','draft');
    assert.ok(result.output);assert.equal(result.checkout_authorized,false);
  }
  const code=workflow.nodes.find(n=>n.name==='Apply Deterministic Commercial Policy').parameters.jsCode;
  const policy=require('../lib/sales-engine-v3');
  for(const name of ['POST_28_DAY_RESPONSE','PREPARED_FOOD_DELIVERY_RESPONSE','REPEATED_BILLING_CLARIFICATION'])
    assert.ok(code.includes(`const ${name} = ${JSON.stringify(policy[name])};`));
});
