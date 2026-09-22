'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const policy = require('../lib/sales-engine-v3');
const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const harness = require('../n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json');
const run = (source, name, records, input = {}) => vm.runInNewContext(`(function(){${source.nodes.find(n=>n.name===name).parameters.jsCode}})()`, {
  $: name=>({item:{json:records[name] || {}}}), $input:{first:()=>({json:input})},
})[0].json;
function turn(source, message, session, interpretation, generated = 'Usa 2 mg. ¿Quieres comprar?') {
  const records = {'Set Session Id':{chatInput:message,session_id:'ticket41a:+5215554111111'},
    'Get Onboarding Session':session,'If Existing Onboarding Session':{session_id:'ticket41a:+5215554111111'},'Parse Sales Interpretation':interpretation};
  const decision = run(source,'Apply Deterministic Commercial Policy',records);
  records['Apply Deterministic Commercial Policy'] = decision;
  const result = run(source,'Validate Sales Response Contract',records,{output:generated});
  return {result,records,decision,generated};
}
const scope = ['Es con medicamento??','¿Incluye medicamento?','¿Necesito medicamento?','¿Hay que tomar medicamento?',
  '¿Ustedes dan el medicamento?','¿Venden medicamentos?','¿El programa incluye Ozempic?', '¿El programa requiere semaglutida?'];
const preferences = ['No no me interesa con medicamento','No quiero medicamentos','Busco algo sin medicamento',
  'Prefiero algo sin medicamentos','No quiero tomar nada','Quiero algo que no incluya medicamento'];
const clinical = ['¿Debo bajar mi dosis?','¿Cuánto debería usar?','¿Puedo dejar Ozempic?','¿Debería suspenderlo?',
  '¿Cada cuánto me lo pongo?','¿Puedo cambiar de medicamento?','¿Me recomiendas empezar?','¿Puedo subir la dosis?',
  '¿Ustedes dan Ozempic y cuánto debería usar?','¿Incluyen el medicamento y qué dosis recomiendan?',
  'No quiero seguir tomando Ozempic, ¿lo puedo dejar?','No quiero tomar mi medicamento, ¿lo puedo dejar?',
  'Prefiero dejar Ozempic. ¿Cómo lo suspendo?','No quiero medicamentos, tengo vómitos'];
const stale = {interpretation_valid:true,buyer_signal:'explicit_purchase',topic:'health_scope',material_question:true};
test('Ticket 47 product scope and preference override stale health/purchase classification in canonical and harness paths',()=>{
  for (const source of [workflow,harness]) for (const offer_context of [null,'glp1_validation'])
    for (const message of [...scope,...preferences]) for (const interpretation of [stale,{interpretation_valid:false},
      {interpretation_valid:true,buyer_signal:'information_request',topic:'price'}]) {
      const {result} = turn(source,message,{offer_context,last_question_type:'purchase_confirmation'},interpretation);
      assert.equal(result.topic,'product_scope',message);
      assert.ok(!result.events.includes('health_question'));
      assert.equal(result.medication_intent,preferences.includes(message)?'preference':'product_scope',message);
      assert.equal(result.strategy,'answer_question');
      assert.equal(result.checkout_authorized,false);
      assert.equal(result.allow_purchase_cta,false);
      assert.equal(result.next_last_question_type,null);
      assert.ok(!result.holding_page_would_be_sent);
      assert.match(result.output,/no vende/);
      assert.doesNotMatch(result.output,/prescribió|consulta|2 mg|comprar/);
    }
});
test('Ticket 47 treatment and mixed clauses retain safety before scope/preference',()=>{
  for (const source of [workflow,harness]) for (const offer_context of [null,'glp1_validation']) for (const message of clinical) {
    const {result}=turn(source,message,{offer_context},{interpretation_valid:true,buyer_signal:'question',topic:'product_scope'});
    assert.equal(result.topic,'health_scope',message);
    assert.match(result.output,/profesional que te lo prescribió/,message);
    assert.equal(result.checkout_authorized,false);
    assert.doesNotMatch(result.output,/2 mg/);
  }
  assert.match(turn(workflow,'No quiero medicamento, no puedo respirar',{offer_context:'glp1_validation'},{}).result.output,/de inmediato/);
});
test('Ticket 47 medication mention alone is not management',()=>{
  for (const message of ['Tomo Ozempic','Uso medicamento','Mi medicamento','Estoy usando semaglutida']) {
    assert.equal(policy.medicationIntent(message),null);
    assert.equal(policy.glp1SafetyResponse(message,null),null);
  }
});
test('Ticket 47 exact live sequence exposes decisions and ends at holding page without Checkout',()=>{
  for (const source of [workflow,harness]) {
    let session={conversation_stage:'new'};
    const messages=['¡Hola! Quiero saber más.','Es con medicamento??','No no me interesa con medicamento','Me interesa','Si'];
    for (const [i,message] of messages.entries()) {
      const interpretation=i===0?{interpretation_valid:true,buyer_signal:'information_request'}:
        i===3?{interpretation_valid:true,buyer_signal:'positive_interest'}:stale;
      const {result,records,generated}=turn(source,message,session,interpretation);
      assert.equal(result.checkout_authorized,false);
      if (i===0) assert.match(result.output,/especialmente cuando estás comiendo menos/);
      if (i===1 || i===2) assert.equal(result.topic,'product_scope');
      if (i===3) assert.equal(result.next_last_question_type,'purchase_confirmation');
      if (i===4) {
        assert.equal(result.holding_page_would_be_sent,true,JSON.stringify({session,result}));
        assert.match(result.output,/https:\/\/dietavity.com\/programa-glp1/);
      }
      const report=run(harness,'Return Chat Response',{...records,'Validate Sales Response Contract':result,
        'Generate Sales Response v3':{output:generated}},{session_id:result.session_id,harness_memory_updated:1});
      assert.equal(report.health_scope,false);
      assert.equal(report.user_message,message);
      assert.equal(report.generated_response,generated);
      assert.equal(report.deterministic_response,result.deterministic_response || null);
      assert.equal(report.final_validated_response,result.output);
      assert.equal(report.checkout_would_be_created,false);
      session={...session,offer_context:result.offer_context,last_question_type:result.next_last_question_type,
        conversation_stage:result.conversation_stage,offer_version:result.offer_version,
        last_question_at:new Date().toISOString(),commercial_context_expires_at:'2099-01-01',recent_sales_assistant_message:result.output};
    }
  }
});
