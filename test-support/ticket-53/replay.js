'use strict';
const {createRuntime} = require('../ticket-48/runner');
const fixture = require('./eight-scenario-incidents.json');
const clone = value => JSON.parse(JSON.stringify(value));
function replay(report, turn, runtimeFactory = createRuntime) {
  const instant = Date.parse(turn.recorded_at);
  class RecordedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  }
  const h = runtimeFactory({Date: RecordedDate});
  let state = h.initialize({target:'sales',scenario_ids:[report.scenario_id]},report.run_id);
  state.session = clone(turn.session_before);
  state.transcript = clone(report.transcript.slice(0,turn.turn - 1));
  state.turns = clone(report.turns.slice(0,turn.turn - 1));
  state.customer = {customer_message:turn.customer_message,outcome:'continue'};
  state = h.prepareInterpretation(state);
  state = h.decide(state,{output:JSON.stringify(turn.diagnostics.interpretation)});
  state = h.capture(state,{output:turn.diagnostics.generated_response});
  return {state, turn: state.turns.at(-1), decision:state.decision};
}
module.exports = {fixture,replay};
function baselineRuntime(options = {}) {
  const fs = require('node:fs');
  const vm = require('node:vm');
  return vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'baseline-runtime.js.txt'),'utf8'),
    {Date:options.Date || Date},{timeout:5000});
}
module.exports.baselineRuntime = baselineRuntime;
