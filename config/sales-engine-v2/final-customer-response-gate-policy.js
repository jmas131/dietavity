'use strict';

const GATE_ID = 'final-customer-response-gate';
const GATE_VERSION = 'ticket-67-v1';
const BINDING_VERSION = 'ticket-67-v1';
const ASSESSMENT_STAGE = 'final_customer_response_semantic_validation';
const ASSESSOR_UNAVAILABLE = 'FINAL_RESPONSE_ASSESSOR_UNAVAILABLE';

// This is trusted fixed instruction material, deliberately separate from the
// untrusted candidate/envelope. Keeping code, definition, and severity in one
// canonical table prevents assessor/runtime taxonomy drift.
const FINDING_TAXONOMY = Object.freeze({
  unsupported_product_or_provider_claim: 'Adds an unsupplied product feature, product fact, provider fact, or provider capability.',
  unsupported_commercial_claim: 'Adds an unsupplied price, offer, eligibility, purchase route, or other commercial term.',
  unsupported_practical_guidance: 'Adds practical, nutrition, quantity, preparation, or behavior guidance not in permitted guidance.',
  medication_management: 'Gives medication-starting, stopping, dosing, adjustment, or prescriber-management advice.',
  diagnosis_or_prescription: 'Diagnoses, prescribes, treats, or gives clinical individualized medical direction.',
  unauthorized_action_or_execution_claim: 'States or implies an action was authorized, attempted, completed, or will be executed without supplied authority.',
  unsupported_payment_claim: 'States or implies payment was processed, confirmed, received, or completed without supplied payment evidence.',
  delivery_or_receipt_claim: 'States or implies a destination/message was sent, delivered, received, opened, or seen.',
  reminder_or_future_action_claim: 'Promises a reminder, retry, follow-up, future link, timing, or future action.',
  unauthorized_future_capability_claim: 'States future or permanent product/provider availability or capability not supplied.',
  uncertainty_overstatement: 'Turns an unknown, unavailable, indeterminate, or resolver-failure semantic into a fact or capability claim.',
  withholding_semantic_violation: 'Broadens a withholding expression by exposing a reason, safety finding, referral, permanent/future claim, or prohibited explanation.',
  support_semantic_overstatement: 'Turns unresolved support into unavailable support, escalation, contact, resolution, or a future promise.',
  unauthorized_question_or_cta: 'Adds a question or call to action not authorized by the bounded question/response semantics.',
  clarification_semantic_drift: 'Uses an authorized clarification question to seek a different, broader, or commercial subject.',
  destination_semantic_violation: 'Uses an exact destination with unsupported payment, execution, delivery, receipt, opening, retry, or route semantics.',
  artifact_or_guidance_reconstruction: 'Reconstructs withheld guidance or a blocked/indeterminate artifact, or exposes its protected content.',
  authority_escalation: 'Claims any authority, truth, policy, action, execution, delivery, or capability beyond the whole supplied envelope.',
  other_semantic_risk: 'Captures a material semantic escape not covered by a more specific closed code.',
});

// Ticket 67 is deliberately fail-closed: a completed semantic finding never
// has a customer-visible "warning" severity.
const FINDING_SEVERITIES = Object.freeze(Object.fromEntries(Object.keys(FINDING_TAXONOMY).map(code => [code, 'blocking'])));

module.exports = { ASSESSMENT_STAGE, ASSESSOR_UNAVAILABLE, BINDING_VERSION, FINDING_SEVERITIES, FINDING_TAXONOMY, GATE_ID, GATE_VERSION };
