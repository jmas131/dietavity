'use strict';
// Replays recorded model boundaries. It does not invoke a model, Judge, database,
// production workflow or messaging provider, and is not autonomous acceptance.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {fixture,replay,baselineRuntime} = require('../test-support/ticket-53/replay');
const {buildHarness} = require('./generate-ticket-48-harness');
const {library} = require('../test-support/ticket-48/runner');
const production = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const output = path.join(__dirname,'../outputs/ticket-53');
fs.mkdirSync(output,{recursive:true});
const reports = fixture.reports.map(report => ({
  scenario: report.scenario_label, run_id: report.run_id, scenario_id:report.scenario_id,
  recorded_termination:report.termination_reason, recorded_judge_status:report.judge_status,
  // Original Judge output is provenance, never reused as a verdict on changed replies.
  recorded_judge_failure:report.failures.filter(f=>f.stage==='judge'),
  turns:report.turns.map(incident => {
    const baseline = replay(report,incident,baselineRuntime);
    const current = replay(report,incident);
    return {turn:incident.turn,customer_message:incident.customer_message,session_before:incident.session_before,
      recorded_at:incident.recorded_at,interpretation:incident.diagnostics.interpretation,
      generated_draft:incident.diagnostics.generated_response,
      recorded_response:incident.final_dietavity_response,
      baseline_response:baseline.turn.final_dietavity_response,
      baseline_exact_match:baseline.turn.final_dietavity_response === incident.final_dietavity_response,
      baseline_failed_assertions:baseline.turn.assertions.filter(a=>a.status==='FAIL'),
      current_response:current.turn.final_dietavity_response,
      current_strategy:current.decision.strategy,current_topic:current.decision.topic,
      current_fallback:current.turn.diagnostics.fallback_identity,
      unknown_details_preserved:current.turn.diagnostics.current_question_details_preserved,
      unconfirmed_question_count:current.turn.diagnostics.unconfirmed_current_question_count,
      current_failures:current.state.failures,
      current_failed_assertions:current.turn.assertions.filter(a=>a.status==='FAIL')};
  })
}));
const turns=reports.flatMap(r=>r.turns);
const summary={scenarios:reports.length,recorded_turns:turns.length,
  baseline_exact_matches:turns.filter(t=>t.baseline_exact_match).length,
  current_execution_failures:turns.reduce((n,t)=>n+t.current_failures.length,0),
  current_assertion_failures:turns.reduce((n,t)=>n+t.current_failed_assertions.length,0),
  unknown_detail_responses:turns.filter(t=>t.unknown_details_preserved).length};
fs.writeFileSync(path.join(output,'exact-replay-comparison.json'),JSON.stringify({
  validation_mode:'RECORDED_MODEL_OUTPUT_REPLAY_NOT_AUTONOMOUS_AI',source:fixture.source,
  current_artifact_sha256:crypto.createHash('sha256').update(JSON.stringify(production)).digest('hex'),
  summary,reports},null,2)+'\n');
const harness=buildHarness(production);
harness.name='Dietavity Ticket 53 Isolated Eight-Scenario Acceptance';
harness.nodes.find(n=>n.name==='Load Test Scenario').parameters.jsCode=
  `return [{json:${JSON.stringify({target:'sales',scenario_ids:library.map(s=>s.scenario_id),max_customer_turns:12})}}];`;
fs.writeFileSync(path.join(output,'inactive-eight-scenario-harness.json'),JSON.stringify(harness,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if(summary.baseline_exact_matches!==summary.recorded_turns || summary.current_execution_failures || summary.current_assertion_failures) process.exitCode=1;
