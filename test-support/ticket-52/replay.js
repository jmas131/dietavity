'use strict';
const vm = require('node:vm');
const {createRuntime} = require('../ticket-48/runner');
const archived = require('../../outputs/ticket-51/inactive-scenario-g-harness.json');
const fixture = require('./scenario-g-live-incident.json');
const clone = value => JSON.parse(JSON.stringify(value));
function runtime(baseline, recordedAt) {
  const instant = Date.parse(recordedAt);
  class RecordedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  }
  if (!baseline) return createRuntime({Date:RecordedDate});
  const code = archived.nodes.find(n => n.name === 'Initialize Synthetic Customer').parameters.jsCode;
  if (!code.includes(fixture.source.sales_engine_sha256)) throw new Error('Archived engine does not match live-run provenance');
  return vm.runInNewContext(code.slice(0, code.lastIndexOf('\nreturn [{json:')) + '\nharness;', {Date:RecordedDate}, {timeout:5000});
}
function replay(turn, baseline = false) {
  const h = runtime(baseline, turn.recorded_at);
  let state = h.initialize({target:'sales',scenario_ids:['context_switching_001'],max_customer_turns:12},fixture.source.run_id);
  const prior = [...fixture.preceding_transcript, ...fixture.incident_turns.filter(t => t.turn < turn.turn).map(t => ({customer_message:t.customer_message,final_dietavity_response:t.final_dietavity_response}))];
  state.session = clone(turn.session_before);
  state.transcript = clone(prior);
  state.turns = prior.map((t,index) => ({turn:index + 1,...clone(t)}));
  state.customer = {customer_message:turn.customer_message,outcome:'continue'};
  state = h.prepareInterpretation(state);
  // The live report preserves parsed interpretation, not the raw classifier envelope.
  // Replay it through the canonical parser with the exact recorded current message.
  state = h.decide(state,{output:JSON.stringify(turn.diagnostics.interpretation)});
  const decision = clone(state.decision);
  state = h.capture(state,{output:turn.diagnostics.generated_response});
  if (state.termination_reason && state.termination_reason !== 'max_turns') throw new Error(JSON.stringify(state.failures));
  return {decision, turn:clone(state.turns.at(-1)),session_after:clone(state.session)};
}
module.exports = {fixture,replay};
