'use strict';
const knowledge = require('../lib/dietavity-knowledge');
const contract = require('../lib/sales-response-contract');

module.exports = function applyTicket46(workflow) {
  const node = name => workflow.nodes.find(n => n.name === name);
  const classifier = node('Interpret Sales Buyer Signal');
  classifier.parameters.options.systemMessage += '\nUse business_location (buyer_signal question, material_question true) for business location, physical premises, in-person versus online service. A clear current question determines the topic, even after price/payment or purchase confirmation. History only resolves ambiguous follow-ups. Preserve other material questions in mixed turns.';
  const prompt = node('Build Constrained Sales Response');
  prompt.parameters.jsCode = prompt.parameters.jsCode.replace('  strategy: decision.strategy,', "  current_customer_message: $('Set Session Id').item.json.chatInput,\n  strategy: decision.strategy,");
  prompt.parameters.jsCode = prompt.parameters.jsCode.replace("'Responde únicamente", "'La pregunta actual determina el tema; la memoria solo aclara referencias ambiguas. Para business_location explica la modalidad digital y el acceso por portal con apoyo por WhatsApp. No repitas precio ni métodos de pago salvo que el mensaje actual también los pregunte. No inventes domicilios, atención presencial ni cobertura geográfica. No reinicies el descubrimiento. ' +\n'Responde únicamente");
  const validator = node('Validate Sales Response Contract');
  validator.parameters.jsCode = `${contract.preserveBusinessLocationResponse.toString()}\n${validator.parameters.jsCode}`;
  validator.parameters.jsCode = validator.parameters.jsCode.replace('const deterministicTopic = {', `const deterministicTopic = {\n  business_location: ${JSON.stringify(knowledge.BUSINESS_LOCATION_RESPONSE)},`);
  validator.parameters.jsCode = validator.parameters.jsCode.replace("new Set(['how_it_works'", "new Set(['business_location', 'how_it_works'");
  validator.parameters.jsCode = validator.parameters.jsCode.replace('|| !/programa|plan', "|| decision.topic !== 'business_location' && !/programa|plan");
  // Run after existing safety checks. A safety redirect still takes precedence.
  const anchor = 'return [{ json: { ...decision, output } }];';
  if (!validator.parameters.jsCode.includes(anchor)) throw new Error('Missing Ticket 46 validator anchor');
  validator.parameters.jsCode = validator.parameters.jsCode.replace(anchor, `let fallback_identity = output !== generated ? 'contract_repair_or_strategy' : null;
if (decision.topic === 'business_location' && !decision.deterministic_response) {
  const preserved = preserveBusinessLocationResponse(output);
  if (!preserved || (output === deterministicTopic.business_location && output !== generated)) {
    output = deterministicTopic.business_location;
    fallback_identity = 'same_topic:business_location';
  }
}
return [{ json: { ...decision, fallback_identity, output } }];`);
};
