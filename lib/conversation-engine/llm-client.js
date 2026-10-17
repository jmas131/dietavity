'use strict';

const axios = require('axios');
const { OBLIGATIONS_SYSTEM_PROMPT, COMPOSITION_SYSTEM_PROMPT, RECOMMENDATION_CANDIDATE_SYSTEM_PROMPT } = require('./prompts');

const UPSTREAM_CATEGORIES = new Set(['http_429', 'http_5xx', 'http_4xx', 'network', 'timeout', 'unavailable', 'malformed_output', 'unknown']);
const DEFAULT_UPSTREAM_CATEGORY = Object.freeze({
  llm_timeout: 'timeout',
  llm_transport_failure: 'network',
  llm_malformed_output: 'malformed_output',
  llm_unavailable: 'unavailable',
});
const CANDIDATE_ACTIONS = Object.freeze(['cook', 'saute', 'mix', 'heat', 'serve', 'combine']);
const CANDIDATE_PANTRY_IDS = Object.freeze(['water', 'salt', 'cooking_oil']);
const CANDIDATE_PORTIONS = Object.freeze(['small', 'normal']);

function safeUpstreamStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function transportMetadata(error) {
  const upstream_status = safeUpstreamStatus(error?.response?.status);
  const upstream_category = upstream_status === 429
    ? 'http_429'
    : upstream_status >= 500
      ? 'http_5xx'
      : upstream_status >= 400
        ? 'http_4xx'
        : 'network';
  return Object.freeze({ upstream_status, upstream_category });
}

class ConversationLlmError extends Error {
  constructor(code, metadata = {}) {
    super(code);
    this.name = 'ConversationLlmError';
    this.code = code;
    this.upstream_status = safeUpstreamStatus(metadata.upstream_status);
    this.upstream_category = UPSTREAM_CATEGORIES.has(metadata.upstream_category)
      ? metadata.upstream_category
      : (DEFAULT_UPSTREAM_CATEGORY[code] || 'unknown');
  }
}

function extractJson(raw) {
  const text = String(raw || '').replace(/^```(?:json)?\s*|\s*```$/gu, '').trim();
  try { return JSON.parse(text); } catch { throw new ConversationLlmError('llm_malformed_output'); }
}

function emitCandidateDiagnostic(logger, value) {
  if (typeof logger !== 'function') return;
  try { logger(Object.freeze(value)); } catch { /* Temporary diagnostics cannot affect a customer turn. */ }
}

function actionStructure(action, candidate_index, action_index) {
  const objectLike = Boolean(action) && typeof action === 'object';
  const prototype = objectLike ? Object.getPrototypeOf(action) : null;
  const descriptors = objectLike ? Object.getOwnPropertyDescriptors(action) : {};
  return Object.freeze({
    candidate_index,
    action_index,
    is_object: objectLike,
    prototype_is_object_prototype: objectLike && prototype === Object.prototype,
    prototype_is_null: objectLike && prototype === null,
    own_enumerable_keys: objectLike ? Object.keys(action) : Object.freeze([]),
    symbol_count: objectLike ? Object.getOwnPropertySymbols(action).length : 0,
    property_descriptors: Object.freeze(Object.entries(descriptors).map(([key, descriptor]) => Object.freeze({
      key,
      kind: Object.prototype.hasOwnProperty.call(descriptor, 'value') ? 'data' : 'accessor',
      enumerable: Boolean(descriptor.enumerable),
      configurable: Boolean(descriptor.configurable),
      writable: Object.prototype.hasOwnProperty.call(descriptor, 'value') ? Boolean(descriptor.writable) : null,
      has_getter: typeof descriptor.get === 'function',
      has_setter: typeof descriptor.set === 'function',
    }))),
  });
}

function candidateActionStructures(parsed) {
  const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
  return Object.freeze(candidates.flatMap((candidate, candidate_index) =>
    Array.isArray(candidate?.actions)
      ? candidate.actions.map((action, action_index) => actionStructure(action, candidate_index, action_index))
      : []
  ));
}

function stringIds(values) {
  return Array.isArray(values) ? values.filter(value => typeof value === 'string') : [];
}

function actionSchema(refs) {
  return {
    type: 'object', additionalProperties: false, required: ['kind', 'refs'],
    properties: {
      kind: { type: 'string', enum: CANDIDATE_ACTIONS },
      refs: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'string', enum: refs } },
    },
  };
}

function commonCandidateSchema(properties, required, actionRefs) {
  return {
    type: 'object', additionalProperties: false, required,
    properties: {
      ...properties,
      pantry_ids: { type: 'array', minItems: 0, maxItems: 3, uniqueItems: true, items: { type: 'string', enum: CANDIDATE_PANTRY_IDS } },
      actions: { type: 'array', minItems: 1, maxItems: 3, items: actionSchema(actionRefs) },
      portion: { type: 'string', enum: CANDIDATE_PORTIONS },
    },
  };
}

function recommendationCandidateResponseFormat(payload) {
  const availability = payload?.availability || {};
  const references = Array.isArray(availability.references) ? availability.references : [];
  const referenceIds = stringIds(references.map(reference => reference?.id));
  const constrained = availability.scope === 'constrained';
  const selectedIds = ['selected-1', 'selected-2', 'selected-3', 'selected-4'];
  const candidate = constrained
    ? commonCandidateSchema({
      required_refs: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'string', enum: referenceIds } },
    }, ['required_refs', 'pantry_ids', 'actions', 'portion'], [...referenceIds, ...CANDIDATE_PANTRY_IDS])
    : commonCandidateSchema({
      selected_foods: {
        type: 'array', minItems: 1, maxItems: 4,
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'label'],
          properties: { id: { type: 'string', enum: selectedIds }, label: { type: 'string', minLength: 1, maxLength: 40 } },
        },
      },
    }, ['selected_foods', 'pantry_ids', 'actions', 'portion'], [...selectedIds, ...CANDIDATE_PANTRY_IDS]);
  return Object.freeze({
    type: 'json_schema',
    json_schema: Object.freeze({
      name: 'recommendation_candidate_v1', strict: true,
      schema: Object.freeze({
        type: 'object', additionalProperties: false, required: ['candidates'],
        properties: { candidates: { type: 'array', minItems: 0, maxItems: 2, items: candidate } },
      }),
    }),
  });
}

function createOpenAiConversationLlmClient({ apiKey = process.env.OPENAI_API_KEY, model = 'gpt-5-mini', reasoningEffort = 'low', timeoutMs = 6000, http = axios, candidateDiagnosticLogger = null } = {}) {
  async function complete(system, payload, response_format = null, candidateDiagnostics = false) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new ConversationLlmError('llm_unavailable');
    try {
      const body = {
        model,
        reasoning_effort: reasoningEffort,
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }],
      };
      if (response_format) body.response_format = response_format;
      const response = await http.post('https://api.openai.com/v1/chat/completions', body, { timeout: timeoutMs, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
      const content = response?.data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new ConversationLlmError('llm_malformed_output');
      if (candidateDiagnostics) emitCandidateDiagnostic(candidateDiagnosticLogger, { event: 'recommendation_candidate_raw_output', message_content: content });
      const parsed = extractJson(content);
      if (candidateDiagnostics) emitCandidateDiagnostic(candidateDiagnosticLogger, { event: 'recommendation_candidate_parsed_actions', actions: candidateActionStructures(parsed) });
      return parsed;
    } catch (error) {
      if (error instanceof ConversationLlmError) throw error;
      if (error?.code === 'ECONNABORTED' || /timeout/iu.test(String(error?.message || ''))) throw new ConversationLlmError('llm_timeout', { upstream_status: safeUpstreamStatus(error?.response?.status), upstream_category: 'timeout' });
      throw new ConversationLlmError('llm_transport_failure', transportMetadata(error));
    }
  }
  return Object.freeze({
    interpret: payload => complete(OBLIGATIONS_SYSTEM_PROMPT, payload),
    generateRecommendationCandidates: payload => complete(RECOMMENDATION_CANDIDATE_SYSTEM_PROMPT, payload, recommendationCandidateResponseFormat(payload), true),
    compose: envelope => complete(COMPOSITION_SYSTEM_PROMPT, envelope),
    configuration: Object.freeze({ model, reasoningEffort, timeoutMs }),
  });
}

module.exports = Object.freeze({ ConversationLlmError, createOpenAiConversationLlmClient, recommendationCandidateResponseFormat });
