'use strict';

const axios = require('axios');
const { OBLIGATIONS_SYSTEM_PROMPT, COMPOSITION_SYSTEM_PROMPT } = require('./prompts');

const UPSTREAM_CATEGORIES = new Set(['http_429', 'http_5xx', 'http_4xx', 'network', 'timeout', 'unavailable', 'malformed_output', 'unknown']);
const DEFAULT_UPSTREAM_CATEGORY = Object.freeze({
  llm_timeout: 'timeout',
  llm_transport_failure: 'network',
  llm_malformed_output: 'malformed_output',
  llm_unavailable: 'unavailable',
});

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

function createOpenAiConversationLlmClient({ apiKey = process.env.OPENAI_API_KEY, model = 'gpt-5-mini', reasoningEffort = 'low', timeoutMs = 6000, http = axios } = {}) {
  async function complete(system, payload) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new ConversationLlmError('llm_unavailable');
    try {
      const response = await http.post('https://api.openai.com/v1/chat/completions', {
        model,
        reasoning_effort: reasoningEffort,
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }],
      }, { timeout: timeoutMs, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
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
    compose: envelope => complete(COMPOSITION_SYSTEM_PROMPT, envelope),
    configuration: Object.freeze({ model, reasoningEffort, timeoutMs }),
  });
}

module.exports = Object.freeze({ ConversationLlmError, createOpenAiConversationLlmClient });
