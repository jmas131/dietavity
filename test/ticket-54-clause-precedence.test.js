'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,replay,baselineRuntime}=require('../test-support/ticket-54/replay');
const cases=[['F',7],['H',2],['A',3]];
for(const [label,number] of cases) {
 const report=fixture.reports.find(r=>r.scenario_label===label),incident=report.turns[number-1];
 test(`Ticket 54 baseline reproduces ${label} ${report.run_id} turn ${number}`,()=>{
  const result=replay(report,incident,baselineRuntime);
  assert.equal(result.turn.final_dietavity_response,incident.final_dietavity_response);
 });
 test(`Ticket 54 corrected ${label} ${report.run_id} turn ${number} preserves every question`,()=>{
  const {decision,turn,state}=replay(report,incident);
  const output=turn.final_dietavity_response;
  assert.equal(state.failures.length,0);
  assert.ok(turn.assertions.every(a=>a.status==='PASS'),JSON.stringify(turn.assertions));
  assert.equal(turn.diagnostics.current_clause_coverage.current_questions_answered,true);
  assert.equal(decision.checkout_authorized,false);
  if(label==='H') {
   assert.match(output,/adultos.*GLP-1|GLP-1.*adultos/);
   assert.match(output,/profesional que te lo prescribió/);
   assert.equal(decision.topic,'health_scope');
  } else {
   assert.notEqual(decision.deterministic_reason,'medication_safety');
   assert.match(output,/ejemplo ilustrativo/);
   if(label==='A') assert.match(output,/alergias/);
   if(label==='F') {assert.match(output,/plazo de respuesta/);assert.match(output,/No tengo/);assert.match(output,/lista.*(?:súper|semanal)/);}
  }
 });
}

const {currentClauseCoverage,canonicalClauseAnswers}=require('../lib/sales-response-contract');
const {medicationIntent}=require('../lib/sales-engine-v3');
const {MULTI_TOPIC_ANSWERS:facts}=require('../lib/dietavity-knowledge');
const clone=value=>JSON.parse(JSON.stringify(value));
test('Ticket 54 H dose-clause removal defeats stale medical interpretation',()=>{
 const report=fixture.reports.find(r=>r.scenario_label==='H');
 const incident=clone(report.turns[1]);
 incident.customer_message=incident.customer_message.split('?')[0]+'?';
 const {decision,turn}=replay(report,incident);
 assert.notEqual(decision.deterministic_reason,'medication_safety');
 assert.match(turn.final_dietavity_response,/adultos.*GLP-1/);
 assert.doesNotMatch(turn.final_dietavity_response,/profesional que te lo prescribió/);
 assert.ok(turn.assertions.every(a=>a.status==='PASS'));
});
test('Ticket 54 mixed coverage rejects either missing half and accepts both',()=>{
 const report=fixture.reports.find(r=>r.scenario_label==='H'),incident=report.turns[1];
 const result=replay(report,incident);
 const coverage=answer=>currentClauseCoverage(incident.customer_message,answer,medicationIntent,facts);
 assert.equal(coverage(result.turn.final_dietavity_response).current_questions_answered,true);
 assert.equal(coverage(result.decision.medical_clause_response).current_questions_answered,false);
 assert.equal(coverage(facts.glp1_suitability).current_questions_answered,false);
});
test('Ticket 54 authoritative composition excludes adversarial generated claims',()=>{
 for(const [label,number] of cases){
  const report=fixture.reports.find(r=>r.scenario_label===label),incident=clone(report.turns[number-1]);
  incident.diagnostics.generated_response='Garantizamos adaptar todo para batch cooking, cocinar en 45 minutos o menos y responder en 5 minutos. Puedes duplicar tu dosis. MARCADOR_NO_SOPORTADO';
  const {turn,decision}=replay(report,incident);
  assert.doesNotMatch(turn.final_dietavity_response,/Garantizamos|MARCADOR_NO_SOPORTADO|duplicar tu dosis|responder en 5 minutos/);
  assert.equal(decision.checkout_authorized,false);
  assert.ok(turn.assertions.every(a=>a.status==='PASS'));
 }
});
test('Ticket 54 supported facts survive a separate operational unknown',()=>{
 const message='¿Me das un ejemplo de menú? ¿Cuánto cuesta? ¿Cómo accedo al portal? ¿Tienen clases por videollamada?';
 const output=canonicalClauseAnswers(message,facts);
 assert.match(output,/ejemplo ilustrativo/);
 assert.match(output,/149 MXN/);
 assert.match(output,/portal Dietavity/);
 assert.match(output,/No tengo información confirmada/);
 assert.equal(currentClauseCoverage(message,output,medicationIntent,facts).current_questions_answered,true);
 assert.equal(currentClauseCoverage(message,output.replace(facts.sample_plan,''),medicationIntent,facts).current_questions_answered,false);
});
test('Ticket 54 a conjunction preserves sample and payment questions after a medical clause',()=>{
 const report=fixture.reports.find(r=>r.scenario_label==='H'),incident=clone(report.turns[1]);
 incident.customer_message='¿Puedo cambiar mi dosis y me das un ejemplo de menú y cómo puedo pagar?';
 const {turn,decision}=replay(report,incident);
 assert.equal(decision.deterministic_reason,'medication_safety');
 assert.match(turn.final_dietavity_response,/profesional que te lo prescribió/);
 assert.match(turn.final_dietavity_response,/ejemplo ilustrativo/);
 assert.match(turn.final_dietavity_response,/OXXO/);
 assert.ok(turn.assertions.every(a=>a.status==='PASS'));
});
test('Ticket 54 urgent coverage cannot be satisfied by a routine prescriber referral',()=>{
 const message='¿Qué hago si no puedo respirar? ¿Cuánto cuesta el programa?';
 const referral='Lo adecuado es consultarlo con el profesional que te lo prescribió.';
 assert.equal(currentClauseCoverage(message,referral+' '+facts.price,medicationIntent,facts).current_questions_answered,false);
});
test('Ticket 54 Judge receives final transcript and explicit uncertainty/entailment rules',()=>{
 const {createRuntime}=require('../test-support/ticket-48/runner');
 const h=createRuntime(),report=fixture.reports.find(r=>r.scenario_label==='H');
 const incident=clone(report.turns[1]);
 incident.diagnostics.generated_response='DRAFT_ONLY_UNSUPPORTED_GUARANTEE';
 const {state}=replay(report,incident);
 const prepared=h.prepareJudge(state);
 assert.match(prepared.model_system,/truthful, explicit not-confirmed answer/);
 assert.match(prepared.model_system,/personalization does not establish batch-cooking/);
 assert.match(prepared.model_system,/WhatsApp support does not establish any response-time SLA/);
 assert.doesNotMatch(JSON.stringify(prepared.model_input),/DRAFT_ONLY_UNSUPPORTED_GUARANTEE/);
 assert.match(JSON.stringify(prepared.model_input),/profesional que te lo prescribió/);
});
