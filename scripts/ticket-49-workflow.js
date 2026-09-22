'use strict';
const contract = require('../lib/sales-response-contract');
const {MULTI_TOPIC_ANSWERS} = require('../lib/dietavity-knowledge');
module.exports = function applyTicket49(workflow) {
  const node = name => workflow.nodes.find(n => n.name === name);
  const functions = [contract.explicitProductQuestions, contract.productAnswerCoverage,
    contract.multiTopicDiagnostics, contract.canonicalMultiTopicResponse,
    contract.uncertaintySubject, contract.currentQuestionUnits, contract.currentQuestionClauses, contract.constrainedSampleRequest,
    contract.currentQuestionDetails, contract.preserveCurrentQuestion].map(fn => fn.toString()).join('\n');
  const validator = node('Validate Sales Response Contract');
  validator.parameters.jsCode = `${functions}\nconst MULTI_TOPIC_ANSWERS = ${JSON.stringify(MULTI_TOPIC_ANSWERS)};\n${validator.parameters.jsCode}`;
  const anchor = "const questions = (generated.match(/\\?/g) || []).length;";
  if (!validator.parameters.jsCode.includes(anchor)) throw new Error('Missing Ticket 49 validator anchor');
  validator.parameters.jsCode = validator.parameters.jsCode.replace(anchor, `const currentMessage = $('Set Session Id').item.json.chatInput;
const preservedQuestion = preserveCurrentQuestion(currentMessage, decision, MULTI_TOPIC_ANSWERS);
if (preservedQuestion !== null) {
  return [{ json: { ...decision, output: preservedQuestion, allow_purchase_cta: false, next_last_question_type: null,
    fallback_identity: 'current_question:unconfirmed_detail',
    current_question_details_preserved: true,
    unconfirmed_current_question_count: currentQuestionDetails(currentMessage, MULTI_TOPIC_ANSWERS, decision.deterministic_response || '').filter(d => d.uncertain).length,
    ...multiTopicDiagnostics(currentMessage, generated, preservedQuestion, decision) } }];
}
const multiTopicOutput = canonicalMultiTopicResponse(currentMessage, decision, MULTI_TOPIC_ANSWERS);
if (multiTopicOutput !== null) {
  return [{ json: { ...decision, output: multiTopicOutput, allow_purchase_cta: false, next_last_question_type: null,
    fallback_identity: 'multi_topic:canonical_facts',
    ...multiTopicDiagnostics(currentMessage, generated, multiTopicOutput, decision) } }];
}
${anchor}`);
  // Preserve all legacy validation for single-topic turns and safety overrides.
  validator.parameters.jsCode = validator.parameters.jsCode.replace(
    'return [{ json: { ...decision, fallback_identity, output } }];',
    `if (decision.deterministic_reason === 'current_product_question' && productAnswerCoverage(explicitProductQuestions(currentMessage), output).missing_topics.length) {
  output = explicitProductQuestions(currentMessage).map(topic => MULTI_TOPIC_ANSWERS[topic]).filter(Boolean).join('\\n\\n');
  fallback_identity = 'current_question:canonical_facts';
}
return [{ json: { ...decision, fallback_identity, ...multiTopicDiagnostics(currentMessage, generated, output, decision), output } }];`);
  const prompt = node('Build Constrained Sales Response');
  prompt.parameters.jsCode = `${contract.explicitProductQuestions.toString()}\n${prompt.parameters.jsCode}`
    .replace('  current_customer_message:', "  explicit_current_question_topics: explicitProductQuestions($('Set Session Id').item.json.chatInput),\n  current_customer_message:");
};
