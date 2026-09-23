'use strict';

const { BOUNDED_INPUT_TYPES, PRACTICAL_TASK_KINDS } = require('./interpreter-validator');
const { normativeResolvedValid, plainObject, practicalGuidanceTerminalValid } = require('./resolved-obligation-validator');

class PracticalGuidanceResolverError extends Error {
  constructor(code, cause) { super(code); this.name = 'PracticalGuidanceResolverError'; this.code = code; this.cause = cause; }
}
const INPUT_KEYS = new Set(['obligation', 'deferredResolution', 'locale', 'asOf', 'knowledgeStore', 'reasoningModel', 'modelRunId']);
function only(value, keys) { return Object.keys(value).every(key => keys.has(key)); }

function validObligation(value) {
  if (!plainObject(value) || !only(value, new Set(['id', 'category', 'subject', 'current_turn_evidence', 'confidence', 'ambiguous', 'attributes', 'practical_task'])) || typeof value.id !== 'string' || !/^o-[A-Za-z0-9._-]+$/.test(value.id) || value.category !== 'practical_guidance' || typeof value.current_turn_evidence !== 'string' || !value.current_turn_evidence || !['high', 'medium', 'low'].includes(value.confidence) || typeof value.ambiguous !== 'boolean' || (value.subject !== undefined && (typeof value.subject !== 'string' || !value.subject))) return false;
  const task = value.practical_task;
  return plainObject(task) && only(task, new Set(['task_kind', 'bounded_inputs'])) && PRACTICAL_TASK_KINDS.has(task.task_kind) && Array.isArray(task.bounded_inputs) && (task.task_kind === 'knowledge_question' || task.bounded_inputs.length > 0) && task.bounded_inputs.every(input => plainObject(input) && only(input, new Set(['id', 'input_type', 'value', 'origin'])) && typeof input.id === 'string' && /^bi-[1-9][0-9]*$/.test(input.id) && BOUNDED_INPUT_TYPES.has(input.input_type) && typeof input.value === 'string' && !!input.value && input.origin === 'current_turn') && new Set(task.bounded_inputs.map(input => input.id)).size === task.bounded_inputs.length;
}
function validDeferred(value, obligationId) {
  return normativeResolvedValid(value) && only(value, new Set(['obligation_id', 'resolution_status', 'authority', 'source', 'allowed_claims', 'prohibited_claims', 'llm_reasoning_permitted', 'customer_uncertainty_required', 'next_stage'])) && value.obligation_id === obligationId && value.resolution_status === 'deferred' && value.authority === null && value.source === null && value.next_stage === 'reviewed_knowledge_or_reasoning';
}
function assertInputs(input) {
  if (!plainObject(input) || !only(input, INPUT_KEYS) || !validObligation(input.obligation) || !validDeferred(input.deferredResolution, input.obligation.id) || typeof input.locale !== 'string' || !input.locale || typeof input.asOf !== 'string' || Number.isNaN(Date.parse(input.asOf)) || !input.knowledgeStore || typeof input.knowledgeStore.retrieve !== 'function') throw new PracticalGuidanceResolverError('PRACTICAL_GUIDANCE_INPUT_INVALID');
  const task = input.obligation.practical_task.task_kind;
  if (task !== 'knowledge_question' && (typeof input.reasoningModel !== 'function' || typeof input.modelRunId !== 'string' || !input.modelRunId)) throw new PracticalGuidanceResolverError('PRACTICAL_GUIDANCE_REASONING_INTERFACE_INVALID');
  return { ...input, obligation: structuredClone(input.obligation), deferredResolution: structuredClone(input.deferredResolution) };
}
function assertTerminal(obligation, result) {
  if (!practicalGuidanceTerminalValid(obligation, result)) throw new PracticalGuidanceResolverError('PRACTICAL_GUIDANCE_OUTPUT_INVALID');
  return result;
}
module.exports = { PracticalGuidanceResolverError, assertInputs, assertTerminal, validDeferred, validObligation };
