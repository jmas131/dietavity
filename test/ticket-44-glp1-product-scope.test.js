'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const policy = require('../lib/sales-engine-v3');
const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const expected = 'No. Dietavity no vende, entrega ni receta medicamentos GLP-1. Somos un programa de alimentación personalizado de 28 días que te ayuda a organizar qué comer cada día. ¿Qué te gustaría saber sobre el programa?';
function run(name, records, input = {}) {
  const code = workflow.nodes.find(n => n.name === name).parameters.jsCode;
  return vm.runInNewContext(`(function(){${code}})()`, {
    $: name => ({item:{json:records[name] || {}}}), $input:{first:()=>({json:input})},
  })[0].json;
}
function final(message, interpretation = {}) {
  const records = {
    'Set Session Id':{chatInput:message,session_id:'test'},
    'If Existing Onboarding Session':{session_id:'test'},
    'Get Onboarding Session':{offer_context:'glp1_validation',last_question_type:'purchase_confirmation'},
    'Parse Sales Interpretation':interpretation,
  };
  const decision = run('Apply Deterministic Commercial Policy', records);
  const result = run('Validate Sales Response Contract', {...records,'Apply Deterministic Commercial Policy':decision}, {output:'Usa 2 mg. ¿Quieres comprar?'});
  assert.equal(result.checkout_authorized,false);
  assert.equal(result.pending_action,'respond');
  return result.output;
}
test('Ticket 44 exact product scope survives generated policy and final validation despite stale or invalid interpretation', () => {
  for (const message of ['Dan el medicamento glp1?', '¿Venden GLP-1?', '¿Venden Ozempic?', '¿Ustedes venden Ozempic?', '¿Ustedes recetan el medicamento?', '¿Ustedes recetan GLP-1?', '¿El programa incluye el medicamento?', '¿El medicamento viene incluido?', '¿Me mandan las inyecciones?', '¿Dietavity proporciona GLP-1?']) {
    for (const interpretation of [{interpretation_valid:false}, {interpretation_valid:true,buyer_signal:'explicit_purchase',topic:'health_scope',material_question:true}]) {
      assert.equal(final(message,interpretation),expected,message);
    }
  }
  assert.equal((expected.match(/\?/g)||[]).length,1);
});
test('Ticket 44 clinical and mixed requests preserve prescriber referral without model advice', () => {
  for (const message of ['¿Debo bajar mi dosis?', '¿Cuánto debo usar?', '¿Cuánto GLP-1 debo usar?', '¿Puedo dejar de usarlo?', '¿Cada cuánto me lo pongo?', '¿Me pongo otra dosis?', '¿Cada cuánto debo inyectarme?', '¿Debo cambiar de medicamento?', '¿Puedo usarlo si tomo otro medicamento?', '¿Ustedes dan Ozempic y cuánto debería usar?', '¿Venden GLP-1? ¿Debo bajar mi dosis?', '¿Me mandan las inyecciones y puedo dejar de usarlo?']) {
    const output = final(message);
    assert.match(output,/profesional que te lo prescribió/,message);
    assert.doesNotMatch(output,/2 mg|Quieres comprar|Somos un programa/);
  }
  assert.match(final('¿Venden Ozempic? Tengo dolor intenso'),/atención médica de inmediato/);
});
test('Ticket 44 scope exemption is limited to complete scope questions and GLP-1 context', () => {
  for (const message of ['¿Venden Ozempic y puedo usarlo?', '¿Ustedes recetan el medicamento para mi tratamiento?', '¿Qué medicamento me recomiendan?', '¿Qué incluye?', 'Me cuesta cocinar']) assert.equal(policy.glp1ProductScopeResponse(message),null);
  for (const message of ['Dan el medicamento glp1?', 'Quiero comprar', 'ok', '¿Cuánto cuesta?']) {
    const plain = policy.decideSalesTurn({message,session:{},interpretation:{}});
    assert.deepEqual(plain, policy.decideSalesTurn({message,session:{offer_context:null},interpretation:{}}));
    assert.notEqual(plain.deterministic_reason,'glp1_product_scope');
  }
  assert.equal(policy.decideSalesTurn({message:'Quiero comprar',session:{},interpretation:{}}).checkout_authorized,true);
});
