'use strict';

// Explicit local SQL integration suite. Uses a temporary PGlite installation,
// following run-ticket-37a-postgres.js; never reads production configuration.
// DIETAVITY_PGLITE_PATH=/path/to/pglite node --test test-support/run-ticket-38-postgres.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require(process.env.DIETAVITY_PGLITE_PATH);
const root = path.resolve(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json')));
const node = name => workflow.nodes.find(item => item.name === name);
const userId = '11111111-1111-4111-8111-111111111111';
const programOne = '22222222-2222-4222-8222-222222222222';
const legacy = {diet: 'historical-diet', cuisine: 'historical-cuisine', allergies: ['historical-allergy'], dislikes: ['historical-dislike'], conditions: ['historical-condition']};
let db;
const tables = ['users', 'profiles', 'programs', 'weeks', 'purchases', 'subscriptions', 'meal_plans', 'sales_funnel_events'];
const rows = async sql => (await db.query(sql)).rows;
const executeNode = async (name, json = {}) => rows(node(name).parameters.query.replace(/{{([\s\S]*?)}}/g, (_, expression) => String(vm.runInNewContext(expression, {$json: { id: userId, generation_source: 'setup_webhook', is_async_request: true, ...json }}))));
const initialize = () => executeNode('Initialize 28-Day Program');
const valid = async () => (await executeNode('Validate Program Generation User'))[0].valid_user;

before(async () => {
  db = new PGlite();
  const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
  for (const table of tables) {
    await db.exec(schema.match(new RegExp(`CREATE TABLE public.${table} \\([\\s\\S]*?\\n\\);`))[0]);
    await db.exec(`ALTER TABLE ${table} ADD PRIMARY KEY(id)`);
  }
  // Mirror relevant real uniqueness/foreign-key constraints, not a mock query engine.
  await db.exec(`ALTER TABLE profiles ADD UNIQUE(user_id);
    ALTER TABLE programs ADD FOREIGN KEY(user_id) REFERENCES users(id);
    ALTER TABLE programs ADD FOREIGN KEY(profile_id) REFERENCES profiles(id);
    ALTER TABLE weeks ADD FOREIGN KEY(program_id) REFERENCES programs(id);
    ALTER TABLE purchases ADD FOREIGN KEY(program_id) REFERENCES programs(id);
    ALTER TABLE meal_plans ADD FOREIGN KEY(week_id) REFERENCES weeks(id);`);
  for (const index of ['meal_plans_one_plan_per_week_idx', 'sales_funnel_events_event_key_uidx', 'weeks_program_week_number_unique']) {
    await db.exec(schema.match(new RegExp(`CREATE UNIQUE INDEX ${index}[^;]+;`))[0]);
  }
});
after(async () => { if (db) await db.close(); });

async function seed({completed = true, status = 'active', profile = true} = {}) {
  await db.exec(`TRUNCATE ${tables.join(', ')} CASCADE`);
  await db.query(`INSERT INTO users(id, preferences, stripe_subscription_id, subscription_status, portal_token)
    VALUES ($1,$2,'sub_legacy',$3,'same-portal-token')`, [userId, legacy, status]);
  if (profile) await db.query(`INSERT INTO profiles(user_id,eating_style,allergies,foods_to_avoid,medical_conditions,sensitive_data_consent_at,privacy_notice_version)
    VALUES ($1,'vegan','{}','{}','{}',NOW(),'2026-08-11')`, [userId]);
  if (completed) await db.exec(`INSERT INTO programs(id,user_id,status,current_week,start_date,completed_at,created_at)
    VALUES ('${programOne}','${userId}','completed',4,'2026-07-01','2026-07-29','2026-07-01');
    INSERT INTO weeks(program_id,week_number,status,completed_at)
    SELECT '${programOne}', n, 'completed', '2026-07-29' FROM generate_series(1,4) n;`);
}
async function purchase(paymentStatus = 'paid', createdAt = '2026-08-01', linkedId = null) {
  return (await db.query(`INSERT INTO purchases(user_id,stripe_checkout_session_id,stripe_price_id,payment_status,amount_total,created_at,purchased_at,program_id)
    VALUES ($1,gen_random_uuid()::text,'price_program',$2,49900,$3,$3,$4) RETURNING id`, [userId, paymentStatus, createdAt, linkedId])).rows[0].id;
}
async function snapshot() {
  const result = {};
  for (const table of tables) result[table] = await rows(`SELECT * FROM ${table} ORDER BY id`);
  return result;
}

async function prepareWeekOne(program) {
  const context = (await executeNode('Get New Program Week 1 Context', {program_id: program.program_id}))[0];
  assert.equal(context.profile.eating_style, 'vegan');
  const outputs = {};
  const lookup = name => {
    assert.ok(outputs[name], `Missing execution output: ${name}`);
    return {item: {json: outputs[name]}, first: () => ({json: outputs[name]})};
  };
  const run = (name, json) => vm.runInNewContext(`(() => { ${node(name).parameters.jsCode} })()`, {$json: json, $: lookup});
  const merged = run('Merge Program Profile Preferences', context)[0].json;
  outputs['Build Weekly Update Prompt'] = run('Build Weekly Update Prompt', merged).json;
  const prompt = run('Add Profile Context to New Program Prompt', outputs['Build Weekly Update Prompt'])[0].json.prompt;
  assert.doesNotMatch(prompt, /historical-/);
  assert.match(prompt, /vegan/);
  // Deterministic seven-day provider fixture; persist through the real n8n
  // Supabase insert field mapping, without making a paid model request.
  const meals = {duration_days: 7, days: Array.from({length: 7}, (_, i) => ({day: i + 1, meals: {
    breakfast: {title: 'Avena', description: 'Avena con fruta', calories: 350, macros: {protein: 10, carbs: 60, fat: 8}, recipe: {ingredients: ['avena', 'agua'], steps: ['Cocina la avena.']}},
    lunch: {title: 'Lentejas', description: 'Lentejas con verduras', calories: 450, macros: {protein: 20, carbs: 65, fat: 10}, recipe: {ingredients: ['lentejas', 'verduras'], steps: ['Cocina las lentejas.']}},
    dinner: {title: 'Tacos de frijol', description: 'Tortillas con frijoles', calories: 400, macros: {protein: 15, carbs: 60, fat: 10}, recipe: {ingredients: ['tortilla', 'frijoles'], steps: ['Rellena las tortillas.']}},
    snacks: ['Manzana'],
  }}))};
  const parsed = run('Parse Meal Plan JSON Weekly Update', {choices: [{message: {content: JSON.stringify(meals)}}]})[0].json;
  assert.equal(parsed.success, true);
  outputs['Parse Meal Plan JSON Weekly Update'] = parsed;
  outputs['Attach Program Week Context'] = run('Attach Program Week Context', parsed)[0].json;
  const prepared = {};
  const evalValue = (expression, json) => vm.runInNewContext(expression.replace(/^={{\s*|\s*}}$/g, ''), {$json: json, $: lookup});
  for (const assignment of node('Prepare Weekly Meal Plan Insert').parameters.assignments.assignments) {
    prepared[assignment.name] = evalValue(assignment.value, {...context, meals});
  }
  const values = node('Insert Weekly Update Meal Plan').parameters.fieldsUi.fieldValues;
  const payload = Object.fromEntries(values.map(field => [field.fieldId, evalValue(field.fieldValue, prepared)]));
  await db.query(`INSERT INTO meal_plans (${Object.keys(payload).join(',')}) VALUES (${Object.keys(payload).map((_,i)=>'$'+(i+1)).join(',')})`, Object.values(payload));
  const result = await executeNode('Plan New Program Week 1', {week_id: context.week_id});
  assert.equal(result[0].status, 'personalization');
  assert.equal(result[0].start_date, null);
  assert.equal((await rows(`SELECT status FROM weeks WHERE id='${context.week_id}'`))[0].status, 'planned');
  assert.equal((await rows('SELECT * FROM meal_plans')).length, 1);
  assert.equal((await rows('SELECT meals FROM meal_plans'))[0].meals.days.length, 7);
  assert.equal((await rows("SELECT * FROM sales_funnel_events WHERE event_type='program_ready'")).length, 1);
  assert.equal((await executeNode('Get New Program Week 1 Context', {program_id: program.program_id})).length, 0);
  await executeNode('Plan New Program Week 1', {week_id: context.week_id});
  assert.equal((await rows('SELECT * FROM sales_funnel_events')).length, 1);
}

test('active legacy continuation creates distinct Program 2, four weeks, Week 1 and program_ready without historical mutation', async () => {
  await seed();
  const before = await snapshot();
  assert.equal(await valid(), true);
  const [program] = await initialize();
  assert.equal(program.created, true);
  assert.notEqual(program.program_id, programOne);
  assert.equal(program.weeks_created, 4);
  assert.equal(program.purchase_linked, false);
  assert.equal(program.purchase_id, null);
  await prepareWeekOne(program);
  const after = await snapshot();
  assert.deepEqual(after.users, before.users, 'portal, Stripe identifiers and historical preferences unchanged');
  assert.deepEqual(after.profiles, before.profiles);
  assert.deepEqual(after.programs.filter(p => p.id === programOne), before.programs);
  assert.deepEqual(after.weeks.filter(w => w.program_id === programOne), before.weeks);
  assert.deepEqual(after.purchases, []);
  assert.equal(after.programs.length, 2);
  const [repeat] = await initialize();
  assert.equal(repeat.program_id, program.program_id);
  assert.equal(repeat.created, false);
  assert.equal(repeat.weeks_created, 0);
});

for (const status of ['personalization', 'ready', 'active']) test(`unfinished ${status} successor prevents Program 3 and purchase consumption`, async () => {
  await seed(); const [program] = await initialize();
  await db.query('UPDATE programs SET status=$1 WHERE id=$2', [status, program.program_id]);
  await purchase();
  const before = await snapshot();
  const [again] = await initialize();
  assert.equal(again.program_id, program.program_id);
  assert.equal(again.created, false);
  assert.equal(again.purchase_linked, false);
  assert.equal(await valid(), true);
  assert.deepEqual(await snapshot(), before);
});

for (const status of ['canceled', 'inactive', 'past_due', 'trialing', 'unpaid', null]) test(`no purchase-free continuation for subscription status ${status}`, async () => {
  await seed({status});
  const before = await snapshot();
  assert.equal(await valid(), false);
  assert.deepEqual(await initialize(), []);
  assert.deepEqual(await snapshot(), before);
});

for (const [label, change] of [
  ['missing profile', 'DELETE FROM profiles'],
  ['missing consent', 'UPDATE profiles SET sensitive_data_consent_at=NULL'],
  ['old privacy notice', "UPDATE profiles SET privacy_notice_version='old'"],
  ['missing privacy notice', 'UPDATE profiles SET privacy_notice_version=NULL'],
  ['future consent', "UPDATE profiles SET sensitive_data_consent_at=NOW()+INTERVAL '1 day'"],
  ['missing Stripe subscription', 'UPDATE users SET stripe_subscription_id=NULL'],
  ['blank Stripe subscription', "UPDATE users SET stripe_subscription_id=' '"],
  ['latest canceled program', `INSERT INTO programs(user_id,status) VALUES ('${userId}','cancelled')`],
  ['no completed history', 'DELETE FROM weeks; DELETE FROM programs'],
  ['conflicting subscription table', `INSERT INTO subscriptions(user_id,provider,stripe_subscription_id,status) VALUES ('${userId}','stripe','sub_legacy','canceled')`],
]) test(`continuation fails closed for ${label}, including a direct initializer call`, async () => {
  await seed(); await db.exec(change);
  const before = await snapshot();
  assert.equal(await valid(), false);
  assert.deepEqual(await initialize(), []);
  assert.deepEqual(await snapshot(), before);
});

test('missing user fails closed', async () => {
  await seed({completed: false, profile: false}); await db.exec('DELETE FROM users');
  assert.equal(await valid(), false); assert.deepEqual(await initialize(), []);
});

test('linked active subscription table can fill missing user status but cannot override explicit past_due', async () => {
  await seed({status: null});
  await db.exec(`INSERT INTO subscriptions(user_id,provider,stripe_subscription_id,status) VALUES ('${userId}','stripe','sub_legacy','active')`);
  assert.equal(await valid(), true);
  await db.exec("UPDATE users SET subscription_status='past_due'");
  assert.equal(await valid(), false); assert.deepEqual(await initialize(), []);
  await db.exec('UPDATE users SET subscription_status=NULL');
  assert.equal((await initialize())[0].created, true);
});

test('ordinary paid one-time customer initializes and prepares four weeks without subscription', async () => {
  await seed({completed: false, status: null});
  await db.exec('UPDATE users SET stripe_subscription_id=NULL');
  const paid = await purchase();
  assert.equal(await valid(), true);
  const [program] = await initialize();
  assert.equal(program.weeks_created, 4);
  assert.equal(program.purchase_linked, true);
  assert.equal(program.purchase_id, paid);
  await prepareWeekOne(program);
  const [again] = await initialize();
  assert.equal(again.program_id, program.program_id);
  assert.equal(again.created, false);
  assert.equal((await rows('SELECT * FROM programs')).length, 1);
});

test('eligible one-time purchase takes the ordinary paid path even for an active legacy subscriber', async () => {
  await seed();
  await purchase('unpaid', '2026-09-01');
  const old = await purchase('paid', '2026-08-01');
  const newest = await purchase('paid', '2026-08-02');
  const [program] = await initialize();
  assert.equal(program.purchase_id, newest);
  assert.equal(program.purchase_linked, true);
  assert.equal((await rows(`SELECT program_id FROM purchases WHERE id='${old}'`))[0].program_id, null);
});

test('unpaid and already linked purchases cannot authorize a new ordinary program', async () => {
  await seed({status: 'canceled'});
  await purchase('unpaid'); await purchase('paid', '2026-08-01', programOne);
  assert.equal(await valid(), false); assert.deepEqual(await initialize(), []);
});

test('late week insert failure rolls back program and purchase linkage atomically', async () => {
  await seed({completed: false, status: null}); await purchase();
  const before = await snapshot();
  await db.exec('ALTER TABLE weeks ADD CONSTRAINT test_reject_week_four CHECK (week_number < 4)');
  try { await assert.rejects(initialize(), /test_reject_week_four/); }
  finally { await db.exec('ALTER TABLE weeks DROP CONSTRAINT test_reject_week_four'); }
  assert.deepEqual(await snapshot(), before);
});
