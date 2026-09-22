'use strict';

const { MAX_OBLIGATIONS } = require('../../config/sales-engine-v2/interpreter-prompt');

const CATEGORIES = new Set(['product_fact', 'provider_service_fact', 'practical_guidance', 'conversational_task', 'commercial_purchase_intent', 'reminder_request', 'medication_management', 'safety_sensitive_nutrition', 'clarification', 'support_account', 'social_acknowledgement']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);
const OBLIGATION_KEYS = new Set(['category', 'subject', 'current_turn_evidence', 'confidence', 'ambiguous', 'attributes']);
const ATTRIBUTE_KEYS = new Set(['requested_fact', 'customer_candidate', 'customer_proposed_value', 'medication_decision', 'direction', 'requested_timing_text', 'task_operation']);

class InterpreterError extends Error {
  constructor(code, cause) { super(code); this.name = 'InterpreterError'; this.code = code; this.cause = cause; }
}

function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function only(object, keys) { return Object.keys(object).every(key => keys.has(key)); }
function validString(value) { return typeof value === 'string' && value.length > 0; }

function parseOutput(output) {
  if (typeof output === 'string') {
    try { return JSON.parse(output); } catch (error) { throw new InterpreterError('INTERPRETER_OUTPUT_INVALID', error); }
  }
  return output;
}

function validateAttributes(attributes) {
  if (!plainObject(attributes) || !only(attributes, ATTRIBUTE_KEYS)) throw new InterpreterError('INTERPRETER_ATTRIBUTES_INVALID');
  for (const value of Object.values(attributes)) if (!validString(value)) throw new InterpreterError('INTERPRETER_ATTRIBUTES_INVALID');
}

function duplicateKey(obligation) {
  return JSON.stringify([obligation.category, obligation.subject || null, obligation.current_turn_evidence, obligation.attributes || null]);
}

function validateModelOutput(output, currentText) {
  const parsed = parseOutput(output);
  if (!plainObject(parsed) || !only(parsed, new Set(['obligations'])) || !Array.isArray(parsed.obligations)) throw new InterpreterError('INTERPRETER_OUTPUT_INVALID');
  if (parsed.obligations.length > MAX_OBLIGATIONS) throw new InterpreterError('INTERPRETER_OBLIGATION_LIMIT_EXCEEDED');
  const seen = new Set();
  const normalized = [];
  for (const obligation of parsed.obligations) {
    if (!plainObject(obligation) || !only(obligation, OBLIGATION_KEYS)) throw new InterpreterError('INTERPRETER_OUTPUT_INVALID');
    if (!CATEGORIES.has(obligation.category) || !validString(obligation.current_turn_evidence) || !CONFIDENCES.has(obligation.confidence) || typeof obligation.ambiguous !== 'boolean') throw new InterpreterError('INTERPRETER_OUTPUT_INVALID');
    if (obligation.subject !== undefined && !validString(obligation.subject)) throw new InterpreterError('INTERPRETER_OUTPUT_INVALID');
    if (obligation.attributes !== undefined) validateAttributes(obligation.attributes);
    if (!currentText.includes(obligation.current_turn_evidence)) throw new InterpreterError('INTERPRETER_EVIDENCE_INVALID');
    const candidate = { category: obligation.category, ...(obligation.subject === undefined ? {} : { subject: obligation.subject }), current_turn_evidence: obligation.current_turn_evidence, confidence: obligation.confidence, ambiguous: obligation.ambiguous, ...(obligation.attributes === undefined ? {} : { attributes: structuredClone(obligation.attributes) }) };
    const key = duplicateKey(candidate);
    if (!seen.has(key)) { seen.add(key); normalized.push(candidate); }
  }
  return normalized.map((obligation, index) => ({ id: `o-${index + 1}`, ...obligation }));
}

module.exports = { ATTRIBUTE_KEYS, CATEGORIES, CONFIDENCES, InterpreterError, validateModelOutput };
