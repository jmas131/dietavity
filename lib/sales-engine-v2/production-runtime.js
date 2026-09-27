'use strict';

const { createClaimedTurnRuntime, createRouteAuthorizer } = require('./claimed-turn-runtime');
const { createSupabaseAssertionReplayAdapter } = require('./assertion-replay-adapter');
const { createSupabaseCanonicalReader } = require('./supabase-canonical-reader');
const { createCanonicalClaimVerifier, createCanonicalInputAdapter } = require('./canonical-input-adapters');
const { createHardenedModelTransport, createStageAdapters } = require('./hardened-model-runtime');
const { createClaimedTurnComposition } = require('./claimed-turn-composition');
const { createBestEffortDiagnosticObserver, createSupabaseDiagnosticRecorder } = require('./diagnostic-observer');
const { parseProductionRuntimeConfig } = require('./production-runtime-config');

function unavailable() { return createClaimedTurnRuntime(); }
function createProductionClaimedTurnRuntime({ env = process.env, dependencies = {}, log = () => {} } = {}) {
  let config;
  try { config = parseProductionRuntimeConfig(env); } catch { return unavailable(); }
  if (!config.enabled || config.control !== 'shadow' || config.replayMode !== 'durable') return unavailable();
  try {
    const supabase = dependencies.supabase;
    if (!supabase || !dependencies.modelClient) return unavailable();
    const replayGuard = dependencies.replayGuard || createSupabaseAssertionReplayAdapter({ supabase });
    if (replayGuard.kind !== 'durable_assertion_replay' || typeof replayGuard.consume !== 'function') return unavailable();
    const needsReader = !dependencies.claimVerifier || !dependencies.inputAdapter;
    const reader = dependencies.reader || (needsReader ? createSupabaseCanonicalReader({ supabase }) : undefined);
    const claimVerifier = dependencies.claimVerifier || createCanonicalClaimVerifier({ reader });
    const inputAdapter = dependencies.inputAdapter || createCanonicalInputAdapter({ reader });
    const transport = createHardenedModelTransport({ client: dependencies.modelClient, models: config.models, maxAttempts: dependencies.maxModelAttempts || 2 });
    const diagnosticObserver = config.diagnosticsEnabled
      ? createBestEffortDiagnosticObserver({ recorder: dependencies.diagnosticRecorder || createSupabaseDiagnosticRecorder({ client: supabase }), log })
      : undefined;
    const composition = dependencies.composition || createClaimedTurnComposition({ stageAdapters: createStageAdapters({ transport }), diagnosticObserver });
    return createClaimedTurnRuntime({
      auth: { issuer: config.issuer, audience: config.audience, keys: config.keys, replayGuard, maxAssertionTtlSeconds: config.assertionMaxTtlSeconds },
      routeAuthorizer: createRouteAuthorizer({ state: 'shadow', generation: config.routeGeneration, cohortIds: config.selectedCohortIds }),
      claimVerifier,
      inputAdapter,
      runtime: input => composition.run({ canonicalInput: input.canonicalInput, mode: input.route.mode, invocationIdentity: input.invocationIdentity, signal: input.signal, diagnosticContext: input.diagnosticContext }),
      deadlineMs: config.deadlineMs,
      diagnosticObserver,
      pseudonymKey: config.pseudonymKey,
      logger: log,
    });
  } catch { return unavailable(); }
}
module.exports = { createProductionClaimedTurnRuntime };
