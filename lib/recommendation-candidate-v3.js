'use strict';

// Candidate V3 deliberately validates authority and structure, not culinary
// correctness. Food labels and culinary verbs are request-local open text.
const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const STATUSES = new Set(['confirmed_available', 'unavailable', 'restricted', 'recently_consumed', 'mentioned']);
const PROPOSED_ROLES = new Set(['ingredient', 'obtain']);
const PROHIBITED = /(?:\b(?:dosis|medic(?:amento|acion)?|mounjaro|ozempic|semaglutida|tirzepatida|insulina|tratamiento|cura|cl[ií]nic|diagn[oó]stic|calor[ií]a|kcal|macros?|bajar\s+de\s+peso|adelgaz|garantiz|ideal\s+para\s+la\s+salud)\b|https?:\/\/|\bwww\b|\$\s*\d)/iu;
const QUANTITATIVE_PROTEIN = /(?:\b\d+(?:[.,]\d+)?\s*(?:g|gr|gramos?)\s+(?:de\s+)?prote[ií]na\b|\bprote[ií]na\s*[:=]?\s*\d+(?:[.,]\d+)?\s*(?:g|gr|gramos?)\b)/iu;
const POSSESSION = /(?:\b(?:tu|tus|su|sus|mi|mis)\s+%LABEL%\b|\b(?:la|el|los|las)\s+%LABEL%\s+que\s+tienes\b|\b%LABEL%\s+que\s+tienes\b|\bcon\s+%LABEL%\s+disponible\b|(?<!si\s)\b(?:tienes|hay|cuentas\s+con|dispones\s+de)\s+(?:el|la|los|las|un|una)?\s*%LABEL%\b)/iu;

function plain(value) { return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype; }
function array(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length || Object.keys(value).length !== value.length) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    return descriptor && OWN(descriptor, 'value') && descriptor.enumerable;
  });
}
function closed(value, keys, required = keys) {
  if (!plain(value) || Object.getOwnPropertySymbols(value).length) return false;
  const names = Object.getOwnPropertyNames(value);
  if (![...required].every(key => names.includes(key)) || !names.every(key => keys.has(key))) return false;
  return names.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && OWN(descriptor, 'value');
  });
}
function normalize(value) { return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es-MX').replace(/\s+/gu, ' ').trim(); }
function escape(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
function boundedLabel(value, max = 80) {
  const label = String(value || '').trim().replace(/\s+/gu, ' ');
  return label && label.length <= max && /^[\p{L}][\p{L}\p{M}0-9' -]*$/u.test(label) && !/[¿?!]/u.test(label) && !prohibited(label) ? label : null;
}
function boundedDishLabel(value) {
  const label = String(value || '').trim().replace(/\s+/gu, ' ');
  return label && label.length <= 80 && /^[\p{L}][\p{L}\p{M}0-9' ,:()/&-]*$/u.test(label) && !/[¿?!]/u.test(label) && !prohibited(label) ? label : null;
}
function prohibited(value) { return PROHIBITED.test(value) || QUANTITATIVE_PROTEIN.test(value); }
function labelVariants(label) {
  const normal = normalize(label);
  const variants = new Set([normal]);
  if (/s$/u.test(normal)) variants.add(normal.slice(0, -1));
  else variants.add(`${normal}s`);
  return [...variants].filter(Boolean);
}
function phraseRegex(label) { return new RegExp(`(?:^|[^\\p{L}])(?:${labelVariants(label).map(escape).join('|')})(?=$|[^\\p{L}])`, 'iu'); }

function ledgerFact(id, label, status, provenance) {
  if (typeof id !== 'string' || !/^food-\d+$/u.test(id) || !boundedLabel(label) || !STATUSES.has(status) || !['current_turn', 'canonical_history'].includes(provenance)) throw new TypeError('V3_LEDGER_FACT_INVALID');
  return Object.freeze({ id, label: boundedLabel(label), status, provenance });
}

function validateLedger(value) {
  if (!array(value) || value.length > 12) throw new TypeError('V3_LEDGER_INVALID');
  const facts = value.map(item => {
    if (!closed(item, new Set(['id', 'label', 'status', 'provenance']))) throw new TypeError('V3_LEDGER_INVALID');
    return ledgerFact(item.id, item.label, item.status, item.provenance);
  });
  if (new Set(facts.map(item => item.id)).size !== facts.length) throw new TypeError('V3_LEDGER_INVALID');
  return Object.freeze(facts);
}

function buildTrustedInput({ ledger, appetite = 'unknown', request_kind = 'food_decision' } = {}) {
  const facts = validateLedger(ledger);
  if (!['low', 'unknown'].includes(appetite) || request_kind !== 'food_decision') throw new TypeError('V3_TRUSTED_INPUT_INVALID');
  return Object.freeze({ contract_version: 'recommendation-candidate-v3', locale: 'es-MX', request_kind, appetite, food_facts: facts });
}

function validId(value, pattern) { return typeof value === 'string' && pattern.test(value); }
function uniqueStrings(values) { return array(values) && values.every(value => typeof value === 'string') && new Set(values).size === values.length; }
function invalid(reason) { return Object.freeze({ valid: false, reason }); }

function validateProposal(payload, trusted) {
  try {
    if (!plain(trusted) || !array(trusted.food_facts)) return invalid('trusted_input_invalid');
    if (!closed(payload, new Set(['candidate_type', 'dish', 'proposed_items', 'customer_response']))) return invalid('candidate_shape_invalid');
    if (payload.candidate_type !== 'meal_proposal') return invalid('candidate_type_invalid');
    if (!closed(payload.dish, new Set(['label', 'confirmed_anchor_ids'])) || !boundedDishLabel(payload.dish.label)) return invalid('dish_invalid');
    if (!uniqueStrings(payload.dish.confirmed_anchor_ids) || payload.dish.confirmed_anchor_ids.length > 4 || !payload.dish.confirmed_anchor_ids.every(id => validId(id, /^food-\d+$/u))) return invalid('anchors_invalid');
    if (!array(payload.proposed_items) || payload.proposed_items.length > 4) return invalid('proposed_items_invalid');
    if (typeof payload.customer_response !== 'string' || !payload.customer_response.trim() || payload.customer_response.length > 600) return invalid('response_invalid');
    if (prohibited(payload.customer_response) || /[?¿]/u.test(payload.customer_response)) return invalid('response_prohibited_content');

    const facts = new Map(trusted.food_facts.map(item => [item.id, item]));
    const anchors = payload.dish.confirmed_anchor_ids.map(id => facts.get(id));
    if (anchors.some(item => !item || item.status !== 'confirmed_available')) return invalid('anchor_not_confirmed');
    const confirmedFacts = trusted.food_facts.filter(item => item.status === 'confirmed_available');
    const blocked = new Set(trusted.food_facts.filter(item => ['unavailable', 'restricted'].includes(item.status)).map(item => normalize(item.label)));
    const proposed = payload.proposed_items.map(item => {
      if (!closed(item, new Set(['id', 'label', 'role'])) || !validId(item.id, /^proposed-\d+$/u) || !boundedLabel(item.label) || !PROPOSED_ROLES.has(item.role) || prohibited(item.label)) throw new Error('proposed_item_invalid');
      const label = boundedLabel(item.label);
      if (blocked.has(normalize(label))) throw new Error('proposed_blocked');
      if (confirmedFacts.some(fact => normalize(fact.label) === normalize(label))) throw new Error('proposed_duplicates_confirmed');
      return Object.freeze({ id: item.id, label, role: item.role });
    });
    if (new Set(proposed.map(item => item.id)).size !== proposed.length || new Set(proposed.map(item => normalize(item.label))).size !== proposed.length) return invalid('proposed_duplicate');
    return Object.freeze({ valid: true, proposal: Object.freeze({ candidate_type: payload.candidate_type, dish: Object.freeze({ label: boundedDishLabel(payload.dish.label), confirmed_anchor_ids: Object.freeze([...payload.dish.confirmed_anchor_ids]) }), proposed_items: Object.freeze(proposed), customer_response: payload.customer_response.trim() }), anchors: Object.freeze(anchors) });
  } catch (error) {
    return invalid(error.message || 'candidate_invalid');
  }
}

function sentenceCount(value) { return String(value).split(/[.!]+/u).filter(part => part.trim()).length; }

function validateCustomerResponse(validated, trustedFoodFacts = []) {
  if (!validated?.valid || !validated.proposal) return invalid('proposal_not_validated');
  const proposal = validated.proposal;
  const response = proposal.customer_response;
  if (response.length > 600 || response.trim().split(/\s+/u).length > 90 || sentenceCount(response) > 3) return invalid('response_bounds_invalid');
  if (/[?¿]/u.test(response) || prohibited(response) || /(?:\[\[|\]\]|<[^>]+>)/u.test(response)) return invalid('response_prohibited_content');
  const anchors = validated.anchors;
  if (!anchors.every(item => phraseRegex(item.label).test(normalize(response)))) return invalid('anchor_not_rendered');
  for (const item of proposal.proposed_items) {
    const possession = new RegExp(POSSESSION.source.replace(/%LABEL%/gu, escape(normalize(item.label))), 'iu');
    if (possession.test(normalize(response))) return invalid('conditional_possession_claim');
  }
  const blocked = new Set();
  // The validated proposal does not expose all ledger facts directly; caller
  // supplies them on the trusted snapshot for this check.
  for (const item of trustedFoodFacts) if (['restricted', 'unavailable'].includes(item.status)) blocked.add(item.label);
  if ([...blocked].some(label => phraseRegex(label).test(normalize(response)))) return invalid('blocked_food_rendered');
  return Object.freeze({ valid: true, response });
}

function selectRecommendation(payload, trusted) {
  const proposal = validateProposal(payload, trusted);
  if (!proposal.valid) return proposal;
  const response = validateCustomerResponse(proposal, trusted.food_facts);
  return response.valid ? Object.freeze({ valid: true, proposal: proposal.proposal, response: response.response }) : response;
}

module.exports = Object.freeze({ buildTrustedInput, validateLedger, validateProposal, validateCustomerResponse, selectRecommendation, normalize, boundedLabel, boundedDishLabel, prohibited, ledgerFact });
