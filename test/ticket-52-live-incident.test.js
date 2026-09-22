'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture,replay} = require('../test-support/ticket-52/replay');
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
 test(`Ticket 52 exact live Scenario G turn ${incident.turn}: current artifact answers timing and limits`,()=>{
  const {turn,decision} = replay(incident);
  assert.deepEqual(turn.session_before,incident.session_before);
  assert.equal(turn.diagnostics.generated_response,incident.diagnostics.generated_response);
  assert.ok(turn.diagnostics.explicit_current_question_topics.includes('fulfillment_timing'));
  assert.ok(turn.diagnostics.explicit_current_question_topics.includes('support_limits'));
  assert.deepEqual(turn.diagnostics.final_answer_coverage.missing_topics,[]);
  assert.match(turn.final_dietavity_response,/No tengo un tiempo exacto confirmado/);
  assert.match(turn.final_dietavity_response,/No tengo un límite de mensajes o consultas confirmado/);
  if (incident.turn >= 10) assert.match(turn.final_dietavity_response,/No tengo un plazo de respuesta/);
  assert.doesNotMatch(turn.final_dietavity_response,/renovación|otro programa|Quieres|No (?:hay|existe) un límite/);
  assert.equal(decision.pending_action,'respond');
  assert.equal(decision.checkout_authorized,false);
  assert.equal(decision.allow_purchase_cta,false);
  assert.equal(decision.next_last_question_type,null);
  assert.equal(turn.diagnostics.historical_state_used_for_intent,false);
  assert.ok(turn.assertions.every(a=>a.status === 'PASS'));
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
