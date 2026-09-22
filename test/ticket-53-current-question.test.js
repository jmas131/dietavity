'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture,replay} = require('../test-support/ticket-53/replay');
test('Ticket 53 exact Scenario D run 39062 turn 4 does not fail the engine',()=>{
 const report = fixture.reports.find(r=>r.run_id === '39062');
 const incident = report.turns[3];
 const result = replay(report,incident);
 assert.deepEqual(JSON.parse(JSON.stringify(result.turn.session_before)),incident.session_before);
 assert.equal(result.turn.diagnostics.generated_response,incident.diagnostics.generated_response);
 assert.deepEqual(JSON.parse(JSON.stringify(result.state.failures)),[]);
 assert.notEqual(result.state.termination_reason,'sales_engine_failure');
 assert.ok(result.turn.assertions.every(a=>a.status === 'PASS'));
});
const {baselineRuntime} = require('../test-support/ticket-53/replay');
const {createRuntime} = require('../test-support/ticket-48/runner');
const {currentQuestionDetails} = require('../lib/sales-response-contract');
const {MULTI_TOPIC_ANSWERS} = require('../lib/dietavity-knowledge');
const clone = x => JSON.parse(JSON.stringify(x));
function evaluate(message, options = {}) {
 const report = fixture.reports[3];
 const turn = clone(report.turns[3]);
 turn.customer_message = message;
 turn.session_before = {...turn.session_before,conversation_stage:'checkout_pending',goal:'see an example meal plan',
   last_question_type:'purchase_confirmation',last_question_at:turn.recorded_at,commercial_context_expires_at:'2099-01-01',
   offer_version:'28d-149-v1',...options.session};
 turn.diagnostics.interpretation = {interpretation_valid:true,buyer_signal:'explicit_purchase',topic:'price',material_question:false,...options.interpretation};
 turn.diagnostics.generated_response = options.draft ?? 'Cuesta $149 MXN. ¿Quieres el enlace?';
 return replay(report,turn);
}
test('Ticket 53 immutable baseline reproduces every recorded final answer and Scenario D assertion failure',()=>{
 for(const report of fixture.reports) for(const turn of report.turns) {
  const result = replay(report,turn,baselineRuntime);
  assert.equal(result.turn.final_dietavity_response,turn.final_dietavity_response,`${report.scenario_label}:${turn.turn}`);
  assert.deepEqual(clone(result.turn.assertions),turn.assertions);
 }
 const report = fixture.reports[3];
 const result = replay(report,report.turns[3],baselineRuntime);
 assert.equal(result.state.termination_reason,'sales_engine_failure');
 assert.deepEqual(clone(result.state.failures),[]);
 assert.deepEqual(clone(result.turn.assertions.filter(a=>a.status==='FAIL')),[{name:'no_known_unsupported_claims',status:'FAIL',turn:4}]);
});
test('Ticket 53 delivery negation does not hide positive claims in another clause',()=>{
 const h=createRuntime();const s=h.initialize({target:'sales',scenario_ids:['prepared_food_001']},'claim_test');
 s.customer={customer_message:'¿Entregan comida?'};
 const check=text=>h.assertions(s,{},text,null).find(a=>a.name==='no_known_unsupported_claims').status;
 for(const text of ['No entregamos comida preparada.','No enviamos la comida a domicilio.']) assert.equal(check(text),'PASS');
 for(const text of ['Entregamos comida preparada.','No entregamos comida preparada, pero enviamos comida a domicilio.',
   'No es una suscripción. Entregamos comida preparada.','No entregamos comida preparada. Baja tu dosis de medicamento.','No entregamos comida preparada sin costo.']) assert.equal(check(text),'FAIL',text);
});
for(const report of fixture.reports) test(`Ticket 53 exact scenario ${report.scenario_label} replay has no execution or assertion failures`,()=>{
 for(const incident of report.turns) {
  const result=replay(report,incident);
  assert.deepEqual(clone(result.state.failures),[],`${report.scenario_label}:${incident.turn}`);
  assert.notEqual(result.state.termination_reason,'sales_engine_failure');
  assert.ok(result.turn.assertions.every(a=>a.status==='PASS'));
  assert.equal(result.turn.diagnostics.generated_response,incident.diagnostics.generated_response);
  assert.deepEqual(clone(result.turn.session_before),incident.session_before);
 }
});
test('Ticket 53 exact A and F product questions do not become medical referrals',()=>{
 for(const label of ['A','F']) {
  const report=fixture.reports.find(r=>r.scenario_label===label);
  for(const incident of report.turns.slice(1)) {
   const {decision,turn}=replay(report,incident);
   assert.notEqual(decision.deterministic_reason,'medication_safety');
   assert.doesNotMatch(turn.final_dietavity_response,/te indicara cambios en tu medicamento/);
   if(label==='A') assert.match(turn.final_dietavity_response,/después del pago y con tu consentimiento/);
   if(label==='F') {assert.match(turn.final_dietavity_response,/preparación/);assert.match(turn.final_dietavity_response,/lista del súper/);assert.match(turn.final_dietavity_response,/No tengo información confirmada/);}
  }
 }
});
test('Ticket 53 exact PDF/contact, restaurant and qualified sample requests retain their subject',()=>{
 for(const report of fixture.reports) for(const incident of report.turns) {
  const output=replay(report,incident).turn.final_dietavity_response;
  if(report.scenario_label==='C' && incident.turn>=4){
   assert.match(output,/PDF/);assert.match(output,/No tengo información confirmada/);assert.doesNotMatch(output,/\$149/);
   if(incident.turn>=5) assert.match(output,/soporte@dietavity\.com/);
  }
  if(report.scenario_label==='D' && incident.turn===4){
   assert.match(output,/restaurantes cercanos/);assert.match(output,/costo extra/);assert.doesNotMatch(output,/\$149/);
  }
  if(report.scenario_label==='G' && incident.turn>=4){
   assert.match(output,/vegetariano/);assert.match(output,/gluten/);
   assert.doesNotMatch(output.replace(/«[^»]*»/g,''),/pollo|avena/);
   assert.match(output,/No tengo información confirmada/);
   if(incident.turn>=5) {assert.match(output,/métodos de pago confirmados/);assert.doesNotMatch(output,/Sí, aceptamos/);}
  }
 }
});
test('Ticket 53 generic invariant survives novel subjects, stale metadata and unsafe drafts',()=>{
 const subjects=['exportación CSV','acceso sin conexión','compatibilidad con reloj Boreal','idioma portugués','modo oscuro','sesiones familiares'];
 for(const subject of subjects) for(const question of [`¿Ofrecen ${subject}?`,`Quisiera saber sobre ${subject}`,`¿Cómo funciona ${subject}?`,`¿Es digital y tiene ${subject}?`,`¿Tienen entregas en CDMX y ${subject}?`]) {
  for(const topic of ['price','post_purchase','health_scope']) {
   const {decision,turn}=evaluate(question,{interpretation:{topic}});
   assert.equal(decision.strategy,'answer_question');assert.equal(decision.checkout_authorized,false);
   assert.equal(decision.allow_purchase_cta,false);assert.equal(decision.next_last_question_type,null);
   assert.ok(turn.final_dietavity_response.includes(subject),question);
   assert.match(turn.final_dietavity_response,/No tengo información confirmada/);
   assert.doesNotMatch(turn.final_dietavity_response,/\$149|Quieres el enlace|te indicara cambios/);
  }
 }
 for(const draft of ['Sí, esa función cuesta $5 y está garantizada.', 'Baja tu dosis a 2 mg.', 'Compra ahora https://untrusted.example']) {
  assert.match(evaluate('¿Exportan archivos XML?',{draft}).turn.final_dietavity_response,/XML/);
  assert.doesNotMatch(evaluate('¿Exportan archivos XML?',{draft}).turn.final_dietavity_response,/\$5|2 mg|https:|Compra ahora/);
 }
});
test('Ticket 53 known facts and uncertainty coexist; unknown qualifiers cannot borrow base-product pricing',()=>{
 const known=evaluate('¿Cuánto cuesta? ¿Dan factura?').turn.final_dietavity_response;
 assert.match(known,/149 MXN/);assert.match(known,/confirmada.*factura/);
 const mixed=evaluate('¿Cuánto cuesta? ¿Ofrecen exportación XML?').turn.final_dietavity_response;
 assert.match(mixed,/149 MXN/);assert.match(mixed,/XML/);assert.match(mixed,/No tengo información confirmada/);
 const qualifier=evaluate('¿Cuánto cuesta la consulta privada?').turn.final_dietavity_response;
 assert.match(qualifier,/consulta privada/);assert.doesNotMatch(qualifier,/149 MXN/);
 assert.equal(currentQuestionDetails('¿PDF?',MULTI_TOPIC_ANSWERS)[0].uncertain,true);
});
test('Ticket 53 authoritative clinical, support, reminder, holding and purchase boundaries remain intact',()=>{
 for(const message of ['No puedo respirar. ¿Exportan XML?','¿Puedo dejar Ozempic? ¿Exportan XML?','¿Debo bajar mi dosis? ¿Exportan XML?','¿Puedo dejarlo?','¿Debería cambiar?']) {
  const {decision,turn}=evaluate(message);
  assert.equal(decision.deterministic_reason,'medication_safety');assert.equal(decision.checkout_authorized,false);
  assert.match(turn.final_dietavity_response,/profesional|atención médica/);
 }
 const support=evaluate('Ya pagué y no puedo entrar. ¿Exportan XML?',{interpretation:{buyer_signal:'support_issue'}});
 assert.equal(support.decision.buyer_signal,'support_issue');
 const reminder=evaluate('Recuérdame mañana',{interpretation:{explicit_reminder_request:true,timing_iso:'2026-09-22T18:00:00Z'}});
 assert.ok(['reminder','clarify'].includes(reminder.decision.strategy));
 for(const message of ['ok','perfecto','gracias']) assert.equal(evaluate(message).decision.checkout_authorized,false);
 assert.equal(evaluate('Quiero comprarlo').decision.checkout_authorized,true);
 assert.equal(evaluate('Quiero comprarlo',{session:{offer_context:'glp1_validation'}}).decision.holding_page_would_be_sent,true);
 const unknown=evaluate('Quiero comprarlo. ¿Incluye asesoría familiar?');
 assert.equal(unknown.decision.checkout_authorized,false);assert.match(unknown.turn.final_dietavity_response,/asesoría familiar/);
});

test('Ticket 53 a missing model response remains an observable infrastructure failure',()=>{
 const result=evaluate('¿Exportan archivos XML?',{draft:''});
 assert.equal(result.state.termination_reason,'sales_engine_failure');
 assert.deepEqual(clone(result.state.failures),[{stage:'sales_response',code:'ENGINE_RESPONSE_FAILURE'}]);
});
test('Ticket 53 both generated validators preserve novel requests and redact internal identifiers',()=>{
 const vm=require('node:vm');
 const sources=[require('../n8n/Dietavity Sales Engine (Ticket 10).json'),require('../n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json')];
 for(const source of sources) {
  const message='¿La exportación XML admite el campo offer_context y 28d-149-v1?';
  const records={'Set Session Id':{chatInput:message},'If Existing Onboarding Session':{},'Get Onboarding Session':{},
    'Initialize Sales Lead v3':{conversation_stage:'offer',last_question_type:'purchase_confirmation'},
    'Parse Sales Interpretation':{interpretation_valid:true,buyer_signal:'question',topic:'price'}};
  const run=(name,input={})=>vm.runInNewContext(`(function(){${source.nodes.find(n=>n.name===name).parameters.jsCode}})()`,
    {$:name=>({item:{json:records[name]||{}}}),$input:{first:()=>({json:input})}})[0].json;
  records['Apply Deterministic Commercial Policy']=run('Apply Deterministic Commercial Policy');
  const final=run('Validate Sales Response Contract',{output:'Cuesta $149 MXN.'});
  assert.match(final.output,/exportación XML/);assert.match(final.output,/No tengo información confirmada/);
  assert.doesNotMatch(final.output,/offer_context|28d-149-v1|149 MXN/);
  assert.equal(final.current_question_details_preserved,true);
  assert.equal(final.unconfirmed_current_question_count,1);
  assert.equal(final.checkout_authorized,false);
 }
});
