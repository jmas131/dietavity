'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildResponsePlan } = require('../lib/sales-engine-v2/response-plan-builder');
const { buildFinalComposerInput, finalComposerInputValid, WITHHOLDING_EXPRESSION_VERSION } = require('../lib/sales-engine-v2/final-composer-input');
const { bindings, constraintDigest } = require('../lib/sales-engine-v2/artifact-reproduction-safety-validator');
const { deriveCommercialAuthorizationSubject } = require('../lib/sales-engine-v2/commercial-authorization-subject');
const { deriveAuthorizedActionIdentity } = require('../lib/sales-engine-v2/authorized-action-identity');
const { resultFor } = require('../lib/sales-engine-v2/action-result-validator');
const { deriveGuidanceAssessmentContextBinding } = require('../lib/sales-engine-v2/guidance-assessment-context');
const { deriveTerminalGuidanceBinding } = require('../lib/sales-engine-v2/terminal-guidance-binding');
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs/contracts/sales-engine-v2-contract.schema.json'), 'utf8'));

const canonicalMessageId = '11111111-1111-4111-8111-000000000065';
function context({ text = 'Hazlo más corto', artifacts = [] } = {}) { return { contract_version: '2.0', context_id: 'c-65e', locale: 'es-MX', current_message: { role: 'customer', text, occurred_at: '2026-09-24T18:00:00.000Z', source_id: 'provider-65e', canonical_message_id: canonicalMessageId }, history: [], history_metadata: { ordering: 'occurred_at', history_truncated: false, retained_prior_turns: 0, retained_prior_characters: 0 }, conversation_artifacts: artifacts, conversation_artifacts_metadata: { ordering: 'occurred_at', artifacts_truncated: false, retained_artifacts: artifacts.length, retained_artifact_characters: artifacts.reduce((n, value) => n + value.text.length, 0) }, session_state: { session_id: 's-65e' }, offer_context: { offer_version: '28d-149-v1' }, customer_state: {}, commercial_state: { checkout_sent: false, valid_purchase_confirmation: false }, metadata: { channel: 'whatsapp', campaign: 'standard' }, authoritative_context: {}, informational_context: { knowledge: [] } }; }
function base(id, fields) { return { obligation_id: id, allowed_claims: [], prohibited_claims: [], customer_uncertainty_required: false, llm_reasoning_permitted: false, ...fields }; }
function artifact() { return { artifact_id: 'ca-65e', artifact_type: 'draft', generation_operation: 'draft', generation_task_id: 'cgt-65e', logical_reply_key: 'reply-65e', anchor_message_id: canonicalMessageId, text: 'El precio anterior era $99.', lineage_artifact_ids: [], occurred_at: '2026-09-23T18:00:00.000Z' }; }
function transformPlan(status = 'cleared', operation = 'transform') {
  const source = artifact(); const task = { operation, artifact_ids: [source.artifact_id], current_turn_inputs: [], current_turn_constraints: [{ value: 'más corto', origin: 'current_turn' }] };
  const obligation = { id: 'o-transform', category: 'conversational_task', current_turn_evidence: 'Hazlo más corto', confidence: 'high', ambiguous: false, conversational_task: task };
  const plan = buildResponsePlan({ context: context({ artifacts: [source] }), obligations: [obligation], resolvedObligations: [base('o-transform', { resolution_status: 'deferred', authority: null, source: null, next_stage: 'conversational_generation' })], semanticGuidanceGates: [], authorizedActions: [] });
  const finalTask = plan.conversational_generation[0];
  const findings = status === 'blocked' ? [{ code: 'commercial_claim', severity: 'blocking', artifact_id: source.artifact_id, rationale: 'blocked' }] : status === 'indeterminate' ? [{ code: 'other_reproduction_risk', severity: 'review_required', artifact_id: source.artifact_id, rationale: 'review' }] : [];
  const gate = { obligation_id: finalTask.obligation_id, gate_id: 'artifact-reproduction-safety-gate', gate_version: 'ticket-64a-v1', operation: finalTask.operation, artifact_bindings: bindings(finalTask), constraint_digest: constraintDigest(finalTask), gate_status: status, findings, assessment_source: { assessment_stage: 'artifact_reproduction_safety', assessor_run_id: 'run-65e', outcome: 'completed' } };
  return { plan, gate, source };
}
function practicalPlan(status = 'cleared') {
  const obligation = { id: 'o-guide', category: 'practical_guidance', current_turn_evidence: 'cortar', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'organization', bounded_inputs: [{ id: 'bi-1', input_type: 'preparation_step', value: 'cortar', origin: 'current_turn' }] } };
  const terminal = base('o-guide', { resolution_status: 'resolved', authority: 'generated_guidance', source: { type: 'generated_guidance', id: 'guide-65e', version: '1', model_run_id: 'run-65e', generation_stage: 'bounded_reasoning' }, llm_reasoning_permitted: true, guidance_payload: { semantic_safety_validation_required: true, units: [{ unit_type: 'organization', content: 'Primero corta.', bounded_input_ids: ['bi-1'] }] } });
  terminal.assessment_context_binding = deriveGuidanceAssessmentContextBinding({ obligation, terminalResult: terminal, locale: 'es-MX', reviewedKnowledgeItems: [] });
  const findings = status === 'blocked' ? [{ code: 'commercial_claim', severity: 'blocking', unit_index: 0, rationale: 'blocked' }] : status === 'indeterminate' ? [{ code: 'unsupported_external_fact', severity: 'review_required', unit_index: 0, rationale: 'review' }] : [];
  const gate = { obligation_id: 'o-guide', gate_id: 'semantic-guidance-safety-gate', gate_version: 'ticket-64b-v1', terminal_guidance_binding: deriveTerminalGuidanceBinding(terminal), gate_status: status, findings, assessment_source: { assessment_stage: 'semantic_guidance_safety', assessor_run_id: 'assess-65e', outcome: 'completed' } };
  return buildResponsePlan({ context: context({ text: 'cortar' }), obligations: [obligation], resolvedObligations: [terminal], semanticGuidanceGates: [gate], authorizedActions: [] });
}
function action() { const subject = deriveCommercialAuthorizationSubject({ campaign: 'standard', offerVersion: '28d-149-v1' }); const identity = deriveAuthorizedActionIdentity({ canonicalMessageId, authorizationSubject: subject, actionType: 'provide_checkout_destination', policy: { id: 'commercial.checkout.standard', version: '1' } }); return { action_identity_version: identity.action_identity_version, action_id: identity.action_id, action_type: 'provide_checkout_destination', authorization_source: 'deterministic_policy', authorizing_rule: 'commercial.checkout.standard.v1', parameters: {}, preconditions: [], constraints: {}, idempotency: { required: true, key_scope: 'inbound_message', execution_key_version: identity.execution_key_version, execution_key: identity.execution_key }, status: 'authorized' }; }
function commercialPlan() { const authorized = action(); const subject = deriveCommercialAuthorizationSubject({ campaign: 'standard', offerVersion: '28d-149-v1' }); const obligation = { id: 'o-buy', category: 'commercial_purchase_intent', current_turn_evidence: 'quiero comprar', confidence: 'high', ambiguous: false, ...subject }; const resolved = base('o-buy', { resolution_status: 'resolved', authority: 'commercial_authorization', source: { type: 'deterministic_policy', id: 'commercial.checkout.standard', version: '1' }, policy_decision: { outcome: 'authorized', reason_code: 'CHECKOUT_AUTHORIZED' }, action_authorization: authorized }); return { plan: buildResponsePlan({ context: context({ text: 'quiero comprar' }), obligations: [obligation], resolvedObligations: [resolved], semanticGuidanceGates: [], authorizedActions: [authorized] }), authorized }; }

test('Ticket 65E admits only a cleared exact reproduction gate and never promotes its text to fact authority', () => {
  const { plan, gate, source } = transformPlan(); const raw = { responsePlan: plan, artifactReproductionGates: [gate] }; const before = structuredClone(raw); const input = buildFinalComposerInput(raw);
  assert.equal(input.obligation_outcomes[0].safety_outcome, 'reproduction_allowed');
  assert.deepEqual(input.obligation_outcomes[0].artifacts, [{ artifact_id: source.artifact_id, text: source.text }]);
  assert.equal(JSON.stringify(input).includes('canonical_fact'), false);
  assert.equal(finalComposerInputValid(input), true);
  assert.deepEqual(raw, before); assert.deepEqual(buildFinalComposerInput(raw), input);
  assert.throws(() => buildFinalComposerInput({ responsePlan: plan, artifactReproductionGates: [{ ...gate, operation: 'show' }] }), /FINAL_COMPOSER_ARTIFACT_GATE_ALIGNMENT_INVALID/);
});

test('Ticket 65E removes blocked or indeterminate reproduction bodies and rejects draft gates', () => {
  const directive = { blocked: 'requested_content_cannot_be_reproduced', indeterminate: 'requested_content_cannot_be_reproduced_now' };
  for (const status of ['blocked', 'indeterminate']) { const { plan, gate, source } = transformPlan(status); const input = buildFinalComposerInput({ responsePlan: plan, artifactReproductionGates: [gate] }); assert.equal(input.obligation_outcomes[0].artifacts.length, 0); assert.equal(JSON.stringify(input).includes(source.text), false); assert.equal(input.obligation_outcomes[0].customer_expression.directive, directive[status]); assert.equal(input.obligation_outcomes[0].customer_expression.semantics_version, WITHHOLDING_EXPRESSION_VERSION); }
  const task = { operation: 'draft', artifact_ids: [], current_turn_inputs: [{ input_type: 'draft_specification', value: 'mensaje', origin: 'current_turn' }], current_turn_constraints: [] };
  const obligation = { id: 'o-draft', category: 'conversational_task', current_turn_evidence: 'mensaje', confidence: 'high', ambiguous: false, conversational_task: task };
  const plan = buildResponsePlan({ context: context({ text: 'mensaje' }), obligations: [obligation], resolvedObligations: [base('o-draft', { resolution_status: 'deferred', authority: null, source: null, next_stage: 'conversational_generation' })], semanticGuidanceGates: [], authorizedActions: [] });
  assert.equal(buildFinalComposerInput({ responsePlan: plan }).obligation_outcomes[0].safety_outcome, 'generation_allowed');
  assert.throws(() => buildFinalComposerInput({ responsePlan: plan, artifactReproductionGates: [{ ...transformPlan().gate, obligation_id: 'o-draft' }] }), /FINAL_COMPOSER_ARTIFACT_GATE_ALIGNMENT_INVALID|FINAL_COMPOSER_DRAFT_GATE_FORBIDDEN/);
});

test('Ticket 65E covers every bounded practical terminal state without leaking withheld guidance', () => {
  const cleared = buildFinalComposerInput({ responsePlan: practicalPlan() }).obligation_outcomes[0];
  assert.equal(cleared.type, 'permitted_guidance'); assert.equal(cleared.guidance_payload.units[0].content, 'Primero corta.');
  for (const [status, type] of [['blocked', 'guidance_withheld_safety'], ['indeterminate', 'bounded_uncertainty']]) { const input = buildFinalComposerInput({ responsePlan: practicalPlan(status) }); assert.equal(input.obligation_outcomes[0].type, type); assert.equal(JSON.stringify(input).includes('Primero corta.'), false); if (status === 'blocked') assert.equal(input.obligation_outcomes[0].customer_expression.directive, 'guidance_cannot_be_provided_safely'); }
  const obligation = { id: 'o-unknown', category: 'practical_guidance', current_turn_evidence: 'cortar', confidence: 'high', ambiguous: false, practical_task: { task_kind: 'organization', bounded_inputs: [{ id: 'bi-1', input_type: 'preparation_step', value: 'cortar', origin: 'current_turn' }] } };
  for (const [resolution_status, authority, reason] of [['unknown', 'bounded_unknown', 'practical_guidance_unknown'], ['failed', 'resolver_failure', 'resolver_failure']]) { const resolved = base('o-unknown', { resolution_status, authority, source: null, customer_uncertainty_required: authority === 'bounded_unknown' }); const plan = buildResponsePlan({ context: context({ text: 'cortar' }), obligations: [obligation], resolvedObligations: [resolved], semanticGuidanceGates: [], authorizedActions: [] }); assert.equal(buildFinalComposerInput({ responsePlan: plan }).obligation_outcomes[0].reason, reason); }
});

test('Ticket 65E.1 requires exact closed withholding expressions and keeps withheld bodies absent', () => {
  const blockedGuidance = buildFinalComposerInput({ responsePlan: practicalPlan('blocked') });
  const blockedReproduction = buildFinalComposerInput({ responsePlan: transformPlan('blocked').plan, artifactReproductionGates: [transformPlan('blocked').gate] });
  const indeterminateReproduction = buildFinalComposerInput({ responsePlan: transformPlan('indeterminate').plan, artifactReproductionGates: [transformPlan('indeterminate').gate] });
  const mutate = (input, expression) => expression === null
    ? (() => { const { customer_expression, ...outcome } = input.obligation_outcomes[0]; return { ...input, obligation_outcomes: [outcome] }; })()
    : { ...input, obligation_outcomes: [{ ...input.obligation_outcomes[0], customer_expression: expression }] };
  const guidanceExpression = blockedGuidance.obligation_outcomes[0].customer_expression;
  for (const forged of [null, { ...guidanceExpression, directive: 'requested_content_cannot_be_reproduced' }, { ...guidanceExpression, allowed_claims: [] }, { ...guidanceExpression, prohibited_claims: [...guidanceExpression.prohibited_claims].reverse() }, { ...guidanceExpression, extra: true }]) assert.equal(finalComposerInputValid(mutate(blockedGuidance, forged)), false);
  const blocked = blockedReproduction.obligation_outcomes[0]; const indeterminate = indeterminateReproduction.obligation_outcomes[0];
  assert.equal(blocked.artifacts.length, 0); assert.equal(indeterminate.artifacts.length, 0);
  for (const forged of [null, indeterminate.customer_expression, { ...blocked, artifacts: [{ artifact_id: 'ca-injected', text: 'contenido oculto' }] }]) {
    const value = forged?.artifacts ? { ...blockedReproduction, obligation_outcomes: [forged] } : mutate(blockedReproduction, forged);
    assert.equal(finalComposerInputValid(value), false);
  }
  for (const forged of [null, blocked.customer_expression, { ...indeterminate, artifacts: [{ artifact_id: 'ca-injected', text: 'contenido oculto' }] }]) {
    const value = forged?.artifacts ? { ...indeterminateReproduction, obligation_outcomes: [forged] } : mutate(indeterminateReproduction, forged);
    assert.equal(finalComposerInputValid(value), false);
  }
});

test('Ticket 65E.1 forbids withholding expressions on draft and cleared reproduction', () => {
  const { plan, gate } = transformPlan(); const cleared = buildFinalComposerInput({ responsePlan: plan, artifactReproductionGates: [gate] });
  const draftTask = { operation: 'draft', artifact_ids: [], current_turn_inputs: [{ input_type: 'draft_specification', value: 'mensaje', origin: 'current_turn' }], current_turn_constraints: [] };
  const obligation = { id: 'o-draft', category: 'conversational_task', current_turn_evidence: 'mensaje', confidence: 'high', ambiguous: false, conversational_task: draftTask };
  const draft = buildFinalComposerInput({ responsePlan: buildResponsePlan({ context: context({ text: 'mensaje' }), obligations: [obligation], resolvedObligations: [base('o-draft', { resolution_status: 'deferred', authority: null, source: null, next_stage: 'conversational_generation' })], semanticGuidanceGates: [], authorizedActions: [] }) });
  const expression = buildFinalComposerInput({ responsePlan: practicalPlan('blocked') }).obligation_outcomes[0].customer_expression;
  for (const input of [cleared, draft]) assert.equal(finalComposerInputValid({ ...input, obligation_outcomes: [{ ...input.obligation_outcomes[0], customer_expression: expression }] }), false);
});

test('Ticket 65E requires exactly one valid reproduction gate for every show, transform, and summarize task', () => {
  for (const operation of ['show', 'transform', 'summarize']) { const { plan, gate } = transformPlan('cleared', operation); assert.equal(buildFinalComposerInput({ responsePlan: plan, artifactReproductionGates: [gate] }).obligation_outcomes[0].safety_outcome, 'reproduction_allowed'); assert.throws(() => buildFinalComposerInput({ responsePlan: plan }), /FINAL_COMPOSER_ARTIFACT_GATE_ALIGNMENT_INVALID/); assert.throws(() => buildFinalComposerInput({ responsePlan: plan, artifactReproductionGates: [gate, gate] }), /FINAL_COMPOSER_ARTIFACT_GATES_INVALID/); assert.throws(() => buildFinalComposerInput({ responsePlan: plan, artifactReproductionGates: [{ ...gate, obligation_id: 'o-foreign' }] }), /FINAL_COMPOSER_ARTIFACT_GATE_ALIGNMENT_INVALID/); }
});

test('Ticket 65E projects a validated commercial expression and exact destination only after success', () => {
  const { plan, authorized } = commercialPlan();
  const succeeded = resultFor({ action: authorized, execution_status: 'succeeded', payload: { destination: { kind: 'checkout', url: 'https://checkout.stripe.com/c/pay_65e' } } });
  const available = buildFinalComposerInput({ responsePlan: plan, actionResults: [succeeded] }).obligation_outcomes[0];
  assert.equal(available.expression.commercial_next_step_status, 'available'); assert.deepEqual(available.customer_action_result, succeeded.payload.destination);
  for (const status of ['not_executed', 'in_progress', 'failed_retryable', 'failed_terminal']) { const input = status === 'not_executed' ? buildFinalComposerInput({ responsePlan: plan }) : status === 'in_progress' ? buildFinalComposerInput({ responsePlan: plan, executionStates: [{ action_id: authorized.action_id, action_type: authorized.action_type, execution_status: status }] }) : buildFinalComposerInput({ responsePlan: plan, actionResults: [resultFor({ action: authorized, execution_status: status, payload: null })] }); const unavailable = input.obligation_outcomes[0]; assert.equal(unavailable.expression.execution_status, status); assert.equal(unavailable.expression.commercial_next_step_status, 'unavailable_now'); assert.equal(Object.hasOwn(unavailable, 'customer_action_result'), false); }
  assert.throws(() => buildFinalComposerInput({ responsePlan: plan, actionResults: [resultFor({ action: authorized, execution_status: 'succeeded', payload: { destination: { kind: 'checkout', url: 'https://example.test/altered' } } })] }), /ACTION_RESULT_INVALID/);
});

test('Ticket 65E maps closed launch policy outcomes and retains distinct support/social semantics without raw customer text', () => {
  const medication = { id: 'o-medication', category: 'medication_management', current_turn_evidence: 'cambia mi medicamento', confidence: 'high', ambiguous: false };
  const reminder = { id: 'o-reminder', category: 'reminder_request', current_turn_evidence: 'recuérdame', confidence: 'high', ambiguous: false, subject: 'explicit' };
  const support = { id: 'o-support', category: 'support_account', current_turn_evidence: 'ayuda', confidence: 'high', ambiguous: false };
  const social = { id: 'o-social', category: 'social_acknowledgement', current_turn_evidence: 'gracias', confidence: 'high', ambiguous: false };
  const policy = (id, source, decision) => base(id, { resolution_status: decision.outcome === 'prohibited' ? 'prohibited' : 'resolved', authority: decision.outcome === 'prohibited' ? 'prohibited' : 'deterministic_policy', source: { type: 'deterministic_policy', id: source, version: '1' }, policy_decision: decision });
  const plan = buildResponsePlan({ context: context({ text: 'cambia mi medicamento recuérdame ayuda gracias' }), obligations: [medication, reminder, support, social], resolvedObligations: [policy('o-medication', 'safety.medication_management', { outcome: 'prohibited', reason_code: 'MEDICATION_MANAGEMENT_REQUIRES_CLINICIAN' }), policy('o-reminder', 'reminder.explicit_launch_unavailable', { outcome: 'unsupported', reason_code: 'REMINDER_SCHEDULING_OUTSIDE_V2_LAUNCH' }), base('o-support', { resolution_status: 'deferred', authority: null, source: null, next_stage: 'support_resolution' }), base('o-social', { resolution_status: 'deferred', authority: null, source: null, next_stage: 'response_composition' })], semanticGuidanceGates: [], authorizedActions: [] });
  const input = buildFinalComposerInput({ responsePlan: plan });
  assert.deepEqual(input.obligation_outcomes.map(value => value.type), ['policy_expression', 'policy_expression', 'support_unresolved', 'social_acknowledgement']);
  assert.equal(JSON.stringify(input).includes('cambia mi medicamento'), false);
  assert.equal(JSON.stringify(input).includes('recuérdame'), false);
  assert.equal(JSON.stringify(input).includes('reason_code'), false);
  assert.equal(input.obligation_outcomes[2].customer_expression, 'support_request_unresolved');
  assert.equal(JSON.stringify(input).includes('support_unavailable'), false);
  assert.throws(() => buildFinalComposerInput({ responsePlan: { ...plan, policy_outcomes: [{ ...plan.policy_outcomes[0], source: { ...plan.policy_outcomes[0].source, id: 'policy.unknown' } }] } }), /FINAL_COMPOSER_POLICY_EXPRESSION_UNAVAILABLE/);
});

test('Ticket 65E standalone validator rejects unknown, duplicate, and destination-forged outcomes', () => {
  const { plan, authorized } = commercialPlan(); const result = resultFor({ action: authorized, execution_status: 'succeeded', payload: { destination: { kind: 'checkout', url: 'https://checkout.stripe.com/c/pay_65e' } } }); const value = buildFinalComposerInput({ responsePlan: plan, actionResults: [result] });
  assert.equal(finalComposerInputValid({ ...value, obligation_outcomes: [...value.obligation_outcomes, value.obligation_outcomes[0]] }), false);
  assert.equal(finalComposerInputValid({ ...value, obligation_outcomes: [{ ...value.obligation_outcomes[0], customer_action_result: { kind: 'checkout', url: 'https://example.test/forged' } }] }), false);
  assert.equal(finalComposerInputValid({ ...value, obligation_outcomes: [{ ...value.obligation_outcomes[0], expression: { ...value.obligation_outcomes[0].expression, execution_status: 'unknown' } }] }), false);
});

test('Ticket 65E standalone validator enforces the canonical closed policy-expression mapping', () => {
  const medication = { id: 'o-medication', category: 'medication_management', current_turn_evidence: 'cambia', confidence: 'high', ambiguous: false };
  const resolved = base('o-medication', { resolution_status: 'prohibited', authority: 'prohibited', source: { type: 'deterministic_policy', id: 'safety.medication_management', version: '1' }, policy_decision: { outcome: 'prohibited', reason_code: 'MEDICATION_MANAGEMENT_REQUIRES_CLINICIAN' }, prohibited_claims: ['medication_management_advice'] });
  const value = buildFinalComposerInput({ responsePlan: buildResponsePlan({ context: context({ text: 'cambia' }), obligations: [medication], resolvedObligations: [resolved], semanticGuidanceGates: [], authorizedActions: [] }) }); const expression = value.obligation_outcomes[0].policy_expression;
  for (const forged of [{ ...expression, directive: 'unknown' }, { ...expression, semantics_version: 'ticket-65e-policy-v2' }, { ...expression, allowed_claims: [] }, { ...expression, allowed_claims: [...expression.allowed_claims, 'extra'] }, { ...expression, prohibited_claims: [] }, { ...expression, extra: true }]) assert.equal(finalComposerInputValid({ ...value, obligation_outcomes: [{ ...value.obligation_outcomes[0], policy_expression: forged }] }), false);
  assert.equal(finalComposerInputValid({ ...value, obligation_outcomes: [{ ...value.obligation_outcomes[0], guidance_payload: {} }] }), false);
});

test('Ticket 65E standalone validator closes every outcome variant and its local conversational shapes', () => {
  const { plan, gate } = transformPlan(); const conversation = buildFinalComposerInput({ responsePlan: plan, artifactReproductionGates: [gate] });
  const { plan: commercial, authorized } = commercialPlan(); const commercialInput = buildFinalComposerInput({ responsePlan: commercial, actionResults: [resultFor({ action: authorized, execution_status: 'succeeded', payload: { destination: { kind: 'checkout', url: 'https://checkout.stripe.com/c/pay_65e' } } })] });
  const supportSocial = (() => { const support = { id: 'o-support', category: 'support_account', current_turn_evidence: 'ayuda', confidence: 'high', ambiguous: false }; const social = { id: 'o-social', category: 'social_acknowledgement', current_turn_evidence: 'gracias', confidence: 'high', ambiguous: false }; const plan = buildResponsePlan({ context: context({ text: 'ayuda gracias' }), obligations: [support, social], resolvedObligations: [base('o-support', { resolution_status: 'deferred', authority: null, source: null, next_stage: 'support_resolution' }), base('o-social', { resolution_status: 'deferred', authority: null, source: null, next_stage: 'response_composition' })], semanticGuidanceGates: [], authorizedActions: [] }); return buildFinalComposerInput({ responsePlan: plan }); })();
  const uncertaintyPlan = (() => { const obligation = { id: 'o-unknown', category: 'product_fact', current_turn_evidence: 'precio', confidence: 'high', ambiguous: false }; return buildFinalComposerInput({ responsePlan: buildResponsePlan({ context: context({ text: 'precio' }), obligations: [obligation], resolvedObligations: [base('o-unknown', { resolution_status: 'unknown', authority: 'bounded_unknown', source: null, customer_uncertainty_required: true })], semanticGuidanceGates: [], authorizedActions: [] }) }); })();
  const factPlan = (() => { const obligation = { id: 'o-fact', category: 'product_fact', current_turn_evidence: 'precio', confidence: 'high', ambiguous: false }; return buildFinalComposerInput({ responsePlan: buildResponsePlan({ context: context({ text: 'precio' }), obligations: [obligation], resolvedObligations: [base('o-fact', { resolution_status: 'resolved', authority: 'canonical_fact', source: { type: 'canonical_fact', id: 'offer.price', version: '1' }, factual_payload: { amount: 149 } })], semanticGuidanceGates: [], authorizedActions: [] }) }); })();
  const mutate = (input, index, field) => ({ ...input, obligation_outcomes: input.obligation_outcomes.map((value, position) => position === index ? { ...value, ...field } : value) });
  for (const forged of [mutate(supportSocial, 0, { factual_payload: {} }), mutate(supportSocial, 1, { policy_expression: {} }), mutate(uncertaintyPlan, 0, { customer_expression: 'acknowledge' }), mutate(conversation, 0, { reason: 'resolver_failure' }), mutate(commercialInput, 0, { factual_payload: {} }), mutate(factPlan, 0, { expression: {} })]) assert.equal(finalComposerInputValid(forged), false);
  const task = conversation.obligation_outcomes[0];
  for (const forged of [mutate(conversation, 0, { current_turn_constraints: [{ value: 'más corto', origin: 'current_turn', extra: true }] }), mutate(conversation, 0, { artifacts: [{ ...task.artifacts[0], extra: true }] }), mutate(conversation, 0, { artifacts: [{ ...task.artifacts[0], artifact_id: 'bad' }] })]) assert.equal(finalComposerInputValid(forged), false);
});

test('Ticket 65E central schema exposes the same closed envelope vocabulary and reproduction safety states', () => {
  const definition = schema.$defs.FinalComposerInput;
  assert.equal(schema.properties.FinalComposerInput.$ref, '#/$defs/FinalComposerInput');
  assert.equal(definition.properties.composer_input_version.const, 'ticket-65e-v1');
  const variants = definition.properties.obligation_outcomes.items.oneOf;
  const conversation = variants.find(value => value.properties?.type?.const === 'conversational_generation');
  assert.deepEqual(conversation.properties.safety_outcome.enum, ['generation_allowed', 'reproduction_allowed', 'reproduction_blocked', 'reproduction_indeterminate']);
  assert.equal(conversation.allOf.length, 6);
  assert.equal(conversation.properties.customer_expression.$ref, '#/$defs/WithholdingExpression');
  assert.equal(schema.$defs.WithholdingExpression.properties.semantics_version.const, 'ticket-65e1-v1');
  assert.equal(schema.$defs.WithholdingExpression.allOf.length, 3);
  const policy = variants.find(value => value.properties?.type?.const === 'policy_expression');
  assert.equal(policy.properties.policy_expression.properties.semantics_version.const, 'ticket-65e-policy-v1');
  assert.equal(policy.properties.policy_expression.allOf.length, 3);
  assert.deepEqual(policy.properties.policy_expression.allOf[0].then.properties.allowed_claims.const, ['refer_to_clinician']);
  const support = variants.find(value => value.properties?.type?.const === 'support_unresolved');
  assert.equal(support.properties.customer_expression.const, 'support_request_unresolved');
});
