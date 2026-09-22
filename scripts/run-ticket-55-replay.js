'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {fixture,replay,baselineRuntime,annotateTask} = require('../test-support/ticket-55/replay');
const {buildHarness} = require('./generate-ticket-48-harness');
const production = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const output = path.join(__dirname,'../outputs/ticket-55');
fs.mkdirSync(output,{recursive:true});
const reports = fixture.reports.map(report => ({scenario:report.scenario_label,run_id:report.run_id,
  recorded_judge_status:report.judge_status,
  turns:report.turns.map(recorded => {
    const baseline = replay(report,recorded,baselineRuntime);
    const task = report.scenario_label === 'F' && recorded.turn >= 10;
    const incident = task ? annotateTask(recorded) : recorded;
    const current = replay(report,incident);
    return {turn:recorded.turn,customer_message:recorded.customer_message,
      semantic_boundary:task ? 'LOCALLY_ANNOTATED_NEW_TASK_FIELD_NOT_FRESH_MODEL_OUTPUT' : 'RECORDED_INTERPRETATION',
      task_annotation:task ? incident.diagnostics.interpretation.current_task : null,
      generated_draft:recorded.diagnostics.generated_response,
      recorded_response:recorded.final_dietavity_response,
      baseline_exact_match:baseline.turn.final_dietavity_response === recorded.final_dietavity_response,
      baseline_response:baseline.turn.final_dietavity_response,
      current_response:current.turn.final_dietavity_response,
      current_task_coverage:current.turn.diagnostics.current_task_coverage,
      current_failures:current.state.failures,
      current_failed_assertions:current.turn.assertions.filter(a => a.status === 'FAIL')};
  })}));
const turns = reports.flatMap(r => r.turns);
const summary = {recorded_turns:turns.length,baseline_exact_matches:turns.filter(t => t.baseline_exact_match).length,
  annotated_task_turns:turns.filter(t => t.task_annotation).length,
  completed_tasks:turns.filter(t => t.current_task_coverage?.completed).length,
  current_execution_failures:turns.reduce((n,t) => n+t.current_failures.length,0),
  current_assertion_failures:turns.reduce((n,t) => n+t.current_failed_assertions.length,0)};
fs.writeFileSync(path.join(output,'recorded-replay-comparison.json'),JSON.stringify({
  validation_mode:'RECORDED_DRAFT_REPLAY_WITH_EXPLICIT_TASK_ANNOTATIONS_NOT_AUTONOMOUS_ACCEPTANCE',
  source:fixture.source,current_artifact_sha256:crypto.createHash('sha256').update(JSON.stringify(production)).digest('hex'),
  summary,reports},null,2)+'\n');
const harness = buildHarness(production);
harness.name = 'Dietavity Ticket 55 Isolated Scenario F';
harness.nodes.find(n => n.name === 'Load Test Scenario').parameters.jsCode =
  "return [{json:{target:'sales',scenario_ids:['busy_customer_001'],max_customer_turns:12}}];";
if (harness.active !== false || harness.settings.errorWorkflow) throw new Error('Harness isolation violation');
fs.writeFileSync(path.join(output,'inactive-scenario-f-harness.json'),JSON.stringify(harness,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if (summary.baseline_exact_matches !== summary.recorded_turns || summary.current_execution_failures || summary.current_assertion_failures) process.exitCode = 1;
