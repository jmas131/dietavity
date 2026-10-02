'use strict';
const rag = require('../lib/sales-engine-v2/direct-rag');

// Test-only: deterministic fixtures replace both model boundaries. No network,
// database, provider, or workflow execution dependency exists here.
function run({ message, obligations, commercialState = {}, history = [], composerFixtureOutput = null }) {
  const context = rag.buildConversationContext({ currentMessage: message, sessionId: 'direct-rag-test', commercialState, history });
  const validated_obligations = rag.validateObligations(obligations, message);
  const resolution = rag.resolveObligations({ context, obligations: validated_obligations });
  const composition_envelope = rag.buildCompositionEnvelope({ context, resolution });
  const composer_fixture_output = composerFixtureOutput || { response: resolution.permitted_claims.join(' '), coveredObligationIds: validated_obligations.map(x => x.id), usedClaims: [] };
  const gate_result = rag.gateResponse({ envelope: composition_envelope, ...composer_fixture_output });
  return { input_message: message, extracted_obligations: obligations, validated_obligations, resolved_obligations: resolution.resolved_obligations, permitted_claims: resolution.permitted_claims, authorized_action: resolution.authorized_action, checkout_suppressed_reason: resolution.checkout_suppressed_reason, conversation_policy: resolution.conversation_policy, composition_envelope, composer_fixture_output, gate_result, final_customer_response: gate_result.cleared ? composer_fixture_output.response : resolution.permitted_claims.join(' '), fallback_used: !gate_result.cleared };
}
module.exports = { run };
