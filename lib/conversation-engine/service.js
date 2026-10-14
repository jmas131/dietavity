'use strict';

const rag = require('../sales-engine-v2/direct-rag-v3');
const { validateRequest, validateResponse, RESPONSE_CONTRACT_VERSION, ENGINE_VERSION } = require('./contracts');
const { ConversationLlmError } = require('./llm-client');
const { foodDiagnostics, emit } = require('./diagnostics');

function nowMs(clock) { return Number(clock()); }

// Node-only activation grammar for meal reports whose food wording falls
// outside Direct RAG's closed operational-food vocabulary. It does not create
// inventory, a recommendation, or a new interpreter obligation type.
function declarativeMealReport(currentMessage, history) {
  const value = String(currentMessage || '').trim();
  if (!value || /[¿?]/u.test(value) || /^(?:no|nunca|jam[aá]s|tal\s+vez|quiz[aá]s|probablemente|si|cuando|seg[uú]n)\b/iu.test(value)) return null;
  const terminal = value.replace(/[.!]+$/u, '').trim();
  const report = (meal, pattern) => {
    const match = pattern.exec(terminal);
    return match && /\S/u.test(match[1]) ? Object.freeze({ meal, evidence: match[0] }) : null;
  };
  const explicit = report('breakfast', /^(?:hoy\s+)?desayun[eé]\s+(.+)$/iu)
    || report('meal', /^acabo\s+de\s+comer\s+(.+)$/iu)
    || report('meal', /^(?:ayer\s+|hoy\s+|en\s+la\s+ma[ñn]ana\s+)?com[ií]\s+(.+)$/iu);
  if (explicit) return explicit;
  const lastHistoryItem = Array.isArray(history) ? history.at(-1) : null;
  const activationInvitesMealReport = lastHistoryItem?.role === 'assistant'
    && /contarme\s+qu[eé]\s+has\s+comido/iu.test(String(lastHistoryItem.text || ''));
  return activationInvitesMealReport ? report('breakfast', /^desayuno\s+(.+)$/iu) : null;
}

function mealReportClaim(report) {
  return report?.meal === 'breakfast' ? 'Gracias por contarme tu desayuno.' : 'Gracias por contarme lo que comiste.';
}

function applyDeclarativeMealReportResolution(resolution, report) {
  if (!report || resolution.resolved_obligations.length !== 1 || resolution.resolved_obligations[0]?.obligation?.type !== 'unsupported') return resolution;
  const claim = mealReportClaim(report);
  return {
    ...resolution,
    resolved_obligations: resolution.resolved_obligations.map(item => ({ ...item, permitted_claims: [claim] })),
    permitted_claims: [claim],
  };
}

function normalizeObligations(model, currentMessage) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) throw new ConversationLlmError('llm_malformed_output');
  const allowed = new Set(rag.INTERPRETER_OBLIGATION_TYPES);
  const values = model.obligations;
  if (!Array.isArray(values) || !values.length || values.length > 8) return [{ type: 'unsupported', evidence: currentMessage }];
  const normalized = []; const seen = new Set();
  for (const value of values) {
    if (!value || !allowed.has(value.type) || typeof value.evidence !== 'string' || !currentMessage.includes(value.evidence)) continue;
    const key = JSON.stringify([value.type, value.evidence]);
    if (seen.has(key)) continue;
    seen.add(key); normalized.push({ type: value.type, evidence: value.evidence });
  }
  return normalized.length ? normalized : [{ type: 'unsupported', evidence: currentMessage }];
}

function parsedContext(request, model) {
  let interpreterContext = {};
  try { interpreterContext = rag.validateInterpreterSemanticContext(model.semantic_context, request.current_message); } catch { interpreterContext = {}; }
  const history = request.canonical_history.map(({ role, text }) => ({ role, text }));
  const semanticContext = rag.extractSemanticContext(request.current_message, history, interpreterContext);
  const mealReport = declarativeMealReport(request.current_message, history);
  const raw = normalizeObligations(model, request.current_message);
  const support = rag.reconcileWeakNutritionSupportObligations(raw, request.current_message, semanticContext);
  const appetite = rag.reconcileStandaloneAppetiteObservationObligations(support, request.current_message, semanticContext);
  const inventory = rag.reconcileAuthoritativeContextualInventoryObligations(appetite, request.current_message, semanticContext, history);
  const weakTypes = new Set(['nutrition_support_request', 'general_information', 'acknowledgement', 'unsupported']);
  const reconciled = mealReport && inventory.every(obligation => weakTypes.has(obligation?.type))
    ? [{ type: 'unsupported', evidence: request.current_message }]
    : inventory;
  const obligations = reconciled
    .map((obligation, index) => ({ id: `o-${index + 1}`, type: obligation.type, evidence: obligation.evidence }));
  return Object.freeze({ history, semanticContext, mealReport, obligations });
}

function finalResponse(resolution, composition) {
  const response = composition && typeof composition.response === 'string' ? composition.response : '';
  const covered = Array.isArray(composition?.covered_obligation_ids) ? composition.covered_obligation_ids : [];
  const used = Array.isArray(composition?.used_claims) ? composition.used_claims : [];
  const gate = rag.gateResponse({ envelope: resolution.envelope, response, coveredObligationIds: covered, usedClaims: used });
  const fallback = resolution.resolution.permitted_claims.join(' ');
  return Object.freeze({ output: gate.cleared ? response.trim() : fallback || 'No tengo información confirmada para responder eso.', gate });
}

function createConversationEngine({ llmClient, logger = null, clock = Date.now } = {}) {
  if (!llmClient || typeof llmClient.interpret !== 'function' || typeof llmClient.compose !== 'function') throw new TypeError('CONVERSATION_LLM_CLIENT_REQUIRED');
  return Object.freeze({
    async resolve(untrustedRequest) {
      const started = nowMs(clock);
      const request = validateRequest(untrustedRequest);
      const stage = {};
      const obligationStarted = nowMs(clock);
      const model = await llmClient.interpret({
        contract_version: request.contract_version,
        session_id: request.session_id,
        inbound_message_id: request.inbound_message_id,
        processing_order: request.processing_order,
        current_message: request.current_message,
        history: request.canonical_history.map(({ role, text }) => ({ role, text })),
      });
      stage.obligations_llm = nowMs(clock) - obligationStarted;
      const parsed = parsedContext(request, model);
      const resolutionStarted = nowMs(clock);
      const context = { current_message: request.current_message, history: parsed.history, most_recent_assistant_message: parsed.history.filter(item => item.role === 'assistant').at(-1)?.text || '', semantic_context: parsed.semanticContext };
      const directResolution = applyDeclarativeMealReportResolution(rag.resolveObligations({ context, obligations: parsed.obligations }), parsed.mealReport);
      const envelope = rag.buildCompositionEnvelope({ context, resolution: directResolution });
      stage.deterministic = nowMs(clock) - resolutionStarted;
      const compositionStarted = nowMs(clock);
      const composition = await llmClient.compose(envelope);
      stage.composition_llm = nowMs(clock) - compositionStarted;
      const finished = finalResponse({ resolution: directResolution, envelope }, composition);
      const foodResolution = directResolution.resolved_obligations.find(item => ['food_decision', 'food_context', 'recommendation_feedback'].includes(item.obligation.type));
      const recommendation = Object.freeze({ source: foodResolution?.recommendation_source || null, status: foodResolution?.recommendation_status || null, failure_code: foodResolution?.recommendation_failure_code || null });
      const response = Object.freeze({
        contract_version: RESPONSE_CONTRACT_VERSION,
        engine_version: ENGINE_VERSION,
        request_id: request.request_id,
        resolution: Object.freeze({ status: finished.gate.cleared ? 'resolved' : 'safe_fallback', type: 'direct_rag_response', delivery_permitted: true }),
        assistant_response: finished.output,
        persistence: Object.freeze({ pending_action: 'respond', strategy: 'direct_rag_v3_response', buyer_signal: parsed.obligations.some(item => item.type === 'purchase_intent') ? 'purchase_intent' : 'obligation_resolution', topic: parsed.obligations.map(item => item.type).join(','), conversation_stage: null, goal: null, next_last_question_type: null, events: Object.freeze([]) }),
        diagnostics: Object.freeze({ recommendation, llm: Object.freeze({ obligations: 'valid', composition: finished.gate.cleared ? 'valid' : 'fallback' }) }),
      });
      emit(logger, { event: 'conversation_engine_resolution', request_id: request.request_id, inbound_message_id: request.inbound_message_id, engine_version: ENGINE_VERSION, contract_version: request.contract_version, obligation_types: parsed.obligations.map(item => item.type), food: foodDiagnostics(parsed.semanticContext.food_context), recommendation, medical_boundary_applied: parsed.obligations.some(item => item.type === 'medical_boundary'), llm: response.diagnostics.llm, stage_latency_ms: { ...stage, total: nowMs(clock) - started }, resolution: response.resolution.status });
      return validateResponse(response);
    },
  });
}

module.exports = Object.freeze({ createConversationEngine, normalizeObligations });
