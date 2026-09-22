'use strict';

const {currentQuestionClauses, explicitProductQuestions} = require('./sales-response-contract');

// The existing semantic interpreter identifies the speech act. A task must cite
// a verbatim span of THIS message; prior goals/topics cannot create a task.
// This contract never grants purchase, reminder or provider authorization.
function currentConversationalTask(message, interpretation = {}) {
  const task = interpretation.current_task;
  if (interpretation.interpretation_valid === false || !task ||
      !['draft', 'transform', 'summarize', 'show'].includes(task.operation) ||
      typeof task.request !== 'string' || task.request.trim().length < 5 ||
      !String(message || '').includes(task.request.trim())) return null;
  return {operation: task.operation, request: task.request.trim()};
}

function taskProductMessage(message, task) {
  if (!task) return String(message || '');
  const remainder = String(message || '').replace(task.request, '');
  // A related how-to/formatting question is part of the current task, not an
  // unknown service capability merely because it has no canonical topic.
  // Retain independently recognizable facts AND unknown provider capabilities.
  return currentQuestionClauses(remainder).filter(clause =>
    explicitProductQuestions(clause + '?').length > 0 ||
    /\b(?:dietavity|servicio|ustedes|ofrecen|tienen|garantizan|su (?:programa|app|plan))\b/i.test(clause)
  ).map(clause => clause + '?').join(' ');
}

// Completion has a separate observable contract. A generic uncertainty answer
// cannot satisfy a writing task. Semantic fidelity is independently judged on
// the actual transcript; this local check does not claim to establish entailment.
function conversationalTaskCoverage(task, answer) {
  if (!task) return {requested: false, completed: null};
  const text = String(answer || '').trim();
  const content = text.match(/(?:^|\n)(?:Borrador|Resumen|Versión[^:\n]*):\s*([\s\S]+)/i)?.[1] || '';
  const onlyFallback = /^(?:["“«]\s*)?(?:no (?:tengo|hay) información confirmada|no pude responder|puedo ayudarte con información|claro[,!.]?\s*(?:puedo|te puedo|te ayudo))/i.test(content);
  return {requested: true, operation: task.operation,
    completed: content.trim().length >= 15 && !onlyFallback};
}

// Apply existing factual/safety validation to the draft as well as its framing.
// Operational promises have no canonical basis, even inside a quoted draft.
// Keep questions to support as questions, never turn them into guarantees.
function repairConversationalTask(text, task, invalidClause = () => false) {
  const sentences = String(text || '').match(/[\s\S]+?(?:[!?](?=\s|$)|\.(?=\s|$)|\n|$)/g) || [];
  const repaired = sentences.map(sentence => {
    // Safety/identifier/commercial checks are supplied by the same canonical
    // validator. Remove only the offending sentence, never the valid task body.
    if (invalidClause(sentence)) return '';
    const value = sentence.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const operationalClaim = /\b(?:garantiza\w*|asegura\w*|adaptamos|adaptan|ofrecemos|ofrecen|incluye|permite|responden|respondemos|responde|tardan|tardamos)\b/.test(value) &&
      /batch.?cooking|cocin\w*.{0,35}\d+\s*minut|\d+\s*(?:minutos|horas)|24\s*\/\s*7|sla/.test(value);
    const falseCommercial = /\$\s*(?!149\b)\d+|\b(?!28\b)\d+\s*dias de programa|nutriolog\w*.{0,40}(?:revisa|supervisa|elabora)|(?:garantiza\w*|asegura\w*).{0,40}(?:adelgazar|perder peso|bajar de peso)/.test(value);
    if (falseCommercial || operationalClaim && !/[¿?]/.test(sentence)) {
      return ' No hay información confirmada para afirmar ese detalle. ';
    }
    return sentence;
  }).join('').trim();
  // Normalize excess generated follow-ups before the final one-question guard.
  // Keep one question at the end; the list/draft/summary is not the violation.
  const questions = repaired.match(/¿[^?]*\?/g) || [];
  let normalized = repaired;
  if (questions.length > 1) {
    normalized = repaired.replace(/(?:^|\n)\s*[-*]?\s*¿[^?]*\?/g, '').replace(/¿[^?]*\?/g, '').trim();
    normalized += '\n\n' + questions[0];
  }
  if (!normalized || /^(?:Borrador|Resumen|Versión[^:]*):/i.test(normalized)) return normalized;
  return (task?.operation === 'summarize' ? 'Resumen:\n' : 'Borrador:\n') + normalized;
}

module.exports = {currentConversationalTask, taskProductMessage, conversationalTaskCoverage, repairConversationalTask};
