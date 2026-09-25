'use strict';

const { assertFinalComposerInput } = require('./final-composer-input');
const { COMPOSER_PROMPT_VERSION, SYSTEM_PROMPT } = require('../../config/sales-engine-v2/response-composer-prompt');

const COMPOSER_RESULT_VERSION = 'ticket-66-v1';
const COMPOSER_FAILURE_VERSION = 'ticket-66-v1';
const MODEL_UNAVAILABLE = 'COMPOSER_MODEL_UNAVAILABLE';
const URL_PATTERN = /https?:\/\/[^\s<>()]+/giu;
const only = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.has(key));
const clone = value => structuredClone(value);

class ComposerError extends Error {
  constructor(code, cause) { super(code); this.name = 'ComposerError'; this.code = code; this.cause = cause; }
}

function modelProvenance(modelRunId) {
  if (typeof modelRunId !== 'string' || !modelRunId) throw new ComposerError('COMPOSER_MODEL_RUN_ID_INVALID');
  return { type: 'conversational_generation', generation_stage: 'composer', model_run_id: modelRunId };
}

function compositionInput(finalComposerInput) {
  const input = assertFinalComposerInput(finalComposerInput);
  // Provenance identifiers are audit material, not customer-language input.
  return {
    composer_input_version: input.composer_input_version,
    contract_version: input.contract_version,
    context_id: input.context_id,
    locale: input.locale,
    question_budget: input.question_budget,
    prohibited_claims: clone(input.prohibited_claims),
    prohibited_actions: clone(input.prohibited_actions),
    obligation_outcomes: input.obligation_outcomes.map(outcome => {
      const { source, ...bounded } = outcome;
      return bounded;
    }),
  };
}

function modelRequest(finalComposerInput) {
  return { prompt_version: COMPOSER_PROMPT_VERSION, system_prompt: SYSTEM_PROMPT, input: compositionInput(finalComposerInput) };
}

function draftValid(draft, input) {
  return only(draft, new Set(['segments']))
    && Array.isArray(draft.segments)
    && draft.segments.length === input.obligation_ids.length
    && draft.segments.every((segment, index) => only(segment, new Set(['obligation_id', 'text']))
      && segment.obligation_id === input.obligation_ids[index]
      && typeof segment.text === 'string'
      && segment.text.trim().length > 0);
}

function urls(text) { return [...text.matchAll(URL_PATTERN)].map(match => match[0].replace(/[.,!?;:]+$/u, '')); }
function questionCount(text) {
  const withoutUrls = text.replace(URL_PATTERN, '');
  return Math.max((withoutUrls.match(/¿/gu) || []).length, (withoutUrls.match(/\?/gu) || []).length);
}

function eligibleDestinations(input) {
  return new Map(input.obligation_outcomes
    .filter(outcome => outcome.type === 'commercial_execution'
      && outcome.expression.destination_may_be_expressed === true
      && outcome.customer_action_result)
    .map(outcome => [outcome.obligation_id, {
      obligation_id: outcome.obligation_id,
      action_id: outcome.expression.action_id,
      kind: outcome.customer_action_result.kind,
      url: outcome.customer_action_result.url,
    }]));
}

function destinationEvidence(input, segments) {
  const eligible = eligibleDestinations(input);
  const evidence = [];
  for (const segment of segments) {
    const destination = eligible.get(segment.obligation_id);
    for (const url of urls(segment.text)) {
      if (!destination || url !== destination.url || evidence.some(item => item.url === url)) throw new ComposerError('COMPOSER_DESTINATION_INVALID');
      evidence.push(clone(destination));
    }
  }
  return evidence;
}

function questionBudgetValid(input, segments) {
  const questions = segments.flatMap(segment => questionCount(segment.text) ? [segment] : []);
  return questions.length <= input.question_budget
    && questions.every(segment => input.obligation_outcomes.find(outcome => outcome.obligation_id === segment.obligation_id)?.type === 'clarification');
}

function composerResult(input, segments, modelRunId) {
  if (!questionBudgetValid(input, segments)) throw new ComposerError('COMPOSER_QUESTION_BUDGET_INVALID');
  const result = {
    composer_result_version: COMPOSER_RESULT_VERSION,
    contract_version: input.contract_version,
    context_id: input.context_id,
    locale: input.locale,
    response_text: segments.map(segment => segment.text.trim()).join('\n\n'),
    covered_obligation_ids: clone(input.obligation_ids),
    expressed_destination_refs: destinationEvidence(input, segments),
    model_provenance: modelProvenance(modelRunId),
  };
  return assertComposerResult(result, { finalComposerInput: input });
}

function composerFailure(input, modelRunId) {
  return {
    composer_failure_version: COMPOSER_FAILURE_VERSION,
    contract_version: input.contract_version,
    context_id: input.context_id,
    locale: input.locale,
    failure_code: MODEL_UNAVAILABLE,
    model_provenance: modelProvenance(modelRunId),
  };
}

function provenanceValid(value) {
  return only(value, new Set(['type', 'generation_stage', 'model_run_id']))
    && value.type === 'conversational_generation'
    && value.generation_stage === 'composer'
    && typeof value.model_run_id === 'string' && !!value.model_run_id;
}

function composerResultValid(value, { finalComposerInput } = {}) {
  let input;
  try { input = assertFinalComposerInput(finalComposerInput); } catch { return false; }
  if (!only(value, new Set(['composer_result_version', 'contract_version', 'context_id', 'locale', 'response_text', 'covered_obligation_ids', 'expressed_destination_refs', 'model_provenance'])) || value.composer_result_version !== COMPOSER_RESULT_VERSION || value.contract_version !== input.contract_version || value.context_id !== input.context_id || value.locale !== input.locale || typeof value.response_text !== 'string' || !value.response_text.trim() || !Array.isArray(value.covered_obligation_ids) || JSON.stringify(value.covered_obligation_ids) !== JSON.stringify(input.obligation_ids) || !Array.isArray(value.expressed_destination_refs) || !provenanceValid(value.model_provenance) || questionCount(value.response_text) > input.question_budget) return false;
  const eligible = eligibleDestinations(input); const seen = new Set();
  for (const reference of value.expressed_destination_refs) {
    if (!only(reference, new Set(['obligation_id', 'action_id', 'kind', 'url'])) || seen.has(reference.url)) return false;
    const expected = eligible.get(reference.obligation_id);
    if (!expected || JSON.stringify(reference) !== JSON.stringify(expected)) return false;
    seen.add(reference.url);
  }
  const actualUrls = urls(value.response_text);
  return actualUrls.length === value.expressed_destination_refs.length && actualUrls.every(url => seen.has(url));
}

function composerFailureValid(value, { finalComposerInput } = {}) {
  let input;
  try { input = assertFinalComposerInput(finalComposerInput); } catch { return false; }
  return only(value, new Set(['composer_failure_version', 'contract_version', 'context_id', 'locale', 'failure_code', 'model_provenance']))
    && value.composer_failure_version === COMPOSER_FAILURE_VERSION
    && value.contract_version === input.contract_version
    && value.context_id === input.context_id
    && value.locale === input.locale
    && value.failure_code === MODEL_UNAVAILABLE
    && provenanceValid(value.model_provenance);
}

function assertComposerResult(value, context) {
  if (!composerResultValid(value, context)) throw new ComposerError('COMPOSER_RESULT_INVALID');
  return clone(value);
}

function composeResponse({ finalComposerInput, composerAdapter, modelRunId }) {
  const input = assertFinalComposerInput(finalComposerInput);
  if (typeof composerAdapter !== 'function') throw new ComposerError('COMPOSER_ADAPTER_INVALID');
  let draft;
  try { draft = composerAdapter(modelRequest(input)); }
  catch (error) {
    if (error?.code === MODEL_UNAVAILABLE) return composerFailure(input, modelRunId);
    throw error;
  }
  if (!draftValid(draft, input)) throw new ComposerError('COMPOSER_MODEL_OUTPUT_INVALID');
  return composerResult(input, draft.segments, modelRunId);
}

module.exports = { COMPOSER_FAILURE_VERSION, COMPOSER_RESULT_VERSION, MODEL_UNAVAILABLE, ComposerError, assertComposerResult, composeResponse, composerFailure, composerFailureValid, composerResultValid, compositionInput, destinationEvidence, draftValid, modelRequest, questionCount };
