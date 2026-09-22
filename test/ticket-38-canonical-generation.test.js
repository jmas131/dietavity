'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const node = name => workflow.nodes.find(item => item.name === name);
const plain = value => JSON.parse(JSON.stringify(value));
function run(name, json) {
  return vm.runInNewContext(`(() => { ${node(name).parameters.jsCode} })()`, { $json: json });
}
const legacy = {
  diet: 'historical-diet', cuisine: 'historical-cuisine', allergies: ['historical-allergy'],
  dislikes: ['historical-dislike'], conditions: ['historical-condition'], notes: 'historical-notes',
};
const current = {
  eating_style: 'vegan', allergies: ['tree_nuts'], foods_to_avoid: ['cilantro'],
  medical_conditions: ['hypertension'], notes: 'Cocinar en casa',
};

for (const profile of [current, { eating_style: 'omnivore', allergies: [], foods_to_avoid: [], medical_conditions: [] }, {}]) {
  test(`canonical profile replaces every historical personalization field: ${profile.eating_style || 'neutral'}`, () => {
    const input = { preferences: structuredClone(legacy), profile: structuredClone(profile) };
    const before = structuredClone(input);
    const merged = run('Merge Program Profile Preferences', input)[0].json;
    assert.deepEqual(plain(merged.preferences), {
      diet: profile.eating_style || null, cuisine: null,
      allergies: profile.allergies || [], dislikes: profile.foods_to_avoid || [],
      conditions: profile.medical_conditions || [],
    });
    const weekly = run('Build Weekly Update Prompt', merged).json;
    const final = run('Add Profile Context to New Program Prompt', weekly)[0].json;
    assert.doesNotMatch(final.prompt, /historical-/);
    assert.deepEqual(input, before, 'legacy stored preferences and profile must not be mutated');
    if (profile.eating_style) assert.match(final.prompt, new RegExp(profile.eating_style));
    if (profile.medical_conditions?.length) assert.match(final.prompt, /hypertension/);
    merged.preferences.allergies.push('mutation-check');
    assert.deepEqual(input, before, 'projected arrays must not alias profile arrays');
  });
}

test('later-week batch uses the current canonical profile without executing the Week 1 merge', () => {
  for (const profile of [current, { eating_style: 'vegetarian', allergies: [], foods_to_avoid: [], medical_conditions: [] }]) {
    const weekly = run('Build Weekly Update Prompt', { profile, preferences: legacy, meals: {days: []} }).json;
    const final = run('Add Profile Context to New Program Prompt', weekly)[0].json;
    assert.match(final.prompt, new RegExp(profile.eating_style));
    assert.doesNotMatch(final.prompt, /historical-/);
    if (profile.eating_style === 'vegetarian') assert.doesNotMatch(final.prompt, /hypertension|tree_nuts|cilantro/);
  }
  assert.doesNotMatch(node('Add Profile Context to New Program Prompt').parameters.jsCode, /\$\(/);
});

test('missing canonical profile preserves the historical fallback for existing programs', () => {
  const merged = run('Merge Program Profile Preferences', { preferences: legacy, profile: null })[0].json;
  assert.deepEqual(plain(merged.preferences), legacy);
});

test('generation input and responses contain no temporary restoration machinery', () => {
  const normalized = run('Normalize Program Generation Request', {
    body: { id: '11111111-1111-4111-8111-111111111111', arbitrary_bypass: true },
  })[0].json;
  assert.deepEqual(Object.keys(normalized).sort(), ['error', 'generation_source', 'id', 'is_async_request', 'valid']);
  assert.equal(normalized.valid, true);
  assert.equal(run('Normalize Program Generation Request', {body: {id: 'invalid'}})[0].json.valid, false);
  for (const source of [fs.readFileSync(workflowPath, 'utf8'), fs.readFileSync(path.join(root, 'scripts/refactor-ticket-10-workflow.js'), 'utf8')]) {
    assert.doesNotMatch(source, /profile_only|restoration_authorization|LEGACY_PROFILE_ONLY/);
  }
});

test('eligibility is rechecked by initialization and consent version matches current Setup', () => {
  const initializer = node('Initialize 28-Day Program').parameters.query;
  const validation = node('Validate Program Generation User').parameters.query;
  const version = fs.readFileSync(path.join(root, 'server.js'), 'utf8').match(/const PRIVACY_NOTICE_VERSION = '([^']+)'/)[1];
  for (const sql of [initializer, validation]) {
    assert.ok(sql.includes(`profile.privacy_notice_version = '${version}'`));
    assert.match(sql, /profile.sensitive_data_consent_at IS NOT NULL/);
    assert.match(sql, /subscription.status IS DISTINCT FROM 'active'/);
    assert.match(sql, /u.subscription_status = 'active'/);
    assert.doesNotMatch(sql, /past_due|trialing/);
    assert.match(sql, /ORDER BY program.created_at DESC, program.id DESC LIMIT 1\) = 'completed'/);
  }
  assert.match(initializer, /AND NOT EXISTS \(SELECT 1 FROM existing_program\)/);
  assert.match(initializer, /generate_series\(1, 4\)/);
  assert.match(initializer, /FOR UPDATE OF purchase/);
  assert.match(initializer, /purchase.purchased_at DESC NULLS LAST/);
  assert.doesNotMatch(initializer, /UPDATE (?:public\.)?(?:users|profiles|programs)|INSERT INTO (?:public\.)?purchases/i);
});

test('existing provisioning, persistence, event, and later-week connections are retained', () => {
  const outputs = name => (workflow.connections[name]?.main || []).flat().map(edge => edge.node);
  assert.deepEqual(outputs('Get New Program Week 1 Context'), ['Merge Program Profile Preferences']);
  assert.deepEqual(outputs('Merge Program Profile Preferences'), ['Build Weekly Update Prompt']);
  assert.deepEqual(outputs('Weekly Update Batch Loop'), ['Build Weekly Update Prompt']);
  assert.deepEqual(outputs('Add Profile Context to New Program Prompt'), ['Generate Weekly Meal Plan']);
  assert.deepEqual(outputs('Plan New Program Week 1'), ['Build Program Generation Response']);
  const historical = JSON.parse(fs.readFileSync(path.join(root, 'n8n/Dietavity Canonical Ledger (Ticket 9).json'), 'utf8'));
  for (const name of ['Insert Weekly Update Meal Plan', 'Prepare Weekly Meal Plan Insert', 'Plan New Program Week 1']) {
    assert.deepEqual(node(name).parameters, historical.nodes.find(item => item.name === name).parameters);
  }
  const plan = node('Plan New Program Week 1').parameters.query;
  assert.match(plan, /'program_ready'/);
  assert.match(plan, /start_date = NULL/);
  assert.match(plan, /status = 'personalization'/);
});

test('Ticket 10 artifact is byte-for-byte synchronized and inactive', () => {
  const generatorPath = path.join(root, 'scripts/refactor-ticket-10-workflow.js');
  const source = fs.readFileSync(generatorPath, 'utf8');
  const generated = new Map();
  const realRequire = require('node:module').createRequire(generatorPath);
  vm.runInNewContext(source, {
    __dirname: path.dirname(generatorPath), console: {log() {}},
    require: name => name === 'node:fs' ? {
      ...fs, writeFileSync: (destination, value) => {
        assert.ok([workflowPath, path.join(root, 'n8n/Dietavity WhatsApp Recovery Poller.json')].includes(destination));
        generated.set(destination, value);
      },
    } : realRequire(name),
  });
  assert.equal(generated.size, 2);
  for (const [destination, value] of generated) assert.equal(value, fs.readFileSync(destination, 'utf8'));
  assert.equal(workflow.active, false);
});
