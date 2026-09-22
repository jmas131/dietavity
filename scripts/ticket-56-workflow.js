'use strict';

const contract = require('../lib/sales-response-contract');

module.exports = function applyTicket56(workflow) {
  const node = name => workflow.nodes.find(n => n.name === name);
  const prompt = node('Build Constrained Sales Response');
  prompt.parameters.jsCode = prompt.parameters.jsCode.replace(
    "'Responde únicamente",
    "'Para practical_guidance responde directamente con orientación general y segura sobre cómo organizar, preparar, conservar, escalar o recalentar comidas. No afirmes que Dietavity incluye, adapta, garantiza o confirma ese arreglo; si la pregunta sí es sobre una capacidad del servicio, responde únicamente con hechos canónicos o incertidumbre explícita. ' +\n'Responde únicamente",
  );

  const validator = node('Validate Sales Response Contract');
  validator.parameters.jsCode = `${contract.practicalGuidanceQuestion.toString()}\n${contract.repairMixedCurrentQuestion.toString()}\n${validator.parameters.jsCode}`;
  const preservedAnchor = "const preservedQuestion = preserveCurrentQuestion(currentMessage, decision, MULTI_TOPIC_ANSWERS);";
  if (!validator.parameters.jsCode.includes(preservedAnchor)) throw new Error('Missing Ticket 56 preservation anchor');
  // This branch precedes the legacy declaration of validator-local predicates.
  // The contract helper carries its own provider-promise boundary; do not close
  // over later const bindings here (which would convert safe repair into a
  // runtime failure and trigger the old whole-response fallback).
  validator.parameters.jsCode = validator.parameters.jsCode.replace(preservedAnchor,
    `const preservedQuestion = repairMixedCurrentQuestion(currentMessage, generated, decision, MULTI_TOPIC_ANSWERS) ||
  preserveCurrentQuestion(currentMessage, decision, MULTI_TOPIC_ANSWERS);`);
  const anchor = 'let output = decision.deterministic_response || repairInformationalResponse(generated, decision);';
  if (!validator.parameters.jsCode.includes(anchor)) throw new Error('Missing Ticket 56 validator anchor');
  validator.parameters.jsCode = validator.parameters.jsCode.replace(anchor,
    `let output = decision.deterministic_response || repairInformationalResponse(generated, decision);
if (decision.deterministic_reason === 'practical_guidance') {
  // Keep useful current-turn guidance, but discard unsupported service promises
  // and the same unsafe personalization/clinical claims guarded elsewhere.
  output = repairInformationalResponse(output, { ...decision, strategy: 'answer_question' });
  output = String(output || '').split(/(?<=[.!?])\\s+/).filter(sentence =>
    !/\\b(?:dietavity|el programa|el servicio|nosotros)\\b.{0,80}\\b(?:incluye|ofrece|adapta|garantiza|confirma|permite|responde)\\b/i.test(sentence)
  ).join(' ').trim();
}`);

  const taskSafetyAnchor = String.raw`responseHasAmbiguousQuestion(clause) ||
    /\$\s*99|99\s*MXN|al mes|suscr[ií]b|planes? de 7 d[ií]as.*actualiz/i.test(clause)`;
  if (!validator.parameters.jsCode.includes(taskSafetyAnchor)) throw new Error('Missing Ticket 56 task safety anchor');
  validator.parameters.jsCode = validator.parameters.jsCode.replace(taskSafetyAnchor, String.raw`responseHasAmbiguousQuestion(clause) ||
    /\b(?:garantiza\w*|asegura\w*)\b|\b(?:incluye|ofrece)\b.{0,80}\b(?:llamada|videollamada|consulta|revisi[oó]n humana)\b/i.test(clause) ||
    /\$\s*99|99\s*MXN|al mes|suscr[ií]b|planes? de 7 d[ií]as.*actualiz/i.test(clause)`);

  const taskFactualAnchor = 'const factualAnswer = preservedQuestion || multiTopicOutput || explicitProductQuestions(currentMessage).map(topic => topic === \'payment_methods\' ? MULTI_TOPIC_ANSWERS.confirmed_payment_methods : MULTI_TOPIC_ANSWERS[topic]).filter(Boolean).join(\'\\n\\n\');';
  if (!validator.parameters.jsCode.includes(taskFactualAnchor)) throw new Error('Missing Ticket 56 task factual anchor');
  validator.parameters.jsCode = validator.parameters.jsCode.replace(taskFactualAnchor,
    'const factualAnswer = preservedQuestion || multiTopicOutput || explicitProductQuestions(currentMessage).map(topic => topic === \'payment_methods\' ? MULTI_TOPIC_ANSWERS.confirmed_payment_methods : MULTI_TOPIC_ANSWERS[topic]).filter(Boolean).join(\'\\n\\n\');');
  const taskCompositionAnchor = "if (factualAnswer) output = factualAnswer + '\\n\\n' + output;";
  if (!validator.parameters.jsCode.includes(taskCompositionAnchor)) throw new Error('Missing Ticket 56 task composition anchor');
  validator.parameters.jsCode = validator.parameters.jsCode.replace(taskCompositionAnchor,
    "if (factualAnswer) output = factualAnswer.replace(/¿[^?]*\\?/g, '').replace(/\\n{3,}/g, '\\n\\n').trim() + '\\n\\n' + output;");
};
