'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { practicalGuidanceQuestion, currentQuestionDetails } = require('../lib/sales-response-contract');
const { decideSalesTurn } = require('../lib/sales-engine-v3');
const { MULTI_TOPIC_ANSWERS } = require('../lib/dietavity-knowledge');
const { fixture, replay, baselineRuntime, annotateTask } = require('../test-support/ticket-55/replay');

const practical = [
  '¿Cómo puedo organizarlo para cocinar dos veces por semana?',
  '¿Cómo hago para que estas comidas duren hasta el jueves?',
  '¿Puedo mover la segunda sesión de cocina al martes?',
  '¿Cómo ajusto las porciones si cocino para tres?',
  '¿Cómo organizo cenas rápidas y comidas para recalentar?',
];
for (const message of practical) test(`Ticket 56 practical guidance remains practical: ${message}`, () => {
  assert.equal(practicalGuidanceQuestion(message), true);
  const details = currentQuestionDetails(message, MULTI_TOPIC_ANSWERS);
  assert.equal(details.some(detail => detail.practical), true);
  assert.equal(details.some(detail => detail.uncertain), false);
  const decision = decideSalesTurn({ message, interpretation: { buyer_signal: 'question', topic: 'product_scope' }, session: {} });
  assert.equal(decision.deterministic_reason, 'practical_guidance');
  assert.equal(decision.strategy, 'conversational');
  assert.equal(decision.checkout_authorized, false);
});

for (const message of [
  '¿Dietavity adapta automáticamente mi programa para cocinar solo dos veces por semana?',
  '¿Dietavity garantiza que las recetas duren cuatro días refrigeradas?',
  '¿El soporte confirma cómo congelar las comidas?',
]) test(`Ticket 56 product capability remains bounded: ${message}`, () => {
  assert.equal(practicalGuidanceQuestion(message), false);
  const decision = decideSalesTurn({ message, interpretation: { buyer_signal: 'question', topic: 'product_scope' }, session: {} });
  assert.notEqual(decision.deterministic_reason, 'practical_guidance');
  assert.equal(decision.checkout_authorized, false);
});

test('Ticket 56 practical guidance does not outrank medical safety', () => {
  const decision = decideSalesTurn({
    message: '¿Cómo organizo comidas para recalentar si también quiero bajar mi dosis?',
    interpretation: { buyer_signal: 'question', topic: null }, session: {},
  });
  assert.equal(decision.deterministic_reason, 'medication_safety');
  assert.equal(decision.checkout_authorized, false);
});

const freshF = fixture.reports.find(report => report.scenario_label === 'F');
for (const number of [7, 8, 9, 11, 12]) test(`Ticket 56 recorded F ${number} remains a reproducible boundary`, () => {
  const recorded = freshF.turns[number - 1];
  const baseline = replay(freshF, recorded, baselineRuntime);
  assert.equal(baseline.turn.final_dietavity_response, recorded.final_dietavity_response);
  const current = replay(freshF, recorded);
  assert.equal(current.state.failures.length, 0);
  assert.equal(current.decision.checkout_authorized, false);
});

test('Ticket 56 final validation preserves a safe practical answer', () => {
  const incident = structuredClone(freshF.turns[7]);
  incident.customer_message = '¿Cómo puedo organizarlo para cocinar dos veces por semana?';
  incident.diagnostics.interpretation = { interpretation_valid: true, buyer_signal: 'question', topic: 'product_scope' };
  incident.diagnostics.generated_response = 'Puedes elegir dos momentos fijos de la semana: prepara una base de verduras, una proteína y un cereal el primer día; deja el segundo para reponer lo que se termine. Guarda componentes por separado y recalienta solo la porción que vayas a comer.';
  const { turn, decision, state } = replay(freshF, incident);
  assert.equal(state.failures.length, 0);
  assert.equal(decision.deterministic_reason, 'practical_guidance');
  assert.equal(turn.final_dietavity_response, incident.diagnostics.generated_response);
  assert.doesNotMatch(turn.final_dietavity_response, /No tengo información confirmada/);
  assert.ok(turn.assertions.every(assertion => assertion.status === 'PASS'), JSON.stringify(turn.assertions));
});

test('Ticket 56 final validation keeps an unknown capability bounded', () => {
  const incident = structuredClone(freshF.turns[7]);
  incident.customer_message = '¿Dietavity adapta automáticamente mi programa para cocinar solo dos veces por semana?';
  incident.diagnostics.interpretation = { interpretation_valid: true, buyer_signal: 'question', topic: 'product_scope' };
  incident.diagnostics.generated_response = 'Sí, Dietavity adapta automáticamente cada programa para cocinar dos veces por semana.';
  const { turn, decision, state } = replay(freshF, incident);
  assert.equal(state.failures.length, 0);
  assert.notEqual(decision.deterministic_reason, 'practical_guidance');
  assert.match(turn.final_dietavity_response, /No tengo información confirmada/);
  assert.doesNotMatch(turn.final_dietavity_response, /Sí, Dietavity adapta automáticamente/);
});

function replayMixed(message, generated, interpretation = { interpretation_valid: true, buyer_signal: 'question', topic: 'product_scope' }) {
  const incident = structuredClone(freshF.turns[7]);
  incident.customer_message = message;
  incident.diagnostics.interpretation = interpretation;
  incident.diagnostics.generated_response = generated;
  return replay(freshF, incident);
}

test('Ticket 56 preserves practical guidance while bounding an unknown capability', () => {
  const { turn, state } = replayMixed(
    '¿Cómo organizo comidas para recalentar y Dietavity garantiza adaptarlas a mi horario?',
    'Para recalentar mejor, guarda las bases por separado y calienta solo la porción que vas a comer. Dietavity garantiza adaptar cada comida a cualquier horario.',
  );
  assert.equal(state.failures.length, 0);
  assert.match(turn.final_dietavity_response, /guarda las bases por separado/i);
  assert.match(turn.final_dietavity_response, /No tengo información confirmada/i);
  assert.doesNotMatch(turn.final_dietavity_response, /Dietavity garantiza adaptar cada comida/i);
});

test('Ticket 56 preserves canonical price while bounding an unknown inclusion', () => {
  const { turn, state } = replayMixed(
    '¿Los $149 MXN incluyen una videollamada de personalización?',
    'El programa tiene un pago único de $149 MXN. Ese precio incluye una videollamada individual de personalización.',
  );
  assert.equal(state.failures.length, 0);
  assert.match(turn.final_dietavity_response, /\$149 MXN/i);
  assert.match(turn.final_dietavity_response, /No tengo información confirmada/i);
  assert.doesNotMatch(turn.final_dietavity_response, /incluye una videollamada/i);
});

test('Ticket 56 preserves a drafting task while removing an unsupported service promise', () => {
  const incident = structuredClone(freshF.turns[7]);
  incident.customer_message = 'Redáctame un mensaje para preguntar por el plan y por una llamada de bienvenida.';
  incident.diagnostics.generated_response = 'Borrador: Hola, me interesa el programa de Dietavity. Dietavity incluye una llamada de bienvenida garantizada junto con el pago único de $149 MXN.';
  const { turn, state } = replay(freshF, annotateTask(incident, 'draft', incident.customer_message));
  assert.equal(state.failures.length, 0);
  assert.match(turn.final_dietavity_response, /Borrador: Hola, me interesa el programa/i);
  assert.doesNotMatch(turn.final_dietavity_response, /incluye una llamada de bienvenida garantizada/i);
});

test('Ticket 56 preserves several independent known product answers when one capability is unknown', () => {
  const { turn, state } = replayMixed(
    '¿Cuánto cuesta, cómo puedo pagar y Dietavity garantiza responder en cinco minutos?',
    'El programa tiene un pago único de $149 MXN. Puedes pagar con tarjeta de crédito o débito, OXXO Pay o Apple Pay. Dietavity garantiza responder en cinco minutos.',
  );
  assert.equal(state.failures.length, 0);
  assert.match(turn.final_dietavity_response, /\$149 MXN/i);
  assert.match(turn.final_dietavity_response, /OXXO Pay/i);
  assert.match(turn.final_dietavity_response, /No tengo información confirmada/i);
  assert.doesNotMatch(turn.final_dietavity_response, /^Dietavity garantiza responder en cinco minutos/i);
});

test('Ticket 56 retains bounded uncertainty for a pure capability or guarantee question', () => {
  const { turn, state } = replayMixed(
    '¿Dietavity garantiza responder en cinco minutos?',
    'Sí, Dietavity garantiza responder en cinco minutos.',
  );
  assert.equal(state.failures.length, 0);
  assert.match(turn.final_dietavity_response, /No tengo información confirmada/i);
  assert.doesNotMatch(turn.final_dietavity_response, /Sí, Dietavity garantiza responder en cinco minutos/i);
});

test('Ticket 56 keeps the established fallback for a fully unsupported generated answer', () => {
  const { turn, state } = replayMixed(
    '¿Dietavity garantiza resultados?',
    'Dietavity garantiza resultados y una videollamada médica semanal.',
  );
  assert.equal(state.failures.length, 0);
  assert.match(turn.final_dietavity_response, /No tengo información confirmada/i);
  assert.doesNotMatch(turn.final_dietavity_response, /videollamada médica/i);
});

test('Ticket 56 does not bypass Ticket 54 medical precedence for mixed content', () => {
  const { turn, decision, state } = replayMixed(
    '¿Cómo organizo comidas para recalentar y puedo duplicar mi dosis?',
    'Guarda las bases por separado para recalentar. Puedes duplicar tu dosis para avanzar más rápido.',
    { interpretation_valid: true, buyer_signal: 'question', topic: 'product_scope' },
  );
  assert.equal(state.failures.length, 0);
  assert.equal(decision.deterministic_reason, 'medication_safety');
  assert.doesNotMatch(turn.final_dietavity_response, /duplicar tu dosis/i);
});

const freshScenarioF40806Turns = [
  'Se ve bien. ¿Pueden ajustarlo a mi horario (salgo 8:00 y vuelvo ~20:00) para que las comidas estén listas para calentar en microondas y las cenas listas en ≤10 min? ¿Incluyen porciones (raciones) por comida y sugerencia de tamaños/kalorías?',
  'Se ve bien. ¿Pueden ajustarlo a mi horario (salgo 8:00 y vuelvo ~20:00) para que las comidas estén listas para calentar en microondas y las cenas listas en ≤10 min? ¿Incluyen porciones (raciones) por comida y sugerencia de tamaños/kalorías? ¿Tiene costo extra esa personalización?',
  '¿Entonces cómo lo hacemos? ¿Ustedes pueden ajustar el plan a mi horario (8:00–20:00), comidas para microondas, cenas de ≤10 min, con porciones/raciones y tamaños/kalorías? ¿Cuánto cuesta esa personalización?',
  '¿Los $149 MXN incluyen ajustar el plan a mi horario (8:00–20:00), comidas para microondas, cenas de ≤10 min y porciones/raciones con tamaños/kalorías? ¿Cómo sería el pago y cuándo empezarían los ajustes?',
  '¿Los $149 MXN incluyen ajustar el plan a mi horario (8:00–20:00), comidas para microondas, cenas de ≤10 min y porciones/raciones con tamaños/kalorías? Si no, ¿cuánto extra cuesta y cómo se paga y cuándo empezarían los ajustes?',
  'Ok, estoy confundido. ¿Me confirman si los $149 incluyen la personalización para mi horario (8:00–20:00), comidas para microondas, cenas de ≤10 min y porciones/kcal? Si no, ¿cuánto cuesta extra, cómo se paga y cuándo comenzarían los ajustes?',
  'No me queda claro — ¿pueden confirmarme si los $149 incluyen la personalización (mi horario 8:00–20:00, comidas para microondas, cenas ≤10 min y porciones/kcal)? Si no, ¿cuánto cuesta extra, cómo pago y cuándo empezarían los ajustes?',
  'Estoy confundido. ¿Me pueden pasar un contacto o link donde alguien confirme si los $149 incluyen esa personalización y cómo se paga y cuándo empiezan? Si no, ¿cuánto cuesta extra esa personalización?',
];

for (const [index, message] of freshScenarioF40806Turns.entries()) test(`Ticket 56 fresh Scenario F #40806 turn ${index + 4} preserves useful current-turn content`, () => {
  const { turn, state } = replayMixed(
    message,
    'Para organizar comidas que se recalientan, guarda los componentes por separado y calienta solo la porción que vas a comer. El programa tiene un pago único de $149 MXN y puedes pagar con tarjeta de crédito o débito, OXXO Pay o Apple Pay. Dietavity incluye sin costo adaptar cada receta a cualquier horario y garantizar cenas de diez minutos.',
  );
  assert.equal(state.failures.length, 0);
  assert.match(turn.final_dietavity_response, /guarda los componentes por separado/i);
  assert.match(turn.final_dietavity_response, /\$149 MXN/i);
  assert.match(turn.final_dietavity_response, /No tengo información confirmada/i);
  assert.doesNotMatch(turn.final_dietavity_response, /incluye sin costo adaptar/i);
  assert.doesNotMatch(turn.final_dietavity_response, /^No tengo información confirmada/i);
});
