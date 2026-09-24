'use strict';

const { MAX_OBLIGATIONS } = require('../../config/sales-engine-v2/interpreter-prompt');

const CATEGORIES = new Set(['product_fact', 'provider_service_fact', 'practical_guidance', 'conversational_task', 'commercial_purchase_intent', 'reminder_request', 'medication_management', 'safety_sensitive_nutrition', 'clarification', 'support_account', 'social_acknowledgement']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);
const OBLIGATION_KEYS = new Set(['category', 'subject', 'current_turn_evidence', 'confidence', 'ambiguous', 'attributes', 'practical_task', 'conversational_task']);
const ATTRIBUTE_KEYS = new Set(['requested_fact', 'customer_candidate', 'customer_proposed_value', 'medication_decision', 'direction', 'requested_timing_text', 'task_operation']);
const PRACTICAL_TASK_KINDS = new Set(['knowledge_question', 'transformation', 'organization']);
const BOUNDED_INPUT_TYPES = new Set(['meal_name', 'ingredient', 'preparation_step', 'meal_component', 'schedule_constraint', 'time_constraint', 'user_preference']);
const CONVERSATIONAL_OPERATIONS = new Set(['draft', 'transform', 'summarize', 'show']);
const CONVERSATIONAL_INPUT_TYPES = new Set(['draft_specification']);

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

function validatePracticalTask(task, currentText) {
  if (!plainObject(task) || !only(task, new Set(['task_kind', 'bounded_inputs'])) || !PRACTICAL_TASK_KINDS.has(task.task_kind) || !Array.isArray(task.bounded_inputs)) throw new InterpreterError('INTERPRETER_PRACTICAL_TASK_INVALID');
  if (['transformation', 'organization'].includes(task.task_kind) && task.bounded_inputs.length === 0) throw new InterpreterError('INTERPRETER_PRACTICAL_TASK_INVALID');
  return {
    task_kind: task.task_kind,
    bounded_inputs: task.bounded_inputs.map(input => {
      if (!plainObject(input) || !only(input, new Set(['input_type', 'value'])) || !BOUNDED_INPUT_TYPES.has(input.input_type) || !validString(input.value) || !currentText.includes(input.value)) throw new InterpreterError('INTERPRETER_BOUNDED_INPUT_INVALID');
      return { input_type: input.input_type, value: input.value, origin: 'current_turn' };
    }),
  };
}

function validateConversationalTask(task, currentText, artifacts) {
  if (!plainObject(task) || !only(task, new Set(['operation', 'artifact_ids', 'current_turn_constraints', 'current_turn_inputs'])) || !CONVERSATIONAL_OPERATIONS.has(task.operation) || !Array.isArray(task.artifact_ids) || !Array.isArray(task.current_turn_constraints) || !Array.isArray(task.current_turn_inputs)) throw new InterpreterError('INTERPRETER_CONVERSATIONAL_TASK_INVALID');
  if (!task.artifact_ids.every(id => typeof id === 'string' && /^ca-[A-Za-z0-9._-]+$/.test(id)) || new Set(task.artifact_ids).size !== task.artifact_ids.length) throw new InterpreterError('INTERPRETER_ARTIFACT_REFERENCE_INVALID');
  if (task.operation === 'draft' ? task.artifact_ids.length !== 0 : task.operation === 'summarize' ? task.artifact_ids.length < 1 : task.artifact_ids.length !== 1) throw new InterpreterError('INTERPRETER_ARTIFACT_REFERENCE_INVALID');
  const availableIds = new Set(artifacts.map(artifact => artifact.artifact_id));
  if (task.artifact_ids.some(id => !availableIds.has(id))) throw new InterpreterError('INTERPRETER_ARTIFACT_REFERENCE_INVALID');
  if (task.operation === 'draft' && task.current_turn_inputs.length === 0) throw new InterpreterError('INTERPRETER_CONVERSATIONAL_INPUT_INVALID');
  return {
    operation: task.operation,
    artifact_ids: [...task.artifact_ids],
    current_turn_constraints: task.current_turn_constraints.map(constraint => {
      if (!plainObject(constraint) || !only(constraint, new Set(['value'])) || !validString(constraint.value) || !currentText.includes(constraint.value)) throw new InterpreterError('INTERPRETER_CONVERSATIONAL_CONSTRAINT_INVALID');
      return { value: constraint.value, origin: 'current_turn' };
    }),
    current_turn_inputs: task.current_turn_inputs.map(input => {
      if (!plainObject(input) || !only(input, new Set(['input_type', 'value'])) || !CONVERSATIONAL_INPUT_TYPES.has(input.input_type) || !validString(input.value) || !currentText.includes(input.value)) throw new InterpreterError('INTERPRETER_CONVERSATIONAL_INPUT_INVALID');
      return { input_type: input.input_type, value: input.value, origin: 'current_turn' };
    }),
  };
}

function duplicateKey(obligation) {
  // `bi-N` IDs are allocated only after semantic deduplication. Preserve the
  // normalized bounded-input order, which is part of the practical task.
  return JSON.stringify([obligation.category, obligation.subject || null, obligation.current_turn_evidence, obligation.attributes || null, obligation.category === 'practical_guidance' ? obligation.practical_task : null, obligation.category === 'conversational_task' ? obligation.conversational_task : null]);
}

function validateModelOutput(output, currentText, conversationArtifacts = []) {
  if (!Array.isArray(conversationArtifacts) || conversationArtifacts.some(artifact => !plainObject(artifact) || typeof artifact.artifact_id !== 'string' || !/^ca-[A-Za-z0-9._-]+$/.test(artifact.artifact_id))) throw new InterpreterError('INTERPRETER_CONTEXT_INVALID');
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
    if (obligation.category === 'practical_guidance' && obligation.practical_task === undefined) throw new InterpreterError('INTERPRETER_PRACTICAL_TASK_INVALID');
    if (obligation.category !== 'practical_guidance' && obligation.practical_task !== undefined) throw new InterpreterError('INTERPRETER_PRACTICAL_TASK_INVALID');
    if (obligation.category === 'conversational_task' && obligation.conversational_task === undefined) throw new InterpreterError('INTERPRETER_CONVERSATIONAL_TASK_INVALID');
    if (obligation.category !== 'conversational_task' && obligation.conversational_task !== undefined) throw new InterpreterError('INTERPRETER_CONVERSATIONAL_TASK_INVALID');
    const conversationalTask = obligation.conversational_task === undefined ? undefined : validateConversationalTask(obligation.conversational_task, currentText, conversationArtifacts);
    if (conversationalTask && obligation.attributes?.task_operation !== undefined && obligation.attributes.task_operation !== conversationalTask.operation) throw new InterpreterError('INTERPRETER_CONVERSATIONAL_TASK_INVALID');
    const candidate = { category: obligation.category, ...(obligation.subject === undefined ? {} : { subject: obligation.subject }), current_turn_evidence: obligation.current_turn_evidence, confidence: obligation.confidence, ambiguous: obligation.ambiguous, ...(obligation.attributes === undefined ? {} : { attributes: structuredClone(obligation.attributes) }), ...(obligation.practical_task === undefined ? {} : { practical_task: validatePracticalTask(obligation.practical_task, currentText) }), ...(conversationalTask === undefined ? {} : { conversational_task: conversationalTask }) };
    const key = duplicateKey(candidate);
    if (!seen.has(key)) { seen.add(key); normalized.push(candidate); }
  }
  let boundedInputIndex = 0;
  return normalized.map((obligation, index) => ({ id: `o-${index + 1}`, ...obligation, ...(obligation.practical_task === undefined ? {} : { practical_task: { ...obligation.practical_task, bounded_inputs: obligation.practical_task.bounded_inputs.map(input => ({ id: `bi-${++boundedInputIndex}`, ...input })) } }) }));
}

module.exports = { ATTRIBUTE_KEYS, BOUNDED_INPUT_TYPES, CATEGORIES, CONFIDENCES, CONVERSATIONAL_INPUT_TYPES, CONVERSATIONAL_OPERATIONS, InterpreterError, PRACTICAL_TASK_KINDS, validateConversationalTask, validateModelOutput };
