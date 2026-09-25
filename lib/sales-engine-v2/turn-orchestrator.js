'use strict';

// Ticket 68 is deliberately a wiring layer: every semantic decision below is
// delegated to the stage that already owns it.
const { assertConversationContext, ConversationContextError } = require('./conversation-context-validator');
const { interpretConversation } = require('./interpreter');
const { InterpreterError } = require('./interpreter-validator');
const { resolveObligations, ResolutionOrchestratorError } = require('./resolution-orchestrator');
const { resolvePracticalGuidance, PracticalGuidanceResolverError } = require('./practical-guidance-resolver');
const { assessSemanticGuidance, SemanticGuidanceSafetyGateError } = require('./semantic-guidance-safety-gate');
const { assessArtifactReproduction, ArtifactReproductionSafetyGateError } = require('./artifact-reproduction-safety-gate');
const { buildResponsePlan, ResponsePlanError } = require('./response-plan-builder');
const { deriveArtifactOutputIntents, ConversationalArtifactOutputIdentityError } = require('./conversational-artifact-output-identity');
const { executeAuthorizedAction, ActionExecutorError } = require('./action-executor');
const { buildFinalComposerInput, FinalComposerInputError } = require('./final-composer-input');
const { composeResponse, composerFailureValid, ComposerError } = require('./response-composer');
const { assessFinalCustomerResponse, customerResponseEligible, FinalCustomerResponseGateError } = require('./final-customer-response-gate');

const TURN_RESULT_VERSION = 'ticket-68-v1';
const FAILURE_CODES = new Set(['context_invalid', 'interpretation_failed', 'resolution_failed', 'guidance_resolution_failed', 'guidance_assessment_unavailable', 'artifact_assessment_unavailable', 'planning_failed', 'action_execution_unavailable', 'final_composer_input_failed', 'composer_unavailable', 'final_response_assessment_unavailable', 'final_response_blocked', 'final_response_binding_invalid']);
const FAILURE_STAGES = new Set(['context', 'interpretation', 'resolution', 'guidance_resolution', 'guidance_assessment', 'artifact_assessment', 'planning', 'action_execution', 'final_composer_input', 'composer', 'final_gate']);
const clone = value => structuredClone(value);
// Deliberately outside TurnResult's serializable/customer-facing contract.
// Ticket 68A may retrieve it only from an eligible in-memory result.
const artifactOutputIntentCompanions = new WeakMap();

class TurnOrchestratorError extends Error { constructor(code, cause) { super(code); this.name = 'TurnOrchestratorError'; this.code = code; this.cause = cause; } }

function result(context, status, fields = {}) {
  return { turn_result_version: TURN_RESULT_VERSION, contract_version: '2.0', context_id: context.context_id, status, ...fields };
}
function turnResultValid(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.turn_result_version !== TURN_RESULT_VERSION || value.contract_version !== '2.0' || !['response_eligible', 'response_ineligible'].includes(value.status) || !Array.isArray(value.stage_trace) || !value.stage_trace.every(item => item && typeof item === 'object' && Object.keys(item).length === 2 && typeof item.stage === 'string' && ['completed', 'failed'].includes(item.status))) return false;
  if (value.status === 'response_eligible') return Object.keys(value).every(key => new Set(['turn_result_version', 'contract_version', 'context_id', 'status', 'customer_response', 'action_execution_summary', 'stage_trace']).has(key)) && typeof value.context_id === 'string' && !!value.context_id && value.customer_response && typeof value.customer_response === 'object' && Object.keys(value.customer_response).length === 3 && typeof value.customer_response.text === 'string' && !!value.customer_response.text && value.customer_response.composer_result_version === 'ticket-66-v1' && value.customer_response.final_gate_version === 'ticket-67-v1' && Array.isArray(value.action_execution_summary) && value.action_execution_summary.every(item => item && typeof item === 'object' && Object.keys(item).length === 3 && /^act-[0-9a-f]{64}$/.test(item.action_id) && ['provide_checkout_destination', 'provide_holding_page_destination'].includes(item.action_type) && ['succeeded', 'failed_retryable', 'failed_terminal', 'in_progress'].includes(item.execution_status));
  return Object.keys(value).every(key => new Set(['turn_result_version', 'contract_version', 'context_id', 'status', 'failure_stage', 'failure_code', 'stage_trace']).has(key)) && FAILURE_STAGES.has(value.failure_stage) && FAILURE_CODES.has(value.failure_code) && (!Object.hasOwn(value, 'context_id') || (typeof value.context_id === 'string' && !!value.context_id));
}
function failure(context, stage, code, trace) {
  if (!FAILURE_CODES.has(code)) throw new TurnOrchestratorError('TURN_FAILURE_CODE_INVALID');
  return result(context, 'response_ineligible', { failure_stage: stage, failure_code: code, stage_trace: trace });
}
function expected(error, Type) { return error instanceof Type; }
function artifactOutputIntentCompanion(turnResult) {
  const value = artifactOutputIntentCompanions.get(turnResult);
  return value ? structuredClone(value) : null;
}
function requireRunId(value, name) { if (typeof value !== 'string' || !value) throw new TurnOrchestratorError(`TURN_${name}_RUN_ID_INVALID`); return value; }
function launchCardinalitySupported(actions) { return Array.isArray(actions) && actions.length <= 1; }
async function executeLaunchActions(actions, executor) {
  if (!launchCardinalitySupported(actions)) return null;
  if (actions.length === 0) return [];
  return [await executor(actions[0])];
}

// This captures the exact reviewed item selected by Ticket 63. Re-reading the
// store could select a different item and would break Ticket 63A's binding.
function capturingKnowledgeStore(store, capture) {
  return { retrieve(request) {
    const item = store.retrieve(request);
    // Ticket 64 accepts only the narrow reviewed-item projection used by
    // Ticket 63A's binding, not storage/provenance fields.
    capture.item = item === null ? null : { id: item.id, version: item.version, content: item.content };
    return item;
  } };
}

async function runSalesEngineV2Turn({ conversationContext, dependencies, runContext = {} }) {
  let context;
  try { context = assertConversationContext(conversationContext); }
  catch (error) {
    if (expected(error, ConversationContextError)) return { turn_result_version: TURN_RESULT_VERSION, contract_version: '2.0', status: 'response_ineligible', failure_stage: 'context', failure_code: 'context_invalid', stage_trace: [{ stage: 'context', status: 'failed' }] };
    throw error;
  }
  const trace = [{ stage: 'context', status: 'completed' }];
  if (!dependencies || typeof dependencies !== 'object') throw new TurnOrchestratorError('TURN_DEPENDENCIES_INVALID');
  let obligations;
  try { obligations = await interpretConversation({ context, model: dependencies.interpreterAdapter }); trace.push({ stage: 'interpretation', status: 'completed' }); }
  catch (error) { if (expected(error, InterpreterError)) return failure(context, 'interpretation', 'interpretation_failed', trace.concat({ stage: 'interpretation', status: 'failed' })); throw error; }
  let initial;
  try { initial = resolveObligations({ context, obligations, factResolver: dependencies.factResolver, policyResolver: dependencies.policyResolver, asOf: runContext.asOf, ...(runContext.reminderContexts ? { reminderContexts: runContext.reminderContexts } : {}) }); trace.push({ stage: 'resolution', status: 'completed' }); }
  catch (error) { if (expected(error, ResolutionOrchestratorError)) return failure(context, 'resolution', 'resolution_failed', trace.concat({ stage: 'resolution', status: 'failed' })); throw error; }

  const byObligation = new Map(obligations.map(item => [item.id, item]));
  const resolved = initial.resolved_obligations.map(clone);
  const guidanceGates = [];
  for (let index = 0; index < resolved.length; index += 1) {
    const deferred = resolved[index];
    if (deferred.next_stage !== 'reviewed_knowledge_or_reasoning') continue;
    const obligation = byObligation.get(deferred.obligation_id); const capture = {};
    let terminal;
    try {
      terminal = resolvePracticalGuidance({ obligation, deferredResolution: deferred, locale: context.locale, asOf: runContext.asOf, knowledgeStore: capturingKnowledgeStore(dependencies.knowledgeStore, capture), ...(obligation.practical_task.task_kind === 'knowledge_question' ? {} : { reasoningModel: dependencies.boundedReasoningAdapter, modelRunId: requireRunId(runContext.boundedReasoningRunId, 'BOUNDED_REASONING') }) });
    } catch (error) { if (expected(error, PracticalGuidanceResolverError)) return failure(context, 'guidance_resolution', 'guidance_resolution_failed', trace.concat({ stage: 'guidance_resolution', status: 'failed' })); throw error; }
    resolved[index] = terminal;
    if (!['reviewed_knowledge', 'generated_guidance'].includes(terminal.authority)) continue;
    try {
      guidanceGates.push(assessSemanticGuidance({ originatingObligation: obligation, terminalResult: terminal, locale: context.locale, reviewedKnowledgeItems: capture.item ? [capture.item] : [], semanticAssessor: dependencies.semanticGuidanceAssessor, assessorRunId: requireRunId(runContext.semanticGuidanceAssessorRunId, 'SEMANTIC_GUIDANCE_ASSESSOR') }));
    } catch (error) { if (expected(error, SemanticGuidanceSafetyGateError)) return failure(context, 'guidance_assessment', 'guidance_assessment_unavailable', trace.concat({ stage: 'guidance_assessment', status: 'failed' })); throw error; }
  }
  trace.push({ stage: 'guidance_resolution', status: 'completed' });

  let plan;
  try { plan = buildResponsePlan({ context, obligations, resolvedObligations: resolved, semanticGuidanceGates: guidanceGates, authorizedActions: initial.authorized_actions }); trace.push({ stage: 'planning', status: 'completed' }); }
  catch (error) { if (expected(error, ResponsePlanError)) return failure(context, 'planning', 'planning_failed', trace.concat({ stage: 'planning', status: 'failed' })); throw error; }
  let artifactOutputIntents;
  try { artifactOutputIntents = deriveArtifactOutputIntents({ context, responsePlan: plan }); }
  catch (error) { if (expected(error, ConversationalArtifactOutputIdentityError)) return failure(context, 'planning', 'planning_failed', trace.concat({ stage: 'planning', status: 'failed' })); throw error; }
  // Tickets 59B/62/65 do not establish a one-action cardinality invariant:
  // Ticket 65 intentionally preserves distinct authorized actions. Launch v1
  // supports one action only, so fail before invoking any executor.
  if (!launchCardinalitySupported(plan.authorized_actions)) return failure(context, 'planning', 'planning_failed', trace.concat({ stage: 'planning', status: 'failed' }));
  const artifactGates = [];
  for (const task of plan.conversational_generation) {
    if (task.operation === 'draft') continue;
    try { artifactGates.push(assessArtifactReproduction({ conversationalGeneration: task, locale: context.locale, artifactAssessor: dependencies.artifactReproductionAssessor, assessorRunId: requireRunId(runContext.artifactReproductionAssessorRunId, 'ARTIFACT_ASSESSOR') })); }
    catch (error) { if (expected(error, ArtifactReproductionSafetyGateError)) return failure(context, 'artifact_assessment', 'artifact_assessment_unavailable', trace.concat({ stage: 'artifact_assessment', status: 'failed' })); throw error; }
  }
  trace.push({ stage: 'artifact_assessment', status: 'completed' });
  const actionResults = []; const executionStates = [];
  for (const action of plan.authorized_actions) {
    let execution;
    try { execution = await (dependencies.authorizedActionExecutor || executeAuthorizedAction)({ authorizedAction: action, reservationStore: dependencies.actionReservationStore, providers: dependencies.actionProviders }); }
    catch (error) { if (expected(error, ActionExecutorError)) return failure(context, 'action_execution', 'action_execution_unavailable', trace.concat({ stage: 'action_execution', status: 'failed' })); throw error; }
    if (execution.action_execution_state === 'in_progress') executionStates.push(execution); else actionResults.push(execution);
  }
  trace.push({ stage: 'action_execution', status: 'completed' });
  let finalComposerInput;
  try { finalComposerInput = buildFinalComposerInput({ responsePlan: plan, artifactReproductionGates: artifactGates, actionResults, executionStates }); trace.push({ stage: 'final_composer_input', status: 'completed' }); }
  catch (error) { if (expected(error, FinalComposerInputError) || error?.code?.startsWith('PRE_COMPOSER_')) return failure(context, 'final_composer_input', 'final_composer_input_failed', trace.concat({ stage: 'final_composer_input', status: 'failed' })); throw error; }
  let composerResult;
  try { composerResult = composeResponse({ finalComposerInput, composerAdapter: dependencies.composerAdapter, modelRunId: requireRunId(runContext.composerModelRunId, 'COMPOSER') }); }
  catch (error) { if (expected(error, ComposerError)) return failure(context, 'composer', 'composer_unavailable', trace.concat({ stage: 'composer', status: 'failed' })); throw error; }
  if (composerFailureValid(composerResult, { finalComposerInput })) return failure(context, 'composer', 'composer_unavailable', trace.concat({ stage: 'composer', status: 'failed' }));
  trace.push({ stage: 'composer', status: 'completed' });
  let finalGate;
  try { finalGate = assessFinalCustomerResponse({ finalComposerInput, composerResult, semanticAssessor: dependencies.finalResponseAssessor, assessorRunId: requireRunId(runContext.finalResponseAssessorRunId, 'FINAL_RESPONSE_ASSESSOR') }); }
  catch (error) { if (expected(error, FinalCustomerResponseGateError)) return failure(context, 'final_gate', 'final_response_assessment_unavailable', trace.concat({ stage: 'final_gate', status: 'failed' })); throw error; }
  if (!customerResponseEligible({ finalComposerInput, composerResult, finalGate })) {
    const code = finalGate.gate_status === 'blocked' ? 'final_response_blocked' : finalGate.gate_status === 'indeterminate' ? 'final_response_assessment_unavailable' : 'final_response_binding_invalid';
    return failure(context, 'final_gate', code, trace.concat({ stage: 'final_gate', status: 'failed' }));
  }
  trace.push({ stage: 'final_gate', status: 'completed' });
  const eligible = result(context, 'response_eligible', { customer_response: { text: composerResult.response_text, composer_result_version: composerResult.composer_result_version, final_gate_version: finalGate.gate_version }, action_execution_summary: actionResults.map(item => ({ action_id: item.action_id, action_type: item.action_type, execution_status: item.execution_status })).concat(executionStates.map(item => ({ action_id: item.action_id, action_type: item.action_type, execution_status: item.action_execution_state }))), stage_trace: trace });
  if (artifactOutputIntents.length) artifactOutputIntentCompanions.set(eligible, artifactOutputIntents);
  return eligible;
}

module.exports = { FAILURE_CODES, FAILURE_STAGES, TURN_RESULT_VERSION, TurnOrchestratorError, artifactOutputIntentCompanion, executeLaunchActions, launchCardinalitySupported, runSalesEngineV2Turn, turnResultValid };
