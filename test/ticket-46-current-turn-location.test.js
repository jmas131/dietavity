'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const harness = require('../n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json');
const policy = require('../lib/sales-engine-v3');
const { BUSINESS_LOCATION_RESPONSE } = require('../lib/dietavity-knowledge');
const run = (name, records, input = {}, source = workflow) => vm.runInNewContext(
  `(function(){${source.nodes.find(n => n.name === name).parameters.jsCode}})()`,
  {$: name => ({item:{json:records[name] || {}}}), $input:{first:()=>({json:input})}},
)[0].json;
function turn(message, interpretation, generated, session = {}, source = workflow) {
  const records = {
    'Set Session Id':{chatInput:message,session_id:'ticket41a:+5215554111111'},
    'If Existing Onboarding Session':{session_id:'ticket41a:+5215554111111'},
    'Get Onboarding Session':session,
    'Parse Sales Interpretation':interpretation,
  };
  const decision = run('Apply Deterministic Commercial Policy',records,{recent_sales_assistant_message:session.recent_sales_assistant_message},source);
  records['Apply Deterministic Commercial Policy'] = decision;
  const result = run('Validate Sales Response Contract',records,{output:generated},source);
  return {decision,result,records};
}
const stale = {interpretation_valid:true,buyer_signal:'question',topic:'price',material_question:true};
const offTopic = 'Cuesta $149 MXN. Accedes al portal y puedes pagar con tarjeta, OXXO o Apple Pay. ¿Qué opción prefieres?';
function noPurchase(result) {
  assert.equal(result.strategy,'answer_question');
  assert.equal(result.topic,'business_location');
  assert.equal(result.buyer_signal,'question');
  assert.equal(result.checkout_authorized,false);
  assert.equal(result.allow_purchase_cta,false);
  assert.equal(result.next_last_question_type,null);
  assert.equal(result.pending_action,'respond');
  assert.ok(!result.events.includes('purchase_intent'));
  assert.ok(!result.holding_page_would_be_sent);
  assert.doesNotMatch(result.output,/149|OXXO|Apple Pay|tarjeta|conseguir|enlace|programa-glp1/);
}
test('Ticket 46 exact sequence reaches same-topic fallback in canonical and harness nodes', () => {
  for (const source of [workflow,harness]) for (const campaign of [true,false]) {
    let session = {conversation_stage:'new'};
    const inputs = [campaign ? '¡Hola! Quiero saber más.' : 'Hola', '¿Cuánto cuesta?', 'En donde están ubicados ?'];
    for (const [index,message] of inputs.entries()) {
      const {decision,result,records} = turn(message,index ? stale : {interpretation_valid:true,buyer_signal:'information_request'},offTopic,session,source);
      if (index === 2) {
        noPurchase(result);
        assert.equal(result.output,BUSINESS_LOCATION_RESPONSE);
        assert.equal(result.fallback_identity,'same_topic:business_location');
        const report = run('Return Chat Response',{
          ...records,'Validate Sales Response Contract':result,'Generate Sales Response v3':{output:offTopic},
        },{session_id:decision.session_id,harness_memory_updated:1},harness);
        assert.equal(report.user_message,message);
        assert.equal(report.interpretation.topic,'price');
        assert.equal(report.topic,'business_location');
        assert.equal(report.material_question,true);
        assert.equal(report.generated_response,offTopic);
        assert.equal(report.final_validated_response,BUSINESS_LOCATION_RESPONSE);
        assert.equal(report.fallback_identity,'same_topic:business_location');
        assert.equal(report.checkout_would_be_created,false);
        assert.equal(report.holding_page_would_be_sent,false);
        assert.equal(report.intercepted_action,null);
      }
      session = {...session,offer_context:result.offer_context,conversation_stage:result.conversation_stage,
        last_question_type:result.next_last_question_type,recent_sales_assistant_message:result.output};
    }
  }
});
test('Ticket 46 business semantics override stale classification and commercial state', () => {
  for (const message of ['¿Dónde están ubicados?','¿Dónde están?','¿Tienen consultorio?','¿Tienen sucursal?',
    '¿Dónde tienen sus oficinas?','¿Es presencial?','¿Todo es en línea?','¿Atienden físicamente?']) {
    for (const interpretation of [stale,{interpretation_valid:true,buyer_signal:'information_request',topic:null},
      {interpretation_valid:false},{interpretation_valid:true,buyer_signal:'explicit_purchase',topic:'payment_methods'},
      {interpretation_valid:true,buyer_signal:'broad_information_request',goal:'bajar de peso'}]) {
      for (const offer_context of [null,'glp1_validation']) {
        const {result} = turn(message,interpretation,offTopic,{offer_context,last_question_type:'purchase_confirmation',
          commercial_context_expires_at:'2099-01-01',offer_version:'28d-149-v1',conversation_stage:'offer'});
        noPurchase(result);
        assert.equal(result.output,BUSINESS_LOCATION_RESPONSE,message);
      }
    }
  }
});
test('Ticket 46 accurate natural answers survive while invalid and invented claims fall back', () => {
  for (const generated of ['Somos un servicio 100% digital; consultas el programa en el portal y recibes apoyo por WhatsApp.',
    'Todo es en línea 😊', 'No ofrecemos atención presencial. El servicio es digital.']) {
    assert.equal(turn('¿Es presencial?',stale,generated).result.output,generated);
  }
  for (const generated of ['', 'Perfecto',offTopic,'Somos digitales y tenemos consultorio en Avenida Uno.',
    'Somos digitales, disponibles en todo el mundo.', 'Somos un servicio digital. Estamos en Guadalajara.',
    'Somos digitales. No tenemos oficinas pero ofrecemos consulta presencial.',
    'Somos digitales y entregamos comida preparada.', 'Somos digitales. ¿Quieres bajar de peso?', 'Somos digitales. Código 28d-149-v1.']) {
    const {result} = turn('¿Es presencial?',stale,generated);
    assert.equal(result.output,BUSINESS_LOCATION_RESPONSE,generated);
    assert.equal(result.fallback_identity,'same_topic:business_location');
  }
});
test('Ticket 46 semantic classifier topic supports paraphrases and parser allows it', () => {
  const interpreted = run('Parse Sales Interpretation',{}, {output:JSON.stringify({buyer_signal:'question',topic:'business_location',material_question:true})});
  const {result} = turn('¿Se puede ir a verlos personalmente?',interpreted,'El servicio es digital.');
  noPurchase(result);
  assert.equal(result.output,'El servicio es digital.');
});
test('Ticket 46 mixed payment questions preserve both subjects without authorizing Checkout', () => {
  for (const message of ['¿Dónde están ubicados y cómo puedo pagar?','¿Tienen sucursal y aceptan OXXO?', '¿Es presencial y cuánto cuesta?']) {
    const {result} = turn(message,stale,offTopic);
    assert.match(result.output,/digital/);
    assert.match(result.output,/OXXO|149/);
    assert.equal(result.checkout_authorized,false);
    assert.ok(!result.events.includes('purchase_intent'));
  }
});
test('Ticket 46 contextual follow-ups and non-business locations retain interpretation', () => {
  for (const message of ['¿Y cómo funciona eso?','¿Dónde están mis recetas?','Estoy en línea','¿Dónde pago en OXXO?']) {
    assert.equal(policy.asksBusinessLocation(message),false,message);
  }
  const {result} = turn('¿Y cómo funciona eso?',{...stale,topic:'payment_methods'},'El pago se realiza en Checkout.',{
    recent_sales_assistant_message:'Puedes pagar con OXXO.',last_question_type:null,
  });
  assert.equal(result.topic,'payment_methods');
  assert.match(result.output,/OXXO/);
  const generator = workflow.nodes.find(n=>n.name==='Generate Sales Response v3');
  assert.equal(generator.parameters.text,"={{ $('Set Session Id').item.json.chatInput }}");
  assert.ok(workflow.connections['Postgres Chat Memory']);
});
test('Ticket 46 retains safety precedence over location output', () => {
  const {result} = turn('¿Es presencial?',stale,'Somos digitales. Baja tu dosis a 2 mg.',{offer_context:'glp1_validation'});
  assert.match(result.output,/profesional que te lo prescribió/);
});
