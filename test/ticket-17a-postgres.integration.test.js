'use strict';

// Run explicitly: LOCAL_SUPABASE_DB_URL=postgresql://... node --test test/ticket-17a-postgres.integration.test.js
// This suite never guesses a database and rejects non-loopback URLs.
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const url = process.env.LOCAL_SUPABASE_DB_URL;
const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/libpq/bin/psql';
const root = path.join(__dirname, '..');
const migration = path.join(root, 'database/migrations/20260923_ticket_17a_typed_conversational_output_metadata.sql');
const local = value => /^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(value || '');
function run(sql) { const r = spawnSync(psql, [url, '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); }
function rpc(id, op, type, task, key, anchor, lineage = []) { return `PERFORM public.persist_conversation_artifact('${JSON.stringify({ contract_version: '1.0', artifact_id: id, artifact_type: type, generation_operation: op, generation_task_id: task, logical_reply_key: key, anchor_message_id: anchor, lineage }).replaceAll("'", "''")}'::jsonb);`; }
function rejected(statement, name) { return `BEGIN ${statement} RAISE EXCEPTION '${name} accepted'; EXCEPTION WHEN SQLSTATE 'P0001' OR insufficient_privilege THEN NULL; END;`; }
test('Ticket 17A PostgreSQL integration matrix', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(local(url), true, 'refuses non-loopback database URL');
  run(`DROP TABLE IF EXISTS public.conversation_artifact_lineage, public.conversation_artifacts CASCADE; DROP TABLE IF EXISTS public.messages CASCADE; CREATE TABLE public.messages (id uuid PRIMARY KEY,direction text NOT NULL,idempotency_key text,in_reply_to_id uuid,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,delivery_status text,user_id uuid); \\i ${migration}; GRANT ALL ON TABLE public.messages TO service_role;`);
  run(`INSERT INTO public.messages VALUES
 ('00000000-0000-4000-8000-000000000001','inbound','in',NULL,'{}','received',NULL),
 ('00000000-0000-4000-8000-000000000101','outbound','r1','00000000-0000-4000-8000-000000000001','{"logical_reply_key":"r1","part_index":1,"part_count":2}','pending',NULL),
 ('00000000-0000-4000-8000-000000000102','outbound','r1:part:002','00000000-0000-4000-8000-000000000001','{"logical_reply_key":"r1","part_index":2,"part_count":2}','pending',NULL),
 ('00000000-0000-4000-8000-000000000201','outbound','r2','00000000-0000-4000-8000-000000000001','{"logical_reply_key":"r2","part_index":1,"part_count":1}','pending',NULL),
 ('00000000-0000-4000-8000-000000000301','outbound','r3','00000000-0000-4000-8000-000000000001','{"logical_reply_key":"r3","part_index":1,"part_count":1}','pending',NULL);
 SELECT public.persist_conversation_artifact('{"contract_version":"1.0","artifact_id":"ca-1","artifact_type":"draft","generation_operation":"draft","generation_task_id":"cgt-1","logical_reply_key":"r1","anchor_message_id":"00000000-0000-4000-8000-000000000101","lineage":[]}'::jsonb);
 DO $$ BEGIN ${rejected(rpc('ca-1','draft','draft','cgt-1','r1','00000000-0000-4000-8000-000000000101',['ca-x']),'changed retry')} ${rejected(rpc('ca-x','draft','draft','cgt-x','r2','00000000-0000-4000-8000-000000000201',['ca-1']),'draft lineage')} ${rejected(rpc('ca-x','transform','draft','cgt-x','r2','00000000-0000-4000-8000-000000000201',[]),'missing transform source')} ${rejected(rpc('ca-x','transform','draft','cgt-x','r2','00000000-0000-4000-8000-000000000201',['ca-x']),'self source')} END $$;
 SELECT public.persist_conversation_artifact('{"contract_version":"1.0","artifact_id":"ca-2","artifact_type":"draft","generation_operation":"transform","generation_task_id":"cgt-2","logical_reply_key":"r2","anchor_message_id":"00000000-0000-4000-8000-000000000201","lineage":["ca-1"]}'::jsonb);
 SELECT public.persist_conversation_artifact('{"contract_version":"1.0","artifact_id":"ca-3","artifact_type":"summary","generation_operation":"summarize","generation_task_id":"cgt-3","logical_reply_key":"r3","anchor_message_id":"00000000-0000-4000-8000-000000000301","lineage":["ca-1","ca-2"]}'::jsonb);
 SET ROLE service_role; DO $$ BEGIN
   BEGIN DELETE FROM public.conversation_artifacts; RAISE EXCEPTION 'direct delete allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN DELETE FROM public.messages WHERE id='00000000-0000-4000-8000-000000000101'; RAISE EXCEPTION 'anchored message delete allowed'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
   BEGIN PERFORM public.delete_message_with_conversation_artifacts_for_privacy('00000000-0000-4000-8000-000000000101'); RAISE EXCEPTION 'privacy deletion allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END $$; RESET ROLE;
 SELECT public.delete_message_with_conversation_artifacts_for_privacy('00000000-0000-4000-8000-000000000101');
 DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.conversation_artifacts) OR EXISTS(SELECT 1 FROM public.conversation_artifact_lineage) THEN RAISE EXCEPTION 'orphaned graph'; END IF; END $$;`);
});

test('Ticket 17A service role cannot mutate artifacts directly', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(local(url), true);
  run(`SET ROLE service_role; DO $$ BEGIN
    BEGIN INSERT INTO public.conversation_artifacts VALUES ('ca-no','1.0','draft','draft','cgt-no','no','00000000-0000-4000-8000-000000000201'); RAISE EXCEPTION 'insert allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN UPDATE public.conversation_artifacts SET artifact_type='summary'; RAISE EXCEPTION 'update allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN DELETE FROM public.conversation_artifacts; RAISE EXCEPTION 'delete allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END $$; RESET ROLE;`);
});

test('Ticket 17A rejects identity, source, and multipart conflicts atomically', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(local(url), true);
  run(`DO $$ DECLARE before_count integer; BEGIN
    SELECT count(*) INTO before_count FROM public.conversation_artifacts;
    ${rejected(rpc('ca-1','draft','draft','cgt-new','r-new','00000000-0000-4000-8000-000000000201',[]),'artifact collision')}
    ${rejected(rpc('ca-new','draft','draft','cgt-1','r-new','00000000-0000-4000-8000-000000000201',[]),'task collision')}
    ${rejected(rpc('ca-new','draft','draft','cgt-new','r1','00000000-0000-4000-8000-000000000201',[]),'logical collision')}
    ${rejected(rpc('ca-new','draft','draft','cgt-new','r-new','00000000-0000-4000-8000-000000000101',[]),'anchor collision')}
    ${rejected(rpc('ca-new','transform','draft','cgt-new','r-new','00000000-0000-4000-8000-000000000201',['ca-missing']),'missing source')}
    IF (SELECT count(*) FROM public.conversation_artifacts) <> before_count THEN RAISE EXCEPTION 'partial persistence'; END IF;
  END $$;`);
});

test('Ticket 17A rejects malformed multipart anchors and lineage variants', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(local(url), true);
  run(`INSERT INTO public.messages VALUES
 ('00000000-0000-4000-8000-000000000401','outbound','bad-1',NULL,'{"logical_reply_key":"bad-1","part_index":"1","part_count":1}','pending',NULL),
 ('00000000-0000-4000-8000-000000000402','outbound','bad-2',NULL,'{"logical_reply_key":"bad-2","part_index":1,"part_count":"1"}','pending',NULL),
 ('00000000-0000-4000-8000-000000000403','outbound','bad-3:part:002',NULL,'{"logical_reply_key":"bad-3","part_index":2,"part_count":2}','pending',NULL);
 DO $$ BEGIN
 ${rejected(rpc('ca-b1','draft','draft','cgt-b1','bad-1','00000000-0000-4000-8000-000000000401',[]),'string index')}
 ${rejected(rpc('ca-b2','draft','draft','cgt-b2','bad-2','00000000-0000-4000-8000-000000000402',[]),'string count')}
 ${rejected(rpc('ca-b3','draft','draft','cgt-b3','bad-3','00000000-0000-4000-8000-000000000403',[]),'non-first anchor')}
 END $$;`);
});

test('Ticket 17A preserves unrelated graph and leaves legacy message untyped', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(local(url), true);
  run(`INSERT INTO public.messages VALUES
   ('00000000-0000-4000-8000-000000000501','outbound','ga-1','00000000-0000-4000-8000-000000000001','{"logical_reply_key":"ga-1","part_index":1,"part_count":1}','pending',NULL),
   ('00000000-0000-4000-8000-000000000502','outbound','ga-2','00000000-0000-4000-8000-000000000001','{"logical_reply_key":"ga-2","part_index":1,"part_count":1}','pending',NULL),
   ('00000000-0000-4000-8000-000000000601','outbound','gb-1','00000000-0000-4000-8000-000000000001','{"logical_reply_key":"gb-1","part_index":1,"part_count":1}','pending',NULL),
   ('00000000-0000-4000-8000-000000000999','outbound',NULL,NULL,'{}','unknown',NULL);
   DO $$ BEGIN ${rpc('ca-ga1','draft','draft','cgt-ga1','ga-1','00000000-0000-4000-8000-000000000501',[])} ${rpc('ca-ga2','transform','draft','cgt-ga2','ga-2','00000000-0000-4000-8000-000000000502',['ca-ga1'])} ${rpc('ca-gb1','draft','draft','cgt-gb1','gb-1','00000000-0000-4000-8000-000000000601',[])} END $$;
   SELECT public.delete_message_with_conversation_artifacts_for_privacy('00000000-0000-4000-8000-000000000501');
   DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM public.conversation_artifacts WHERE artifact_id IN ('ca-ga1','ca-ga2')) OR EXISTS(SELECT 1 FROM public.conversation_artifact_lineage WHERE artifact_id IN ('ca-ga1','ca-ga2') OR source_artifact_id IN ('ca-ga1','ca-ga2')) THEN RAISE EXCEPTION 'deleted graph remains'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.conversation_artifacts WHERE artifact_id='ca-gb1') THEN RAISE EXCEPTION 'unrelated graph removed'; END IF;
    IF EXISTS(SELECT 1 FROM public.conversation_artifacts WHERE anchor_message_id='00000000-0000-4000-8000-000000000999') THEN RAISE EXCEPTION 'legacy promoted'; END IF;
   END $$;`);
});

test('Ticket 17A rejects duplicate lineage and a transitive cycle without partial rows', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, () => {
  assert.equal(local(url), true);
  run(`DO $$ BEGIN ${rejected(rpc('ca-dup','transform','draft','cgt-dup','r2','00000000-0000-4000-8000-000000000201',['ca-1','ca-1']),'duplicate source')} END $$;
  INSERT INTO public.conversation_artifacts VALUES ('ca-cycle-a','1.0','draft','transform','cgt-cycle-a','cycle-a','00000000-0000-4000-8000-000000000201'),('ca-cycle-b','1.0','draft','transform','cgt-cycle-b','cycle-b','00000000-0000-4000-8000-000000000301');
  INSERT INTO public.conversation_artifact_lineage VALUES ('ca-cycle-a','ca-cycle-b',1);
  DO $$ BEGIN ${rejected(rpc('ca-cycle-b','transform','draft','cgt-cycle-b','cycle-b','00000000-0000-4000-8000-000000000301',['ca-cycle-a']),'transitive cycle')} END $$;`);
});

test('Ticket 17A concurrent conflicting writers leave one canonical result', { skip: !url ? 'LOCAL_SUPABASE_DB_URL is required' : false }, async () => {
  assert.equal(local(url), true);
  run(`INSERT INTO public.messages VALUES ('00000000-0000-4000-8000-000000000701','outbound','race','00000000-0000-4000-8000-000000000001','{"logical_reply_key":"race","part_index":1,"part_count":1}','pending',NULL);`);
  const body = id => `SELECT public.persist_conversation_artifact('{"contract_version":"1.0","artifact_id":"${id}","artifact_type":"draft","generation_operation":"draft","generation_task_id":"cgt-race","logical_reply_key":"race","anchor_message_id":"00000000-0000-4000-8000-000000000701","lineage":[]}'::jsonb);`;
  const call = sql => new Promise(resolve => { const p = spawn(psql, [url, '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'ignore', 'pipe'] }); let err=''; p.stderr.on('data', b => { err += b; }); p.on('close', code => resolve({ code, err })); p.stdin.end(sql); });
  const [a, b] = await Promise.all([call(body('ca-race-a')), call(body('ca-race-b'))]);
  assert.equal([a.code, b.code].filter(code => code === 0).length, 1, `${a.err}\n${b.err}`);
  run(`DO $$ BEGIN IF (SELECT count(*) FROM public.conversation_artifacts WHERE generation_task_id='cgt-race' OR logical_reply_key='race') <> 1 THEN RAISE EXCEPTION 'divergent race state'; END IF; END $$;`);
});
