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
const CANDIDATE_DEFAULTS = Object.freeze({ model: 'gpt-6.1-sol', reasoningEffort: 'low', timeoutMs: 15000 });
const CANDIDATE_TIMEOUT_MIN_MS = 1000;
const CANDIDATE_TIMEOUT_MAX_MS = 30000;

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

function candidateEnvironmentValue(name) {
  return Object.prototype.hasOwnProperty.call(process.env, name) ? process.env[name] : undefined;
}

function candidateModel(value = CANDIDATE_DEFAULTS.model) {
  if (typeof value !== 'string' || !/^gpt-[a-z0-9][a-z0-9.-]{0,75}$/iu.test(value)) throw new TypeError('CONVERSATION_CANDIDATE_V3_MODEL_INVALID');
  return value;
}

function candidateReasoningEffort(value = CANDIDATE_DEFAULTS.reasoningEffort) {
  if (value !== 'low') throw new TypeError('CONVERSATION_CANDIDATE_V3_REASONING_EFFORT_INVALID');
  return value;
}

function candidateTimeoutMs(value = CANDIDATE_DEFAULTS.timeoutMs) {
  const parsed = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < CANDIDATE_TIMEOUT_MIN_MS || parsed > CANDIDATE_TIMEOUT_MAX_MS) throw new TypeError('CONVERSATION_CANDIDATE_V3_TIMEOUT_INVALID');
  return parsed;
}

function stringIds(values) { return Array.isArray(values) ? values.filter(value => typeof value === 'string') : []; }
function boundedKnownIdSchema(ids) { return ids.length ? { type: 'string', enum: ids } : { type: 'string', pattern: '^food-[0-9]+$' }; }

function recommendationCandidateResponseFormat(payload) {
  const foodIds = stringIds(payload?.food_facts?.map(reference => reference?.id));
  return Object.freeze({
    type: 'json_schema',
    json_schema: Object.freeze({
      name: 'recommendation_candidate_v3', strict: true,
      schema: Object.freeze({
        type: 'object', additionalProperties: false, required: ['candidate_type', 'dish', 'proposed_items', 'customer_response'],
        properties: {
          candidate_type: { type: 'string', enum: ['meal_proposal'] },
          dish: {
            type: 'object', additionalProperties: false, required: ['label', 'confirmed_anchor_ids'],
            properties: { label: { type: 'string', minLength: 1, maxLength: 80 }, confirmed_anchor_ids: { type: 'array', minItems: 0, maxItems: 4, items: boundedKnownIdSchema(foodIds) } },
          },
          proposed_items: {
            type: 'array', minItems: 0, maxItems: 4,
            items: { type: 'object', additionalProperties: false, required: ['id', 'label', 'role'], properties: { id: { type: 'string', enum: ['proposed-1', 'proposed-2', 'proposed-3', 'proposed-4'] }, label: { type: 'string', minLength: 1, maxLength: 80 }, role: { type: 'string', enum: ['ingredient', 'obtain'] } } },
          },
          customer_response: { type: 'string', minLength: 1, maxLength: 600 },
        },
      }),
    }),
  });
}

function createOpenAiConversationLlmClient({
  apiKey = process.env.OPENAI_API_KEY,
  model = 'gpt-5-mini',
  reasoningEffort = 'low',
  timeoutMs = 6000,
  candidateModel: configuredCandidateModel = candidateEnvironmentValue('CONVERSATION_CANDIDATE_V3_MODEL'),
  candidateReasoningEffort: configuredCandidateReasoningEffort = candidateEnvironmentValue('CONVERSATION_CANDIDATE_V3_REASONING_EFFORT'),
  candidateTimeoutMs: configuredCandidateTimeoutMs = candidateEnvironmentValue('CONVERSATION_CANDIDATE_V3_TIMEOUT_MS'),
  http = axios,
} = {}) {
  const candidate = Object.freeze({
    model: candidateModel(configuredCandidateModel === undefined ? CANDIDATE_DEFAULTS.model : configuredCandidateModel),
    reasoningEffort: candidateReasoningEffort(configuredCandidateReasoningEffort === undefined ? CANDIDATE_DEFAULTS.reasoningEffort : configuredCandidateReasoningEffort),
    timeoutMs: candidateTimeoutMs(configuredCandidateTimeoutMs === undefined ? CANDIDATE_DEFAULTS.timeoutMs : configuredCandidateTimeoutMs),
  });
  const shared = Object.freeze({ model, reasoningEffort, timeoutMs });
  async function complete(system, payload, response_format = null, configuration = shared) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new ConversationLlmError('llm_unavailable');
    try {
      const body = {
        model: configuration.model,
        reasoning_effort: configuration.reasoningEffort,
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }],
      };
      if (response_format) body.response_format = response_format;
      const response = await http.post('https://api.openai.com/v1/chat/completions', body, { timeout: configuration.timeoutMs, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
      const content = response?.data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new ConversationLlmError('llm_malformed_output');
      return extractJson(content);
    } catch (error) {
      if (error instanceof ConversationLlmError) throw error;
      if (error?.code === 'ECONNABORTED' || /timeout/iu.test(String(error?.message || ''))) throw new ConversationLlmError('llm_timeout', { upstream_status: safeUpstreamStatus(error?.response?.status), upstream_category: 'timeout' });
      throw new ConversationLlmError('llm_transport_failure', transportMetadata(error));
    }
  }
  return Object.freeze({
    interpret: payload => complete(OBLIGATIONS_SYSTEM_PROMPT, payload),
    generateRecommendationCandidate: payload => complete(RECOMMENDATION_CANDIDATE_SYSTEM_PROMPT, payload, recommendationCandidateResponseFormat(payload), candidate),
    compose: envelope => complete(COMPOSITION_SYSTEM_PROMPT, envelope),
    configuration: Object.freeze({ model, reasoningEffort, timeoutMs, candidate }),
  });
}

module.exports = Object.freeze({ ConversationLlmError, createOpenAiConversationLlmClient, recommendationCandidateResponseFormat });
