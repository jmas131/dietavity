'use strict';

const axios = require('axios');
const { PRIMARY_CONVERSATION_SYSTEM_PROMPT } = require('./prompt');

const DEFAULTS = Object.freeze({ model: 'gpt-6.1-sol', reasoningEffort: 'low', timeoutMs: 15000 });
const UPSTREAM = new Set(['http_429', 'http_5xx', 'http_4xx', 'network', 'timeout', 'unavailable', 'malformed_output']);

class ConversationV4LlmError extends Error {
  constructor(code, { upstream_status = null, upstream_category = 'network' } = {}) {
    super(code); this.name = 'ConversationV4LlmError'; this.code = code;
    this.upstream_status = Number.isInteger(upstream_status) && upstream_status >= 100 && upstream_status <= 599 ? upstream_status : null;
    this.upstream_category = UPSTREAM.has(upstream_category) ? upstream_category : 'network';
  }
}
function modelName(value) { if (typeof value !== 'string' || !/^gpt-[a-z0-9][a-z0-9.-]{0,75}$/iu.test(value)) throw new TypeError('V4_MODEL_INVALID'); return value; }
function effort(value) { if (value !== 'low') throw new TypeError('V4_REASONING_EFFORT_INVALID'); return value; }
function timeout(value) { const parsed = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value; if (!Number.isSafeInteger(parsed) || parsed < 1000 || parsed > 30000) throw new TypeError('V4_TIMEOUT_INVALID'); return parsed; }
function parse(raw) { try { return JSON.parse(String(raw || '').replace(/^```(?:json)?\s*|\s*```$/gu, '').trim()); } catch { throw new ConversationV4LlmError('llm_malformed_output', { upstream_category: 'malformed_output' }); } }
function responseFormat() {
  return Object.freeze({
    type: 'json_schema',
    json_schema: Object.freeze({
      name: 'conversation_engine_v4_response',
      strict: true,
      schema: Object.freeze({
        type: 'object',
        additionalProperties: false,
        required: ['response', 'memory_updates'],
        properties: {
          response: { type: 'string', minLength: 1, maxLength: 4000 },
          memory_updates: {
            type: 'array', minItems: 0, maxItems: 12,
            items: {
              type: 'object', additionalProperties: false,
              required: ['kind', 'action', 'value'],
              properties: {
                kind: { type: 'string', enum: ['allergy', 'dietary_restriction', 'preference'] },
                action: { type: 'string', enum: ['add', 'remove'] },
                value: { type: 'string', minLength: 1, maxLength: 160 },
              },
            },
          },
        },
      }),
    }),
  });
}
function category(error) { const status = Number.isInteger(error?.response?.status) ? error.response.status : null; return { upstream_status: status, upstream_category: status === 429 ? 'http_429' : status >= 500 ? 'http_5xx' : status >= 400 ? 'http_4xx' : 'network' }; }

function createPrimaryConversationLlmClient({ apiKey = process.env.OPENAI_API_KEY, model = process.env.CONVERSATION_V4_MODEL || DEFAULTS.model, reasoningEffort = process.env.CONVERSATION_V4_REASONING_EFFORT || DEFAULTS.reasoningEffort, timeoutMs = process.env.CONVERSATION_V4_TIMEOUT_MS || DEFAULTS.timeoutMs, http = axios } = {}) {
  const configuration = Object.freeze({ model: modelName(model), reasoningEffort: effort(reasoningEffort), timeoutMs: timeout(timeoutMs) });
  return Object.freeze({
    configuration,
    async generate(request) {
      if (typeof apiKey !== 'string' || !apiKey.trim()) throw new ConversationV4LlmError('llm_unavailable', { upstream_category: 'unavailable' });
      try {
        const response = await http.post('https://api.openai.com/v1/chat/completions', {
          model: configuration.model,
          reasoning_effort: configuration.reasoningEffort,
          messages: [{ role: 'system', content: PRIMARY_CONVERSATION_SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(request) }],
          response_format: responseFormat(),
        }, { timeout: configuration.timeoutMs, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
        const content = response?.data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) throw new ConversationV4LlmError('llm_malformed_output', { upstream_category: 'malformed_output' });
        return parse(content);
      } catch (error) {
        if (error instanceof ConversationV4LlmError) throw error;
        if (error?.code === 'ECONNABORTED' || /timeout/iu.test(String(error?.message || ''))) throw new ConversationV4LlmError('llm_timeout', { ...category(error), upstream_category: 'timeout' });
        throw new ConversationV4LlmError('llm_transport_failure', category(error));
      }
    },
  });
}

module.exports = Object.freeze({ ConversationV4LlmError, createPrimaryConversationLlmClient, responseFormat, DEFAULTS });
