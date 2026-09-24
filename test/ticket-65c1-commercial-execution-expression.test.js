'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { COMMERCIAL_EXECUTION_EXPRESSION_VERSION, commercialExecutionExpressionValid, expressionFor } = require('../lib/sales-engine-v2/commercial-execution-expression');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'contracts', 'sales-engine-v2-contract.schema.json'), 'utf8'));
const expressionSchema = schema.$defs.CommercialExecutionExpression;

const checkoutId = `act-${'a'.repeat(64)}`;
const holdingId = `act-${'b'.repeat(64)}`;
const semantic = (intent = 'checkout_offer') => ({ obligation_id: 'o-buy', semantics_version: 'ticket-65c-v1', commercial_intent: intent, destination: { status: 'authorized_to_provide' } });
const state = (status, intent = 'checkout_offer') => ({ action_id: intent === 'checkout_offer' ? checkoutId : holdingId, action_type: intent === 'checkout_offer' ? 'provide_checkout_destination' : 'provide_holding_page_destination', execution_status: status });
const result = (intent = 'checkout_offer') => ({ action_id: intent === 'checkout_offer' ? checkoutId : holdingId, action_type: intent === 'checkout_offer' ? 'provide_checkout_destination' : 'provide_holding_page_destination', destination: intent === 'checkout_offer' ? { kind: 'checkout', url: 'https://checkout.stripe.com/c/pay_65c1' } : { kind: 'holding_page', url: 'https://dietavity.com/programa-glp1' } });

// Node has no JSON Schema dependency. This focused evaluator intentionally reads
// the normative Ticket 65C.1 definition and covers every keyword it uses here.
function schemaExpressionValid(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || expressionSchema.required.some(key => !Object.hasOwn(value, key)) || expressionSchema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(expressionSchema.properties, key))) return false;
  for (const [key, property] of Object.entries(expressionSchema.properties)) {
    const current = value[key];
    if (property.const !== undefined && JSON.stringify(current) !== JSON.stringify(property.const)) return false;
    if (property.enum && !property.enum.includes(current)) return false;
    if (property.type === 'boolean' && typeof current !== 'boolean') return false;
    if (property.type === 'string' && (typeof current !== 'string' || property.pattern && !(new RegExp(property.pattern).test(current)))) return false;
    if (property.type === 'array' && (!Array.isArray(current) || current.some(item => property.items.enum && !property.items.enum.includes(item)))) return false;
  }
  return expressionSchema.allOf.every(condition => {
    const status = condition.if.properties.execution_status.const;
    if (condition.if.required?.includes('execution_status') && value.execution_status === undefined) return true;
    if (value.execution_status !== status) return true;
    return Object.entries(condition.then.properties).every(([key, property]) => JSON.stringify(value[key]) === JSON.stringify(property.const));
  });
}

test('Ticket 65C.1 projects only closed success semantics with an exact validated destination reference', () => {
  for (const intent of ['checkout_offer', 'holding_page_offer']) {
    const expression = expressionFor({ commercialSemantics: semantic(intent), actionExecutionState: state('succeeded', intent), customerActionResult: result(intent) });
    assert.equal(expression.semantics_version, COMMERCIAL_EXECUTION_EXPRESSION_VERSION);
    assert.equal(expression.commercial_next_step_status, 'available');
    assert.equal(expression.destination_may_be_expressed, true);
    assert.equal(Object.hasOwn(expression, 'destination'), false);
    assert.equal(commercialExecutionExpressionValid(expression, { customerActionResults: [result(intent)] }), true);
  }
});

test('Ticket 65C.1 maps every non-success execution state to narrow unavailable_now without a destination', () => {
  for (const intent of ['checkout_offer', 'holding_page_offer']) for (const status of ['not_executed', 'in_progress', 'failed_retryable', 'failed_terminal']) {
    const expression = expressionFor({ commercialSemantics: semantic(intent), actionExecutionState: state(status, intent) });
    assert.equal(expression.commercial_next_step_status, 'unavailable_now');
    assert.equal(expression.destination_may_be_expressed, false);
    assert.equal(commercialExecutionExpressionValid(expression), true);
    assert.equal(Object.hasOwn(expression, 'destination'), false);
  }
  const progressing = expressionFor({ commercialSemantics: semantic(), actionExecutionState: state('in_progress') });
  assert.equal(progressing.prohibited_claims.includes('execution_success_or_failure_claim'), true);
  const unattempted = expressionFor({ commercialSemantics: semantic(), actionExecutionState: state('not_executed') });
  assert.equal(unattempted.prohibited_claims.includes('execution_attempt_or_failure_claim'), true);
});

test('Ticket 65C.1 fails closed for forged destinations, mismatched identity/type, unknown vocabulary, and copied executor data', () => {
  assert.throws(() => expressionFor({ commercialSemantics: semantic(), actionExecutionState: state('succeeded'), customerActionResult: { ...result(), destination: { kind: 'checkout', url: 'https://evil.example/checkout' } } }), /DESTINATION_ALIGNMENT_INVALID/);
  assert.throws(() => expressionFor({ commercialSemantics: semantic(), actionExecutionState: { ...state('succeeded'), action_type: 'provide_holding_page_destination' }, customerActionResult: result() }), /INPUT_INVALID/);
  assert.throws(() => expressionFor({ commercialSemantics: { ...semantic(), commercial_intent: 'unknown' }, actionExecutionState: state('not_executed') }), /INPUT_INVALID/);
  assert.throws(() => expressionFor({ commercialSemantics: semantic(), actionExecutionState: { ...state('not_executed'), execution_status: 'unknown' } }), /INPUT_INVALID/);
  const expression = expressionFor({ commercialSemantics: semantic(), actionExecutionState: state('succeeded'), customerActionResult: result() });
  assert.equal(commercialExecutionExpressionValid(expression, { customerActionResults: [{ ...result(), action_id: holdingId }] }), false);
  assert.equal(commercialExecutionExpressionValid({ ...expression, execution_status: 'failed_retryable' }, { customerActionResults: [result()] }), false);
  assert.equal(commercialExecutionExpressionValid({ ...expression, semantics_version: 'ticket-65c1-v2' }, { customerActionResults: [result()] }), false);
  assert.equal(JSON.stringify(expression).includes('provider secret'), false);
  assert.equal(JSON.stringify(expression).includes('pay_65c1'), false);
});

test('Ticket 65C.1 is deterministic and does not generate customer prose', () => {
  const input = { commercialSemantics: semantic(), actionExecutionState: state('failed_retryable') };
  const before = structuredClone(input);
  assert.deepEqual(expressionFor(input), expressionFor(input));
  assert.deepEqual(input, before);
  assert.equal(JSON.stringify(expressionFor(input)).includes('Stripe'), false);
});

test('Ticket 65C.1 schema and executable validator have exact five-state closed-shape parity', () => {
  assert.equal(expressionSchema.allOf.length, 5);
  assert.equal(expressionSchema.allOf.every(condition => condition.if.required?.includes('execution_status')), true);
  for (const status of ['succeeded', 'not_executed', 'in_progress', 'failed_retryable', 'failed_terminal']) {
    const expression = expressionFor({ commercialSemantics: semantic(), actionExecutionState: state(status), ...(status === 'succeeded' ? { customerActionResult: result() } : {}) });
    const context = status === 'succeeded' ? { customerActionResults: [result()] } : undefined;
    assert.equal(schemaExpressionValid(expression), true, `${status} schema`);
    assert.equal(commercialExecutionExpressionValid(expression, context), true, `${status} runtime`);
  }
});

test('Ticket 65C.1 schema rejects every forged state-dependent semantic shape the executable validator rejects', () => {
  const succeeded = expressionFor({ commercialSemantics: semantic(), actionExecutionState: state('succeeded'), customerActionResult: result() });
  const unavailable = expressionFor({ commercialSemantics: semantic(), actionExecutionState: state('not_executed') });
  const cases = [
    { ...succeeded, commercial_next_step_status: 'unavailable_now' },
    { ...succeeded, destination_may_be_expressed: false },
    { ...succeeded, allowed_claims: [...succeeded.allowed_claims].reverse() },
    { ...succeeded, prohibited_claims: [...succeeded.prohibited_claims].reverse() },
    { ...succeeded, prohibited_claims: succeeded.prohibited_claims.slice(1) },
    { ...unavailable, allowed_claims: ['commercial_next_step_available'] },
    (() => { const { allowed_claims, ...withoutAllowed } = unavailable; return withoutAllowed; })(),
    { ...unavailable, prohibited_claims: [...unavailable.prohibited_claims, 'delivery_claim'] },
    (() => { const { prohibited_claims, ...withoutProhibited } = unavailable; return withoutProhibited; })(),
    { ...unavailable, execution_status: 'unknown' },
    { ...unavailable, extra: true },
  ];
  for (const forged of cases) {
    assert.equal(schemaExpressionValid(forged), false, `schema: ${JSON.stringify(forged)}`);
    assert.equal(commercialExecutionExpressionValid(forged, forged.execution_status === 'succeeded' ? { customerActionResults: [result()] } : undefined), false, `runtime: ${JSON.stringify(forged)}`);
  }
});
