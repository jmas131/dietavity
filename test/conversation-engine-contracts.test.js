'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { validateRequest, validateResponse, ConversationRequestError, ConversationResponseError } = require('../lib/conversation-engine/contracts');

const request = () => ({
  contract_version: 'conversation-engine-request-v1', request_id: '00000000-0000-4000-8000-000000000001', session_id: 'whatsapp:+5215550000000', inbound_message_id: '00000000-0000-4000-8000-000000000002', processing_order: 2, current_message: 'Tengo pollo.', canonical_history: [{ role: 'customer', text: 'Hola', source_processing_order: 1 }],
});
const response = () => ({
  contract_version: 'conversation-engine-response-v1', engine_version: 'direct-rag-v3-v1_3', request_id: '00000000-0000-4000-8000-000000000001', resolution: { status: 'resolved', type: 'direct_rag_response', delivery_permitted: true }, assistant_response: 'Respuesta segura.', persistence: { pending_action: 'respond', strategy: 'direct_rag_v3_response', buyer_signal: 'obligation_resolution', topic: 'acknowledgement', conversation_stage: null, goal: null, next_last_question_type: null, events: [] }, diagnostics: { recommendation: { source: null, status: null, failure_code: null }, llm: { obligations: 'valid', composition: 'valid' } },
});

test('conversation-engine contracts accept same-realm and structurally valid cross-realm data', () => {
  assert.doesNotThrow(() => validateRequest(request()));
  assert.doesNotThrow(() => validateResponse(response()));
  const foreignRequest = vm.runInNewContext(`(${JSON.stringify(request())})`);
  const foreignResponse = vm.runInNewContext(`(${JSON.stringify(response())})`);
  assert.doesNotThrow(() => validateRequest(foreignRequest));
  assert.doesNotThrow(() => validateResponse(foreignResponse));
  const foreignHistory = vm.runInNewContext(`({ role: 'customer', text: 'Hola', source_processing_order: 1 })`);
  const withForeignHistory = request(); withForeignHistory.canonical_history = [foreignHistory];
  assert.doesNotThrow(() => validateRequest(withForeignHistory));
});

test('conversation-engine contracts fail closed on unknown, symbol, accessor, array, primitive, and malformed nested values', () => {
  const requestFailure = value => assert.throws(() => validateRequest(value), ConversationRequestError);
  const responseFailure = value => assert.throws(() => validateResponse(value), ConversationResponseError);
  const unexpected = request(); unexpected.unexpected = true; requestFailure(unexpected);
  const symbol = request(); symbol[Symbol('hidden')] = true; requestFailure(symbol);
  let getterRead = false;
  const accessor = request(); Object.defineProperty(accessor, 'current_message', { enumerable: true, get() { getterRead = true; return 'Tengo pollo.'; } }); requestFailure(accessor); assert.equal(getterRead, false);
  requestFailure([]); requestFailure(null); requestFailure('not an object');
  const malformedHistory = request(); malformedHistory.canonical_history = [{ role: 'customer', text: 'Hola', source_processing_order: 1, forged: true }]; requestFailure(malformedHistory);
  const malformedResponse = response(); malformedResponse.diagnostics.llm.extra = true; responseFailure(malformedResponse);
});
