'use strict';
const fs = require('node:fs');
const {replay,acceptanceBaselineRuntime} = require('../test-support/ticket-55/replay');
const fixture = require('../test-support/ticket-55/fresh-f-incidents.json');
const {currentQuestionClauses,currentQuestionDetails,explicitProductQuestions} = require('../lib/sales-response-contract');
const {taskProductMessage} = require('../lib/sales-conversational-task');
const {MULTI_TOPIC_ANSWERS} = require('../lib/dietavity-knowledge');
const report = fixture.report;
const turns = report.turns.map(recorded => {
  const before = replay(report,recorded,acceptanceBaselineRuntime);
  const after = replay(report,recorded);
  const task = recorded.diagnostics.interpretation.current_task;
  const beforeProductMessage = task ? recorded.customer_message.replace(task.request,'') : recorded.customer_message;
  const afterProductMessage = taskProductMessage(recorded.customer_message,task);
  return {turn:recorded.turn,customer_message:recorded.customer_message,
    recorded_interpretation:recorded.diagnostics.interpretation,
    extracted_current_task:task,
    raw_current_question_clauses:currentQuestionClauses(recorded.customer_message),
    before_product_message:beforeProductMessage,
    before_product_details:currentQuestionDetails(beforeProductMessage,MULTI_TOPIC_ANSWERS),
    after_product_message:afterProductMessage,
    after_product_topics:explicitProductQuestions(afterProductMessage),
    generated_response:recorded.diagnostics.generated_response,
    generated_question_count:(recorded.diagnostics.generated_response.match(/\?/g)||[]).length,
    baseline_exact_match:before.turn.final_dietavity_response === recorded.final_dietavity_response,
    before_validation:{strategy:before.decision.strategy,fallback:before.turn.diagnostics.fallback_identity,
      task_coverage:before.turn.diagnostics.current_task_coverage},
    before_final_customer_visible_response:before.turn.final_dietavity_response,
    after_validation:{strategy:after.decision.strategy,fallback:after.turn.diagnostics.fallback_identity,
      task_coverage:after.turn.diagnostics.current_task_coverage},
    after_final_customer_visible_response:after.turn.final_dietavity_response,
    after_execution_failures:after.state.failures,
    after_failed_assertions:after.turn.assertions.filter(a=>a.status==='FAIL')};
});
const summary = {recorded_turns:turns.length,baseline_exact_matches:turns.filter(t=>t.baseline_exact_match).length,
  current_execution_failures:turns.reduce((n,t)=>n+t.after_execution_failures.length,0),
  current_assertion_failures:turns.reduce((n,t)=>n+t.after_failed_assertions.length,0)};
fs.writeFileSync('outputs/ticket-55/acceptance-followup-trace.json',JSON.stringify({
  validation_mode:'EXACT_RECORDED_MODEL_BOUNDARIES_NOT_FRESH_AUTONOMOUS_ACCEPTANCE',source:fixture.source,
  run_id:report.run_id,summary,turns},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if(summary.baseline_exact_matches!==turns.length || summary.current_execution_failures || summary.current_assertion_failures) process.exitCode=1;
