'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture,replay} = require('../test-support/ticket-52/replay');
const {FACTS, resolveObligations} = require('../lib/sales-engine-v2/direct-rag');
for (const incident of fixture.incident_turns) {
 test(`Ticket 52 exact live Scenario G turn ${incident.turn}: archived artifact reproduces recorded failure`,()=>{
  const result = replay(incident,true).turn;
  assert.equal(result.customer_message,incident.customer_message);
  assert.deepEqual(result.session_before,incident.session_before);
  assert.equal(result.final_dietavity_response,incident.final_dietavity_response);
  for (const key of ['topic','strategy','generated_response','deterministic_response_or_fallback','final_validated_response','fallback_identity','explicit_current_question_topics','final_answer_coverage','coverage_warnings']) {
   assert.deepEqual(result.diagnostics[key],incident.diagnostics[key],key);
  }
  assert.doesNotMatch(result.final_dietavity_response,/límite.{0,50}confirmado/);
 });
 test(`Ticket 52 exact live Scenario G turn ${incident.turn}: Direct RAG answers lifecycle and bounded support without an action`,()=>{
  // The fixture is a historical legacy-harness incident. The active route is
  // Direct RAG, whose facts intentionally avoid a promised generation or
  // support-response SLA.
  const direct = resolveObligations({context:{current_message:incident.customer_message},obligations:[
    {id:'o-1',type:'fulfillment',evidence:incident.customer_message},
    {id:'o-2',type:'support_limits',evidence:incident.customer_message}
  ]});
  assert.deepEqual(direct.permitted_claims,[...FACTS.fulfillment,...FACTS.support_limits]);
  assert.equal(direct.authorized_action,null);
  assert.equal(direct.checkout_suppressed_reason,null);
  assert.doesNotMatch(direct.permitted_claims.join(' '),/unas horas|mismo día|plazo.*garantizado/i);
 });
}

const {explicitProductQuestions} = require('../lib/sales-response-contract');
const {decideSalesTurn} = require('../lib/sales-engine-v3');
test('Ticket 52 timing and support-limit variants stay bounded to product questions',()=>{
 for (const message of ['¿Cuánto tardan en generar mi programa?', '¿Cuánto suelen demorar en generar el plan?', '¿Cuánto tiempo suelen tardar en generar el plan?']) {
  assert.ok(explicitProductQuestions(message).includes('fulfillment_timing'),message);
 }
 for (const message of ['¿Cuánto tardan en cocinarse los frijoles?', '¿Cuánto demoran en responder por soporte?', '¿Cuál es el límite de calorías?', 'Tengo un límite de mensajes']) {
  assert.ok(!explicitProductQuestions(message).includes('fulfillment_timing'),message);
  assert.ok(!explicitProductQuestions(message).includes('support_limits'),message);
 }
 for (const message of ['¿Hay límite de consultas por WhatsApp?', '¿Cuál es el máximo de mensajes?', '¿Tienen un tiempo estimado de respuesta por WhatsApp?']) {
  assert.ok(explicitProductQuestions(message).some(t=>['support_limits','support_timing'].includes(t)),message);
 }
});
test('Ticket 52 exact question retains purchase, GLP-1 and safety boundaries',()=>{
 const message=fixture.incident_turns[0].customer_message;
 const interpretation=fixture.incident_turns[0].diagnostics.interpretation;
 const purchase=decideSalesTurn({message:`Quiero comprarlo. ${message}`,interpretation});
 assert.equal(purchase.checkout_authorized,true);
 assert.match(purchase.checkout_question_response,/tiempo exacto confirmado/);
 assert.match(purchase.checkout_question_response,/límite de mensajes o consultas confirmado/);
 const holding=decideSalesTurn({message:`Quiero comprarlo. ${message}`,interpretation,session:{offer_context:'glp1_validation'}});
 assert.equal(holding.checkout_authorized,false);
 const urgent=decideSalesTurn({message:`No puedo respirar. ${message}`,interpretation});
 assert.equal(urgent.deterministic_reason,'medication_safety');
 assert.equal(urgent.checkout_authorized,false);
 const renewal=decideSalesTurn({message:'¿Cuánto tardan en generar el plan? ¿Qué pasa después de los 28 días?',interpretation});
 assert.equal(renewal.deterministic_reason,'post_28_day_continuation');
});
