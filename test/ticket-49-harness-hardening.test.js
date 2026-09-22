'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {run,createRuntime,fixtureModel,judgeFixture,library}=require('../test-support/ticket-48/runner');
const production=require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const generated=require('../n8n/Dietavity Autonomous Conversation Harness (Ticket 48).json');
const cfg=(max=1)=>({target:'sales',scenario_ids:['context_switching_001'],max_customer_turns:max});
const start=library.find(s=>s.scenario_id==='context_switching_001').starting_message;
const output=value=>({output:JSON.stringify(value)});
const customer=(message=start)=>({customer_message:message,outcome:'continue'});

test('Ticket 49 unambiguous Customer extraction and normalization require no repair call',async()=>{
  const value=customer();
  for(const result of [{output:`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``},
    {output:`Here is the JSON: ${JSON.stringify(value)} End.`},{output:`${JSON.stringify(value)}\nDone.`},
    {output:value},output({...value,outcome:' CONTINUE '})]) {
    const fixture=fixtureModel(),calls=[];
    const r=(await run(cfg(),async req=>{calls.push(req.role);return req.role==='customer'?result:fixture(req);})).reports[0];
    assert.equal(r.conversation_execution_status,'PASS');assert.equal(r.customer_agent_status,'PASS');
    assert.equal(r.termination_reason,'max_turns');assert.equal(r.turn_count,1);
    assert.ok(!calls.includes('customer_repair'));assert.equal(r.costs.model_call_count,4);
    assert.equal(r.repairs[0].method,'deterministic_normalization');
  }
});

test('Ticket 49 ambiguous, truncated and wrong-shape Customer output gets exactly one safe repair',async()=>{
  for(const bad of ['{"customer_message":', `${JSON.stringify(customer())}\n${JSON.stringify(customer('different'))}`,
    `{"customer_message":${JSON.stringify(start)},"outcome":"continue","outcome":"customer_rejection"}`,
    JSON.stringify([customer()]), JSON.stringify({...customer(),outcome:'done'}), JSON.stringify({...customer(),internal:'not allowed'})]) {
    const fixture=fixtureModel();let repairs=0;
    const r=(await run(cfg(),req=>{
      if(req.role==='customer')return {output:bad};
      if(req.role==='customer_repair') {
        repairs++;const p=JSON.parse(req.input);
        assert.equal(p.customer_context.starting_message,start);assert.deepEqual(p.customer_context.conversation,[]);
        assert.deepEqual(Object.keys(p).sort(),['customer_context','invalid_output']);
        assert.doesNotMatch(JSON.stringify(p.customer_context),/buyer_signal|offer_context|session_id|generated_response|expected_answer|last_question_type/);
        return output(customer());
      }
      return fixture(req);
    })).reports[0];
    assert.equal(repairs,1);assert.equal(r.termination_reason,'max_turns');assert.equal(r.status,'PASS');
    assert.equal(r.repairs[0].method,'model_repair');assert.equal(r.costs.model_call_count,5);
  }
});

test('Ticket 49 Customer failure after three valid turns preserves transcript and is not a Sales failure',async()=>{
  const fixture=fixtureModel();let repairCalls=0,judgeTranscript;
  const result=await run(cfg(12),req=>{
    if(req.role==='customer' && JSON.parse(req.input).conversation.length===3)return {output:'invalid'};
    if(req.role==='customer_repair'){repairCalls++;return {output:'still invalid'};}
    if(req.role==='judge')judgeTranscript=JSON.parse(req.input).transcript;
    return fixture(req);
  });
  const r=result.reports[0];
  assert.equal(repairCalls,1);assert.equal(r.termination_reason,'customer_output_failure');
  assert.equal(r.customer_agent_status,'customer_output_failure');assert.equal(r.sales_engine_status,'PASS');
  assert.equal(r.conversation_execution_status,'FAIL');assert.equal(r.deterministic_status,'PASS');
  assert.equal(r.judge_status,'PASS');assert.equal(r.turn_count,3);assert.deepEqual(judgeTranscript,r.transcript);
  assert.equal(result.summary.sales_engine_failures,0);assert.equal(result.summary.customer_output_failures,1);
  assert.equal(r.failed_turn,null);
});

test('Ticket 49 malformed Judge output can be repaired with complete valid transcript and no engine internals',async()=>{
  const fixture=fixtureModel();let original,repairCalls=0;
  const r=(await run(cfg(3),req=>{
    if(req.role==='judge'){original=JSON.parse(req.input);return {output:'{"termination_reason":'};}
    if(req.role==='judge_repair') {
      repairCalls++;const p=JSON.parse(req.input);
      assert.deepEqual(p.evaluation_context,original);
      assert.equal(p.evaluation_context.transcript.length,3);
      assert.doesNotMatch(JSON.stringify(p.evaluation_context.transcript),/generated_response|fallback_identity|buyer_signal|session_id/);
      return output(judgeFixture(p.evaluation_context));
    }
    return fixture(req);
  })).reports[0];
  assert.equal(repairCalls,1);assert.equal(r.judge_status,'PASS');assert.equal(r.sales_engine_status,'PASS');
  assert.equal(r.conversation_execution_status,'PASS');assert.equal(r.termination_reason,'max_turns');
  assert.equal(r.repairs.at(-1).method,'model_repair');assert.equal(r.evaluation_failure,null);
});

test('Ticket 49 safe Judge boolean/index normalization does not invent missing fields or evidence',async()=>{
  const fixture=fixtureModel();
  const r=(await run(cfg(),req=>{
    if(req.role!=='judge')return fixture(req);
    return {output:'Result:\n'+JSON.stringify({...judgeFixture(JSON.parse(req.input)),lost_context:'false',
      current_questions_answered:'true',evidence:[{turn:'1',observation:'Answered the current price question.'}]})};
  })).reports[0];
  assert.equal(r.judge_status,'PASS');assert.equal(r.judge.lost_context,false);assert.equal(r.judge.evidence[0].turn,1);
  assert.equal(r.costs.model_call_count,4);assert.equal(r.repairs.at(-1).method,'deterministic_normalization');
});

test('Ticket 49 failed Judge repair leaves conversation termination, assertions and Sales success intact',async()=>{
  const fixture=fixtureModel(),calls=[];
  const result=await run(cfg(3),req=>{calls.push(req.role);return /^judge/.test(req.role)?{output:'{}'}:fixture(req);});
  const r=result.reports[0];
  assert.equal(calls.filter(r=>r==='judge_repair').length,1);
  assert.equal(r.judge_status,'judge_output_failure');assert.equal(r.evaluation_failure,'judge_output_failure');
  assert.equal(r.termination_reason,'max_turns');assert.equal(r.conversation_execution_status,'PASS');
  assert.equal(r.sales_engine_status,'PASS');assert.equal(r.customer_agent_status,'PASS');assert.equal(r.deterministic_status,'PASS');
  assert.equal(r.turn_count,3);assert.equal(r.transcript.length,3);assert.equal(r.judge,null);
  assert.equal(result.summary.judge_output_failures,1);assert.equal(result.summary.sales_engine_failures,0);
});

test('Ticket 49 Judge flags unanswered current questions as diagnosable defects without misclassifying infrastructure',async()=>{
  const fixture=fixtureModel();
  const r=(await run(cfg(),req=>req.role==='judge'?output({...judgeFixture(JSON.parse(req.input)),current_questions_answered:false,
    evidence:[{turn:1,observation:'The explicit price question was ignored.'}]}):fixture(req))).reports[0];
  assert.equal(r.judge_status,'PASS');assert.equal(r.conversation_execution_status,'PASS');assert.equal(r.status,'FAIL');
  assert.ok(r.potential_defects.some(d=>d.finding==='current_questions_unanswered'));
});

test('Ticket 49 worst-case repairs are bounded at 50 calls and preserve the 12-turn cap',async()=>{
  const fixture=fixtureModel();
  const r=(await run(cfg(12),req=>{
    if(req.role==='customer'||req.role==='judge')return {output:'invalid'};
    if(req.role==='customer_repair'){
      const p=JSON.parse(req.input).customer_context;return output(customer(p.conversation.length?'ok':p.starting_message));
    }
    if(req.role==='judge_repair')return output(judgeFixture(JSON.parse(req.input).evaluation_context));
    return fixture(req);
  })).reports[0];
  assert.equal(r.turn_count,12);assert.equal(r.termination_reason,'max_turns');
  assert.equal(r.costs.model_call_count,50);assert.equal(r.costs.max_model_calls,50);
  assert.equal(r.repairs.filter(r=>r.role==='customer').length,12);assert.equal(r.repairs.filter(r=>r.role==='judge').length,1);
  const h=createRuntime();let s=h.initialize(cfg(),'guard');s=h.prepareCustomer(s);s=h.acceptCustomer(s,{output:'broken'});
  s=h.prepareCustomerRepair(s);assert.throws(()=>h.prepareCustomerRepair(s),/CUSTOMER_REPAIR_BUDGET_EXCEEDED/);
});

test('Ticket 49 brief_whatsapp preference is scoped to persona, observable and does not truncate stress turns',()=>{
  const h=createRuntime();assert.match(h.CUSTOMER_PROMPT,/one or two short sentences/);
  assert.match(h.CUSTOMER_PROMPT,/ONE primary question/);assert.match(h.CUSTOMER_PROMPT,/TWO closely related/);
  assert.match(h.CUSTOMER_PROMPT,/Do not accumulate/);assert.match(h.CUSTOMER_PROMPT,/NOT a checklist/);
  const long='¿Cuánto cuesta? ¿Qué incluye? ¿Aceptan OXXO?';
  for(const style of ['brief_whatsapp','stress_test']) {
    let s=h.initialize(cfg(),'style');s.scenario.persona.communication_style=style;s.scenario.starting_message=long;
    s=h.prepareCustomer(s);s=h.acceptCustomer(s,output(customer(long)));assert.equal(s.customer.customer_message,long);
    s=h.prepareInterpretation(s);s=h.decide(s,output({buyer_signal:'question',topic:'price',material_question:true}));
    s=h.capture(s,{output:'Cuesta $149 MXN, incluye desayuno, comida, cena y snack. Puedes pagar en OXXO.'});
    assert.equal(s.transcript[0].customer_message,long);
    assert.equal(s.warnings.some(w=>w.code==='BRIEF_WHATSAPP_STYLE_WARNING'),style==='brief_whatsapp');
  }
});

test('Ticket 54 coverage loss remains visible and now fails the clause coverage gate',async()=>{
  const broken=structuredClone(production);
  broken.nodes.find(n=>n.name==='Validate Sales Response Contract').parameters.jsCode =
    "if ($('Set Session Id').item.json.chatInput.includes('lo hace IA')) return [{json:{...$('Apply Deterministic Commercial Policy').item.json, output:'El servicio es digital.'}}];\n" + broken.nodes.find(n=>n.name==='Validate Sales Response Contract').parameters.jsCode;
  const fixture=fixtureModel();
  const r=(await run(cfg(2),req=>{
    if(req.role==='customer') {const p=JSON.parse(req.input);return output(customer(p.conversation.length?'¿Es digital, lo hace IA y cómo personalizan el plan?':p.starting_message));}
    if(req.role==='sales_response')return {output:'El servicio es digital. Usamos inteligencia artificial y consideramos tu estilo de alimentación y alergias.'};
    return fixture(req);
  },{production:broken})).reports[0];
  assert.ok(r.warnings.some(w=>w.code==='POSSIBLE_MULTI_TOPIC_COVERAGE_LOSS'));
  assert.equal(r.turns[1].diagnostics.multi_topic_turn,true);
  assert.equal(r.turns[1].diagnostics.generated_answer_coverage.covered_count,3);
  assert.equal(r.turns[1].diagnostics.final_answer_coverage.covered_count,1);
  assert.equal(r.deterministic_status,'FAIL');assert.equal(r.status,'FAIL');
  assert.ok(r.turns[1].assertions.some(a=>a.name==='current_clause_coverage' && a.status==='FAIL'));
});

test('Ticket 49 structured model transport is scoped to Customer/Judge and their bounded repairs',()=>{
  for(const name of ['Generate Customer Turn','Repair Customer Output','Generate Judge','Repair Judge Output']) {
    const n=generated.nodes.find(n=>n.name===`${name} Model`);
    assert.equal(n.parameters.options.responseFormat,'json_object');
    assert.equal(n.typeVersion,production.nodes.find(n=>n.name==='Sales Response Model').typeVersion);
  }
  assert.deepEqual(generated.nodes.find(n=>n.name==='Interpret Isolated Sales Turn Model').parameters,
    production.nodes.find(n=>n.name==='Sales Interpretation Model').parameters);
  assert.deepEqual(generated.nodes.find(n=>n.name==='Generate Isolated Sales Response Model').parameters,
    production.nodes.find(n=>n.name==='Sales Response Model').parameters);
  assert.equal(generated.active,false);
});

test('Ticket 49 actual generated graph executes each repair once and still produces a structured report',async()=>{
  const records={},compiled=new Map(),fixture=fixtureModel(),counts={};let current='Manual Trigger',steps=0,result;
  while(current) {
    assert.ok(++steps<300);const n=generated.nodes.find(n=>n.name===current);let branch=0;
    if(n.type.endsWith('.code')) {
      if(!compiled.has(current))compiled.set(current,new vm.Script(`(function(){${n.parameters.jsCode}})()`));
      result=compiled.get(current).runInNewContext({$input:{first:()=>({json:result})},$execution:{id:'repair_graph'},
        $:name=>({item:{json:records[name]}})},{timeout:5000})[0].json;
      if(current==='Load Test Scenario')result=cfg();
    } else if(n.type.endsWith('.agent')) {
      const role=result.calls.at(-1).role,p=JSON.parse(result.model_input);counts[role]=(counts[role]||0)+1;
      if(role==='customer'||role==='judge')result={output:'invalid'};
      else if(role==='customer_repair')result=output(customer(p.customer_context.starting_message));
      else if(role==='judge_repair')result=output(judgeFixture(p.evaluation_context));
      else result=await fixture({role,input:result.model_input,system:result.model_system});
    } else if(n.type.endsWith('.if'))branch=vm.runInNewContext(n.parameters.conditions.conditions[0].leftValue.slice(3,-2),{$json:result})?0:1;
    records[current]=result;current=generated.connections[current]?.main?.[branch]?.[0]?.node;
  }
  assert.equal(counts.customer_repair,1);assert.equal(counts.judge_repair,1);assert.equal(result.summary.passes,1);
  assert.equal(result.reports[0].costs.model_call_count,6);assert.equal(result.reports[0].isolation.database_writes,0);
  assert.equal(result.reports[0].isolation.external_customer_side_effects,0);
});
