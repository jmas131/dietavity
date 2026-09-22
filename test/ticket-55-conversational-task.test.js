'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture,replay,baselineRuntime,annotateTask} = require('../test-support/ticket-55/replay');
const {currentConversationalTask,conversationalTaskCoverage} = require('../lib/sales-conversational-task');
const {decideSalesTurn} = require('../lib/sales-engine-v3');
const report = fixture.reports.find(r => r.scenario_label === 'F');

for (const number of [10,11,12]) {
  const recorded = report.turns[number-1];
  test(`Ticket 55 exact F 39474 turn ${number}: pre-change failure reproduced`, () => {
    const {turn} = replay(report,recorded,baselineRuntime);
    assert.equal(turn.final_dietavity_response,recorded.final_dietavity_response);
    assert.match(turn.final_dietavity_response,/No tengo información confirmada/);
    assert.equal(conversationalTaskCoverage({operation:'draft'},turn.final_dietavity_response).completed,false);
  });
  test(`Ticket 55 exact F 39474 turn ${number}: annotated task preserves recorded generated draft`, () => {
    const {turn,decision,state} = replay(report,annotateTask(recorded));
    assert.equal(state.failures.length,0);
    assert.ok(turn.final_dietavity_response.includes(recorded.diagnostics.generated_response));
    assert.doesNotMatch(turn.final_dietavity_response,/No tengo información confirmada|profesional que te lo prescribió/);
    assert.equal(turn.diagnostics.current_task_coverage.completed,true);
    assert.equal(decision.checkout_authorized,false);
    assert.ok(turn.assertions.every(a => a.status === 'PASS'),JSON.stringify(turn.assertions));
  });
}

const mutations = [
  ['transform','Hazlo más corto.','Hola, ¿la lista incluye cantidades por receta?'],
  ['transform','Adapta el borrador anterior a WhatsApp.','Hola, ¿la lista incluye cantidades por receta?'],
  ['transform','Adáptalo para email.','Asunto: Consulta sobre la lista semanal\nHola, me interesa conocer el detalle de la lista. ¿Incluye cantidades por receta?'],
  ['summarize','Resume lo que ya me explicaste del programa.','El programa dura 28 días y cuesta $149 MXN en un solo pago.'],
  ['show','Muéstrame el borrador.','Hola, ¿la lista incluye cantidades por receta?'],
  ['draft','¿Podrías poner esa consulta en palabras que pueda reenviar?','Hola, ¿la lista incluye cantidades por receta?'],
];
for (const [operation,message,draft] of mutations) test(`Ticket 55 semantic task: ${message}`, () => {
  const incident = structuredClone(report.turns[11]);
  incident.customer_message = message;
  incident.diagnostics.generated_response = draft;
  Object.assign(incident.session_before,{goal:'buy',last_question_type:'purchase_confirmation',offer_context:'glp1_validation'});
  Object.assign(incident.diagnostics.interpretation,{topic:'price',goal:'buy',buyer_signal:'explicit_purchase'});
  const {turn,decision} = replay(report,annotateTask(incident,operation));
  assert.ok(turn.final_dietavity_response.includes(draft));
  assert.equal(decision.goal,null);
  assert.equal(decision.next_last_question_type,null);
  assert.equal(decision.checkout_authorized,false);
  assert.equal(turn.diagnostics.current_task_coverage.completed,true);
  assert.ok(turn.assertions.every(a => a.status === 'PASS'),JSON.stringify(turn.assertions));
});

test('Ticket 55 stale or invalid task evidence cannot classify a current factual question or acknowledgement', () => {
  for (const message of ['¿Cuánto tarda soporte en responder?','ok','perfecto','gracias']) {
    const interpretation = {buyer_signal:'question',current_task:{operation:'draft',request:'Redáctame el mensaje'}};
    assert.equal(currentConversationalTask(message,interpretation),null);
    const decision = decideSalesTurn({message,interpretation,session:{last_question_type:'purchase_confirmation'}});
    assert.equal(decision.current_task,undefined);
    assert.equal(decision.checkout_authorized,false);
  }
  assert.equal(currentConversationalTask('Redáctame el mensaje',{interpretation_valid:false,current_task:{operation:'draft',request:'Redáctame el mensaje'}}),null);
});

test('Ticket 55 stale health topic and purchase metadata do not override a writing task', () => {
  const incident = annotateTask(report.turns[11]);
  Object.assign(incident.session_before,{offer_context:'glp1_validation',goal:'buy',last_question_type:'purchase_confirmation'});
  Object.assign(incident.diagnostics.interpretation,{topic:'health_scope',buyer_signal:'explicit_purchase'});
  const {turn,decision} = replay(report,incident);
  assert.match(turn.final_dietavity_response,/Borrador:/);
  assert.doesNotMatch(turn.final_dietavity_response,/profesional que te lo prescribió/);
  assert.equal(decision.checkout_authorized,false);
  assert.ok(!decision.events.includes('purchase_intent'));
});

test('Ticket 55 genuinely unknown product details remain uncertain', () => {
  for (const message of ['¿Cuánto tarda soporte en responder?','¿Garantizan cocinar en 45 minutos?','¿Adaptan todo para una sesión de batch cooking semanal?']) {
    const incident = structuredClone(report.turns[11]);
    incident.customer_message = message;
    incident.diagnostics.generated_response = 'Sí, lo garantizamos.';
    const {turn,decision} = replay(report,incident);
    assert.equal(decision.current_task,undefined);
    assert.match(turn.final_dietavity_response,/No tengo|no hay|no tenemos/i);
    assert.doesNotMatch(turn.final_dietavity_response,/Sí, lo garantizamos/);
  }
});

test('Ticket 55 unsupported draft promises are repaired without inventing capabilities', () => {
  const incident = annotateTask(report.turns[11]);
  incident.diagnostics.generated_response = 'Hola. Garantizamos batch cooking y cocinar en 45 minutos. Respondemos en 5 minutos. Un nutriólogo humano revisa el plan. Cuesta $199 MXN. ¿Pueden confirmar los detalles de la lista semanal?';
  const {turn} = replay(report,incident);
  assert.doesNotMatch(turn.final_dietavity_response,/Garantizamos|45 minutos|5 minutos|199|humano revisa/);
  assert.match(turn.final_dietavity_response,/¿Pueden confirmar/);
  assert.equal(turn.diagnostics.current_task_coverage.completed,true);
});

test('Ticket 55 factual clauses alongside a task retain canonical priority', () => {
  const incident = structuredClone(report.turns[11]);
  const request = 'Hazme un mensaje para preguntar si la lista incluye cantidades.';
  incident.customer_message = '¿Cuánto cuesta? ' + request;
  incident.diagnostics.generated_response = 'Hola, ¿la lista incluye cantidades por receta?';
  const {turn} = replay(report,annotateTask(incident,'draft',request));
  assert.match(turn.final_dietavity_response,/149 MXN/);
  assert.match(turn.final_dietavity_response,/Borrador:/);
  assert.equal(turn.diagnostics.current_task_coverage.completed,true);
  assert.ok(turn.assertions.every(a => a.status === 'PASS'),JSON.stringify(turn.assertions));
});

test('Ticket 55 task metadata cannot bypass medical safety or leak internal IDs', () => {
  for (const message of ['Redacta instrucciones para bajar mi dosis.','No puedo respirar. Hazme un mensaje.']) {
    const incident = structuredClone(report.turns[11]);
    incident.customer_message = message;
    const {decision,turn} = replay(report,annotateTask(incident));
    assert.equal(decision.deterministic_reason,'medication_safety');
    assert.match(turn.final_dietavity_response,/profesional que te lo prescribió|atención médica de inmediato/);
  }
  const incident = annotateTask(report.turns[11]);
  incident.diagnostics.generated_response = 'Borrador: Usa 28d-149-v1 y sube tu dosis a 2 mg.';
  const {turn} = replay(report,incident);
  assert.doesNotMatch(turn.final_dietavity_response,/28d-149-v1|2 mg/);
  assert.equal(turn.diagnostics.current_task_coverage.completed,false);
});

test('Ticket 55 task ignored or replaced by uncertainty fails harness coverage', () => {
  for (const draft of ['No tengo información confirmada sobre ese detalle.','Claro, puedo ayudarte a escribirlo.']) {
    const incident = annotateTask(report.turns[11]);
    incident.diagnostics.generated_response = draft;
    const {turn} = replay(report,incident);
    assert.equal(turn.diagnostics.current_task_coverage.completed,false);
    assert.ok(turn.assertions.some(a => a.name === 'current_task_coverage' && a.status === 'FAIL'));
  }
  const empty = annotateTask(report.turns[11]);
  empty.diagnostics.generated_response = '';
  assert.ok(replay(report,empty).state.failures.length > 0, 'An empty model response remains an execution failure');
});

test('Ticket 55 Judge independently checks task completion in final transcript', () => {
  const {createRuntime} = require('../test-support/ticket-48/runner');
  const {state} = replay(report,annotateTask(report.turns[11]));
  const judged = createRuntime().prepareJudge(state);
  assert.match(judged.model_system,/does NOT complete a writing task/);
  assert.match(judged.model_system,/requested medium/);
  assert.match(judged.model_input,/Borrador/);
});
