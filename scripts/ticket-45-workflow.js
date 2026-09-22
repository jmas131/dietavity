'use strict';
const contract = require('../lib/sales-response-contract');

module.exports = function applyTicket45(workflow) {
  const node = workflow.nodes.find(n => n.name === 'Validate Sales Response Contract');
  const replace = (from, to) => {
    if (!node.parameters.jsCode.includes(from)) throw new Error('Missing Ticket 45 validator anchor: ' + from);
    node.parameters.jsCode = node.parameters.jsCode.replace(from, to);
  };
  node.parameters.jsCode = `${contract.repairInformationalResponse.toString()}\n${contract.constrainInformationalCta.toString()}\n${node.parameters.jsCode}`;
  replace('let output = decision.deterministic_response || generated;', `// Commercial facts and safety topics retain their existing deterministic protection.
const conversationalTopics = new Set(['how_it_works', 'personalization', 'product_scope', 'what_is_included', 'post_purchase', 'portal', 'WhatsApp_assistance', 'diet_support']);
deterministicTopic.how_it_works = 'En Dietavity armamos tu programa de 28 días con inteligencia artificial, principios generales de alimentación y la información que compartes después del pago. Respetamos tu estilo de alimentación, alergias y alimentos a evitar; las condiciones declaradas se consideran como contexto de seguridad. Lo consultas en el portal.';
deterministicTopic.personalization = asksAge ? deterministicTopic.personalization : 'Nos basamos en tu estilo de alimentación, alergias y alimentos a evitar; las condiciones médicas declaradas se consideran como contexto de seguridad, sin ofrecer tratamiento. Compartes esta información después del pago y con tu consentimiento.';
let output = decision.deterministic_response || repairInformationalResponse(generated, decision);`);
  replace("if (decision.strategy === 'answer_question' && !decision.deterministic_response && deterministicTopic[decision.topic]) output = deterministicTopic[decision.topic];", "if (decision.strategy === 'answer_question' && !decision.deterministic_response && deterministicTopic[decision.topic] && (!conversationalTopics.has(decision.topic) || !output || acknowledgementOnly || !/programa|plan|aliment|comida|dieta|personaliz|perfil|preferenc|restric|alerg|edad|inteligencia artificial|portal|WhatsApp|receta|restaurante/i.test(output))) output = deterministicTopic[decision.topic];");
  replace("decision.next_last_question_type === 'purchase_confirmation' && !/[?¿]/.test(output)", "decision.allow_purchase_cta === true && decision.next_last_question_type === 'purchase_confirmation' && !/[?¿]/.test(output)");
  replace('const outputQuestions =', `output = constrainInformationalCta(output, decision);
// An invitation alone is not an answer to the recognized question.
if (decision.strategy === 'answer_question' && !decision.deterministic_response &&
    (!output || /^¿[^?]+\\?$/.test(output.trim()))) output = constrainInformationalCta(deterministicTopic[decision.topic] || fallback.answer_question, decision);
const outputQuestions =`);
  replace("decision.offer_context === 'glp1_validation' && glp1ResponseViolatesScope(output)", "(decision.offer_context === 'glp1_validation' || decision.strategy === 'answer_question') && glp1ResponseViolatesScope(output)");
  replace('output = fallback[decision.strategy] || fallback.conversational;', "output = decision.strategy === 'answer_question' ? (deterministicTopic[decision.topic] || fallback.answer_question) : (fallback[decision.strategy] || fallback.conversational);\noutput = constrainInformationalCta(output, decision);");
};
