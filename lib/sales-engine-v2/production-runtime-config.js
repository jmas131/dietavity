'use strict';

const { AUDIENCE } = require('./claimed-turn-runtime');
const STAGES = ['interpreter', 'bounded_reasoning', 'semantic_guidance_assessor', 'artifact_reproduction_assessor', 'composer', 'final_response_assessor'];
const OPAQUE = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// The production request boundary is fixed at 100 seconds. Keep an explicit
// margin for n8n to receive the bounded result before it times out.
const MAX_PRODUCTION_CLAIMED_TURN_DEADLINE_MS = 90000;

class ProductionRuntimeConfigError extends Error { constructor(code) { super(code); this.name = 'ProductionRuntimeConfigError'; this.code = code; } }
const text = (env, name) => String(env[name] || '').trim();
function json(env, name) { try { return JSON.parse(text(env, name)); } catch { throw new ProductionRuntimeConfigError('CLAIMED_TURN_CONFIGURATION_INVALID'); } }
function cohort(env, name) { const values = text(env, name).split(',').map(value => value.trim()).filter(Boolean); if (!values.every(value => UUID.test(value))) throw new ProductionRuntimeConfigError('CLAIMED_TURN_CONFIGURATION_INVALID'); return Object.freeze([...new Set(values.map(value => value.toLowerCase()))]); }
function keys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) throw new ProductionRuntimeConfigError('CLAIMED_TURN_CONFIGURATION_INVALID');
  const output = {};
  for (const [kid, entry] of Object.entries(value)) {
    if (!OPAQUE.test(kid) || !entry || typeof entry !== 'object' || Array.isArray(entry) || !OPAQUE.test(entry.client_id) || typeof entry.public_key !== 'string' || !entry.public_key.trim()) throw new ProductionRuntimeConfigError('CLAIMED_TURN_CONFIGURATION_INVALID');
    output[kid] = Object.freeze({ clientId: entry.client_id, publicKey: entry.public_key });
  }
  return Object.freeze(output);
}
function models(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !STAGES.every(stage => typeof value[stage] === 'string' && value[stage].trim())) throw new ProductionRuntimeConfigError('CLAIMED_TURN_CONFIGURATION_INVALID');
  return Object.freeze(Object.fromEntries(STAGES.map(stage => [stage, value[stage].trim()])));
}
function parseProductionRuntimeConfig(env = process.env) {
  const control = text(env, 'SALES_ENGINE_V2_CONTROL') || 'disabled';
  if (!['disabled', 'shadow', 'live'].includes(control)) throw new ProductionRuntimeConfigError('CLAIMED_TURN_CONFIGURATION_INVALID');
  if (control === 'disabled') return Object.freeze({ control, enabled: false, audience: AUDIENCE });
  const routeGeneration = text(env, 'SALES_ENGINE_V2_ROUTE_GENERATION');
  const issuer = text(env, 'SALES_ENGINE_V2_JWT_ISSUER');
  const pseudonymKey = text(env, 'SALES_ENGINE_V2_PSEUDONYM_KEY');
  const deadlineMs = Number(text(env, 'SALES_ENGINE_V2_CLAIMED_TURN_DEADLINE_MS'));
  const assertionMaxTtlSeconds = text(env, 'SALES_ENGINE_V2_ASSERTION_MAX_TTL_SECONDS') === '' ? 60 : Number(text(env, 'SALES_ENGINE_V2_ASSERTION_MAX_TTL_SECONDS'));
  const backendAdapter = text(env, 'SALES_ENGINE_V2_BACKEND_ADAPTER');
  const diagnosticsEnabled = text(env, 'SALES_ENGINE_V2_DIAGNOSTICS_ENABLED') === 'true';
  if (!OPAQUE.test(routeGeneration) || routeGeneration === 'disabled' || !OPAQUE.test(issuer) || pseudonymKey.length < 16 || !Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > MAX_PRODUCTION_CLAIMED_TURN_DEADLINE_MS || !Number.isInteger(assertionMaxTtlSeconds) || assertionMaxTtlSeconds < 1 || assertionMaxTtlSeconds > 60 || backendAdapter !== 'supabase_service_role' || !diagnosticsEnabled) throw new ProductionRuntimeConfigError('CLAIMED_TURN_CONFIGURATION_INVALID');
  const shadowCohortIds = cohort(env, 'SALES_ENGINE_V2_SHADOW_COHORT_IDS');
  const liveCohortIds = cohort(env, 'SALES_ENGINE_V2_LIVE_COHORT_IDS');
  const selectedCohortIds = control === 'shadow' ? shadowCohortIds : liveCohortIds;
  if (!selectedCohortIds.length) throw new ProductionRuntimeConfigError('CLAIMED_TURN_CONFIGURATION_INVALID');
  return Object.freeze({ control, enabled: true, routeGeneration, issuer, audience: AUDIENCE, keys: keys(json(env, 'SALES_ENGINE_V2_JWT_PUBLIC_KEYS_JSON')), pseudonymKey, deadlineMs, assertionMaxTtlSeconds, models: models(json(env, 'SALES_ENGINE_V2_MODEL_IDS_JSON')), shadowCohortIds, liveCohortIds, selectedCohortIds, replayMode: text(env, 'SALES_ENGINE_V2_ASSERTION_REPLAY_MODE') || 'durable', backendAdapter, diagnosticsEnabled });
}
module.exports = { MAX_PRODUCTION_CLAIMED_TURN_DEADLINE_MS, ProductionRuntimeConfigError, parseProductionRuntimeConfig };
