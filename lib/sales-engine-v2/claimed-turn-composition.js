'use strict';

const crypto = require('node:crypto');
const { createAuthorityFactResolver } = require('./product-fact-authority');
const { createPolicyResolver } = require('./policy-resolver');
const { diagnosticCompanion, runSalesEngineV2Turn, turnResultValid } = require('./turn-orchestrator');
const { projectTurnOutcome } = require('./diagnostic-observer');
const { buildPostGateDeliveryManifest, postGateDeliveryManifestValid } = require('./post-gate-delivery-manifest');
const { executeAuthorizedAction } = require('./action-executor');
const { createShadowActionExecutor } = require('./action-runtime-adapters');
const { createApprovedDeliveryReservation } = require('./approved-delivery-reservation');
const defaultPolicies = require('../../config/sales-engine-v2/policies.json');

const CONTRACT_VERSION = 'ticket-75c3-runtime-v1';
class ClaimedTurnCompositionError extends Error { constructor(code) { super(code); this.name = 'ClaimedTurnCompositionError'; this.code = code; } }
const runId = (identity, stage) => `mr-${crypto.createHash('sha256').update(`${identity}\n${stage}`, 'utf8').digest('hex')}`;
function abort(signal) { if (signal?.aborted) throw new ClaimedTurnCompositionError('deadline_exceeded'); }
function validBundle(value) { return value && typeof value === 'object' && value.conversation_context && value.product_fact_authority && value.reviewed_knowledge_authority?.store; }

function createClaimedTurnComposition({ stageAdapters, actionReservationStore, actionProviders, approvedDeliveryReservation, diagnosticObserver, policies = defaultPolicies.policies, shadowActionExecutor = createShadowActionExecutor() } = {}) {
  if (!stageAdapters || typeof stageAdapters !== 'object' || !['interpreterAdapter', 'boundedReasoningAdapter', 'semanticGuidanceAssessor', 'artifactReproductionAssessor', 'composerAdapter', 'finalResponseAssessor'].every(key => typeof stageAdapters[key] === 'function') || !Array.isArray(policies) || typeof shadowActionExecutor !== 'function') throw new ClaimedTurnCompositionError('runtime_not_configured');
  const preparedLiveDeliveries = new Map();
  const observe = event => { try { diagnosticObserver?.observe(event); } catch {} };
  const observeTurn = args => { try { observe(projectTurnOutcome(args)); } catch {} };
  return Object.freeze({
    async run({ canonicalInput, mode, invocationIdentity, signal, diagnosticContext }) {
      if (!validBundle(canonicalInput) || !['live', 'shadow'].includes(mode) || typeof invocationIdentity !== 'string') throw new ClaimedTurnCompositionError('context_invalid');
      abort(signal);
      const prior = mode === 'live' && approvedDeliveryReservation ? preparedLiveDeliveries.get(invocationIdentity) : null;
      if (prior) {
        const durable = await approvedDeliveryReservation.reserve({ ...prior, session_id: canonicalInput.conversation_context.session_state.session_id, processing_owner: canonicalInput.claim.processing_owner, invocationIdentity });
        if (diagnosticObserver && diagnosticContext) { const diagnostic = diagnosticCompanion(prior.turnResult); observeTurn({ ...diagnosticContext, invocationIdentity, turnResult: prior.turnResult, actionProjection: diagnostic.action_projection, gateProjection: diagnostic.gate_projection, reservation: durable.reservation }); }
        return Object.freeze({ contract_version: CONTRACT_VERSION, status: 'response_eligible', turn_result: prior.turnResult, delivery: Object.freeze({ text: prior.turnResult.customer_response.text, post_gate_delivery_manifest: prior.manifest, reservation: durable.reservation }) });
      }
      const dependencies = {
        ...stageAdapters,
        factResolver: createAuthorityFactResolver({ authority: canonicalInput.product_fact_authority }),
        policyResolver: createPolicyResolver({ policies }),
        knowledgeStore: canonicalInput.reviewed_knowledge_authority.store,
        authorizedActionExecutor: mode === 'shadow'
          ? input => shadowActionExecutor(input)
          : input => {
              if (!actionReservationStore || !actionProviders) throw new ClaimedTurnCompositionError('action_lifecycle_unavailable');
              return executeAuthorizedAction({ ...input, reservationStore: actionReservationStore, providers: actionProviders, signal });
            }
      };
      const turnResult = await runSalesEngineV2Turn({
        conversationContext: canonicalInput.conversation_context,
        dependencies,
        runContext: {
          asOf: canonicalInput.built_at,
          boundedReasoningRunId: runId(invocationIdentity, 'bounded_reasoning'),
          semanticGuidanceAssessorRunId: runId(invocationIdentity, 'semantic_guidance_assessor'),
          artifactReproductionAssessorRunId: runId(invocationIdentity, 'artifact_reproduction_assessor'),
          composerModelRunId: runId(invocationIdentity, 'composer'),
          finalResponseAssessorRunId: runId(invocationIdentity, 'final_response_assessor')
        }
      });
      abort(signal);
      if (!turnResultValid(turnResult)) throw new ClaimedTurnCompositionError('internal_unclassified');
      if (turnResult.status !== 'response_eligible') {
        if (diagnosticObserver && diagnosticContext) observeTurn({ ...diagnosticContext, invocationIdentity, turnResult });
        return Object.freeze({ contract_version: CONTRACT_VERSION, status: 'response_ineligible', turn_result: turnResult });
      }
      const manifest = buildPostGateDeliveryManifest({ turnResult });
      if (!postGateDeliveryManifestValid(manifest, { turnResult })) throw new ClaimedTurnCompositionError('internal_unclassified');
      const delivery = { text: turnResult.customer_response.text, post_gate_delivery_manifest: manifest };
      if (mode === 'live' && approvedDeliveryReservation) {
        preparedLiveDeliveries.set(invocationIdentity, Object.freeze({ turnResult, manifest }));
        const durable = await approvedDeliveryReservation.reserve({ turnResult, manifest, session_id: canonicalInput.conversation_context.session_state.session_id, processing_owner: canonicalInput.claim.processing_owner, invocationIdentity });
        delivery.reservation = durable.reservation;
      }
      if (diagnosticObserver && diagnosticContext) { const diagnostic = diagnosticCompanion(turnResult); observeTurn({ ...diagnosticContext, invocationIdentity, turnResult, actionProjection: diagnostic.action_projection, gateProjection: diagnostic.gate_projection, reservation: delivery.reservation }); }
      return Object.freeze({ contract_version: CONTRACT_VERSION, status: 'response_eligible', turn_result: turnResult, delivery: Object.freeze(delivery) });
    }
  });
}

module.exports = { CONTRACT_VERSION, ClaimedTurnCompositionError, createClaimedTurnComposition };
