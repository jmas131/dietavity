'use strict';

// Ticket75F.1 replay is a structural regression harness, not a production
// retry path. Its adapters are intentionally incapable of side effects.
const FORBIDDEN = ['customer_text','assistant_text','body','history','prompt','provider_payload','provider_sid','destination','token','credential'];

class OfflineReplayError extends Error { constructor(code) { super(code); this.code = code; } }
function assertFixture(fixture) {
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture) || !fixture.fixture_version || Object.keys(fixture).some(key => FORBIDDEN.includes(key))) throw new OfflineReplayError('OFFLINE_REPLAY_FIXTURE_INVALID');
  if (!Array.isArray(fixture.obligations) || !Array.isArray(fixture.resolution_authorities) || !Array.isArray(fixture.stage_trace) || !['response_eligible','response_ineligible'].includes(fixture.response_eligibility)) throw new OfflineReplayError('OFFLINE_REPLAY_FIXTURE_INVALID');
  return structuredClone(fixture);
}
function disabled(name, counters) { return async () => { counters[name] += 1; throw new OfflineReplayError('OFFLINE_REPLAY_SIDE_EFFECT_FORBIDDEN'); }; }
function createOfflineReplayHarness() {
  return Object.freeze({ async replay(fixture) {
    const value = assertFixture(fixture); const counters = { action: 0, reservation: 0, transport: 0, completion: 0, claim: 0, recovery: 0, network: 0 };
    const adapters = Object.freeze({ executeAction: disabled('action', counters), reserveReply: disabled('reservation', counters), transport: disabled('transport', counters), completeInbound: disabled('completion', counters), mutateClaim: disabled('claim', counters), recover: disabled('recovery', counters), network: disabled('network', counters) });
    // Fixtures carry only deterministic, sanitized stage projections. No prose
    // is replayed or compared; action/reservation are explicitly not executed.
    const output = Object.freeze({ fixture_id: value.fixture_id, obligation_categories: value.obligations.map(item => item.category), obligation_count: value.obligations.length, resolution_authorities: value.resolution_authorities, gate_statuses: value.gate_statuses || {}, action_projection: value.action_projection || [], response_eligibility: value.response_eligibility, terminal: value.terminal || null, stage_trace: value.stage_trace, reservation_state: 'not_executed' });
    return Object.freeze({ output, counters: Object.freeze({ ...counters }), adapters });
  } });
}
module.exports = { FORBIDDEN, OfflineReplayError, createOfflineReplayHarness };
