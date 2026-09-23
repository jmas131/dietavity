'use strict';

const OUTCOMES = new Set(['authorized', 'prohibited', 'clarification_required', 'unsupported']);
const ACTION_TYPES = new Set(['provide_checkout_destination', 'provide_holding_page_destination', 'schedule_reminder']);
const CATEGORIES = new Set(['medication_management', 'commercial_purchase_intent', 'reminder_request']);
const CAMPAIGNS = new Set(['standard', 'glp1_validation']);
const POLICY_KEYS = new Set(['id', 'version', 'status', 'category', 'subtypes', 'campaign', 'outcome', 'action_type', 'reason_code', 'required_context', 'required_handling', 'prohibited_handling', 'when']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The reminder adapter supplies an ISO-8601 instant with an explicit timezone.
// Validate its representation without normalizing it: the exact input string is
// execution authority and must be preserved by Policy Resolver output.
function isIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const numericMonth = Number(month);
  const numericDay = Number(day);
  if (numericMonth < 1 || numericMonth > 12 || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))) return false;
  const daysInMonth = new Date(Date.UTC(Number(year), numericMonth, 0)).getUTCDate();
  return numericDay >= 1 && numericDay <= daysInMonth && !Number.isNaN(Date.parse(value));
}

function validatePolicy(policy) {
  if (!isPlainObject(policy)) return 'POLICY_MUST_BE_OBJECT';
  if (Object.keys(policy).some(key => !POLICY_KEYS.has(key))) return 'POLICY_FIELD_INVALID';
  if (typeof policy.id !== 'string' || !policy.id) return 'POLICY_ID_INVALID';
  if (!Number.isInteger(policy.version) || policy.version < 1) return 'POLICY_VERSION_INVALID';
  if (policy.status !== 'active') return 'POLICY_STATUS_INVALID';
  if (!CATEGORIES.has(policy.category)) return 'POLICY_CATEGORY_INVALID';
  if (!Array.isArray(policy.subtypes) || !policy.subtypes.length || policy.subtypes.some(value => typeof value !== 'string' || !value)) return 'POLICY_SUBTYPES_INVALID';
  if (!OUTCOMES.has(policy.outcome)) return 'POLICY_OUTCOME_INVALID';
  if (typeof policy.reason_code !== 'string' || !/^[A-Z0-9_]+$/.test(policy.reason_code)) return 'POLICY_REASON_CODE_INVALID';
  if (policy.campaign !== undefined && !CAMPAIGNS.has(policy.campaign)) return 'POLICY_CAMPAIGN_INVALID';
  if (policy.action_type !== undefined && !ACTION_TYPES.has(policy.action_type)) return 'POLICY_ACTION_INVALID';
  if (policy.outcome === 'authorized' && !policy.action_type) return 'POLICY_AUTHORIZATION_ACTION_REQUIRED';
  if (policy.outcome !== 'authorized' && policy.action_type !== undefined) return 'POLICY_NONAUTHORIZATION_ACTION_FORBIDDEN';
  for (const key of ['required_context', 'required_handling', 'prohibited_handling']) {
    if (policy[key] !== undefined && (!Array.isArray(policy[key]) || policy[key].some(value => typeof value !== 'string' || !value))) return 'POLICY_' + key.toUpperCase() + '_INVALID';
  }
  if (policy.when !== undefined) {
    if (!isPlainObject(policy.when) || Object.keys(policy.when).some(key => !['reminder_scheduled_for', 'safety_gate'].includes(key))) return 'POLICY_WHEN_INVALID';
    if (policy.when.reminder_scheduled_for !== undefined && policy.when.reminder_scheduled_for !== 'missing') return 'POLICY_WHEN_INVALID';
    if (policy.when.safety_gate !== undefined && !['clear', 'blocked', 'indeterminate'].includes(policy.when.safety_gate)) return 'POLICY_WHEN_INVALID';
  }
  return null;
}

function validateDictionary(dictionary) {
  if (!isPlainObject(dictionary) || typeof dictionary.policy_dictionary_version !== 'string' || !dictionary.policy_dictionary_version || !Array.isArray(dictionary.policies)) throw new TypeError('POLICY_DICTIONARY_INVALID');
  const ids = new Set();
  for (const policy of dictionary.policies) {
    const error = validatePolicy(policy);
    if (error) throw new TypeError(error);
    const identity = policy.id + '|' + policy.version;
    if (ids.has(identity)) throw new TypeError('POLICY_DUPLICATE_VERSION');
    ids.add(identity);
  }
  return dictionary;
}

module.exports = { ACTION_TYPES, CAMPAIGNS, CATEGORIES, OUTCOMES, isIsoTimestamp, isPlainObject, validateDictionary, validatePolicy };
