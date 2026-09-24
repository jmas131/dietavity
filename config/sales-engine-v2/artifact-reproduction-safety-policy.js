'use strict';

const GATE_ID = 'artifact-reproduction-safety-gate';
const GATE_VERSION = 'ticket-64a-v1';
const ASSESSMENT_STAGE = 'artifact_reproduction_safety';
const FINDING_SEVERITIES = Object.freeze({
  product_or_provider_claim: 'blocking',
  commercial_claim: 'blocking',
  medication_management: 'blocking',
  diagnosis_or_prescription: 'blocking',
  safety_sensitive_guidance: 'blocking',
  unauthorized_action_or_execution_claim: 'blocking',
  delivery_claim: 'blocking',
  transformation_authority_escalation: 'blocking',
  instruction_injection: 'blocking',
  other_reproduction_risk: 'review_required',
});

module.exports = { ASSESSMENT_STAGE, FINDING_SEVERITIES, GATE_ID, GATE_VERSION };
