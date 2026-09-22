'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {decideSalesTurn} = require('../lib/sales-engine-v3');
const sources = [require('../n8n/Dietavity Sales Engine (Ticket 10).json'), require('../n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json')];
const session = {last_question_type:'purchase_confirmation', last_question_at:new Date().toISOString(),commercial_context_expires_at:'2099-01-01',offer_version:'28d-149-v1'};
const messages = ['¿Cómo funciona?', '¿Quién crea el plan?', '¿Qué incluye?', '¿Dan factura?', '¿Cuánto tarda en generarse mi plan?', '¿Cómo lo personalizan?', '¿Puedo pagar con tarjeta o solo transferencia? ¿Cuánto tiempo tarda en generarse mi plan después del pago?'];
for (const message of messages) test(`Ticket 52 current question survives commercial history: ${message}`,()=>{
 for(const source of sources) for(const conversation_stage of ['offer','checkout_pending']) for(const offer_context of [null,'glp1_validation']) for(const buyer_signal of ['question','explicit_purchase','ai_value_objection','rejection','deferred_interest']) {
  const records={'Set Session Id':{chatInput:message},'If Existing Onboarding Session':{},'Get Onboarding Session':{...session,conversation_stage,offer_context},'Parse Sales Interpretation':{interpretation_valid:true,buyer_signal,topic:'post_purchase'}};
  const run=(name,input={})=>vm.runInNewContext(`(function(){${source.nodes.find(n=>n.name===name).parameters.jsCode}})()`,{$:name=>({item:{json:records[name]||{}}}),$input:{first:()=>({json:input})}})[0].json;
  const decision=run('Apply Deterministic Commercial Policy');
  records['Apply Deterministic Commercial Policy']=decision;
  const final=run('Validate Sales Response Contract',{output:'Al terminar puedes comprar otro programa. ¿Quieres el enlace?'});
  assert.equal(decision.strategy,'answer_question');
  assert.equal(final.pending_action,'respond');
  assert.equal(final.checkout_authorized,false);
  assert.equal(final.allow_purchase_cta,false);
  assert.equal(final.next_last_question_type,null);
  assert.equal(final.final_answer_coverage.missing_topics.length,0);
  assert.equal(final.historical_state_used_for_intent,false);
  assert.doesNotMatch(final.output,/Quieres el enlace|puedes comprar otro programa/);
 }
});
test('Ticket 52 current purchase and question coexist while weak acknowledgement never authorizes',()=>{
 const interpretation={interpretation_valid:true,buyer_signal:'question',topic:'post_purchase'};
 const purchase=decideSalesTurn({message:'Quiero comprarlo. ¿Dan factura?',session,interpretation});
 assert.equal(purchase.checkout_authorized,true);
 assert.match(purchase.checkout_question_response,/confirmad/);
 for(const message of ['ok','perfecto','gracias']) {
  const d=decideSalesTurn({message,session,interpretation});
  assert.equal(d.checkout_authorized,false);
  assert.equal(d.historical_state_used_for_intent, message !== 'gracias');
 }
 const strong=decideSalesTurn({message:'Sí',session,interpretation});
 assert.equal(strong.checkout_authorized,true);
});
