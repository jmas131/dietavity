'use strict';

const rag = require('../sales-engine-v2/direct-rag-v3');
const { recommendationV2 } = require('../recommendation-v2');
const candidatePolicy = require('../recommendation-candidate-policy');
const { validateRequest, validateResponse, RESPONSE_CONTRACT_VERSION, ENGINE_VERSION } = require('./contracts');
const { ConversationLlmError } = require('./llm-client');
const { foodDiagnostics, emit } = require('./diagnostics');

function nowMs(clock) { return Number(clock()); }

const ACTIVATION_RESPONSE = 'Dietavity es un asistente de alimentación por WhatsApp para personas que usan GLP-1. Te ayuda a decidir qué comer de acuerdo con tu apetito y lo que tienes a la mano. Puedes probarlo gratis.';
const ACTIVATION_INVENTORY_QUESTION = '¿Qué alimentos tienes disponibles ahora?';
const META_ACTIVATION_ICEBREAKER = 'hola quiero saber mas';

function normalizedMetaIcebreaker(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es-MX').replace(/[¡!¿?.,;:]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

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

  const labelReport = (meal, pattern) => report(meal, pattern);
  const explicitLabel = labelReport('breakfast', /^desayuno\s*:\s*(.+)$/iu)
    || labelReport('meal', /^(?:comida|cena)\s*:\s*(.+)$/iu)
    || labelReport('breakfast', /^mi\s+desayuno\s*:\s*(.+)$/iu)
    || labelReport('meal', /^mi\s+(?:comida|cena)\s*:\s*(.+)$/iu)
    || labelReport('breakfast', /^mi\s+desayuno\s+fue\s+(.+)$/iu)
    || labelReport('meal', /^mi\s+(?:comida|cena)\s+fue\s+(.+)$/iu);
  if (explicitLabel) return explicitLabel;

  const shorthandDescription = value => /(?:,|\b(?:con|y)\b)/iu.test(value)
    && !/^(?:no|nunca|jam[aá]s|tal\s+vez|quiz[aá]s|probablemente|si|cuando|seg[uú]n|a\s+las|es|ser[aá]|va\s+a\s+ser|ma[ñn]ana|de\s+ma[ñn]ana)(?:\s|$)/iu.test(value);
  const shorthand = (meal, pattern) => {
    const match = pattern.exec(terminal);
    return match && shorthandDescription(match[1]) ? Object.freeze({ meal, evidence: match[0] }) : null;
  };
  const unambiguousShorthand = shorthand('breakfast', /^desayuno\s+(.+)$/iu)
    || shorthand('meal', /^cena\s+(.+)$/iu);
  if (unambiguousShorthand) return unambiguousShorthand;

  const lastHistoryItem = Array.isArray(history) ? history.at(-1) : null;
  const activationInvitesMealReport = lastHistoryItem?.role === 'assistant'
    && /contarme\s+qu[eé]\s+has\s+comido/iu.test(String(lastHistoryItem.text || ''));
  return activationInvitesMealReport ? report('breakfast', /^desayuno\s+(.+)$/iu) : null;
}

function recentMealReports(request, currentReport) {
  const history = request.canonical_history;
  const reports = [];
  for (const [index, item] of history.entries()) {
    if (item.role !== 'customer') continue;
    const report = declarativeMealReport(item.text, history.slice(0, index));
    if (report) reports.push(Object.freeze({ meal_kind: report.meal, raw_report_text: report.evidence, source: 'canonical_history', source_processing_order: item.source_processing_order }));
  }
  if (currentReport) reports.push(Object.freeze({ meal_kind: currentReport.meal, raw_report_text: currentReport.evidence, source: 'current_turn', source_processing_order: request.processing_order }));
  return Object.freeze(reports.slice(-4));
}

function mealReportClaim(report) {
  return report?.meal === 'breakfast'
    ? '¡Perfecto! 😊 Ya sé qué desayunaste. Cuando quieras decidir qué comer después, dime cuánto apetito tienes o qué alimentos tienes disponibles y te ayudo a elegir.'
    : '¡Perfecto! 😊 Ya sé qué comiste. Cuando quieras decidir qué comer después, dime cuánto apetito tienes o qué alimentos tienes disponibles y te ayudo a elegir.';
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

function applyRecentMealReportContinuity(resolution, semanticContext) {
  const reports = semanticContext?.food_context?.recent_meal_reports;
  const latest = Array.isArray(reports) ? reports.at(-1) : null;
  const foodResult = resolution.resolved_obligations.find(item => item.obligation?.type === 'food_decision');
  const clarification = resolution.conversation_policy?.clarification_question;
  if (!latest || !foodResult || !clarification || !foodResult.permitted_claims.includes(`Para recomendarte algo concreto, ${clarification}`)) return resolution;
  const meal = latest.meal_kind === 'breakfast' ? 'ya desayunaste' : 'ya comiste';
  const appetite = semanticContext.food_context.appetite_observation?.kind === 'low' ? ' y tienes poca hambre' : '';
  const claim = `Tomando en cuenta que ${meal}${appetite}, para recomendarte algo concreto, ${clarification}`;
  return {
    ...resolution,
    resolved_obligations: resolution.resolved_obligations.map(item => item === foodResult ? { ...item, permitted_claims: [claim] } : item),
    permitted_claims: resolution.permitted_claims.map(value => value === foodResult.permitted_claims[0] ? claim : value),
  };
}

function applyActivationResponse(resolution, history, currentMessage) {
  const explicitMetaActivation = normalizedMetaIcebreaker(currentMessage) === META_ACTIVATION_ICEBREAKER;
  const activation = ((resolution.conversation_policy?.discovery_question_authorized && !history.length) || explicitMetaActivation)
    && resolution.resolved_obligations.length === 1
    && resolution.resolved_obligations[0]?.obligation?.type === 'general_information';
  if (!activation) return resolution;
  return {
    ...resolution,
    resolved_obligations: resolution.resolved_obligations.map(item => ({ ...item, permitted_claims: [ACTIVATION_RESPONSE] })),
    permitted_claims: [ACTIVATION_RESPONSE, ACTIVATION_INVENTORY_QUESTION],
    conversation_policy: {
      ...resolution.conversation_policy,
      clarification_question: null,
      required_questions: [ACTIVATION_INVENTORY_QUESTION],
    },
  };
}

// A predicate-less ingredient list is factual only as the immediate answer to
// Dietavity's active inventory prompt.  The Direct RAG scanner remains the
// closed source of food anchors; this grammar only supplies the omitted
// availability predicate and accepts its existing cooked/ground descriptor.
function contextualIngredientReply(currentMessage, history, foodContext) {
  const value = String(currentMessage || '');
  const trimmed = value.trim();
  const lastHistoryItem = Array.isArray(history) ? history.at(-1) : null;
  const priorAssistant = lastHistoryItem?.role === 'assistant' ? String(lastHistoryItem.text || '') : '';
  const inventoryQuestion = /(?:¿\s*)?qu[eé]\s+alimentos\s+tienes\s+disponibles\s+ahora\?\s*$/iu.test(priorAssistant);
  const legacyActivationInvitation = /qu[eé]\s+alimentos\s+tienes\s+disponibles/iu.test(priorAssistant)
    && /ayudo\s+a\s+decidir\s+qu[eé]\s+comer/iu.test(priorAssistant);
  if (!trimmed || !priorAssistant || (!inventoryQuestion && !legacyActivationInvitation)
    || /[¿?]/u.test(value)
    || /^(?:no|nunca|jam[aá]s|tal\s+vez|quiz[aá]s|probablemente|si|cuando|seg[uú]n|ma[ñn]ana|hoy\s+voy\s+a|quiero|voy\s+a)\b/iu.test(trimmed)) return null;

  const mentions = (foodContext?.structured_food_mentions || []).filter(mention => (
    mention?.relation === 'mentioned' && mention?.polarity === 'affirmed' && mention?.temporal_scope === 'unknown'
      && Number.isSafeInteger(mention?.evidence?.start) && Number.isSafeInteger(mention?.evidence?.end)
  ));
  if (!mentions.length) return null;

  const articles = '(?:(?:un|una|unos|unas|el|la|los|las)\\s+)?';
  let cursor = 0;
  const reportedFoods = [];
  for (const [index, mention] of mentions.entries()) {
    const prefix = value.slice(cursor, mention.evidence.start);
    if (index === 0) {
      if (!(new RegExp(`^\\s*${articles}$`, 'iu')).test(prefix)) return null;
    } else {
      const connector = new RegExp(`^\\s*(?:(molida|asada)\\s*)?(?:,|y|e)\\s*${articles}$`, 'iu').exec(prefix);
      if (!connector) return null;
      if (connector[1]) reportedFoods[reportedFoods.length - 1] += ` ${connector[1].toLocaleLowerCase('es-MX')}`;
    }
    reportedFoods.push(mention.surface.trim().toLocaleLowerCase('es-MX'));
    cursor = mention.evidence.end;
  }
  const tail = /^\s*(?:(molida|asada)\s*)?[.!]*\s*$/iu.exec(value.slice(cursor));
  if (!tail) return null;
  if (tail[1]) reportedFoods[reportedFoods.length - 1] += ` ${tail[1].toLocaleLowerCase('es-MX')}`;

  // Reuse the existing deterministic projection rather than creating a second
  // food vocabulary in the Node-only contextual completion.
  const projected = rag.extractSemanticContext(`Tengo ${mentions.map(mention => mention.surface).join(' y ')}`).food_context;
  if (!projected.available_foods.length) return null;
  return Object.freeze({
    available_foods: projected.available_foods,
    structured_food_mentions: mentions.map(mention => Object.freeze({ ...mention, relation: 'available', temporal_scope: 'current' })),
    reported_foods: Object.freeze(reportedFoods),
  });
}

// Keep the empty-inventory interpretation deliberately narrow. These exact
// replies are only meaningful as answers to Dietavity's immediately preceding
// inventory question; elsewhere they retain the normal interpreter path.
function contextualEmptyInventoryReply(currentMessage, history) {
  const value = String(currentMessage || '').trim();
  const lastHistoryItem = Array.isArray(history) ? history.at(-1) : null;
  const priorAssistant = lastHistoryItem?.role === 'assistant' ? String(lastHistoryItem.text || '') : '';
  const inventoryQuestion = /(?:¿\s*)?qu[eé]\s+alimentos\s+tienes\s+disponibles\s+ahora\?\s*$/iu.test(priorAssistant);
  if (!inventoryQuestion) return false;
  return /^(?:nada|no\s+tengo\s+nada)[.!]*$/iu.test(value);
}

function hasActiveInventoryQuestion(history) {
  const latest = Array.isArray(history) ? history.at(-1) : null;
  return latest?.role === 'assistant'
    && /(?:¿\s*)?qu[eé]\s+alimentos\s+tienes\s+disponibles\s+ahora\?\s*$/iu.test(String(latest.text || ''));
}

function availabilityConcept(surface, sourceText = '') {
  const value = String(surface || '').trim().toLocaleLowerCase('es-MX');
  const groundedMeat = value === 'carne' && /\bcarne\s+molida\b/iu.test(String(sourceText));
  if (/^verduras?$|^vegetales?$/u.test(value)) return { surface: value, concept: 'vegetables' };
  if (/^carne\s+molida$/u.test(value) || groundedMeat) return { surface: 'carne molida', concept: 'ground_meat', specificity: 'generic' };
  if (/^huevos?$/u.test(value)) return { surface: value, concept: 'egg' };
  if (/^tortillas?$/u.test(value)) return { surface: value, concept: 'corn_tortilla' };
  const bounded = new Map([
    ['pollo', 'chicken'], ['aguacate', 'avocado'], ['jitomate', 'red_tomato'], ['jitomates', 'red_tomato'], ['nopal', 'nopal'], ['nopales', 'nopal'], ['atún', 'tuna'], ['atun', 'tuna'], ['arroz', 'rice'], ['frijoles', 'common_beans'], ['frijol', 'common_beans'], ['brócoli', 'broccoli'], ['brocoli', 'broccoli'], ['calabacita', 'zucchini'], ['zanahoria', 'carrot'],
  ]);
  if (bounded.has(value)) return { surface: value, concept: bounded.get(value) };
  return { surface: value, concept: value };
}

function boundedActiveInventoryList(value, allowUnknown = false) {
  const trimmed = String(value || '').trim().replace(/[.!]+$/u, '').toLocaleLowerCase('es-MX');
  const withoutAppetite = trimmed.replace(/^tengo\s+poca\s+hambre\s*(?:,|y)?\s*/u, '');
  const items = withoutAppetite.replace(/^tengo\s+/u, '').split(/\s*,\s*|\s+(?:y|e)\s+/u).filter(Boolean);
  const accepted = new Set(['carne molida', 'verduras', 'verdura', 'vegetales', 'vegetal', 'pollo', 'tortillas', 'tortilla', 'aguacate', 'jitomate', 'jitomates', 'huevos', 'huevo', 'nopales', 'nopal', 'atún', 'atun', 'arroz', 'frijoles', 'frijol', 'brócoli', 'brocoli', 'calabacita', 'zanahoria']);
  if (items.length && items.every(item => accepted.has(item))) return items;
  // This is intentionally not a food ontology. In the exact active inventory
  // answer position it preserves short, literal food spans which may be outside
  // Direct RAG's closed vocabulary. It does not run elsewhere, and rejects
  // acknowledgements, empty/broad replies, questions, negation and free prose.
  const forbidden = /^(?:(?:no|nunca|jamas|jamás|comi|comí|desayune|desayuné|cena|cene|cené|tal\s+vez|quizas|quizás|probablemente|si|cuando|mañana|hoy\s+voy\s+a|quiero|voy\s+a)(?:\s|$).*|todos?|de\s+todo|tengo\s+de\s+todo|nada|no\s+tengo\s+nada|lo\s+que\s+sea|gracias|ok(?:ay)?|perfecto|vale|listo)$/iu;
  const foodSpan = /^(?:el|la|los|las|un|una|unos|unas)?\s*[\p{L}]+(?:[ -][\p{L}]+){0,3}$/u;
  return allowUnknown && items.length && items.length <= 4 && items.every(item => foodSpan.test(item) && !forbidden.test(item)) ? items : [];
}

// Food availability is derived request context, never a durable pantry. The
// exact active prompt grants omitted-predicate authority; explicit current
// availability propositions retain their ordinary scanner authority.
function deriveFoodAvailability(currentMessage, history, foodContext, ingredientReply, emptyInventoryReply) {
  const value = String(currentMessage || '').trim();
  const activeInventoryQuestion = hasActiveInventoryQuestion(history);
  const broad = activeInventoryQuestion && /^(?:todos|de\s+todo|tengo\s+de\s+todo)[.!]*$/iu.test(value);
  if (broad) return Object.freeze({ scope: 'broad', authority: Object.freeze({ kind: 'active_inventory_reply', evidence: value }), confirmed_foods: Object.freeze([]), underspecified_groups: Object.freeze([]), currently_unavailable_foods: Object.freeze([]) });
  if (emptyInventoryReply) return Object.freeze({ scope: 'none', authority: Object.freeze({ kind: 'active_inventory_reply', evidence: value }), confirmed_foods: Object.freeze([]), underspecified_groups: Object.freeze([]), currently_unavailable_foods: Object.freeze([]) });

  const mentions = Array.isArray(foodContext?.structured_food_mentions) ? foodContext.structured_food_mentions : [];
  const currentAvailable = mentions.filter(mention => mention?.relation === 'available' && mention?.polarity === 'affirmed' && mention?.temporal_scope === 'current');
  const currentUnavailable = mentions.filter(mention => mention?.relation === 'available' && mention?.polarity === 'negated' && mention?.temporal_scope === 'current');
  // Preserve Ticket 79's fail-closed behavior for malformed mixed phrases,
  // while allowing a scanner vocabulary to recognize every literal list item
  // without suppressing active-question authority for that list.
  const proposedList = activeInventoryQuestion ? boundedActiveInventoryList(value, true) : [];
  const mentionedSurfaces = mentions.map(mention => String(mention.surface || '').trim().toLocaleLowerCase('es-MX'));
  const alignedMentions = mentionedSurfaces.length > 1
    && mentionedSurfaces.length === proposedList.length
    && mentionedSurfaces.every((surface, index) => surface === proposedList[index]);
  const allowUnknown = !mentions.length || mentions.length === 1 || alignedMentions;
  const activeList = activeInventoryQuestion ? boundedActiveInventoryList(value, allowUnknown) : [];
  const surfaces = ingredientReply ? ingredientReply.reported_foods : currentAvailable.length ? currentAvailable.map(mention => mention.surface) : activeList;
  const concepts = surfaces.map(surface => availabilityConcept(surface, value));
  const groups = concepts.filter(item => item.concept === 'vegetables');
  const foods = concepts.filter(item => item.concept !== 'vegetables');
  const constrained = Boolean(ingredientReply || currentAvailable.length || activeList.length);
  const authority = ingredientReply || (activeInventoryQuestion && (currentAvailable.length || activeList.length))
    ? { kind: 'active_inventory_reply', evidence: value }
    : currentAvailable.length ? { kind: 'explicit_current_availability', evidence: value } : null;
  return Object.freeze({
    scope: constrained ? 'constrained' : 'unknown',
    authority: authority ? Object.freeze(authority) : null,
    confirmed_foods: Object.freeze(foods.map(item => Object.freeze(item))),
    underspecified_groups: Object.freeze(groups.map(item => Object.freeze(item))),
    currently_unavailable_foods: Object.freeze(currentUnavailable.map(mention => Object.freeze(availabilityConcept(mention.surface, value)))),
  });
}

function applyContextualIngredientReplyResolution(resolution, reply) {
  const foodResult = resolution.resolved_obligations.find(item => item.obligation?.type === 'food_decision');
  if (!reply || !foodResult) return resolution;
  const [first, ...rest] = reply.reported_foods;
  const claim = rest.length
    ? `Puedes preparar ${first} con ${rest.join(' y ')}.`
    : `Con ${first}, arma un plato sencillo.`;
  return {
    ...resolution,
    resolved_obligations: resolution.resolved_obligations.map(item => item === foodResult ? {
      ...item,
      permitted_claims: [claim],
      recommendation_source: 'contextual_inventory_reply',
      recommendation_status: 'recommendation',
      recommendation_failure_code: null,
    } : item),
    permitted_claims: resolution.permitted_claims.map(value => value === foodResult.permitted_claims[0] ? claim : value),
    conversation_policy: { ...resolution.conversation_policy, food_clarification_authorized: false, clarification_question: null, required_questions: [] },
  };
}

function applyContextualEmptyInventoryResolution(resolution, emptyInventoryReply) {
  const foodResult = resolution.resolved_obligations.find(item => item.obligation?.type === 'food_decision');
  if (!emptyInventoryReply || !foodResult) return resolution;
  const claim = 'Entiendo. Si ahora no tienes alimentos disponibles, no te voy a recomendar una comida que no tienes. Cuando tengas algo a la mano, puedo ayudarte a decidir qué preparar.';
  return {
    ...resolution,
    resolved_obligations: resolution.resolved_obligations.map(item => item === foodResult ? {
      ...item,
      permitted_claims: [claim],
      recommendation_source: 'contextual_empty_inventory_reply',
      recommendation_status: 'no_available_foods',
      recommendation_failure_code: null,
    } : item),
    permitted_claims: resolution.permitted_claims.map(value => value === foodResult.permitted_claims[0] ? claim : value),
    conversation_policy: { ...resolution.conversation_policy, food_clarification_authorized: false, clarification_question: null, required_questions: [] },
  };
}

function applyRecommendationV2Resolution(resolution, semanticContext) {
  const foodResult = resolution.resolved_obligations.find(item => item.obligation?.type === 'food_decision');
  if (!foodResult) return resolution;
  const reportFoods = (semanticContext?.food_context?.recent_meal_reports || []).flatMap(report => {
    const text = String(report?.raw_report_text || '').toLocaleLowerCase('es-MX');
    return ['pollo', 'huevos'].filter(food => new RegExp(`\\b${food}\\b`, 'u').test(text));
  });
  const recommendation = recommendationV2({
    availability: semanticContext?.food_availability,
    appetite: semanticContext?.food_context?.appetite_observation?.kind || null,
    recentlyConsumed: [...new Set([...(semanticContext?.food_context?.recently_consumed || []), ...reportFoods])],
  });
  if (!recommendation) return resolution;
  return {
    ...resolution,
    resolved_obligations: resolution.resolved_obligations.map(item => item === foodResult ? {
      ...item, permitted_claims: [recommendation.claim], recommendation_source: 'recommendation_v2', recommendation_status: 'recommendation', recommendation_failure_code: null,
    } : item),
    permitted_claims: resolution.permitted_claims.map(value => value === foodResult.permitted_claims[0] ? recommendation.claim : value),
    conversation_policy: { ...resolution.conversation_policy, food_clarification_authorized: false, clarification_question: null, required_questions: [] },
  };
}

function foodResolution(resolution) {
  return resolution.resolved_obligations.find(item => item.obligation?.type === 'food_decision') || null;
}

function candidateEligibility(resolution, semanticContext) {
  const availability = semanticContext?.food_availability;
  return Boolean(foodResolution(resolution)
    && !resolution.resolved_obligations.some(item => item.obligation?.type === 'medical_boundary')
    && availability && (availability.scope === 'constrained' || availability.scope === 'broad'));
}

function trustedCandidateContext(resolution, semanticContext) {
  if (!candidateEligibility(resolution, semanticContext)) return null;
  try {
    return candidatePolicy.buildTrustedRecommendationContext({
      availability: semanticContext.food_availability,
      appetite: semanticContext.food_context?.appetite_observation?.kind || 'unknown',
      recently_consumed: semanticContext.food_context?.recently_consumed || [],
      eligible: true,
    });
  } catch {
    return null;
  }
}

function candidateGeneratorRequest(trusted) {
  if (!trusted) return null;
  return Object.freeze({
    contract_version: 'recommendation-candidate-v1',
    availability: Object.freeze({
      scope: trusted.scope,
      references: Object.freeze(trusted.references.map(reference => Object.freeze({ id: reference.id, kind: reference.kind, surface: reference.surface }))),
      currently_unavailable: Object.freeze(trusted.unavailable.map(reference => Object.freeze({ surface: reference.surface }))),
    }),
    allowed_pantry_ids: Object.freeze(Object.keys(candidatePolicy.PANTRY)),
    allowed_actions: Object.freeze(['cook', 'saute', 'mix', 'heat', 'serve', 'combine']),
    allowed_portions: Object.freeze(['small', 'normal']),
    appetite: trusted.appetite,
    recently_consumed: Object.freeze([...trusted.recently_consumed]),
  });
}

function applyCandidateRecommendation(resolution, selection) {
  const foodResult = foodResolution(resolution);
  if (!foodResult || !selection?.claim) return resolution;
  const claim = selection.claim;
  return {
    ...resolution,
    resolved_obligations: resolution.resolved_obligations.map(item => item === foodResult ? {
      ...item, permitted_claims: [claim], recommendation_source: 'structured_candidate_policy', recommendation_status: 'recommendation', recommendation_failure_code: null,
    } : item),
    permitted_claims: resolution.permitted_claims.map(value => value === foodResult.permitted_claims[0] ? claim : value),
    conversation_policy: { ...resolution.conversation_policy, food_clarification_authorized: false, clarification_question: null, required_questions: [] },
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
  const mealReport = declarativeMealReport(request.current_message, history);
  const reports = recentMealReports(request, mealReport);
  const extractedSemanticContext = rag.extractSemanticContext(request.current_message, history, interpreterContext);
  const ingredientReply = contextualIngredientReply(request.current_message, history, extractedSemanticContext.food_context);
  const emptyInventoryReply = contextualEmptyInventoryReply(request.current_message, history);
  const foodAvailability = deriveFoodAvailability(request.current_message, history, extractedSemanticContext.food_context, ingredientReply, emptyInventoryReply);
  const availableFoods = ingredientReply
    ? [...new Set([...(extractedSemanticContext.food_context.available_foods || []), ...ingredientReply.available_foods])]
    : extractedSemanticContext.food_context.available_foods;
  const semanticContext = Object.freeze({
    ...extractedSemanticContext,
    food_context: Object.freeze({
      ...extractedSemanticContext.food_context,
      available_foods: availableFoods,
      structured_food_mentions: ingredientReply?.structured_food_mentions || extractedSemanticContext.food_context.structured_food_mentions,
      recent_meal_reports: reports,
    }),
    food_availability: foodAvailability,
  });
  const raw = normalizeObligations(model, request.current_message);
  const support = rag.reconcileWeakNutritionSupportObligations(raw, request.current_message, semanticContext);
  const appetite = rag.reconcileStandaloneAppetiteObservationObligations(support, request.current_message, semanticContext);
  const inventory = rag.reconcileAuthoritativeContextualInventoryObligations(appetite, request.current_message, semanticContext, history);
  const weakTypes = new Set(['nutrition_support_request', 'general_information', 'acknowledgement', 'unsupported']);
  const contextualInventory = (foodAvailability.scope === 'constrained' || foodAvailability.scope === 'broad' || emptyInventoryReply) && inventory.every(obligation => weakTypes.has(obligation?.type))
    ? [{ type: 'food_decision', evidence: request.current_message }]
    : inventory;
  const reconciled = mealReport && contextualInventory.every(obligation => weakTypes.has(obligation?.type))
    ? [{ type: 'unsupported', evidence: request.current_message }]
    : contextualInventory;
  const obligations = reconciled
    .map((obligation, index) => ({ id: `o-${index + 1}`, type: obligation.type, evidence: obligation.evidence }));
  return Object.freeze({ history, semanticContext, mealReport, ingredientReply, emptyInventoryReply, obligations });
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
      let llmStage = 'obligations';
      let llmStarted = nowMs(clock);
      try {
        const model = await llmClient.interpret({
          contract_version: request.contract_version,
          session_id: request.session_id,
          inbound_message_id: request.inbound_message_id,
          processing_order: request.processing_order,
          current_message: request.current_message,
          history: request.canonical_history.map(({ role, text }) => ({ role, text })),
        });
        stage.obligations_llm = nowMs(clock) - llmStarted;
        const parsed = parsedContext(request, model);
        const resolutionStarted = nowMs(clock);
        const context = { current_message: request.current_message, history: parsed.history, most_recent_assistant_message: parsed.history.filter(item => item.role === 'assistant').at(-1)?.text || '', semantic_context: parsed.semanticContext };
        const baselineResolution = applyContextualEmptyInventoryResolution(
          applyContextualIngredientReplyResolution(
            applyRecentMealReportContinuity(applyDeclarativeMealReportResolution(applyActivationResponse(rag.resolveObligations({ context, obligations: parsed.obligations }), parsed.history, request.current_message), parsed.mealReport), parsed.semanticContext),
            parsed.ingredientReply,
          ),
          parsed.emptyInventoryReply,
        );
        const trusted = trustedCandidateContext(baselineResolution, parsed.semanticContext);
        let directResolution = baselineResolution;
        if (trusted && typeof llmClient.generateRecommendationCandidates === 'function') {
          const candidateStarted = nowMs(clock);
          try {
            const rawCandidates = await llmClient.generateRecommendationCandidates(candidateGeneratorRequest(trusted));
            stage.candidate_generation_llm = nowMs(clock) - candidateStarted;
            const selection = candidatePolicy.selectRecommendation(rawCandidates, trusted);
            if (selection.claim) directResolution = applyCandidateRecommendation(baselineResolution, selection);
          } catch (error) {
            stage.candidate_generation_llm = nowMs(clock) - candidateStarted;
            // Candidate generation is optional and untrusted. Its failure must
            // not discard a valid interpretation or expose partial output.
            if (!(error instanceof ConversationLlmError)) throw error;
          }
        }
        if (directResolution === baselineResolution) directResolution = applyRecommendationV2Resolution(baselineResolution, parsed.semanticContext);
        const envelope = rag.buildCompositionEnvelope({ context, resolution: directResolution });
        stage.deterministic = nowMs(clock) - resolutionStarted;
        llmStage = 'composition';
        llmStarted = nowMs(clock);
        const composition = await llmClient.compose(envelope);
        stage.composition_llm = nowMs(clock) - llmStarted;
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
      } catch (error) {
        if (error instanceof ConversationLlmError) {
          const failedAt = nowMs(clock);
          emit(logger, Object.freeze({ event: 'conversation_engine_llm_failure', request_id: request.request_id, engine_version: ENGINE_VERSION, llm_stage: llmStage, llm_error_code: error.code, upstream_status: error.upstream_status, upstream_category: error.upstream_category, llm_latency_ms: failedAt - llmStarted, total_latency_ms: failedAt - started }));
        }
        throw error;
      }
    },
  });
}

module.exports = Object.freeze({ createConversationEngine, normalizeObligations, __testOnly: Object.freeze({ parsedContext, deriveFoodAvailability }) });
