'use strict';
const mealRecommendationAdapter = require('../meal-recommendation-adapter');

// Direct RAG V3 proposition-test authority. The model can identify
// obligations and phrase only these claims; it cannot revive the retired
// 28-day commercial offer.
const GLP1_LIVE_PILOT_CHECKOUT_SUPPRESSED = true;
const FIRST_CONTACT_DISCOVERY_QUESTION = '¿Qué necesitas resolver con tu alimentación ahora?';
const OBSOLETE_CURRENT_PRODUCT_CLAIMS = /(?:\$\s*149|149\s*(?:mxn|pesos?)|28\s*d[ií]as|\b(?:lo|se)\s+consulta\w*.{0,30}\bportal\b|\b(?:accede|ingresa)\w*.{0,30}\bportal\b|desayuno,?\s*comida,?\s*cena\s+y\s*snack|cuatro\s+comidas|checkout)/iu;
const MEDICATION_MANAGEMENT_ADVICE = /\b(?:sube|baja|aumenta|reduce|cambia|ajusta|suspende|inicia)\b.{0,50}\b(?:dosis|medicamento|mg)\b/iu;
const SEMANTIC_CONTEXT_VERSION = 'direct-rag-v3.2b-patch-5';

const FACTS = Object.freeze({
  general_information: ['Dietavity es un asistente de alimentación por WhatsApp para personas que usan GLP-1. Te ayuda a decidir qué comer de acuerdo con tu apetito y lo que tienes a la mano. Puedes probarlo gratis.'],
  how_it_works: ['Por WhatsApp me cuentas tu situación de comida, te doy una recomendación práctica y podemos ajustarla según lo que te funcione. Puedes probarlo gratis.'],
  nutrition_support_request: ['Puedo ayudarte con decisiones prácticas de alimentación según tu apetito, lo que ya comiste o los alimentos que tienes disponibles.'],
  price: ['Actualmente puedes probar Dietavity gratis. Todavía no hay un precio futuro definido.'],
  delivery_channel: ['Dietavity funciona por WhatsApp; no necesitas un portal para usarlo.'],
  glp1_scope: ['Dietavity ofrece apoyo para decidir qué comer; no vende, entrega ni receta medicamentos GLP-1.'],
  medical_boundary: ['No puedo orientarte sobre cambiar, iniciar o suspender una dosis. Consulta al profesional que te la prescribe.'],
  purchase_intent: ['La prueba gratuita está disponible actualmente por WhatsApp. No necesitas completar una compra para probarla.'],
  acknowledgement: ['¡Con gusto! 😊'],
  unsupported: ['No tengo información confirmada para afirmar que Dietavity ofrezca eso.'],
});

function deliveryChannelFact(message) {
  const value = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  if (/\b(?:descarg|instal|bajar)\w*\b/u.test(value)) {
    return 'Dietavity funciona directamente por WhatsApp; no necesitas descargar una app ni entrar a un portal para usarlo.';
  }
  if (/\b(?:este|por este)\s+(?:numero|chat)\b|\baqui\s+(?:mismo|en el chat)\b|\bpor aqui\b/u.test(value)) {
    return 'Sí 😊 Puedes usar Dietavity directamente en este chat de WhatsApp.';
  }
  return 'Dietavity funciona por WhatsApp; no necesitas un portal para usarlo.';
}

const INTERPRETER_OBLIGATION_TYPES = Object.freeze(['general_information', 'how_it_works', 'nutrition_support_request', 'food_decision', 'recommendation_feedback', 'price', 'delivery_channel', 'glp1_scope', 'medical_boundary', 'purchase_intent', 'acknowledgement', 'unsupported']);
const OBLIGATION_TYPE_CONTRACT = Object.freeze(Object.fromEntries(INTERPRETER_OBLIGATION_TYPES.map(type => [type, type === 'unsupported' ? 'bounded_unknown' : 'resolved'])));
const SUBJECTS = new Set(INTERPRETER_OBLIGATION_TYPES);
// Accepted only by the source-level compatibility seam used by existing V3.1
// resolver tests. The interpreter/parser taxonomy deliberately does not emit it.
const LEGACY_RESOLVER_OBLIGATION_TYPES = new Set(['food_context']);
function copy(value) { return structuredClone(value); }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function normalized(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase(); }
function canonical(value) { return String(value || '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('es-MX'); }

function isTokenContinuation(rawMessage, offset) {
  return /^[\p{L}\p{M}\p{Nd}\p{Pc}]/u.test(rawMessage.slice(offset));
}

function hasVisibleModifierCompletion(rawMessage, matchEnd, lookaheadEnd) {
  if (isTokenContinuation(rawMessage, matchEnd)) return false;
  if (matchEnd === rawMessage.length) return true;
  const immediate = rawMessage[matchEnd];
  if (/[,;:.!?()\-—]/u.test(immediate)) return true;
  let cursor = matchEnd;
  while (cursor < lookaheadEnd && /\s/u.test(rawMessage[cursor])) cursor += 1;
  if (cursor === rawMessage.length) return true;
  if (cursor >= lookaheadEnd) return false;
  return /[,;:.!?()\-—]/u.test(rawMessage[cursor]);
}

const OWNERSHIP_CONSTRUCTIONS = new Set(['tengo', 'cuento_con', 'dispongo_de', 'comi', 'prepare', 'voy_a_comer', 'desayune', 'cene', 'almorce', 'merende']);
const AUTHORITY_MODIFIERS = new Set([null, 'confirmation_tag', 'attribution', 'future_qualifier', 'conditional', 'uncertainty']);
const AUTHORITY_RELATIONS = new Set(['available', 'consumed', 'prepared', 'planned']);
const AUTHORITY_BOUNDARIES = new Set(['backward_modifier', 'independent_proposition', 'terminal', 'ambiguous']);

function snapshotClosedDescriptor(value, allowedKeys, requiredKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    // Descriptors are closed data records. Do not use prototype or intrinsic
    // identity here: n8n Code nodes may construct otherwise valid records in
    // a different runtime realm. The exact own-key/data-descriptor schema is
    // the authority boundary; inherited fields, accessors, symbols, unknown
    // keys, and invalid values remain fail-closed below.
    const names = Object.getOwnPropertyNames(value);
    if (Object.getOwnPropertySymbols(value).length || !requiredKeys.every(key => names.includes(key)) || !names.every(key => allowedKeys.has(key))) return false;
    const snapshot = {};
    for (const key of names) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property || !property.enumerable || !Object.prototype.hasOwnProperty.call(property, 'value')) return false;
      snapshot[key] = property.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return false;
  }
}

// WP2.1B.2 test seam. The parser will later provide this compact construction
// descriptor; this helper deliberately performs no subject/coreference parsing.
function classifyPropositionOwnership(descriptor) {
  const allowedKeys = new Set(['construction', 'explicitSubject']);
  const snapshot = snapshotClosedDescriptor(descriptor, allowedKeys, ['construction']);
  if (!snapshot || typeof snapshot.construction !== 'string') return Object.freeze({ ownership: 'unknown' });
  if (Object.hasOwn(snapshot, 'explicitSubject') && ![null, 'third_party', 'unknown'].includes(snapshot.explicitSubject)) return Object.freeze({ ownership: 'unknown' });
  if (snapshot.explicitSubject === 'third_party' || snapshot.explicitSubject === 'unknown') return Object.freeze({ ownership: 'unknown' });
  if (snapshot.construction === 'hay') return Object.freeze({ ownership: 'existential_context' });
  return Object.freeze({ ownership: OWNERSHIP_CONSTRUCTIONS.has(snapshot.construction) ? 'user_context' : 'unknown' });
}

function isCoherentAuthorityDescriptor(snapshot) {
  const isBackwardModifier = snapshot.modifier !== null;
  if (snapshot.boundaryDisposition === 'backward_modifier' ? !isBackwardModifier : isBackwardModifier) return false;
  return snapshot.ambiguous === (snapshot.boundaryDisposition === 'ambiguous');
}

function evaluatePropositionAuthority(descriptor) {
  const allowedKeys = new Set(['ownership', 'assertionMode', 'boundaryDisposition', 'modifier', 'ambiguous', 'relation']);
  const unsupported = reason => Object.freeze({ authoritative: false, mode: 'unsupported', reason });
  const snapshot = snapshotClosedDescriptor(descriptor, allowedKeys, ['ownership', 'assertionMode', 'boundaryDisposition', 'modifier', 'ambiguous', 'relation']);
  if (!snapshot || !['user_context', 'existential_context', 'unknown'].includes(snapshot.ownership) || !['asserted', 'interrogative'].includes(snapshot.assertionMode) || !AUTHORITY_BOUNDARIES.has(snapshot.boundaryDisposition) || !AUTHORITY_MODIFIERS.has(snapshot.modifier) || typeof snapshot.ambiguous !== 'boolean' || !AUTHORITY_RELATIONS.has(snapshot.relation) || !isCoherentAuthorityDescriptor(snapshot)) return unsupported('unsupported');
  if (snapshot.ownership === 'unknown') return unsupported('unknown_ownership');
  if (snapshot.modifier === 'attribution') return Object.freeze({ authoritative: false, mode: 'attributed', reason: 'attribution' });
  if (snapshot.assertionMode === 'interrogative') return Object.freeze({ authoritative: false, mode: 'interrogative', reason: 'interrogative' });
  if (snapshot.modifier === 'confirmation_tag') return Object.freeze({ authoritative: false, mode: 'interrogative', reason: 'confirmation_tag' });
  if (snapshot.modifier === 'uncertainty') return Object.freeze({ authoritative: false, mode: 'uncertain', reason: 'uncertainty' });
  if (snapshot.modifier === 'conditional') return Object.freeze({ authoritative: false, mode: 'conditional', reason: 'conditional' });
  if (snapshot.ambiguous) return unsupported('ambiguous_boundary');
  return Object.freeze({ authoritative: true, mode: 'asserted', reason: snapshot.ownership });
}

// WP2.1B.1 test seam. This pure classifier deliberately has no authority,
// relation, temporal, or emission behavior; later work packages may wire it.
function resolveCandidateBoundary({ rawMessage, proposition, boundary, followingStart, maxLookahead = 96 }) {
  if (typeof rawMessage !== 'string' || !boundary || !Number.isInteger(boundary.start) || !Number.isInteger(boundary.end)) throw new Error('BOUNDARY_INPUT_INVALID');
  const start = Number.isInteger(followingStart) ? followingStart : boundary.end;
  if (start < 0 || boundary.start < 0 || boundary.end < boundary.start || start < boundary.end || start > rawMessage.length || maxLookahead < 0) throw new Error('BOUNDARY_INPUT_INVALID');
  const limit = Math.min(rawMessage.length, start + maxLookahead);
  const tail = rawMessage.slice(start, limit);
  const leadingWhitespace = tail.match(/^\s*/u)[0].length;
  const fragmentStart = start + leadingWhitespace;
  const fragment = rawMessage.slice(fragmentStart, limit);
  const completeModifier = match => match && hasVisibleModifierCompletion(rawMessage, fragmentStart + match[0].length, limit) ? match : null;
  const completeIndependentStart = match => match && !isTokenContinuation(rawMessage, fragmentStart + match[0].length) ? match : null;
  const range = match => match ? Object.freeze({ start: fragmentStart, end: fragmentStart + match[0].length }) : null;
  const result = ({ disposition, modifier = null, match = null, independentStart = null, consumedThrough = start }) => Object.freeze({
    disposition,
    modifier,
    consumedThrough,
    followingRange: range(match),
    independentStart
  });
  // Precedence: tag, attribution, future, conditional, uncertainty, independent, terminal, ambiguous.
  let match = completeModifier(/^(?:¿\s*)?(?:verdad|no|cierto)\s*\?/iu.exec(fragment));
  if (match) return result({ disposition: 'backward_modifier', modifier: 'confirmation_tag', match, consumedThrough: fragmentStart + match[0].length });
  match = completeModifier(/^(?:dijo\s+\p{L}+|me\s+dijeron|seg[uú]n\s+\p{L}+(?:\s+\p{L}+){0,2})/iu.exec(fragment));
  if (match) return result({ disposition: 'backward_modifier', modifier: 'attribution', match, consumedThrough: fragmentStart + match[0].length });
  match = completeModifier(/^(?:(?:para\s+)?(?:ma[ñn]ana|esta\s+noche|m[aá]s\s+tarde)|el\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo))/iu.exec(fragment));
  if (match) return result({ disposition: 'backward_modifier', modifier: 'future_qualifier', match, consumedThrough: fragmentStart + match[0].length });
  match = completeModifier(/^(?:si\s+viene(?:\s+\p{L}+)?|cuando\s+llegue(?:\s+\p{L}+)?)/iu.exec(fragment));
  if (match) return result({ disposition: 'backward_modifier', modifier: 'conditional', match, consumedThrough: fragmentStart + match[0].length });
  match = completeModifier(/^(?:tal\s+vez|probablemente|quiz[aá]s)/iu.exec(fragment));
  if (match) return result({ disposition: 'backward_modifier', modifier: 'uncertainty', match, consumedThrough: fragmentStart + match[0].length });
  // B.1 proves only that P2 has started, never that P2 is complete or
  // authoritative. A finite predicate start separates P1 from later P2
  // material; noun phrases and uncertainty/attribution prefixes do not.
  // These are the scanner's already-supported explicit construction starts,
  // not food vocabulary. They establish only that P2 has begun; B.2 still
  // owns factual authority for the separately parsed P2.
  const explicitScannerPredicate = '(?:(?:no\\s+)?(?:quiero|tengo|hay)|(?:no\\s+)?(?:cuento\\s+con|dispongo\\s+de)|(?:no\\s+)?(?:me\\s+)?prepar[eé]|(?:no\\s+)?(?:ya\\s+)?(?:me\\s+)?(?:com[ií]|desayun[eé]|cen[eé]|almorc[eé]|merend[eé])|(?:no\\s+)?voy\\s+a\\s+(?:comprar|comer|preparar))';
  const mealPositionConsumedPredicate = '(?:para\\s+(?:desayunar|comer|cenar)\\s+(?:no\\s+)?(?:ya\\s+)?(?:me\\s+)?(?:com[ií]|desayun[eé]|cen[eé]|almorc[eé]|merend[eé]))';
  const independentPredicate = `(?:(?:no\\s+s[eé])|(?:sí\\s+)?${explicitScannerPredicate}|${mealPositionConsumedPredicate}|(?:¿\\s*(?:qu[eé]|c[oó]mo)\\s+(?:me\\s+)?puedo)|(?:¿\\s*qu[eé]\\s+(?:me\\s+)?recomiendas?)|(?:(?:tal\\s+vez|probablemente|quiz[aá]s)\\s+(?:cocino|cocin[eé]|preparo|prepar[eé]|como|com[ií]|tengo|hay|puedo|voy))|(?:\\p{L}+\\s+dice))`;
  match = completeIndependentStart(new RegExp(`^${independentPredicate}`, 'iu').exec(fragment));
  if (match) return result({ disposition: 'independent_proposition', independentStart: fragmentStart, consumedThrough: fragmentStart });
  const coordinatedConditionalPredicate = '(?:si\\s+(?:viene|vino|llega|llegue|regresa|regrese)\\s+\\p{L}+|cuando\\s+(?:llega|llegue|regresa|regrese)\\s+\\p{L}+)';
  // A coordinator makes the bounded temporal prefix belong to P2 only when
  // the scanner's own explicit planned predicate follows it. Bare "mañana"
  // remains subject to the frozen backward future-modifier precedence.
  const coordinatedPlannedPredicate = '(?:ma[ñn]ana\\s+(?:voy\\s+a\\s+)?(?:comer|hacer|preparar))';
  match = completeIndependentStart(new RegExp(`^(?:,\\s*)?(?:y\\s+despu[eé]s|y|e|pero|aunque|mientras|entonces)\\s+(${independentPredicate}|${coordinatedConditionalPredicate}|${coordinatedPlannedPredicate})`, 'iu').exec(fragment));
  if (match) {
    const independentStart = fragmentStart + match[0].lastIndexOf(match[1]);
    return result({ disposition: 'independent_proposition', independentStart, consumedThrough: independentStart });
  }
  if (rawMessage.slice(start).trim() === '') return result({ disposition: 'terminal', consumedThrough: rawMessage.length });
  return result({ disposition: 'ambiguous', consumedThrough: start });
}

function extractSemanticContext(message, history = [], interpreterContext = {}) {
  const rawMessage = String(message || '');
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  const unique = values => [...new Set(values)];
  const isNegatedAt = (value, index) => /\b(?:no|nunca|jamas)\s+(?:(?:ya|me)\s+)?(?:me\s+)?$/u.test(value.slice(Math.max(0, index - 40), index));
  const contextual_rejection = /\bno se me antoja|no quiero|no me apetece\b/u.test(text);
  const glp1Medication = /\b(?:glp[ -]?1|mounjaro|ozempic|semaglutida|tirzepatida)\b/u;
  const hasCurrentPersonalGlp1Usage = value => {
    const usage = /\b(?:uso|estoy\s+usando|me\s+(?:estan\s+)?inyect(?:an|ando)|me\s+inyecto|tomo|recibo)\b/gu;
    if (!glp1Medication.test(value)) return false;
    for (const match of value.matchAll(usage)) if (!isNegatedAt(value, match.index)) return true;
    return false;
  };
  const currentGlp1Mentioned = glp1Medication.test(text);
  const currentGlp1Usage = hasCurrentPersonalGlp1Usage(text);
  const priorGlp1Usage = Array.isArray(history) && history.some(item => item?.role === 'customer' && hasCurrentPersonalGlp1Usage(String(item.text || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()));
  const priorGlp1Mentioned = Array.isArray(history) && history.some(item => item?.role === 'customer' && glp1Medication.test(String(item.text || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()));
  const professionalMentioned = /\b(?:nutriologa|nutriologo|medic[oa]|profesional)\b/u.test(text);
  const dissatisfactionReported = professionalMentioned && /\b(?:no tiene idea|no sabe|no entiende|no conoce)\b/u.test(text);
  const requestedEvidence = typeof interpreterContext?.recommendation_request_evidence === 'string' && message.includes(interpreterContext.recommendation_request_evidence)
    ? interpreterContext.recommendation_request_evidence : null;
  // Additive current-turn provenance for the later deterministic ontology
  // layer. These are lexical food facts only: no engine IDs, preferences,
  // constraints, or recommendation authority are created here.
  const structured_food_mentions = (() => {
    // Scanner authority is intentionally decided from one proposition record:
    // relation + local objects + completed continuation. Raw offsets remain
    // the coordinate system throughout.
    const patterns = ['pechuga\\s+de\\s+pollo', 'at[uú]n\\s+en\\s+lata', 'queso\\s+fresco', 'chile\\s+serrano', 'salsa\\s+verde', 'huitlacoche', 'tortillas?', 'verduras?', 'vegetales?', 'galletas?', 'frijoles?', 'aguacate', 'jitomates?', 'huevos?', 'pechuga', 'pescado', 'carne', 'leche', 'frutas?', 'tocino', 'caf[eé]', 'pollo', 'arroz', 'tacos?'];
    const spans = []; const occupied = [];
    for (const source of patterns) for (const match of rawMessage.matchAll(new RegExp(`(^|[^\\p{L}\\p{M}\\p{Nd}\\p{Pc}])(${source})(?=$|[^\\p{L}\\p{M}\\p{Nd}\\p{Pc}])`, 'giu'))) {
      const start = match.index + match[1].length; const end = start + match[2].length;
      if (!occupied.some(range => start < range.end && end > range.start)) { occupied.push({ start, end }); spans.push({ start, end }); }
    }
    spans.sort((a, b) => a.start - b.start);
    const bounds = index => {
      const start = Math.max(rawMessage.lastIndexOf('.', index), rawMessage.lastIndexOf('\n', index)) + 1;
      const ends = [rawMessage.indexOf('.', index), rawMessage.indexOf('\n', index)].filter(value => value >= 0).sort((a, b) => a - b);
      return { start, end: ends[0] ?? rawMessage.length };
    };
    const anchors = [];
    const constructions = [
      ['planned', /\b(?:no\s+)?(?:voy\s+a\s+(?:comprar|comer|preparar)|quiero\s+(?:hacer|comer|preparar)|ma[ñn]ana\s+(?:voy\s+a\s+)?(?:comer|hacer|preparar))(?=$|[^\p{L}])/giu],
      ['available', /\b(?:no\s+)?(?:tengo(?:\s+disponibles?)?|hay|cuento\s+con|dispongo\s+de)(?=$|[^\p{L}])/giu],
      ['consumed', /\b(?:no\s+)?(?:ya\s+)?(?:me\s+)?(?:com[ií]|desayun[eé]|cen[eé]|almorc[eé]|merend[eé])(?=$|[^\p{L}])/giu],
      ['prepared', /\b(?:no\s+)?(?:me\s+)?prepar[eé](?=$|[^\p{L}])/giu],
    ];
    for (const [relation, pattern] of constructions) for (const match of rawMessage.matchAll(pattern)) anchors.push({ relation, start: match.index, end: match.index + match[0].length, negated: /^\s*no\b/iu.test(match[0]) });
    anchors.sort((a, b) => a.start - b.start || b.end - a.end);
    const emit = (span, relation, polarity, temporal_scope) => ({ surface: rawMessage.slice(span.start, span.end), relation, polarity, temporal_scope, state: { cooked: relation === 'prepared' && polarity === 'affirmed' ? true : null, canned: /at[uú]n\s+en\s+lata/iu.test(rawMessage.slice(span.start, span.end)) ? true : null, readiness: null }, evidence: { start: span.start, end: span.end, clause_index: rawMessage.slice(0, span.start).split(/[.!?;\n]/u).length - 1 } });
    const emitted = []; const assigned = new Set(); let restartEligibleEnd = -1;
    const initial = anchor => {
      const prefix = rawMessage.slice(bounds(anchor.start).start, anchor.start);
      const consumedMealPositionPrefix = anchor.relation === 'consumed'
        && /^\s*(?:[¿¡]\s*)?para\s+(?:desayunar|comer|cenar)\s+$/iu.test(prefix);
      return /^\s*(?:[¿¡]\s*)?$/u.test(prefix)
        || (anchor.relation === 'available' && /^\s*(?:también|tambien)\s+$/iu.test(prefix))
        || consumedMealPositionPrefix
        || (anchor.relation !== 'available' && ( /^\s*(?:ayer|hoy)\s+$/iu.test(prefix) || /;\s*(?:ayer|hoy)\s+$/iu.test(prefix) ));
    };
    const isApprovedRestart = value => /^\s*(?:,\s*)?(?:y\s+despu[eé]s|y|e|ni|pero|aunque)(?:\s+sí)?(?:\s+para\s+(?:desayunar|comer|cenar))?\s*$/iu.test(value);
    const localPastTail = (relation, start) => {
      if (relation !== 'consumed') return start;
      const match = /^\s+(?:ayer|hoy|en\s+(?:la\s+cena|el\s+desayuno|la\s+comida))(?=$|[^\p{L}\p{M}\p{Nd}\p{Pc}])/iu.exec(rawMessage.slice(start));
      return match ? start + match[0].length : start;
    };
    for (const [index, anchor] of anchors.entries()) {
      // Restart eligibility is recorded only after B.2 trusts P1. The next
      // anchor still builds its own proposition and authority descriptor;
      // structural coordinators and emphatic "sí" confer no authority.
      const joined = restartEligibleEnd >= 0 && isApprovedRestart(rawMessage.slice(restartEligibleEnd, anchor.start));
      if (!initial(anchor) && !joined) continue;
      const next = anchors[index + 1]?.start ?? bounds(anchor.start).end;
      const soft = /\b(?:pero|aunque|y\s+no|e\s+no)\b|[;?!]/iu.exec(rawMessage.slice(anchor.end, next));
      const end = Math.min(next, soft ? anchor.end + soft.index : next);
      const candidates = spans.filter(span => span.start >= anchor.end && span.end <= end && !assigned.has(span.start));
      if (!candidates.length || !/^\s*(?:(?:un|una|unos|unas|el|la|los|las)\s+)?$/iu.test(rawMessage.slice(anchor.end, candidates[0].start))) continue;
      const objects = []; let previous = anchor.end;
      for (const span of candidates) {
        const separator = rawMessage.slice(previous, span.start);
        const listSeparator = /^\s*(?:,|y|e|ni)\s*(?:(?:un|una|unos|unas|el|la|los|las)\s+)?$/iu;
        const preparedDescriptorConnector = /^\s*(?:chino\s+)?con\s+(?:(?:un|una|unos|unas|el|la|los|las)\s+)?$/iu;
        // This deliberately closed availability descriptor keeps an ordinary
        // cooked-state adjective attached to its preceding food object; it
        // creates neither a food span nor any authority of its own.
        const availabilityDescriptorConnector = /^\s+asada\s*(?:,|y|e)\s*(?:(?:un|una|unos|unas|el|la|los|las)\s+)?$/iu;
        if (previous !== anchor.end && !listSeparator.test(separator) && !(anchor.relation === 'prepared' && preparedDescriptorConnector.test(separator)) && !(anchor.relation === 'available' && availabilityDescriptorConnector.test(separator))) break;
        objects.push(span); previous = span.end;
      }
      if (!objects.length) continue;
      // Predicate ellipsis remains part of this same locally bound proposition:
      // B.2 evaluates it once; each object keeps its own polarity.
      const negativeTail = /^\s*(?:,\s*)?(?:y|e|pero|aunque)\s+no\s+/iu.exec(rawMessage.slice(end));
      if (negativeTail) {
        const tailStart = end + negativeTail[0].length;
        const span = spans.find(item => item.start >= tailStart && !assigned.has(item.start));
        if (span && /^\s*$/u.test(rawMessage.slice(tailStart, span.start))) {
          objects.push({ ...span, polarity: 'negated' });
          previous = span.end;
        }
      }
      const preparedDescriptorTail = anchor.relation === 'prepared'
        ? /^\s+con\s+salsa\s+de\s+soya(?=$|[^\p{L}\p{M}\p{Nd}\p{Pc}])/iu.exec(rawMessage.slice(previous))
        : null;
      const availabilityDescriptorTail = anchor.relation === 'available'
        ? /^\s+asada(?=$|[^\p{L}\p{M}\p{Nd}\p{Pc}])/iu.exec(rawMessage.slice(previous))
        : null;
      const descriptorEnd = preparedDescriptorTail ? previous + preparedDescriptorTail[0].length
        : availabilityDescriptorTail ? previous + availabilityDescriptorTail[0].length : previous;
      const propositionEnd = localPastTail(anchor.relation, descriptorEnd);
      const sentence = bounds(anchor.start);
      const suffix = rawMessage.slice(propositionEnd, sentence.end);
      const question = rawMessage.slice(sentence.start, anchor.start).includes('¿') || (/\?/u.test(suffix) && !/,\s*¿(?:qu[eé]|c[oó]mo|cu[aá]l)/iu.test(suffix));
      const constructionText = rawMessage.slice(anchor.start, anchor.end).normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
      const construction = anchor.relation === 'available'
        ? /^\s*no\s+cuento\s+con|^\s*cuento\s+con/u.test(constructionText) ? 'cuento_con'
          : /^\s*no\s+dispongo\s+de|^\s*dispongo\s+de/u.test(constructionText) ? 'dispongo_de'
            : /^\s*no\s+hay|^\s*hay/u.test(constructionText) ? 'hay' : 'tengo'
        : anchor.relation === 'consumed'
          ? /desayun/u.test(constructionText) ? 'desayune' : /cene/u.test(constructionText) ? 'cene' : /almorc/u.test(constructionText) ? 'almorce' : /merend/u.test(constructionText) ? 'merende' : 'comi'
          : anchor.relation === 'prepared' ? 'prepare'
            : /voy\s+a\s+comer/u.test(constructionText) ? 'voy_a_comer' : 'unsupported_planned';
      let boundaryEnd = propositionEnd;
      while (boundaryEnd < rawMessage.length && /\s/u.test(rawMessage[boundaryEnd])) boundaryEnd += 1;
      if (/[,;:.!?\-—()]/u.test(rawMessage[boundaryEnd] || '')) boundaryEnd += 1;
      const boundary = resolveCandidateBoundary({ rawMessage, proposition: { start: anchor.start, end: propositionEnd }, boundary: { start: propositionEnd, end: boundaryEnd }, followingStart: boundaryEnd, maxLookahead: 96 });
      const ownership = classifyPropositionOwnership({ construction }).ownership;
      const authority = evaluatePropositionAuthority({
        ownership,
        assertionMode: question ? 'interrogative' : 'asserted',
        boundaryDisposition: boundary.disposition,
        modifier: boundary.modifier,
        ambiguous: boundary.disposition === 'ambiguous',
        relation: anchor.relation,
      });
      const temporal_scope = anchor.relation === 'available' ? 'current' : anchor.relation === 'consumed' ? 'past' : anchor.relation === 'planned' ? 'future' : /\bayer\b/iu.test(rawMessage.slice(anchor.start, sentence.end)) ? 'past' : 'unknown';
      // B.2 grants factuality; this relation-local mapping only prevents a
      // future-qualified possession from being represented as current inventory.
      const representableRelation = authority.authoritative && !(anchor.relation === 'available' && boundary.modifier === 'future_qualifier');
      for (const object of objects) {
        const polarity = question ? 'question' : object.polarity || (anchor.negated ? 'negated' : 'affirmed');
        assigned.add(object.start);
        emitted.push(emit(object, representableRelation ? anchor.relation : 'mentioned', polarity, representableRelation ? temporal_scope : 'unknown'));
      }
      if (authority.authoritative) restartEligibleEnd = propositionEnd;
    }
    for (const span of spans) if (!assigned.has(span.start)) emitted.push(emit(span, 'mentioned', /[¿?]/u.test(rawMessage.slice(bounds(span.start).start, bounds(span.start).end)) ? 'question' : 'affirmed', 'unknown'));
    const ordered = emitted.sort((a, b) => a.evidence.start - b.evidence.start);
    const lastHistoryItem = Array.isArray(history) ? history.at(-1) : null;
    const inventoryReplyAuthorized = lastHistoryItem?.role === 'assistant'
      && String(lastHistoryItem.text || '').trim() === '¿Qué alimentos tienes disponibles ahora?';
    const listOnly = () => {
      if (!inventoryReplyAuthorized || !ordered.length || ordered.some(mention => mention.relation !== 'mentioned')) return false;
      let cursor = 0;
      for (const mention of ordered) {
        const separator = rawMessage.slice(cursor, mention.evidence.start);
        if (!/^\s*(?:(?:,|y|e)\s*)?(?:(?:un|una|unos|unas|el|la|los|las)\s+)?$/iu.test(separator)) return false;
        cursor = mention.evidence.end;
      }
      return /^\s*$/u.test(rawMessage.slice(cursor));
    };
    // This is deliberately separate from B.1/B.2/B.3: a complete, closed
    // predicate-less breakfast report can fill its omitted consumed predicate,
    // but only after explicit proposition parsing left every food non-factual.
    // It is not a general meal-description parser.
    const predicateLessBreakfastReport = () => {
      if (!ordered.length || ordered.some(mention => mention.relation !== 'mentioned' || mention.polarity !== 'affirmed')) return false;
      const marker = /\s+de\s+desayuno(?=$|[.!])/iu.exec(rawMessage);
      if (!marker || !/^\s*[.!]*\s*$/u.test(rawMessage.slice(marker.index + marker[0].length))) return false;
      let cursor = 0;
      for (const [index, mention] of ordered.entries()) {
        if (mention.evidence.end > marker.index) return false;
        const separator = rawMessage.slice(cursor, mention.evidence.start);
        const validLeading = index === 0
          ? /^\s*(?:(?:1|2|dos)\s+)?(?:(?:un|una|el|la)\s+)?$/iu
          : /^\s*(?:,\s*(?:y|e)?|y|e|con)\s*(?:(?:un|una|el|la)\s+)?$/iu;
        if (!validLeading.test(separator)) return false;
        cursor = mention.evidence.end;
      }
      const trailing = rawMessage.slice(cursor, marker.index);
      const finalFood = normalized(ordered.at(-1).surface);
      return finalFood === 'cafe'
        ? /^\s*(?:sin\s+az[uú]car)?\s*$/iu.test(trailing)
        : /^\s*$/u.test(trailing);
    };
    // The exact, immediate inventory authorization has precedence for lists.
    if (listOnly()) return ordered.map(mention => ({ ...mention, relation: 'available', polarity: 'affirmed', temporal_scope: 'current' }));
    if (predicateLessBreakfastReport()) return ordered.map(mention => ({ ...mention, relation: 'consumed', polarity: 'affirmed', temporal_scope: 'past' }));
    return ordered;
    /* superseded WP2.1 anchor/suffix implementation
    // This is a bounded lexical grammar, not an ontology or open-vocabulary
    // extractor. Original-string matching keeps evidence coordinates exact.
    const foodPatterns = [
      'pechuga\\s+de\\s+pollo', 'at[uú]n\\s+en\\s+lata', 'queso\\s+fresco', 'chile\\s+serrano', 'salsa\\s+verde',
      'huitlacoche', 'tortillas?', 'verduras?', 'galletas?', 'frijoles?', 'aguacate', 'huevos?', 'pollo', 'arroz', 'tacos?',
    ];
    const occupied = []; const foodMentions = [];
    const overlaps = (start, end) => occupied.some(range => start < range.end && end > range.start);
    for (const foodPattern of foodPatterns) {
      const pattern = new RegExp(`(^|[^\\p{L}])(${foodPattern})(?=$|[^\\p{L}])`, 'giu');
      for (const match of rawMessage.matchAll(pattern)) {
        const start = match.index + match[1].length; const end = start + match[2].length;
        if (!overlaps(start, end)) { occupied.push({ start, end }); foodMentions.push({ start, end }); }
      }
    }
    foodMentions.sort((left, right) => left.start - right.start);
    const constructions = [
      { relation: 'planned', pattern: /\b(?:no\s+)?(?:voy\s+a\s+(?:comprar|comer|preparar)|quiero\s+(?:hacer|comer|preparar)|ma[ñn]ana\s+(?:voy\s+a\s+)?(?:comer|hacer|preparar))(?=$|[^\p{L}])/giu },
      { relation: 'available', pattern: /\b(?:no\s+)?(?:tengo(?:\s+disponibles?)?|hay|cuento\s+con|dispongo\s+de)(?=$|[^\p{L}])/giu },
      { relation: 'consumed', pattern: /\b(?:no\s+)?(?:ya\s+)?(?:me\s+)?(?:com[ií]|desayun[eé]|cen[eé]|almorc[eé]|merend[eé])(?=$|[^\p{L}])/giu },
      { relation: 'prepared', pattern: /\b(?:no\s+)?(?:me\s+)?prepar[eé](?=$|[^\p{L}])/giu },
    ];
    const anchors = [];
    for (const { relation, pattern } of constructions) for (const match of rawMessage.matchAll(pattern)) {
      anchors.push({ relation, start: match.index, end: match.index + match[0].length, negated: /^\s*no\b/iu.test(match[0]) });
    }
    anchors.sort((left, right) => left.start - right.start || right.end - left.end);
    const clauseIndex = index => rawMessage.slice(0, index).split(/[.!?;]/u).length - 1;
    const sentenceBounds = index => {
      const start = Math.max(rawMessage.lastIndexOf('.', index), rawMessage.lastIndexOf('?', index), rawMessage.lastIndexOf('!', index), rawMessage.lastIndexOf(';', index)) + 1;
      const end = [rawMessage.indexOf('.', index), rawMessage.indexOf('?', index), rawMessage.indexOf('!', index), rawMessage.indexOf(';', index)].filter(value => value >= 0).sort((a, b) => a - b)[0] ?? rawMessage.length;
      return { start, end };
    };
    const isQuestionAnchor = anchor => {
      const sentence = sentenceBounds(anchor.start);
      const questionAt = rawMessage.indexOf('?', anchor.start);
      return rawMessage.slice(sentence.start, anchor.start).includes('¿') || (questionAt >= 0 && questionAt <= sentence.end && !/[,;]/u.test(rawMessage.slice(anchor.end, questionAt)));
    };
    // An initial assertion must begin its sentence/clause. A later predicate
    // may bind only after an already accepted direct-object construction;
    // this prevents a conditional/reported first predicate from licensing a
    // later coordinated predicate in the same sentence.
    const isInitialLocalAnchor = anchor => {
      const sentence = sentenceBounds(anchor.start);
      const prefix = rawMessage.slice(sentence.start, anchor.start);
      return /^\s*(?:[¿¡]\s*)?$/u.test(prefix) || (anchor.relation !== 'available' && /^\s*(?:ayer|hoy)\s+$/iu.test(prefix));
    };
    const nextBoundary = (anchor, nextAnchor) => {
      const localBoundary = /[.!?;]|\b(?:pero|aunque)\b/iu.exec(rawMessage.slice(anchor.end));
      const boundary = localBoundary ? anchor.end + localBoundary.index : rawMessage.length;
      return Math.min(boundary, nextAnchor?.start ?? rawMessage.length);
    };
    // Local object binding is necessary but insufficient for current inventory:
    // availability must also be an unqualified factual proposition. The small
    // grammar below recognizes only direct assertions and known independent
    // follow-on predicates; uncertain suffixes fail closed to `mentioned`.
    const isAuthoritativeCurrentAvailability = (anchor, objectEnd) => {
      const sentence = sentenceBounds(anchor.start);
      const suffix = rawMessage.slice(objectEnd, sentence.end);
      if (!suffix.trim()) return true;
      if (/^\s*(?:(?:para\s+)?(?:ma[ñn]ana|esta\s+noche|hoy\s+en\s+la\s+noche|m[aá]s\s+tarde)|el\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|fin\s+de\s+semana)|(?:si|cuando)\b)/iu.test(suffix)) return false;
      if (/^\s*,\s*(?:(?:me\s+)?dij\p{L}*|seg[uú]n\b)/iu.test(suffix)) return false;
      if (/^\s*,?\s*(?:¿\s*)?(?:verdad|no|cierto)\s*\??\s*$/iu.test(suffix)) return false;
      return /^\s*(?:y\s+(?:(?:no\s+)?(?:tengo|hay|cuento\s+con|dispongo\s+de|(?:me\s+)?com[ií]|(?:me\s+)?prepar[eé])|quiero|voy\s+a|puedo|prefiero|necesito)|pero\s+(?:no\s+s[eé]|no\s+sé|quiero|prefiero|voy\s+a))/iu.test(suffix);
    };
    const emit = (mention, relation, polarity, temporal_scope) => ({
      surface: rawMessage.slice(mention.start, mention.end), relation, polarity, temporal_scope,
      state: { cooked: relation === 'prepared' && polarity === 'affirmed' ? true : null, canned: /at[uú]n\s+en\s+lata/iu.test(rawMessage.slice(mention.start, mention.end)) ? true : null, readiness: null },
      evidence: { start: mention.start, end: mention.end, clause_index: clauseIndex(mention.start) },
    });
    const emitted = []; const assigned = new Set(); let lastAcceptedObjectEnd = -1;
    for (const [index, anchor] of anchors.entries()) {
      const followsAcceptedObject = lastAcceptedObjectEnd >= 0
        && /^\s*(?:pero|aunque)(?:\s+s[ií])?\s*$|^\s*(?:y\s+despu[eé]s|y|e|ni|despu[eé]s)\s*$/iu.test(rawMessage.slice(lastAcceptedObjectEnd, anchor.start));
      if (!isInitialLocalAnchor(anchor) && !followsAcceptedObject) continue;
      const end = nextBoundary(anchor, anchors[index + 1]);
      const candidates = foodMentions.filter(mention => mention.start >= anchor.end && mention.end <= end && !assigned.has(mention.start));
      if (!candidates.length) continue;
      const leading = rawMessage.slice(anchor.end, candidates[0].start);
      if (!/^\s*(?:(?:un|una|unos|unas|el|la|los|las)\s+)?$/iu.test(leading)) continue;
      const temporal_scope = anchor.relation === 'available' ? 'current' : anchor.relation === 'consumed' ? 'past' : anchor.relation === 'planned' ? 'future' : /\bayer\b/iu.test(rawMessage.slice(anchor.start, end)) ? 'past' : 'unknown';
      const polarity = isQuestionAnchor(anchor) ? 'question' : anchor.negated ? 'negated' : 'affirmed';
      let previous = anchor.end; const localMentions = [];
      for (const mention of candidates) {
        const connector = rawMessage.slice(previous, mention.start);
        if (previous !== anchor.end && !/^\s*(?:,|y|e|ni)\s*(?:(?:un|una|unos|unas|el|la|los|las)\s+)?$/iu.test(connector)) break;
        localMentions.push(mention); previous = mention.end;
      }
      const trustedAvailability = anchor.relation !== 'available' || polarity !== 'affirmed' || isAuthoritativeCurrentAvailability(anchor, previous);
      for (const mention of localMentions) {
        emitted.push(emit(mention, trustedAvailability ? anchor.relation : 'mentioned', polarity, trustedAvailability ? temporal_scope : 'unknown'));
        assigned.add(mention.start);
      }
      if (previous !== anchor.end) lastAcceptedObjectEnd = previous;
      // Predicate-ellipsis remains local only for an immediately coordinated
      // negative object ("Comí huevo pero no frijoles").
      const negativeTail = /^\s*(?:pero|aunque)\s+no\s+/iu.exec(rawMessage.slice(end));
      if (negativeTail) {
        const tailStart = end + negativeTail[0].length;
        const mention = foodMentions.find(item => item.start >= tailStart && !assigned.has(item.start));
        if (mention && /^\s*(?:(?:un|una|unos|unas|el|la|los|las)\s+)?$/iu.test(rawMessage.slice(tailStart, mention.start))) {
          emitted.push(emit(mention, anchor.relation, 'negated', temporal_scope)); assigned.add(mention.start);
        }
      }
    }
    for (const mention of foodMentions) if (!assigned.has(mention.start)) {
      const sentence = sentenceBounds(mention.start);
      emitted.push(emit(mention, 'mentioned', rawMessage.slice(sentence.start, sentence.end).includes('?') || rawMessage.slice(sentence.start, mention.start).includes('¿') ? 'question' : 'affirmed', 'unknown'));
    }
    return emitted.sort((left, right) => left.evidence.start - right.evidence.start);
    */
  })();
  // Operational food state is a deterministic projection of resulting
  // structured mentions. B.1/B.2/B.3 govern explicit-proposition authority;
  // C.1 and C.6 are separately bounded contextual completions. Projection
  // itself only maps that already-established factuality into operations.
  const operationalFoods = mention => {
    const value = normalized(mention.surface);
    if (/^pechuga\s+de\s+pollo$/u.test(value)) return ['pollo', 'pechuga'];
    if (/^huevos?$/u.test(value)) return ['huevos'];
    if (/^tortillas?$/u.test(value)) return ['tortillas'];
    if (/^(?:verduras?|vegetales?)$/u.test(value)) return ['verduras'];
    if (/^frijoles?$/u.test(value)) return ['frijoles'];
    if (/^galletas?$/u.test(value)) return ['galletas'];
    if (/^tacos?$/u.test(value)) return ['tacos'];
    return [value];
  };
  const trusted = structured_food_mentions.filter(mention => mention.polarity === 'affirmed');
  // Inventory is deliberately ephemeral: rebuild it from the bounded canonical
  // customer history on every turn. Only already-authoritative propositions are
  // projected; arbitrary mentions, assistant prose, and inferred ingredients
  // never enter this state. A later explicit consumption removes the matching
  // asserted availability rather than creating a durable pantry.
  const inventory = new Set();
  const applyFoodAssertions = mentions => {
    for (const mention of mentions.filter(value => value.polarity === 'affirmed')) {
      const foods = operationalFoods(mention);
      if (mention.relation === 'available' && mention.temporal_scope === 'current') foods.forEach(food => inventory.add(food));
      if (mention.relation === 'consumed') foods.forEach(food => inventory.delete(food));
    }
  };
  for (const item of Array.isArray(history) ? history : []) {
    if (item?.role !== 'customer') continue;
    // Recursive extraction is bounded because historical extraction receives no
    // history of its own; it preserves the same proposition authority grammar.
    applyFoodAssertions(extractSemanticContext(String(item.text || ''), []).food_context.structured_food_mentions);
  }
  applyFoodAssertions(structured_food_mentions);
  const available_foods = [...inventory];
  const eventGroups = new Map();
  for (const mention of trusted) {
    if (!['consumed', 'prepared'].includes(mention.relation)) continue;
    const key = `${mention.relation}:${mention.evidence.clause_index}`;
    const group = eventGroups.get(key) || { kind: mention.relation, foods: [], evidence: mention.surface, start: mention.evidence.start };
    group.foods.push(...operationalFoods(mention));
    eventGroups.set(key, group);
  }
  const recent_food_events = [...eventGroups.values()]
    .sort((left, right) => left.start - right.start)
    .map(({ kind, foods, evidence }) => ({ kind, foods: unique(foods), evidence }));
  const recently_consumed = unique(recent_food_events.filter(event => event.kind === 'consumed').flatMap(event => event.foods));
  return {
    contract_version: SEMANTIC_CONTEXT_VERSION,
    glp1_context: { mentioned: currentGlp1Mentioned || priorGlp1Mentioned, usage_reported: currentGlp1Usage || priorGlp1Usage, source: currentGlp1Usage ? 'current_turn' : priorGlp1Usage ? 'history' : null },
    food_context: {
      available_foods,
      recent_food_events,
      recently_consumed,
      appetite_observation: /\bpoco apetito|no tengo hambre|poca hambre\b/u.test(text) ? { kind: 'low', evidence: 'current_turn' } : /\bmucha hambre\b/u.test(text) && /\bcomo poco\b/u.test(text) ? { kind: 'variable_hunger_with_small_intake', evidence: 'current_turn' } : null,
      contextual_rejection,
      structured_food_mentions,
    },
    professional_support_context: { mentioned: professionalMentioned, dissatisfaction_reported: dissatisfactionReported },
    recommendation_request: { current_food_decision: Boolean(requestedEvidence), evidence: requestedEvidence },
  };
}

function validateInterpreterSemanticContext(value, currentMessage) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'recommendation_request_evidence')) throw new Error('SEMANTIC_CONTEXT_INVALID');
  if (value.recommendation_request_evidence !== null && value.recommendation_request_evidence !== undefined && (typeof value.recommendation_request_evidence !== 'string' || !currentMessage.includes(value.recommendation_request_evidence))) throw new Error('SEMANTIC_CONTEXT_INVALID');
  return value.recommendation_request_evidence ? { recommendation_request_evidence: value.recommendation_request_evidence } : {};
}

// The interpreter is probabilistic, but a standalone request for help after a
// confirmed GLP-1 disclosure has one bounded response obligation. Reconcile
// only classifications that carry no independent material work; medication,
// food-decision, commercial, delivery, and all other stronger obligations win.
function reconcileWeakNutritionSupportObligations(obligations, currentMessage, semanticContext) {
  if (!semanticContext?.glp1_context?.usage_reported || !Array.isArray(obligations) || !obligations.length) return obligations;
  const value = String(currentMessage || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().trim();
  const genericSupportRequest = /^[¿¡\s]*(?:hola[,.!\s]+)?(?:(?:me\s+)?pued(?:e|es|en)\s+ayudar|(?:me\s+)?ayudas?|(?:me\s+)?podrian\s+ayudar(?:me)?|necesito\s+(?:que\s+me\s+)?(?:ayuda|ayudar|ayuden|ayudes)|quisiera\s+ayuda|busco\s+ayuda)(?:\s+(?:con\s+)?(?:mi\s+)?(?:alimentacion|comida|nutricion))?(?:\s+(?:por\s+favor|porfa))?[?!.\s]*$/u;
  const weakTypes = new Set(['general_information', 'acknowledgement', 'unsupported']);
  if (!genericSupportRequest.test(value)) return obligations;
  const material = obligations.filter(obligation => !weakTypes.has(obligation?.type) && obligation?.type !== 'nutrition_support_request');
  if (material.length) return obligations;
  if (obligations.some(obligation => obligation?.type === 'nutrition_support_request')) return obligations.filter(obligation => !weakTypes.has(obligation?.type));
  const evidence = obligations.find(obligation => typeof obligation?.evidence === 'string' && currentMessage.includes(obligation.evidence))?.evidence || currentMessage;
  return [{ type: 'nutrition_support_request', evidence }];
}

// Appetite is semantic context, not an obligation. If the interpreter turns a
// standalone observation into generic support, restore the existing bounded
// contextual-fallback path without overriding an expressed request or question.
function reconcileStandaloneAppetiteObservationObligations(obligations, currentMessage, semanticContext) {
  if (!semanticContext?.food_context?.appetite_observation || !Array.isArray(obligations) || !obligations.length) return obligations;
  const value = String(currentMessage || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  const explicitSupport = /\b(?:pued(?:e|es|en)\s+ayudar|ayudas?|podrian\s+ayudar|necesito\s+(?:que\s+me\s+)?(?:ayuda|ayudar|ayuden|ayudes)|quisiera\s+ayuda|busco\s+ayuda)\b/u;
  const explicitFoodDecision = Boolean(semanticContext?.recommendation_request?.current_food_decision) || /\bque\s+(?:puedo|debo)\s+comer\b|\b(?:me\s+)?recomiendas?\b|\bque\s+me\s+puedo\s+(?:hacer|preparar)\b/u.test(value);
  const weakTypes = new Set(['nutrition_support_request', 'general_information', 'acknowledgement', 'unsupported']);
  if (/[?¿]/u.test(value) || explicitSupport.test(value) || explicitFoodDecision || obligations.some(obligation => !weakTypes.has(obligation?.type))) return obligations;
  const evidence = obligations.find(obligation => typeof obligation?.evidence === 'string' && currentMessage.includes(obligation.evidence))?.evidence || currentMessage;
  return [{ type: 'unsupported', evidence }];
}

// The interpreter may classify a terse inventory continuation as an
// acknowledgement, but it does not own the proposition authority decision.
// Promote only a continuation already established by the deterministic food
// scanner; words such as "también" alone are never inventory authority.
function reconcileAuthoritativeContextualInventoryObligations(obligations, currentMessage, semanticContext, history = []) {
  if (!Array.isArray(obligations) || !obligations.length || !semanticContext?.food_context) return obligations;
  const weakTypes = new Set(['general_information', 'acknowledgement', 'unsupported']);
  if (obligations.some(obligation => !weakTypes.has(obligation?.type))) return obligations;
  const currentAvailability = (semanticContext.food_context.structured_food_mentions || []).filter(mention => (
    mention?.relation === 'available' && mention?.polarity === 'affirmed' && mention?.temporal_scope === 'current'
  ));
  if (!currentAvailability.length) return obligations;
  const historicalAvailability = extractSemanticContext('', Array.isArray(history) ? history : []).food_context.available_foods || [];
  const continuationMarker = /^\s*(?:tamb[ié]n|adem[aá]s)\b/iu.test(String(currentMessage || ''));
  if (!historicalAvailability.length && !continuationMarker) return obligations;
  const evidence = obligations.find(obligation => typeof obligation?.evidence === 'string' && currentMessage.includes(obligation.evidence))?.evidence || currentMessage;
  return [{ type: 'food_decision', evidence }];
}

function extractFoodContext(message, mostRecentAssistantMessage = '') {
  const context = extractSemanticContext(message, mostRecentAssistantMessage ? [{ role: 'assistant', text: mostRecentAssistantMessage }] : []);
  return {
    recently_consumed: context.food_context.recently_consumed,
    available_foods: context.food_context.available_foods,
    appetite: context.food_context.appetite_observation?.kind === 'low' ? 'low' : null,
    contextual_rejection: context.food_context.contextual_rejection,
  };
}

function foodContextForResolution(semanticContext, message, mostRecentAssistantMessage = '') {
  if (!semanticContext?.food_context) return extractFoodContext(message, mostRecentAssistantMessage);
  return {
    recently_consumed: semanticContext.food_context.recently_consumed || [],
    available_foods: semanticContext.food_context.available_foods || [],
    appetite: semanticContext.food_context.appetite_observation?.kind === 'low' ? 'low' : null,
    contextual_rejection: Boolean(semanticContext.food_context.contextual_rejection),
  };
}

// This is a closed semantic-to-ontology mapping, not food inference. Values
// absent from this table are intentionally withheld from the adapter.
const DIRECT_RAG_FOOD_TO_ENGINE_ID = Object.freeze({
  pollo: 'chicken', pechuga: 'chicken_breast', huevos: 'egg', huevo: 'egg',
  tortillas: 'corn_tortilla', tortilla: 'corn_tortilla', aguacate: 'avocado',
  jitomate: 'red_tomato', jitomates: 'red_tomato', arroz: 'rice',
  pescado: 'fish', carne: 'ground_beef', leche: 'milk', fruta: 'apple', frutas: 'apple',
  frijoles: 'common_beans', frijol: 'common_beans', tocino: 'pork',
});

function buildMealRecommendationInput(context) {
  const mapped = [];
  for (const food of context.available_foods || []) {
    const food_id = DIRECT_RAG_FOOD_TO_ENGINE_ID[food];
    if (food_id && !mapped.some(value => value.food_id === food_id)) mapped.push({ food_id, state: {} });
  }
  const recently_consumed = [...new Set((context.recently_consumed || [])
    .map(food => DIRECT_RAG_FOOD_TO_ENGINE_ID[food]).filter(Boolean))];
  return {
    recommendation_authorized: true,
    available_foods: mapped,
    recently_consumed,
    appetite: context.appetite || 'unknown',
    meal_context: null,
    confirmed_constraints: [],
    contextual_rejections: [],
    locale: 'es-MX',
    // The user asked what to prepare, rather than asserting ready-to-eat food.
    decision_horizon: 'upcoming_meal',
  };
}

function recommendationClaim(contract, appetite) {
  const portion = contract.recommendation.appetite_strategy === 'start_small' || appetite === 'low'
    ? ' Empieza con una porción pequeña y come despacio.' : '';
  const companion = contract.recommendation.grounded_food_ids.length === 1
    ? ' Si tienes una verdura o tortilla a la mano, agrégala para completar el plato.' : '';
  return `Puedes preparar ${contract.recommendation.visible_name}.${companion}${portion}`;
}

function singleFoodDecisionClaim(context) {
  const [food] = context.available_foods;
  return `Con ${food}, arma un plato sencillo: añade una verdura o tortilla si tienes a la mano.`;
}

function resolveFoodDecision(message, mostRecentAssistantMessage = '', history = [], semanticContext = null, mayClarifyInventory = true) {
  const context = foodContextForResolution(semanticContext, message, mostRecentAssistantMessage);
  const adapter_input = buildMealRecommendationInput(context);
  const recommendation = mealRecommendationAdapter.runMealRecommendation(adapter_input);
  if (recommendation.status === 'recommendation') {
    return { context, adapter_input, recommendation, permitted_claims: [recommendationClaim(recommendation, context.appetite)], clarification_question: null };
  }
  // The V1.3 engine correctly refuses to manufacture a complete grounded meal
  // from one food. This bounded presentation step does not claim the optional
  // companion is available; it turns one explicit ingredient into an immediate
  // practical next step while retaining the adapter's selection boundary.
  if (context.available_foods.length === 1 && adapter_input.available_foods.length === 1) {
    return { context, adapter_input, recommendation, permitted_claims: [singleFoodDecisionClaim(context)], clarification_question: null };
  }
  const clarification_question = mayClarifyInventory ? '¿Qué alimentos tienes disponibles ahora?' : null;
  if (context.contextual_rejection) return { context, adapter_input, recommendation, permitted_claims: [`Entiendo, buscamos otra cosa para este momento.${clarification_question ? ` ${clarification_question}` : ''}`], clarification_question };
  return { context, adapter_input, recommendation, permitted_claims: [clarification_question ? `Para recomendarte algo concreto, ${clarification_question}` : 'Entiendo. Cuando quieras decidir qué comer, puedo ayudarte con una opción práctica.'], clarification_question };
}

function recommendationFailureCode(recommendation) {
  const allowed = new Set(['adapter_input_invalid', 'available_foods_invalid', 'recently_consumed_invalid', 'appetite_invalid', 'meal_context_unsupported', 'confirmed_constraints_invalid', 'contextual_rejections_invalid', 'locale_invalid', 'decision_horizon_invalid', 'decision_horizon_unsupported', 'engine_exception', 'engine_output_malformed', 'selected_food_not_grounded', 'confirmed_constraint_violated', 'contextual_rejection_violated', 'engine_validation_failed']);
  return recommendation?.status === 'integration_failure' && allowed.has(recommendation.reason) ? recommendation.reason : null;
}

function nutritionSupportClaim(semanticContext) {
  if (semanticContext?.professional_support_context?.dissatisfaction_reported) return 'Entiendo que buscas apoyo claro para tus decisiones de alimentación. Puedo ayudarte por aquí con decisiones prácticas de comida; no sustituyo atención médica ni doy indicaciones sobre medicamentos.';
  if (semanticContext?.glp1_context?.usage_reported) return 'Sí. Puedo ayudarte con decisiones de alimentación mientras usas GLP-1: qué comer según tu apetito, lo que ya comiste o los alimentos que tienes disponibles. No doy indicaciones sobre dosis ni sobre el medicamento.';
  return 'Puedo ayudarte con decisiones prácticas de alimentación según tu apetito, lo que ya comiste o los alimentos que tienes disponibles.';
}

function contextualSemanticClaim(semanticContext) {
  if (semanticContext?.professional_support_context?.dissatisfaction_reported) return nutritionSupportClaim(semanticContext);
  if (semanticContext?.food_context?.appetite_observation?.kind === 'variable_hunger_with_small_intake') return 'Entiendo que por momentos tienes mucha hambre y cuando comes, comes poco. Puedo ayudarte a pensar una siguiente comida de forma práctica, sin ajustar medicamentos.';
  if (semanticContext?.food_context?.appetite_observation?.kind === 'low') return 'Entiendo que tienes poco apetito. Puedo ayudarte a pensar una siguiente comida sencilla y práctica.';
  const event = semanticContext?.food_context?.recent_food_events?.[0];
  if (event?.kind === 'prepared' && event.foods?.length) return `Entiendo: preparaste una comida con ${event.foods.join(', ')}.`;
  if (event?.kind === 'consumed' && event.foods?.length) return `Gracias por contarme lo que comiste: ${event.foods.join(', ')}.`;
  return null;
}

function permitsFirstContactDiscoveryQuestion(context, obligations) {
  return Array.isArray(obligations) && obligations.length === 1 && obligations[0]?.type === 'general_information' && (!Array.isArray(context?.history) || context.history.length === 0) && !String(context?.most_recent_assistant_message || '').trim();
}

function buildConversationContext({ currentMessage, history = [], recentAssistantMessage = '', customerState = {}, sessionId, offerVersion = 'glp1-whatsapp-free-test-v3' }) {
  if (typeof currentMessage !== 'string' || !currentMessage.trim() || typeof sessionId !== 'string' || !sessionId) throw new Error('CONVERSATION_CONTEXT_INVALID');
  const safeHistory = Array.isArray(history) ? history.slice(-12).map(item => ({ role: item.role === 'assistant' ? 'assistant' : 'customer', text: String(item.text || '').slice(0, 1000) })) : [];
  const current_message = currentMessage.trim().slice(0, 2000);
  const most_recent_assistant_message = String(recentAssistantMessage || '').slice(0, 1500);
  const semanticHistory = most_recent_assistant_message && safeHistory.at(-1)?.text !== most_recent_assistant_message ? [...safeHistory, { role: 'assistant', text: most_recent_assistant_message }] : safeHistory;
  return Object.freeze({ contract_version: 'direct-rag-v3-proposition-test', locale: 'es-MX', session_id: sessionId, current_message, history: safeHistory, most_recent_assistant_message, semantic_context: extractSemanticContext(current_message, semanticHistory), customer_state: copy(customerState), commercial_state: { purchase_context: false, checkout_suppressed: true }, offer_version: offerVersion });
}

function validateObligations(value, currentMessage) {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw new Error('OBLIGATIONS_INVALID');
  return value.map((item, index) => {
    if (!plain(item) || (!SUBJECTS.has(item.type) && !LEGACY_RESOLVER_OBLIGATION_TYPES.has(item.type)) || typeof item.evidence !== 'string' || !currentMessage.includes(item.evidence)) throw new Error('OBLIGATIONS_INVALID');
    return { id: `o-${index + 1}`, type: item.type, evidence: item.evidence };
  });
}

function resolveObligations({ context, obligations }) {
  const semanticHistory = context.most_recent_assistant_message && context.history?.at(-1)?.text !== context.most_recent_assistant_message ? [...(context.history || []), { role: 'assistant', text: context.most_recent_assistant_message }] : context.history;
  const semantic_context = context.semantic_context || extractSemanticContext(context.current_message, semanticHistory);
  const hasCurrentFoodDecision = obligations.some(obligation => obligation.type === 'food_decision');
  const hasLegacyFoodContext = obligations.some(obligation => obligation.type === 'food_context');
  const hasFoodResolution = hasCurrentFoodDecision || hasLegacyFoodContext || obligations.some(obligation => obligation.type === 'recommendation_feedback');
  const foodDecision = hasFoodResolution ? resolveFoodDecision(context.current_message, context.most_recent_assistant_message, context.history, semantic_context, hasCurrentFoodDecision || hasLegacyFoodContext) : null;
  const contextualClaim = contextualSemanticClaim(semantic_context);
  const semanticFallbackAllowed = obligations.length === 1 && obligations[0]?.type === 'unsupported';
  let foodClaimAssigned = false;
  const results = obligations.map(obligation => {
    const food = ['food_decision', 'food_context', 'recommendation_feedback'].includes(obligation.type);
    const permitted_claims = food && !foodClaimAssigned ? foodDecision.permitted_claims : food ? [] : obligation.type === 'nutrition_support_request' ? [nutritionSupportClaim(semantic_context)] : obligation.type === 'unsupported' && semanticFallbackAllowed && contextualClaim ? [contextualClaim] : obligation.type === 'delivery_channel' ? [deliveryChannelFact(context.current_message)] : copy(FACTS[obligation.type] || FACTS.unsupported);
    if (food) foodClaimAssigned = true;
    return { obligation: copy(obligation), resolution: obligation.type === 'unsupported' ? 'bounded_unknown' : 'resolved', permitted_claims, ...(food ? { food_context: copy(foodDecision.context), recommendation_source: foodDecision.recommendation?.source || null, recommendation_status: foodDecision.recommendation?.status || null, recommendation_failure_code: recommendationFailureCode(foodDecision.recommendation) } : {}), prohibited_or_boundary_claims: ['obsolete_28_day_offer', 'portal_access', 'price_149', 'four_meal_product', 'checkout', ...(obligation.type === 'medical_boundary' ? ['medication_management_advice'] : []), ...(obligation.type === 'glp1_scope' ? ['medication_sale_delivery_or_prescription'] : [])], action_authorization: null, ...(obligation.type === 'purchase_intent' ? { checkout_suppressed_reason: 'proposition_test_no_checkout' } : {}) };
  });
  const discovery = permitsFirstContactDiscoveryQuestion(context, obligations);
  const clarification_question = discovery ? null : hasCurrentFoodDecision || hasLegacyFoodContext ? foodDecision?.clarification_question || null : null;
  const required_questions = discovery ? [FIRST_CONTACT_DISCOVERY_QUESTION] : clarification_question ? [clarification_question] : [];
  return { semantic_context: copy(semantic_context), resolved_obligations: results, permitted_claims: [...results.flatMap(item => item.permitted_claims), ...(discovery ? [FIRST_CONTACT_DISCOVERY_QUESTION] : [])], authorized_action: null, checkout_suppressed_reason: results.find(item => item.checkout_suppressed_reason)?.checkout_suppressed_reason || null, conversation_policy: { discovery_question_authorized: discovery, food_clarification_authorized: Boolean(clarification_question), clarification_question, required_questions }, checkout_question_response: null };
}

function buildCompositionEnvelope({ context, resolution }) {
  const required_questions = copy(resolution.conversation_policy?.required_questions || []);
  return Object.freeze({ contract_version: 'direct-rag-v3-proposition-test', current_message: context.current_message, relevant_conversation_context: { history: context.history, most_recent_assistant_message: context.most_recent_assistant_message }, resolved_obligations: copy(resolution.resolved_obligations), permitted_claims: copy(resolution.permitted_claims), response_policy: { locale: 'es-MX', max_questions: required_questions.length, required_questions, question_authorization: { generic_first_contact: Boolean(resolution.conversation_policy?.discovery_question_authorized), food_clarification: Boolean(resolution.conversation_policy?.food_clarification_authorized), authorized_food_clarification_question: resolution.conversation_policy?.clarification_question || null }, unsolicited_purchase_cta: false, action_authorization: null } });
}

function gateResponse({ envelope, response, coveredObligationIds, usedClaims = [] }) {
  if (!plain(envelope) || typeof response !== 'string' || !response.trim() || !Array.isArray(usedClaims)) return { cleared: false, reason: 'STRUCTURE_INVALID' };
  const required = envelope.resolved_obligations.map(item => item.obligation.id);
  if (!Array.isArray(coveredObligationIds) || required.some(id => !coveredObligationIds.includes(id))) return { cleared: false, reason: 'OBLIGATION_COVERAGE_MISSING' };
  if (OBSOLETE_CURRENT_PRODUCT_CLAIMS.test(response)) return { cleared: false, reason: 'OBSOLETE_CURRENT_PRODUCT_CLAIM' };
  if (MEDICATION_MANAGEMENT_ADVICE.test(response)) return { cleared: false, reason: 'MEDICATION_GUIDANCE' };
  const allowed = envelope.permitted_claims.map(canonical);
  if (canonical(response) !== canonical(envelope.permitted_claims.join(' ')) && !allowed.includes(canonical(response))) return { cleared: false, reason: 'UNSUPPORTED_ACTUAL_RESPONSE' };
  const requiredQuestions = envelope.response_policy?.required_questions || [];
  if ((response.match(/\?/gu) || []).length !== requiredQuestions.length || requiredQuestions.some(question => response.split(question).length - 1 !== 1)) return { cleared: false, reason: requiredQuestions.length ? 'REQUIRED_QUESTION_MISSING' : 'UNAUTHORIZED_QUESTION' };
  return { cleared: true, reason: null };
}

module.exports = { FACTS, INTERPRETER_OBLIGATION_TYPES, OBLIGATION_TYPE_CONTRACT, GLP1_LIVE_PILOT_CHECKOUT_SUPPRESSED, FIRST_CONTACT_DISCOVERY_QUESTION, OBSOLETE_CURRENT_PRODUCT_CLAIMS, SEMANTIC_CONTEXT_VERSION, buildConversationContext, extractSemanticContext, validateInterpreterSemanticContext, reconcileWeakNutritionSupportObligations, reconcileStandaloneAppetiteObservationObligations, reconcileAuthoritativeContextualInventoryObligations, extractFoodContext, foodContextForResolution, buildMealRecommendationInput, recommendationClaim, singleFoodDecisionClaim, resolveFoodDecision, recommendationFailureCode, nutritionSupportClaim, contextualSemanticClaim, permitsFirstContactDiscoveryQuestion, deliveryChannelFact, validateObligations, resolveObligations, buildCompositionEnvelope, gateResponse, __testOnly: Object.freeze({ resolveCandidateBoundary, classifyPropositionOwnership, evaluatePropositionAuthority }) };
