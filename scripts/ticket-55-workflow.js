'use strict';
const task = require('../lib/sales-conversational-task');

module.exports = function applyTicket55(workflow) {
  const node = name => workflow.nodes.find(n => n.name === name);
  const replace = (name, from, to) => {
    const target = node(name).parameters;
    if (!target.jsCode.includes(from)) throw new Error('Missing Ticket 55 anchor: ' + name);
    target.jsCode = target.jsCode.replace(from, to);
  };
  node('Interpret Sales Buyer Signal').parameters.options.systemMessage += `
Also return current_task: null or {"operation":"draft|transform|summarize|show","request":"verbatim current-message span"}.
Identify the CURRENT speech act semantically: a request to compose, rewrite, shorten, change medium, summarize or display text is a conversational task, not a question about an unknown service capability. Use history only to resolve the source text/referent. Do not infer tasks from old goals or offers, acknowledgements, or hypothetical discussion. request must quote the explicit current task exactly, including related how-to/formatting questions about that task, and exclude separate product-fact questions and purchase requests. Keep buyer_signal question for a writing task. An SLA question is factual; writing a message to ask about an SLA is a task. Tasks must use only established facts; unsupported premises remain unconfirmed. Safety policy still applies to requests to write medical advice. Never treat quoted purchase language within a draft as authorization.`;
  node('Parse Sales Interpretation').parameters.jsCode = task.currentConversationalTask.toString() + '\n' + node('Parse Sales Interpretation').parameters.jsCode;
  replace('Parse Sales Interpretation', '    goal_supplied:', "    current_task: currentConversationalTask($('Set Session Id').item.json.chatInput, parsed),\n    goal_supplied:");
  replace('Build Constrained Sales Response', '  strategy: decision.strategy,', '  current_task: decision.current_task || null,\n  strategy: decision.strategy,');
  replace('Build Constrained Sales Response', 'goal: decision.goal || session.goal || null,', 'goal: decision.current_task ? null : decision.goal || session.goal || null,');
  replace('Build Constrained Sales Response', "'Responde únicamente", `'Si current_task existe, realiza ahora esa tarea usando la conversación para resolver el texto de origen. Entrega el texto solicitado, no una oferta de redactarlo ni una respuesta genérica sobre el servicio. Usa Borrador: para mensajes y Resumen: para resúmenes. Respeta el medio y la extensión solicitados. No añadas preguntas comerciales. El borrador puede contener como máximo una pregunta, al final. Usa solo hechos canónicos y contexto establecido; nunca conviertas deseos del cliente en capacidades del servicio. Si redactas una consulta sobre algo no confirmado, formúlalo como pregunta, no como promesa. No inventes plazos, garantías, batch cooking ni revisión humana. Si falta el texto de origen, pide únicamente ese texto. ' +\n'Responde únicamente`);
  const validator = node('Validate Sales Response Contract');
  validator.parameters.jsCode = [task.taskProductMessage, task.repairConversationalTask, task.conversationalTaskCoverage].map(fn => fn.toString()).join('\n') + '\n' + validator.parameters.jsCode;
  replace('Validate Sales Response Contract', "const currentMessage = $('Set Session Id').item.json.chatInput;", "const currentMessage = taskProductMessage($('Set Session Id').item.json.chatInput, decision.current_task);");
  replace('Validate Sales Response Contract', 'if (preservedQuestion !== null) {', 'if (preservedQuestion !== null && !decision.current_task) {');
  replace('Validate Sales Response Contract', 'if (multiTopicOutput !== null) {', 'if (multiTopicOutput !== null && !decision.current_task) {');
  replace('Validate Sales Response Contract', 'let output = decision.deterministic_response || repairInformationalResponse(generated, decision);',
    `let output = decision.deterministic_response || repairInformationalResponse(generated, decision);
if (decision.current_task && !decision.deterministic_response) output = repairConversationalTask(output, decision.current_task,
  clause => internalOfferVersion.test(clause) || unsupportedPersonalizationClaim.test(clause) || glp1ResponseViolatesScope(clause) || responseHasAmbiguousQuestion(clause) ||
    /\\$\\s*99|99\\s*MXN|al mes|suscr[ií]b|planes? de 7 d[ií]as.*actualiz/i.test(clause));`);
  // The normal validator still enforces safety, identifiers, claims and question
  // limits. Append independent factual answers without replacing the task body.
  replace('Validate Sales Response Contract', 'return [{ json: { ...decision, fallback_identity, ...multiTopicDiagnostics', `if (decision.current_task) {
  const factualAnswer = preservedQuestion || multiTopicOutput || explicitProductQuestions(currentMessage).map(topic => topic === 'payment_methods' ? MULTI_TOPIC_ANSWERS.confirmed_payment_methods : MULTI_TOPIC_ANSWERS[topic]).filter(Boolean).join('\\n\\n');
  if (factualAnswer) output = factualAnswer + '\\n\\n' + output;
}
return [{ json: { ...decision, current_task_coverage: conversationalTaskCoverage(decision.current_task, output), fallback_identity, ...multiTopicDiagnostics`);
};
