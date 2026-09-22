'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const ejs = require('ejs');
const policy = require('../lib/sales-engine-v3');
const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const harness = require('../n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json');
const get = (w, name) => w.nodes.find(n => n.name === name);
const run = (w, name, input, records) => vm.runInNewContext(
  '(function(){' + get(w, name).parameters.jsCode + '})()',
  {$input:{first:()=>({json:input})}, $:name=>({item:{json:records[name] || {}}})}
)[0].json;
test('authorized explicit and contextual GLP-1 turns use canonical response routing, validator and harness', () => {
  for (const message of ['Quiero comprar', 'Quiero comprarlo.', 'sí']) {
    const session = {offer_context:'glp1_validation',conversation_stage:'offer',
      last_question_at:new Date().toISOString(),last_question_type:'purchase_confirmation',offer_version:'28d-149-v1',
      commercial_context_expires_at:new Date(Date.now()+600000).toISOString()};
    const records = {'Set Session Id':{session_id:'test',chatInput:message},
      'If Existing Onboarding Session':{session_id:'test'}, 'Get Onboarding Session':session,
      'Parse Sales Interpretation':{interpretation_valid:true,buyer_signal:'explicit_purchase'}};
    const decision = run(workflow,'Apply Deterministic Commercial Policy',{},records);
    assert.equal(decision.pending_action,'respond');
    assert.equal(decision.checkout_authorized,false);
    assert.equal(decision.offer_context,'glp1_validation');
    assert.equal(decision.offer_version,'28d-149-v1');
    assert.ok(decision.events.includes('purchase_intent'));
    assert.ok(!decision.events.includes('checkout_sent'));
    records['Apply Deterministic Commercial Policy'] = decision;
    const validated = run(workflow,'Validate Sales Response Contract',{output:'Paga ahora'},records);
    assert.equal(validated.output,'Claro 😊 Te comparto el siguiente paso:\nhttps://dietavity.com/programa-glp1');
    records['Validate Sales Response Contract'] = validated;
    const report = run(harness,'Return Chat Response',{session_id:'test',harness_memory_updated:1},records);
    assert.equal(report.holding_page_would_be_sent,true);
    assert.equal(report.checkout_would_be_created,false);
  }
});
test('generic intent retains Checkout and weak or unsafe canary intent cannot reach holding page', () => {
  const generic = policy.decideSalesTurn({message:'Quiero comprar',session:{offer_context:null},interpretation:{}});
  assert.equal(generic.pending_action,'send_checkout');
  assert.equal(generic.checkout_authorized,true);
  assert.equal(generic.holding_page_would_be_sent,undefined);
  for (const message of ['ok','okay','perfecto','vale','listo','gracias','sí','Quiero comprar, ¿qué dosis uso?']) {
    const decision = policy.decideSalesTurn({message,session:{offer_context:'glp1_validation'},interpretation:{}});
    assert.equal(decision.checkout_authorized,false);
    assert.equal(decision.holding_page_would_be_sent,undefined);
  }
});
test('holding route renders exactly the approved visible copy without controls', async () => {
  const supabasePath = require.resolve('../lib/supabase');
  require.cache[supabasePath] = {id:supabasePath,filename:supabasePath,loaded:true,exports:{}};
  const app = require('../server');
  const route = app.router.stack.find(layer=>layer.route?.path==='/programa-glp1').route;
  let view;
  route.stack[0].handle({}, {render:name=>{view=name;}});
  const html = await ejs.renderFile(path.resolve(__dirname,'../views',view+'.ejs'),{});
  assert.doesNotMatch(html, /<(?:button|form|input|h1)\b/i);
  const body = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)[1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
  assert.equal(body,'Estamos abriendo esta modalidad de Dietavity de forma gradual. Te enviaremos por WhatsApp el enlace para completar tu compra. $149 MXN · 28 días · pago único · sin suscripción');
  assert.equal(workflow.active,false);
  assert.equal(harness.active,false);
});
