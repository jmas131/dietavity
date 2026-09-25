'use strict';

const GATE_ID = 'semantic-guidance-safety-gate';
const GATE_VERSION = 'ticket-64b-v1';
const ASSESSMENT_STAGE = 'semantic_guidance_safety';
const FINDING_SEVERITIES = Object.freeze({
  unsupported_external_fact: 'review_required',
  product_or_provider_claim: 'blocking',
  commercial_claim: 'blocking',
  medication_management: 'blocking',
  diagnosis_or_prescription: 'blocking',
  unauthorized_action_claim: 'blocking',
  bounded_input_semantic_drift: 'review_required',
  reviewed_knowledge_contradiction: 'blocking',
  safety_sensitive_guidance: 'review_required',
  other_semantic_risk: 'review_required',
});

module.exports = { ASSESSMENT_STAGE, FINDING_SEVERITIES, GATE_ID, GATE_VERSION };
