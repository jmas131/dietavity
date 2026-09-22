'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {buildHarness, buildPrelude, canonicalNames, outputPath} = require('../scripts/generate-ticket-48-harness');
const production = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const {createRuntime, run, fixtureModel, judgeFixture, library} = require('../test-support/ticket-48/runner');
const workflow = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
const json = value => JSON.parse(JSON.stringify(value));
const config = (id = library[0].scenario_id, max = 12) => ({target: 'sales', scenario_ids: [id], max_customer_turns: max});
const output = obj => ({output: JSON.stringify(obj)});

test('Ticket 48 generated artifact matches source and embeds canonical engine nodes verbatim', () => {
  assert.deepEqual(workflow, buildHarness(production));
  const prelude = buildPrelude(production);
  for (const name of canonicalNames) assert.ok(prelude.includes(production.nodes.find(n => n.name === name).parameters.jsCode), name);
  const altered = structuredClone(production);
  altered.nodes.find(n => n.name === 'Apply Deterministic Commercial Policy').parameters.jsCode += '\nfetch("https://example.com");';
  assert.throws(() => buildHarness(altered), /Unsafe canonical capability/);
  const changedState = structuredClone(production);
  changedState.nodes.find(n => n.name === 'Persist Sales Response State and Events').parameters.query += '\n-- state changed';
  assert.throws(() => buildHarness(changedState), /review the Ticket 48 memory adapter/);
});

test('Ticket 48 graph has only manual, pure Code, IF and tool-free model calls; no production credentials or error workflow', () => {
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.errorWorkflow, undefined);
  assert.equal(workflow.settings.executionTimeout, 1800);
  const types = new Set(['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.code', 'n8n-nodes-base.if',
    '@n8n/n8n-nodes-langchain.agent', '@n8n/n8n-nodes-langchain.lmChatOpenAi']);
  for (const n of workflow.nodes) {
    assert.ok(types.has(n.type), n.name);
    if (n.credentials) assert.deepEqual(n.credentials, {openAiApi: {name: 'Dietavity Autonomous Harness OpenAI'}});
    if (n.type.endsWith('.agent')) {
      assert.equal(n.parameters.text, '={{ $json.model_input }}');
      assert.equal(n.parameters.options.systemMessage, '={{ $json.model_system }}');
      assert.equal(n.parameters.options.maxIterations, 1);
      assert.equal(n.retryOnFail, false);
    }
    if (n.type.endsWith('.code')) {
      assert.doesNotMatch(n.parameters.jsCode, /\b(?:require|fetch|eval|Function|process|globalThis|XMLHttpRequest)\s*[.(]|\$helpers|\$env|\$getWorkflowStaticData/);
    }
  }
  assert.equal(workflow.nodes.filter(n => n.type.endsWith('manualTrigger')).length, 1);
  const names = new Set(workflow.nodes.map(n => n.name));
  const reachable = new Set(['Manual Trigger']);
  for (let i=0; i<workflow.nodes.length; i++) {
    for (const [from, streams] of Object.entries(workflow.connections)) for (const [type, branches] of Object.entries(streams)) {
      assert.ok(['main', 'ai_languageModel'].includes(type));
      for (const edge of branches.flat()) {
        assert.ok(names.has(edge.node));
        if (reachable.has(from) || type === 'ai_languageModel' && reachable.has(edge.node)) {
          reachable.add(edge.node); if (type === 'ai_languageModel') reachable.add(from);
        }
      }
    }
  }
  assert.equal(reachable.size, names.size);
});

test('Ticket 48 scenario validation fails closed for targets, identities and batch/turn bounds', () => {
  const h = createRuntime();
  assert.equal(library.length, 8);
  for (const s of library) assert.deepEqual(json(h.validateScenario(s)), s);
  for (const c of [{...config(), target:'concierge'}, {...config(),scenario_ids:[]},
    {...config(),scenario_ids:Array(9).fill(library[0].scenario_id)}, {...config(),scenario_ids:['unknown']},
    {...config(),scenario_ids:[library[0].scenario_id,library[0].scenario_id]}, config(undefined,13),config(undefined,0),config(undefined,2.5)]) {
    assert.throws(() => h.initialize(c, 'safe_run'));
  }
  assert.throws(() => h.initialize(config(), '+5215554111111'), /INVALID_RUN_ID/);
  assert.throws(() => h.validateScenario({...library[0], offer_context:'custom-url'}), /UNSUPPORTED_OFFER_CONTEXT/);
  assert.throws(() => h.validateScenario({...library[0], persona:{}}), /INVALID_PERSONA/);
});

test('Ticket 48 customer gets only persona and final visible history; engine never gets hidden scenario', async () => {
  const h = createRuntime();
  let s = h.initialize(config(), 'isolation');
  s.decision = {buyer_signal:'SECRET_SIGNAL'};
  s.session.last_question_type = 'SECRET_QUESTION';
  s.generated_response = 'SECRET_DRAFT';
  s.scenario.expected_answer = 'SECRET_EXPECTATION';
  s.scenario.persona.internal_metadata = 'SECRET_PERSONA_METADATA';
  s.transcript = [{customer_message:'hola',final_dietavity_response:'Respuesta final', diagnostics:'SECRET_DIAGNOSTICS'}];
  s.turns = [{}];
  s = h.prepareCustomer(s);
  assert.doesNotMatch(s.model_input, /SECRET|offer_context|glp1_validation|last_question_type/);
  assert.deepEqual(Object.keys(JSON.parse(s.model_input)).sort(), ['behavior_constraints','conversation','hidden_objectives','persona','starting_message']);
  assert.deepEqual(JSON.parse(s.model_input).conversation, [{customer_message:'hola',final_dietavity_response:'Respuesta final'}]);
  s = h.acceptCustomer(s, output({customer_message:'Qué incluye?',outcome:'continue'}));
  s.scenario.hidden_objectives = ['SECRET_PRIVATE_OBJECTIVE'];
  s = h.prepareInterpretation(s);
  assert.doesNotMatch(s.model_input + s.model_system, /SECRET_PRIVATE_OBJECTIVE|hidden_objectives|budget_context/);
});

test('Ticket 48 single scenario reacts to final canonical responses for at least three turns and runs judge', async () => {
  const seen = [];
  const fixture = fixtureModel();
  const report = await run(config(), async req => {seen.push(req); return fixture(req);});
  const r = report.reports[0];
  assert.equal(r.status,'PASS');
  assert.equal(r.turn_count,4);
  assert.equal(r.termination_reason,'purchase_intent');
  assert.equal(r.turns[0].final_dietavity_response, '¡Hola! 😊 Claro. Dietavity te ayuda a organizar comidas sencillas y personalizadas durante 28 días, especialmente cuando estás comiendo menos. ¿Qué te gustaría saber?');
  assert.equal(r.turns[1].customer_message, '¿Cuánto cuesta?');
  assert.notEqual(r.turns[0].diagnostics.generated_response, r.turns[0].final_dietavity_response);
  assert.deepEqual(JSON.parse(seen.filter(s => s.role === 'customer')[1].input).conversation, r.transcript.slice(0,1));
  assert.equal(seen.filter(s => s.role === 'judge').length,1);
  assert.equal(r.turns.at(-1).diagnostics.holding_page_would_be_sent,true);
  assert.equal(r.turns.at(-1).diagnostics.checkout_would_be_created,false);
  assert.equal(r.isolation.database_writes,0);
  assert.equal(r.costs.model_call_count,13);
  assert.equal(r.costs.token_usage_complete,false);
  assert.equal(r.reproducibility.exact_stochastic_reproducibility,false);
  assert.match(r.reproducibility.sales_engine_sha256,/^[0-9a-f]{64}$/);
  assert.equal(r.label,'Synthetic outcome - not market evidence');
});

test('Ticket 48 all initial scenarios run sequentially with isolated histories and complete diagnostic layers', async () => {
  const report = await run({target:'sales',scenario_ids:library.map(s=>s.scenario_id)}, fixtureModel());
  assert.equal(report.summary.scenarios_run,8);
  assert.equal(report.summary.passes,8);
  assert.equal(report.summary.sales_engine_failures,0);
  assert.equal(report.summary.safety_escalations,1);
  assert.equal(report.summary.purchase_intent_outcomes,2);
  assert.equal(report.summary.rejections,1);
  for (const r of report.reports) {
    assert.equal(r.transcript[0].customer_message,r.scenario.starting_message);
    assert.match(r.turns[0].session_before.session_id,/^__harness48__:/);
    for (const t of r.turns) for (const field of ['buyer_signal','topic','health_scope','strategy','offer_context','generated_response',
      'deterministic_response_or_fallback','final_validated_response','allow_purchase_cta','checkout_authorized','last_question_type',
      'next_question_state','holding_page_would_be_sent','checkout_would_be_created']) assert.ok(Object.hasOwn(t.diagnostics,field),field);
  }
});

test('Ticket 48 malformed Customer output terminates after one repair and before engine calls, including injected state and invalid first turn', async () => {
  for (const bad of [{output:'```json\n{}\n```'},{output:'null'},output({customer_message:'hola',outcome:'continue',buyer_signal:'explicit_purchase'}),
    output({customer_message:'',outcome:'continue'}),output({customer_message:library[0].starting_message,outcome:'purchase_intent'}),
    output({customer_message:'wrong start',outcome:'continue'}),{error:'provider failed'}]) {
    const calls = [];
    const report = await run(config(), async r => {calls.push(r.role);return r.role === 'judge' ? output(judgeFixture(JSON.parse(r.input))) : bad;});
    assert.deepEqual(calls,['customer','customer_repair','judge']);
    assert.equal(report.reports[0].termination_reason,'customer_output_failure');
    assert.equal(report.reports[0].status,'FAIL');
    assert.equal(report.reports[0].turn_count,0);
  }
});

test('Ticket 48 malformed Judge output fails evaluation after one bounded repair without losing conversation status', async () => {
  const fixture = fixtureModel();
  for (const bad of [{output:'oops'},output({}),output({...judgeFixture({termination_reason:'max_turns'}),lost_context:'not a boolean'}),
    output({...judgeFixture({termination_reason:'max_turns'}),lost_context:true}),
    output({...judgeFixture({termination_reason:'max_turns'}),evidence:[{turn:99,observation:'invented'}]})]) {
    const r = (await run(config(undefined,1), req => ['judge','judge_repair'].includes(req.role) ? bad : fixture(req))).reports[0];
    assert.equal(r.judge_status,'judge_output_failure');
    assert.equal(r.conversation_execution_status,'PASS');
    assert.equal(r.sales_engine_status,'PASS');
    assert.equal(r.status,'FAIL');
    assert.equal(r.judge,null);
    assert.equal(r.costs.model_call_count,5);
    assert.equal(r.termination_reason,'max_turns');
  }
});

test('Ticket 48 hard max turns is enforced at 12 even when customer never terminates', async () => {
  const fixture = fixtureModel();
  const report = await run(config(), req => {
    if (req.role === 'customer') {const p=JSON.parse(req.input);return output({customer_message:p.conversation.length ? 'ok' : p.starting_message,outcome:'continue'});}
    return fixture(req);
  });
  const r=report.reports[0];
  assert.equal(r.termination_reason,'max_turns'); assert.equal(r.turn_count,12); assert.equal(r.costs.model_call_count,37);
  const h=createRuntime(); let s=h.initialize(config(undefined,1),'cap');s.turns=[{}];
  assert.throws(()=>h.prepareCustomer(s),/TURN_BUDGET_EXCEEDED/);
});

test('Ticket 48 engine model failure and malformed interpretation terminate safely and retain a pending customer message', async () => {
  for (const role of ['sales_interpretation','sales_response']) for (const bad of [{error:'SECRET_PROVIDER_TOKEN'}, {output:''}, {output:'null'}]) {
    const fixture=fixtureModel();
    const report=await run(config(), req=>req.role===role?bad:fixture(req));
    if (role==='sales_response' && bad.output==='null') {
      // Literal text is a draft; prove the canonical validator repairs it.
      assert.equal(report.reports[0].status,'PASS');
      assert.notEqual(report.reports[0].turns[0].final_dietavity_response,'null');
      continue;
    }
    const r=report.reports[0];assert.equal(r.termination_reason,'sales_engine_failure');assert.equal(r.status,'FAIL');
    assert.equal(r.pending_customer_message,library[0].starting_message);
    assert.doesNotMatch(JSON.stringify(report),/SECRET_PROVIDER_TOKEN/);
  }
});

test('Ticket 48 independent assertions detect forbidden transitions, leaks, question jobs, unsupported claims and repeated openers', () => {
  const h=createRuntime();const s=h.initialize(config('busy_customer_001'),'assert');s.customer={customer_message:'ok'};
  const checks=(d,text,action=null)=>Object.fromEntries(h.assertions(s,d,text,action).map(a=>[a.name,a.status]));
  assert.equal(checks({checkout_authorized:true},null,'send_checkout').qualifying_purchase_authorization,'FAIL');
  assert.equal(checks({offer_context:'glp1_validation',checkout_authorized:true},null,'send_checkout').glp1_holding_only,'FAIL');
  assert.equal(checks({},'').nonempty_response,'FAIL');
  assert.equal(checks({},'¿Quieres comprar? ¿Ahora?').at_most_one_question,'FAIL');
  assert.equal(checks({},'¿Quieres saber el precio o te muestro un ejemplo?').no_multiple_jobs,'FAIL');
  for (const text of ['glp1_validation','28d-149-v1','__harness48__:run:id']) assert.equal(checks({},text).no_internal_identifiers,'FAIL');
  assert.equal(checks({},'Baja tu dosis de medicamento').no_known_unsupported_claims,'FAIL');
  assert.equal(checks({},'Entregamos comida preparada').no_known_unsupported_claims,'FAIL');
  s.turns=[{}];assert.equal(checks({},'¡Hola! Te cuento de nuevo').no_repeated_generic_opener,'FAIL');
});

test('Ticket 48 generic Checkout is intercepted without inventing customer-visible payment text or URLs', async () => {
  const report=await run(config('busy_customer_001'),fixtureModel());const r=report.reports[0];const last=r.turns.at(-1);
  assert.equal(r.termination_reason,'purchase_intent');assert.equal(last.diagnostics.checkout_would_be_created,true);
  assert.equal(last.final_dietavity_response,null);assert.equal(last.diagnostics.generated_response,null);
  assert.equal(last.diagnostics.intercepted_action,'send_checkout');
  assert.equal(r.costs.model_call_count,12);
});

test('Ticket 48 in-memory question state preserves canonical contextual purchase and weak acknowledgements', async () => {
  const h=createRuntime();let s=h.initialize(config('busy_customer_001'),'context');
  s.session={...s.session,last_question_type:'purchase_confirmation',offer_version:'28d-149-v1',
    last_question_at:new Date().toISOString(),commercial_context_expires_at:new Date(Date.now()+60000).toISOString()};
  s.customer={customer_message:'ok',outcome:'continue'};s=h.prepareInterpretation(s);
  s=h.decide(s,output({buyer_signal:'contextual_affirmation'}));assert.equal(s.decision.checkout_authorized,false);
  s=h.capture(s,{output:'¿Quieres el enlace?'});assert.equal(s.session.last_question_type,'purchase_confirmation');
  assert.ok(Date.parse(s.session.commercial_context_expires_at)>Date.now());
  s.customer={customer_message:'sí',outcome:'continue'};s=h.prepareInterpretation(s);
  s=h.decide(s,output({buyer_signal:'contextual_affirmation'}));assert.equal(s.decision.checkout_authorized,true);
  s=h.capture(s,null);assert.equal(s.termination_reason,'purchase_intent');
});

test('Ticket 48 Judge findings remain diagnosable and model usage is counted when exposed', async () => {
  const fixture=fixtureModel();
  const report=await run(config(undefined,1),async req=> {
    const result=await fixture(req);result.usage={total_tokens:42};
    if(req.role==='judge') result.output=JSON.stringify({...judgeFixture(JSON.parse(req.input)),lost_context:true,evidence:[{turn:1,observation:'Fixture defect evidence'}]});
    return result;
  });
  const r=report.reports[0];assert.equal(r.status,'FAIL');assert.equal(r.judge_status,'PASS');
  assert.equal(r.potential_defects[0].finding,'lost_context');assert.equal(r.costs.known_total_tokens,168);assert.equal(r.costs.token_usage_complete,true);
});

// Execute the actual generated Code/IF graph, including loops and paired-item
// lookups, with synthetic model outputs. This supplements portable runner tests;
// it does not pretend to be an installed n8n runtime integration test.
test('Ticket 48 generated graph completes multi-scenario loops with current-run state', async () => {
  const records={},compiled=new Map();const model=fixtureModel();let current='Manual Trigger',steps=0,result;
  while(current) {
    assert.ok(++steps<500,'bounded graph execution');
    const n=workflow.nodes.find(n=>n.name===current);let branch=0;
    if(n.type.endsWith('.code')) {
      if(!compiled.has(current)) compiled.set(current,new vm.Script(`(function(){${n.parameters.jsCode}})()`));
      result=compiled.get(current).runInNewContext({$input:{first:()=>({json:result})},$execution:{id:'graph'},
        $:name=>({item:{json:records[name]}})},{timeout:5000})[0].json;
      if(current==='Load Test Scenario') result={target:'sales',scenario_ids:['curious_glp1_001','busy_customer_001']};
    } else if(n.type.endsWith('.agent')) {
      result=await model({role:result.calls.at(-1).role,system:result.model_system,input:result.model_input});
    } else if(n.type.endsWith('.if')) {
      const expr=n.parameters.conditions.conditions[0].leftValue.slice(3,-2);
      branch=vm.runInNewContext(expr,{$json:result})?0:1;
    } else assert.ok(n.type.endsWith('manualTrigger'));
    records[current]=result;
    current=workflow.connections[current]?.main?.[branch]?.[0]?.node;
  }
  assert.equal(result.summary.scenarios_run,2);assert.equal(result.summary.passes,2);
  assert.equal(result.reports[0].turn_count,4);assert.equal(result.reports[1].turn_count,4);
});


test('Ticket 48 canonical knowledge, policy and validator exceptions produce engine-failure reports and judge execution', async () => {
  for (const name of ['Build Canonical Dietavity Knowledge','Apply Deterministic Commercial Policy','Validate Sales Response Contract']) {
    const broken=structuredClone(production);
    broken.nodes.find(n=>n.name===name).parameters.jsCode = "throw new Error('SANITIZED_ENGINE_EXCEPTION');";
    const result=await run(config(),fixtureModel(),{production:broken});
    assert.equal(result.reports[0].termination_reason,'sales_engine_failure');
    assert.equal(result.reports[0].status,'FAIL');
    assert.equal(result.reports[0].costs.calls.at(-1).role,'judge');
    assert.ok(result.reports[0].failed_turn);
  }
});

test('Ticket 48 requested reminder is intercepted without a fabricated delivered reply', () => {
  const h=createRuntime();let s=h.initialize(config('busy_customer_001'),'reminder');
  s.customer={customer_message:'Recuérdame mañana por favor',outcome:'continue'};
  s=h.prepareInterpretation(s);
  s=h.decide(s,output({buyer_signal:'deferred_interest',explicit_reminder_request:true,timing_iso:new Date(Date.now()+86400000).toISOString()}));
  assert.equal(s.decision.pending_action,'schedule_requested_reminder');
  s=h.capture(s,null);
  assert.equal(s.termination_reason,'conversation_resolved');
  assert.equal(s.turns[0].diagnostics.intercepted_action,'schedule_requested_reminder');
  assert.equal(s.turns[0].final_dietavity_response,null);
  assert.equal(s.turns[0].diagnostics.checkout_would_be_created,false);
});
