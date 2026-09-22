'use strict';
// Run with a temporary DIETAVITY_PGLITE_PATH. Actual generated SQL and Code nodes
// execute locally; model outputs are fixtures, not a claimed live n8n/OpenAI run.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {PGlite} = require(process.env.DIETAVITY_PGLITE_PATH);
const workflow = require('../n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json');
const node = name => workflow.nodes.find(n => n.name === name);
const policy = require('../lib/sales-engine-v3');
let db;
let turnNumber = 0;
const readSession = async sessionId => (await db.query('SELECT * FROM onboarding_sessions WHERE session_id=$1', [sessionId])).rows[0];
const state = async () => ({
  sessions: (await db.query('SELECT * FROM onboarding_sessions ORDER BY session_id')).rows,
  memory: (await db.query('SELECT * FROM onboarding_chat_memory ORDER BY session_id,created_at,id')).rows,
});
function context(input, records) {
  return {$input:{first:()=>({json:input})}, $json:input, $:name=>({item:{json:records[name] || {}}})};
}
function code(name, input, records) {
  const result = vm.runInNewContext(`(function(){${node(name).parameters.jsCode}})()`,context(input,records))[0].json;
  records[name] = result;
  return result;
}
async function sql(name, input, records) {
  const parameters = node(name).parameters;
  const payload = vm.runInNewContext(parameters.options.queryReplacement.slice(3,-2),context(input,records));
  const rows = (await db.query(parameters.query,[payload])).rows;
  const result = rows[0] || {};
  records[name] = result;
  return result;
}
async function send(fake, message, interpretation = {}, generated = 'Respuesta ilustrativa.') {
  const records = {'When chat message received':{chatInput:message, action:'sendMessage'}};
  const input = code('Set Session Id',{fake_whatsapp_id:fake},records);
  let session = await sql('Get Onboarding Session',input,records);
  records['If Existing Onboarding Session'] = session;
  if (!session.session_id) session = await sql('Initialize Sales Lead v3',input,records);
  code('Build Canonical Dietavity Knowledge',session,records);
  code('Parse Sales Interpretation',{output:JSON.stringify({interpretation_valid:true,buyer_signal:'question',...interpretation})},records);
  const recent = await sql('Get Recent Sales Clarification Context',{},records);
  const decision = code('Apply Deterministic Commercial Policy',recent,records);
  const rules = node('Route Authorized Sales Action').parameters.rules.values;
  const outputIndex = rules.findIndex(rule => {
    const condition = rule.conditions.conditions[0];
    return vm.runInNewContext(condition.leftValue.slice(3,-2),context(decision,records)) === condition.rightValue;
  });
  const target = workflow.connections['Route Authorized Sales Action'].main[outputIndex < 0 ? 4 : outputIndex][0].node;
  if (target === 'Intercept External Action') return {report:code(target,decision,records), records};
  assert.equal(target,'Build Constrained Sales Response');
  code(target,decision,records);
  // The canonical memory subnode writes a human/AI pair. Substitute that model
  // boundary locally, leaving all business logic and SQL unmocked.
  turnNumber++;
  for (const [type,content] of [['human',message],['ai',generated]]) {
    await db.query(`INSERT INTO onboarding_chat_memory(session_id,message,created_at)
      VALUES ($1,$2, '2026-09-13'::timestamptz + $3::integer * INTERVAL '1 second')`,
    [input.session_id,JSON.stringify({type,content,additional_kwargs:{fixture:'preserved'}}),turnNumber]);
  }
  code('Validate Sales Response Contract',{output:generated},records);
  const persisted = await sql('Persist Harness Response State',{},records);
  return {report:code('Return Chat Response',persisted,records),records};
}
before(async () => {
  db = new PGlite();
  const schema = fs.readFileSync(require.resolve('../database/schema.sql'),'utf8');
  for (const table of ['onboarding_sessions','onboarding_chat_memory']) {
    await db.exec(schema.match(new RegExp(`CREATE TABLE public.${table} \\([\\s\\S]*?\\n\\);`))[0]);
  }
  await db.exec('ALTER TABLE onboarding_sessions ADD PRIMARY KEY(session_id); ALTER TABLE onboarding_chat_memory ADD PRIMARY KEY(id);');
  // No messages, users, Stripe, email, or event tables exist: accidental access fails.
  // Even the phone-shaped identities themselves are protected from test writes.
  await db.exec(`INSERT INTO onboarding_sessions(session_id,goal) VALUES ('+5215554111111','real sentinel'),('+5215554222222','real sentinel');
    INSERT INTO onboarding_chat_memory(session_id,message) VALUES ('+5215554111111','{"type":"ai","data":{"content":"real sentinel"}}');`);
});
after(async () => {if (db) await db.close();});
test('requested six-turn GLP-1 sequence retains canonical context and intercepts Checkout without payment or ledger tables', async () => {
  const fake = '+5215554111111';
  const cases = [
    ['¡Hola! Quiero saber más.',{buyer_signal:'broad_information_request'},'incorrect model greeting'],
    ['Se me complica saber qué comer porque tengo poco apetito.',{buyer_signal:'question',topic:'diet_support',material_question:true,goal_supplied:true,goal:'poco apetito'},'Podemos ayudarte con ideas de comidas sencillas y nutritivas para organizar tu día.'],
    ['¿Cuánto cuesta?',{topic:'price',material_question:true},'incorrect price'],
    ['¿Y qué incluye?',{topic:'what_is_included',material_question:true},'incorrect inclusion'],
    ['¿Debo bajar mi dosis?',{topic:'health_scope',material_question:true},'Baja tu dosis.'],
    ['Quiero comprarlo.',{buyer_signal:'explicit_purchase'},'unused'],
  ];
  let previousReply;
  for (let i=0;i<cases.length;i++) {
    const [message,interpretation,raw] = cases[i];
    const before = await state();
    const {report,records} = await send(fake,message,interpretation,raw);
    assert.equal(report.session_id,'ticket41a:'+fake);
    assert.equal(report.offer_context,'glp1_validation');
    assert.equal(report.offer_version,'28d-149-v1');
    assert.equal((await readSession(report.session_id)).offer_context,'glp1_validation');
    assert.equal(report.checkout_would_be_created,i===5);
    if (i===0) {
      assert.equal(report.assistant_response,'¡Hola! 😊 Claro. ¿Qué es lo que más se te está complicando con la comida desde que empezaste a usarlo?');
      assert.doesNotMatch(report.assistant_response,/149|Checkout/);
    }
    if (i===1) {
      assert.match(report.assistant_response, /huevo o frijoles/);
      assert.doesNotMatch(report.assistant_response, /enlace|preferencias|restricciones/);
    }
    if (i===2) assert.match(report.assistant_response,/149 MXN/);
    if (i===3) assert.match(report.assistant_response,/desayuno, comida, cena y snack/);
    if (i===4) assert.match(report.assistant_response,/profesional que te lo prescribió/);
    if (i===5) {
      assert.match(report.assistant_response,/No Stripe session/);
      assert.deepEqual(await state(),before);
      assert.equal((await readSession(report.session_id)).checkout_session_id,null);
    } else {
      const memory = (await db.query(`SELECT message FROM onboarding_chat_memory WHERE session_id=$1 AND message->>'type'='ai' ORDER BY created_at DESC LIMIT 1`,[report.session_id])).rows[0].message;
      assert.equal(memory.content,report.output);
      assert.equal(memory.additional_kwargs.ticket41a_final,true);
      assert.equal(memory.additional_kwargs.fixture,'preserved');
    }
    if(i>0) assert.equal(records['Get Recent Sales Clarification Context'].recent_sales_assistant_message, previousReply);
    previousReply = report.assistant_response;
  }
  assert.equal((await readSession(fake)).goal,'real sentinel');
});
test('second fake identity has independent NULL context and unchanged generic response, including contextual billing state', async () => {
  const fake = '+5215554222222';
  const {report} = await send(fake,'¡Hola! Quiero más información.',{buyer_signal:'broad_information_request'});
  assert.equal(report.offer_context,null);
  assert.equal(report.assistant_response,policy.CANONICAL_INITIAL_BROAD_INFORMATION_RESPONSE);
  assert.equal((await readSession(report.session_id)).offer_context,null);
  const price = await send(fake,'¿Cuánto cuesta?',{topic:'price',material_question:true});
  assert.equal(price.report.offer_context,null);
  assert.match(price.report.assistant_response,/149 MXN/);
  const weak = await send(fake,'ok',{buyer_signal:'ambiguous_acknowledgement'});
  assert.equal(weak.report.checkout_would_be_created,false);
  assert.equal((await readSession(fake)).goal,'real sentinel');
});
test('missing AI memory produces a genuine transactional error and rolls back response-state changes', async () => {
  const sessionId = 'ticket41a:+5215554222222';
  await db.query('DELETE FROM onboarding_chat_memory WHERE session_id=$1',[sessionId]);
  const previous = await readSession(sessionId);
  const decision = {session_id:sessionId,pending_action:'respond',conversation_stage:'closed',goal:'would change',output:'test'};
  const records = {'Validate Sales Response Contract':decision};
  await assert.rejects(sql('Persist Harness Response State',{},records),/division by zero/);
  assert.deepEqual(await readSession(sessionId),previous);
});
test('nested legacy memory is finalized without losing metadata; unfinished history blocks the next model turn', async () => {
  const sessionId = 'ticket41a:+5215554222222';
  const inserted = await db.query(`INSERT INTO onboarding_chat_memory(session_id,message) VALUES ($1,$2) RETURNING id`,
    [sessionId, JSON.stringify({type:'ai',data:{content:'raw',additional_kwargs:{keep:true}}})]);
  const records = {'Set Session Id':{session_id:sessionId},'Validate Sales Response Contract':{
    session_id:sessionId,output:'Final validated reply',conversation_stage:'evaluating',pending_action:'respond'}};
  await assert.rejects(sql('Get Recent Sales Clarification Context',{},records), /division by zero/);
  await sql('Persist Harness Response State',{},records);
  const memory = (await db.query('SELECT message FROM onboarding_chat_memory WHERE id=$1',[inserted.rows[0].id])).rows[0].message;
  assert.equal(memory.data.content,'Final validated reply');
  assert.equal(memory.data.additional_kwargs.ticket41a_final,true);
  assert.equal(memory.data.additional_kwargs.keep,true);
  assert.equal((await sql('Get Recent Sales Clarification Context',{},records)).recent_sales_assistant_message,'Final validated reply');
});
test('flat memory with absent or null kwargs is corrected and unfinished flat history is rejected', async () => {
  const sessionId = 'ticket41a:+5215554222222';
  for (const additional_kwargs of [undefined, null]) {
    await db.query('DELETE FROM onboarding_chat_memory WHERE session_id=$1',[sessionId]);
    await db.query('INSERT INTO onboarding_chat_memory(session_id,message) VALUES ($1,$2)',
      [sessionId,JSON.stringify({type:'ai',content:'raw',additional_kwargs})]);
    const records = {'Set Session Id':{session_id:sessionId},'Validate Sales Response Contract':{
      session_id:sessionId,output:'Validated',conversation_stage:'evaluating',pending_action:'respond'}};
    await assert.rejects(sql('Get Recent Sales Clarification Context',{},records), /division by zero/);
    await sql('Persist Harness Response State',{},records);
    const memory = (await db.query('SELECT message FROM onboarding_chat_memory WHERE session_id=$1',[sessionId])).rows[0].message;
    assert.equal(memory.content,'Validated');
    assert.deepEqual(memory.additional_kwargs,{ticket41a_final:true});
    assert.equal((await sql('Get Recent Sales Clarification Context',{},records)).recent_sales_assistant_message,'Validated');
  }
});
test('cleanup deletes only exact namespaced test records and is safe to repeat', async () => {
  await db.exec("INSERT INTO onboarding_sessions(session_id,goal) VALUES ('ticket41a:unrelated','leave intact')");
  const cleanup = fs.readFileSync(require.resolve('../database/cleanup-ticket-41a-test-sessions.sql'),'utf8');
  await db.exec(cleanup);
  await db.exec(cleanup);
  assert.equal(await readSession('ticket41a:+5215554111111'),undefined);
  assert.equal(await readSession('ticket41a:+5215554222222'),undefined);
  assert.equal((await readSession('+5215554111111')).goal,'real sentinel');
  assert.equal((await readSession('+5215554222222')).goal,'real sentinel');
  assert.equal((await readSession('ticket41a:unrelated')).goal,'leave intact');
  const remaining = (await db.query('SELECT session_id FROM onboarding_chat_memory')).rows;
  assert.deepEqual(remaining,[{session_id:'+5215554111111'}]);
});
