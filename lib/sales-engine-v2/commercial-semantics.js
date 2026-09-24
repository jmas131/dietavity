'use strict';

// Closed Ticket 65C mapping from deterministic commercial authorization to
// customer-expressible intent. These are not action or delivery contracts.
const COMMERCIAL_SEMANTICS_VERSION = 'ticket-65c-v1';
const RULES = Object.freeze({
  'commercial.checkout.standard': Object.freeze({ policy_version: '1', action_type: 'provide_checkout_destination', commercial_intent: 'checkout_offer' }),
  'commercial.checkout.glp1_canary': Object.freeze({ policy_version: '1', action_type: 'provide_holding_page_destination', commercial_intent: 'holding_page_offer' }),
});

class CommercialSemanticsError extends Error {
  constructor(code) { super(code); this.name = 'CommercialSemanticsError'; this.code = code; }
}

function projectCommercialSemantics(resolution) {
  const rule = resolution?.source?.type === 'deterministic_policy' ? RULES[resolution.source.id] : undefined;
  if (!rule || resolution.authority !== 'commercial_authorization' || resolution.resolution_status !== 'resolved' || resolution.source.version !== rule.policy_version || resolution.action_authorization?.action_type !== rule.action_type || resolution.action_authorization?.status !== 'authorized') throw new CommercialSemanticsError('COMMERCIAL_SEMANTICS_MAPPING_UNAVAILABLE');
  return { obligation_id: resolution.obligation_id, semantics_version: COMMERCIAL_SEMANTICS_VERSION, commercial_intent: rule.commercial_intent, destination: { status: 'authorized_to_provide' } };
}

module.exports = { COMMERCIAL_SEMANTICS_VERSION, CommercialSemanticsError, projectCommercialSemantics };
