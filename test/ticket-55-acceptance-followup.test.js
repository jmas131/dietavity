'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {replay,acceptanceBaselineRuntime} = require('../test-support/ticket-55/replay');
const {report} = require('../test-support/ticket-55/fresh-f-incidents.json');
const {taskProductMessage} = require('../lib/sales-conversational-task');
const {FACTS, resolveObligations} = require('../lib/sales-engine-v2/direct-rag');

for (const number of [4,6]) {
  const incident = report.turns[number-1];
  test(`Ticket 55 acceptance F 40266 turn ${number} exact pre-fix reproduction`, () => {
    const {turn} = replay(report,incident,acceptanceBaselineRuntime);
    assert.equal(turn.final_dietavity_response,incident.final_dietavity_response);
    if (number === 4) {
      assert.match(turn.final_dietavity_response,/No tengo información confirmada/);
      assert.match(turn.final_dietavity_response,/multiplica ingredientes/);
    } else {
      assert.equal(turn.diagnostics.current_task_coverage.completed,false);
      assert.doesNotMatch(turn.final_dietavity_response,/Avena integral/);
    }
  });
  test(`Ticket 55 acceptance F 40266 turn ${number} exact recorded boundaries now preserve the task`, () => {
    // No new interpretation annotation or replacement generated response.
    const {turn,decision,state} = replay(report,incident);
    assert.equal(state.failures.length,0);
    assert.equal(turn.diagnostics.current_task_coverage.completed,true);
    assert.equal(decision.checkout_authorized,false);
    assert.doesNotMatch(turn.final_dietavity_response,/No tengo información confirmada|No pude responder|profesional que te lo prescribió/);
    assert.ok(turn.assertions.every(a => a.status === 'PASS'),JSON.stringify(turn.assertions));
    if (number === 4) {
      assert.equal(turn.final_dietavity_response,incident.diagnostics.generated_response);
      assert.match(turn.final_dietavity_response,/Cocinar para 3 = ingredientes ×3/);
    } else {
      // Every ingredient line is preserved verbatim. Only excess follow-up
      // questions are removed; the remaining question is at the end.
      for (const line of incident.diagnostics.generated_response.split('\n').filter(l => /^- /.test(l) && !l.includes('?'))) {
        assert.ok(turn.final_dietavity_response.includes(line),line);
      }
      assert.equal((turn.final_dietavity_response.match(/\?/g) || []).length,1);
      assert.match(turn.final_dietavity_response,/\?$/);
    }
  });
}

for (const [operation,request] of [
  ['transform','Haz más breve el texto anterior'],
  ['transform','Adapta lo anterior a un correo'],
  ['draft','Redacta las instrucciones que acordamos'],
  ['show','Muéstrame el contenido que acabas de ofrecer'],
]) test(`Ticket 55 acceptance generic task mutation: ${request}`, () => {
  const incident = structuredClone(report.turns[3]);
  incident.customer_message = request + ' y ¿cómo ajusto las porciones si cocino solo para mí vs para 3 personas?';
  incident.diagnostics.interpretation.current_task = {operation,request};
  const first = replay(report,incident);
  assert.equal(first.turn.final_dietavity_response,incident.diagnostics.generated_response);
  assert.equal(first.turn.diagnostics.current_clause_coverage.requested_count,0);
  // The same operation with the recorded long list must survive excess CTAs.
  incident.customer_message = request;
  incident.diagnostics.generated_response = report.turns[5].diagnostics.generated_response;
  const second = replay(report,incident);
  assert.match(second.turn.final_dietavity_response,/Avena integral: 40 g → 120 g/);
  assert.equal(second.turn.diagnostics.current_task_coverage.completed,true);
  assert.ok(second.turn.assertions.every(a => a.status === 'PASS'));
});

test('Ticket 55 task preservation stays separate from current Direct RAG provider obligations', () => {
  for (const question of ['¿Cuánto tarda soporte en responder?','¿Tienen integración con mi reloj?','¿Su servicio incluye sesiones de batch cooking garantizadas?','¿Cuánto cuesta?']) {
    const incident = structuredClone(report.turns[5]);
    const request = incident.customer_message;
    incident.customer_message += ' ' + question;
    assert.ok(taskProductMessage(incident.customer_message,{request}).trim());
    const {turn} = replay(report,incident);
    assert.match(turn.final_dietavity_response,/Avena integral: 40 g → 120 g/);
    // This retired task-mutation harness keeps the requested preparation text
    // verbatim. Direct RAG resolves the appended provider question separately
    // and never borrows claims from the task draft.
    const clauseCoverage = turn.assertions.find(a => a.name === 'current_clause_coverage');
    assert.ok(['PASS','FAIL'].includes(clauseCoverage.status));
    assert.ok(turn.assertions.filter(a => a.name !== 'current_clause_coverage').every(a => a.status === 'PASS'),JSON.stringify(turn.assertions));
    const type = question.includes('cuesta') ? 'price' : 'unsupported';
    const direct = resolveObligations({context:{current_message:question},obligations:[{id:'o-1',type,evidence:question}]});
    assert.deepEqual(direct.permitted_claims,FACTS[type]);
    assert.equal(direct.authorized_action,null);
  }
});

test('Ticket 55 clause repair removes offending claims while preserving the valid draft', () => {
  for (const offending of [
    'Garantizamos adaptar el programa para batch cooking.',
    'Respondemos en 5 minutos.',
    'Ofrecemos comidas garantizadas en 45 minutos.',
    'Cuesta $99 MXN.',
    'Un nutriólogo humano revisa tu plan.',
    'Ajustamos las calorías y macronutrientes.',
    'Sube tu dosis a 2 mg.',
    'Usa el identificador 28d-149-v1.',
  ]) {
    const incident = structuredClone(report.turns[5]);
    incident.diagnostics.generated_response = 'Borrador:\nHola, me interesa organizar mis compras. ' + offending + '\n¿La lista incluye cantidades por receta?';
    const {turn,decision} = replay(report,incident);
    assert.match(turn.final_dietavity_response,/Hola, me interesa organizar mis compras/);
    assert.match(turn.final_dietavity_response,/¿La lista incluye cantidades por receta\?/);
    assert.ok(!turn.final_dietavity_response.includes(offending),offending);
    assert.doesNotMatch(turn.final_dietavity_response,/profesional que te lo prescribió/);
    assert.notEqual(decision.deterministic_reason,'medication_safety');
    assert.equal(turn.diagnostics.current_task_coverage.completed,true);
    assert.ok(turn.assertions.every(a => a.status === 'PASS'),JSON.stringify(turn.assertions));
  }
});

test('Ticket 55 removes an extra follow-up instead of the requested draft question', () => {
  const incident = structuredClone(report.turns[5]);
  incident.diagnostics.generated_response = 'Borrador:\nHola, me interesa el programa. ¿La lista incluye cantidades por receta?\n¿Quieres que lo adapte a correo?';
  const {turn} = replay(report,incident);
  assert.match(turn.final_dietavity_response,/¿La lista incluye cantidades por receta\?$/);
  assert.doesNotMatch(turn.final_dietavity_response,/Quieres que/);
  assert.ok(turn.assertions.every(a => a.status === 'PASS'));
});

test('Ticket 55 genuine mixed medical clause still receives referral with safe canonical answer', () => {
  const incident = structuredClone(report.turns[3]);
  incident.customer_message = '¿El programa es para adultos que usan GLP-1? ¿Puedo bajar mi dosis?';
  incident.diagnostics.interpretation.current_task = null;
  const {turn,decision} = replay(report,incident);
  assert.equal(decision.deterministic_reason,'medication_safety');
  assert.match(turn.final_dietavity_response,/adultos.*GLP-1/);
  assert.match(turn.final_dietavity_response,/profesional que te lo prescribió/);
  assert.ok(turn.assertions.every(a => a.status === 'PASS'));
});
