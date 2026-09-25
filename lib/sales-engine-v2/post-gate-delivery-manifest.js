'use strict';

// Ticket 68A records only integrity evidence for a future reservation boundary.
// It neither persists nor exposes an eligible response to transport.
const crypto = require('node:crypto');
const { assertConversationContext } = require('./conversation-context-validator');
const { assertFinalComposerInput } = require('./final-composer-input');
const { assertComposerResult } = require('./response-composer');
const { candidateBinding, customerResponseEligible, finalCustomerResponseGateValid } = require('./final-customer-response-gate');
const { assertConversationalArtifactOutputIntent } = require('./conversational-artifact-output-identity');
const { postGateEligibilityCompanion, turnResultValid } = require('./turn-orchestrator');

const CONTRACT_VERSION = 'ticket-68a-v1';
const CONTEXT_BINDING_DOMAIN = 'post-gate-delivery-context-v1';
const COMPOSER_INPUT_BINDING_DOMAIN = 'post-gate-delivery-composer-input-v1';
const COMPOSER_RESULT_BINDING_DOMAIN = 'post-gate-delivery-composer-result-v1';
const FINAL_GATE_BINDING_DOMAIN = 'post-gate-delivery-final-gate-v1';
const RESPONSE_BINDING_DOMAIN = 'post-gate-delivery-response-v1';
const TURN_BINDING_DOMAIN = 'post-gate-delivery-turn-v1';
const LOGICAL_REPLY_DOMAIN = 'post-gate-delivery-logical-reply-v1';
const MANIFEST_KEYS = new Set(['contract_version', 'context_id', 'canonical_inbound_message_id', 'conversation_context_binding', 'final_composer_input_binding', 'composer_result_binding', 'ticket67_candidate_binding', 'final_gate_binding', 'eligible_response_binding', 'eligible_turn_binding', 'logical_reply_key', 'artifact_projection']);
const PROJECTION_KEYS = new Set(['artifact_id', 'artifact_type', 'generation_operation', 'generation_task_id', 'ordered_lineage_artifact_ids']);
const only = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.has(key));
const clone = value => structuredClone(value);

class PostGateDeliveryManifestError extends Error {
  constructor(code, cause) { super(code); this.name = 'PostGateDeliveryManifestError'; this.code = code; this.cause = cause; }
}

// Object keys are lexicographically sorted while arrays retain their semantic
// order. This is intentionally separate from ordinary JSON.stringify helpers.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(domain, value) { return crypto.createHash('sha256').update(canonicalJson([domain, value]), 'utf8').digest('hex'); }
function binding(prefix, domain, value) { return `${prefix}-${digest(domain, value)}`; }
function conversationContextBinding(value) { return binding('pgctx', CONTEXT_BINDING_DOMAIN, value); }
function finalComposerInputBinding(value) { return binding('pgfci', COMPOSER_INPUT_BINDING_DOMAIN, value); }
function composerResultBinding(value) { return binding('pgcr', COMPOSER_RESULT_BINDING_DOMAIN, value); }
function finalGateBinding(value) { return binding('pgfg', FINAL_GATE_BINDING_DOMAIN, value); }
function responseBinding(turnResult) { return binding('pgrsp', RESPONSE_BINDING_DOMAIN, { context_id: turnResult.context_id, customer_response: turnResult.customer_response }); }
function turnBinding(turnResult) { return binding('pgturn', TURN_BINDING_DOMAIN, turnResult); }
function logicalReplyKey({ canonicalInboundMessageId, eligibleResponseBinding }) { return `lrk-${digest(LOGICAL_REPLY_DOMAIN, [canonicalInboundMessageId.toLowerCase(), eligibleResponseBinding])}`; }

function projection(intent) {
  if (!intent) return null;
  return {
    artifact_id: intent.artifact_id,
    artifact_type: intent.artifact_type,
    generation_operation: intent.generation_operation,
    generation_task_id: intent.generation_task_id,
    ordered_lineage_artifact_ids: clone(intent.ordered_lineage_artifact_ids),
  };
}
function projectionValid(value) {
  return value === null || (only(value, PROJECTION_KEYS)
    && [...PROJECTION_KEYS].every(key => Object.hasOwn(value, key))
    && /^ca-[0-9a-f]{64}$/.test(value.artifact_id || '')
    && /^cgt-[0-9a-f]{64}$/.test(value.generation_task_id || '')
    && ['draft', 'summary'].includes(value.artifact_type)
    && ['draft', 'transform', 'summarize'].includes(value.generation_operation)
    && Array.isArray(value.ordered_lineage_artifact_ids)
    && value.ordered_lineage_artifact_ids.every(id => /^ca-[A-Za-z0-9._-]+$/.test(id))
    && new Set(value.ordered_lineage_artifact_ids).size === value.ordered_lineage_artifact_ids.length
    && value.artifact_type === (value.generation_operation === 'summarize' ? 'summary' : 'draft')
    && (value.generation_operation === 'draft' ? value.ordered_lineage_artifact_ids.length === 0 : value.ordered_lineage_artifact_ids.length > 0));
}

function input(turnResult) {
  if (!turnResult || typeof turnResult !== 'object' || Array.isArray(turnResult)) throw new PostGateDeliveryManifestError('POST_GATE_DELIVERY_MANIFEST_TURN_RESULT_INVALID');
  const companion = postGateEligibilityCompanion(turnResult);
  if (!companion) throw new PostGateDeliveryManifestError('POST_GATE_DELIVERY_MANIFEST_COMPANION_UNAVAILABLE');
  let context; let finalComposerInput; let composerResult;
  try {
    context = assertConversationContext(companion.conversation_context);
    finalComposerInput = assertFinalComposerInput(companion.final_composer_input);
    composerResult = assertComposerResult(companion.composer_result, { finalComposerInput });
  } catch (error) { throw new PostGateDeliveryManifestError('POST_GATE_DELIVERY_MANIFEST_COMPANION_INVALID', error); }
  if (!finalCustomerResponseGateValid(companion.final_gate) || !customerResponseEligible({ finalComposerInput, composerResult, finalGate: companion.final_gate })) throw new PostGateDeliveryManifestError('POST_GATE_DELIVERY_MANIFEST_ELIGIBILITY_INVALID');
  if (!turnResultValid(turnResult) || turnResult.status !== 'response_eligible' || turnResult.context_id !== context.context_id || turnResult.customer_response.text !== composerResult.response_text || turnResult.customer_response.composer_result_version !== composerResult.composer_result_version || turnResult.customer_response.final_gate_version !== companion.final_gate.gate_version) throw new PostGateDeliveryManifestError('POST_GATE_DELIVERY_MANIFEST_TURN_BINDING_INVALID');
  const intents = companion.artifact_output_intents;
  if (!Array.isArray(intents)) throw new PostGateDeliveryManifestError('POST_GATE_DELIVERY_MANIFEST_INTENTS_INVALID');
  if (intents.length > 1) throw new PostGateDeliveryManifestError('POST_GATE_DELIVERY_MANIFEST_MULTIPLE_ARTIFACT_INTENTS');
  if (intents.length === 1) {
    let intent;
    try { intent = assertConversationalArtifactOutputIntent(intents[0]); } catch (error) { throw new PostGateDeliveryManifestError('POST_GATE_DELIVERY_MANIFEST_INTENTS_INVALID', error); }
    if (!projectionValid(projection(intent))) throw new PostGateDeliveryManifestError('POST_GATE_DELIVERY_MANIFEST_INTENTS_INVALID');
  }
  return { context, finalComposerInput, composerResult, finalGate: clone(companion.final_gate), intents: clone(intents) };
}

function derive(turnResult) {
  const source = input(turnResult);
  const eligible_response_binding = responseBinding(turnResult);
  return {
    contract_version: CONTRACT_VERSION,
    context_id: source.context.context_id,
    canonical_inbound_message_id: source.context.current_message.canonical_message_id.toLowerCase(),
    conversation_context_binding: conversationContextBinding(source.context),
    final_composer_input_binding: finalComposerInputBinding(source.finalComposerInput),
    composer_result_binding: composerResultBinding(source.composerResult),
    ticket67_candidate_binding: clone(candidateBinding(source.composerResult)),
    final_gate_binding: finalGateBinding(source.finalGate),
    eligible_response_binding,
    eligible_turn_binding: turnBinding(turnResult),
    logical_reply_key: logicalReplyKey({ canonicalInboundMessageId: source.context.current_message.canonical_message_id, eligibleResponseBinding: eligible_response_binding }),
    artifact_projection: source.intents.length === 1 ? projection(source.intents[0]) : null,
  };
}

function manifestShapeValid(value) {
  return only(value, MANIFEST_KEYS) && [...MANIFEST_KEYS].every(key => Object.hasOwn(value, key))
    && value.contract_version === CONTRACT_VERSION
    && typeof value.context_id === 'string' && !!value.context_id
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.canonical_inbound_message_id || '')
    && ['conversation_context_binding', 'final_composer_input_binding', 'composer_result_binding', 'final_gate_binding', 'eligible_response_binding', 'eligible_turn_binding'].every(key => typeof value[key] === 'string' && /^pg(?:ctx|fci|cr|fg|rsp|turn)-[0-9a-f]{64}$/.test(value[key]))
    && only(value.ticket67_candidate_binding, new Set(['version', 'digest'])) && value.ticket67_candidate_binding.version === 'ticket-67-v1' && /^[0-9a-f]{64}$/.test(value.ticket67_candidate_binding.digest || '')
    && /^lrk-[0-9a-f]{64}$/.test(value.logical_reply_key || '')
    && projectionValid(value.artifact_projection);
}

function postGateDeliveryManifestValid(value, { turnResult } = {}) {
  if (!manifestShapeValid(value)) return false;
  if (!turnResult) return true;
  try { return canonicalJson(value) === canonicalJson(derive(turnResult)); } catch { return false; }
}
function assertPostGateDeliveryManifest(value, context) {
  if (!postGateDeliveryManifestValid(value, context)) throw new PostGateDeliveryManifestError('POST_GATE_DELIVERY_MANIFEST_INVALID');
  return deepFreeze(clone(value));
}
function buildPostGateDeliveryManifest({ turnResult } = {}) { return assertPostGateDeliveryManifest(derive(turnResult), { turnResult }); }
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; }

module.exports = { COMPOSER_INPUT_BINDING_DOMAIN, COMPOSER_RESULT_BINDING_DOMAIN, CONTRACT_VERSION, CONTEXT_BINDING_DOMAIN, FINAL_GATE_BINDING_DOMAIN, LOGICAL_REPLY_DOMAIN, PostGateDeliveryManifestError, RESPONSE_BINDING_DOMAIN, TURN_BINDING_DOMAIN, assertPostGateDeliveryManifest, buildPostGateDeliveryManifest, canonicalJson, composerResultBinding, conversationContextBinding, finalComposerInputBinding, finalGateBinding, logicalReplyKey, postGateDeliveryManifestValid, responseBinding, turnBinding };
