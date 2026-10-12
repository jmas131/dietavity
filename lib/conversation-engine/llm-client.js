'use strict';

const axios = require('axios');
const { OBLIGATIONS_SYSTEM_PROMPT, COMPOSITION_SYSTEM_PROMPT } = require('./prompts');

class ConversationLlmError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ConversationLlmError';
    this.code = code;
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
      if (error?.code === 'ECONNABORTED' || /timeout/iu.test(String(error?.message || ''))) throw new ConversationLlmError('llm_timeout');
      throw new ConversationLlmError('llm_transport_failure');
    }
  }
  return Object.freeze({
    interpret: payload => complete(OBLIGATIONS_SYSTEM_PROMPT, payload),
    compose: envelope => complete(COMPOSITION_SYSTEM_PROMPT, envelope),
    configuration: Object.freeze({ model, reasoningEffort, timeoutMs }),
  });
}

module.exports = Object.freeze({ ConversationLlmError, createOpenAiConversationLlmClient });
