const assert = require('node:assert/strict');
const test = require('node:test');
const { loadWorkflow } = require('../test-support/workflow-fixture');

const workflow = loadWorkflow();
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const node = (name) => {
  assert.ok(nodes.has(name), `expected node ${name}`);
  return nodes.get(name);
};

test('paid-user classifier uses the 28-day intent taxonomy', () => {
  const prompt = node('Detect Intent and Entities').parameters.options.systemMessage;
  for (const intent of ['portal_help', 'program_help', 'recipe', 'meal_idea', 'restaurant_near', 'restaurant_menu', 'advice', 'support', 'general', 'unsubscribe']) {
    assert.match(prompt, new RegExp(`\\b${intent}\\b`));
  }
  for (const retired of ['meal_plan', 'shopping_list', 'preference_update']) {
    assert.doesNotMatch(prompt, new RegExp(`^- ${retired}:`, 'm'));
  }
  assert.match(prompt, /lista del súper.*portal_help/i);
  assert.match(prompt, /otro plan de 7 días.*program_help/i);
});

test('profile facts are conversational-only and persistence nodes are gone', () => {
  const parser = node('Parse JSON Intent and Entities').parameters.jsCode;
  const allowedEntityDeclaration = parser.match(/const validEntities = \[([^\]]+)\]/)?.[1] || '';
  assert.doesNotMatch(allowedEntityDeclaration, /['"](?:diet|allergy|dislike|condition|name|cuisine)['"],?/);
  assert.match(parser, /profile_statement/);
  for (const retired of ['Unified Merge', 'Safeguard', 'Persist Preference General', 'Update User Preference all Other Intents', 'Update User Name', 'If Ask Name', 'If Ask Diet']) {
    assert.equal(nodes.has(retired), false, `${retired} should be removed`);
  }
});

test('standalone WhatsApp meal-plan and shopping-list generation are unreachable', () => {
  for (const retired of ['Build Meal Plan Prompt', 'Meal Plan Chat Completions', 'Create Meal Plan', 'Portal Token Link']) {
    assert.equal(nodes.has(retired), false, `${retired} should be removed`);
  }
  const prompt = node('Build Nutrition Prompt').parameters.jsCode;
  assert.doesNotMatch(prompt, /case ["']shopping_list["']/);
  assert.match(prompt, /sin crear ni reemplazar el programa/i);
});

test('portal and program facts are deterministic and database-backed', () => {
  const query = node('Get Customer Assistant Context').parameters.query;
  assert.match(query, /FROM programs/);
  assert.match(query, /start_date/);
  assert.match(query, /current_week/);
  const deterministic = node('Build Deterministic Customer Response').parameters.jsCode;
  assert.match(deterministic, /https:\/\/dietavity\.com/);
  assert.match(deterministic, /user\.portal_token/);
  assert.match(deterministic, /lista del súper/i);
  assert.match(deterministic, /No me gustó/);
});

test('legacy cancellation is gated by active persisted subscription state', () => {
  const query = node('Get Customer Assistant Context').parameters.query;
  assert.match(query, /FROM subscriptions/);
  assert.match(query, /legacy_subscription\.stripe_subscription_id = legacy_user\.stripe_subscription_id/);
  assert.match(query, /status IN \('active', 'trialing', 'past_due'\)/);
  node('If Active Legacy Subscription');
  node('Stripe Cancel a Subscription');
  const outputs = workflow.connections['If Active Legacy Subscription'].main;
  assert.equal(outputs[0][0].node, 'Unsubscribe User Message');
  assert.equal(outputs[1][0].node, 'Build Deterministic Customer Response');
  const response = node('Build Deterministic Customer Response').parameters.jsCode;
  assert.match(response, /compra única/i);
});

test('lead/customer split and Tickets 1-4 workflow roots remain present', () => {
  for (const required of ['If Identify User State', 'Set Session Id', 'Generate 28-Day Program Webhook', 'Meal Regeneration Webhook', 'Weekly Update Trigger', 'Resolve User and Persist Purchase']) {
    node(required);
  }
  const split = workflow.connections['If Identify User State'].main;
  assert.equal(split[0][0].node, 'Detect Intent and Entities');
  assert.equal(split[1][0].node, 'Set Session Id');
  assert.equal(workflow.settings.errorWorkflow, 'sa10JQEAbxNYvCGG');
});

test('all workflow connections refer to existing nodes', () => {
  for (const [source, groups] of Object.entries(workflow.connections)) {
    assert.ok(nodes.has(source), `connection source missing: ${source}`);
    for (const outputs of Object.values(groups)) for (const output of outputs) for (const target of output) {
      assert.ok(nodes.has(target.node), `connection target missing: ${target.node}`);
    }
  }
});
