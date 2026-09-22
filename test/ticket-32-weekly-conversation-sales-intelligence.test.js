'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const workflowName = 'Dietavity Weekly Conversation & Sales Intelligence';
const workflowPath = path.join(root, 'n8n', `${workflowName}.json`);
const formatterPath = path.join(root, 'n8n', 'source', `${workflowName}.formatter.js`);
const generator = require('../scripts/refactor-ticket-32-weekly-conversation-sales-intelligence');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const formatterSource = fs.readFileSync(formatterPath, 'utf8').trimEnd();
const builtSource = nodes.get('Prepare Weekly Intelligence Input').parameters.jsCode;

function baseAudit(overrides = {}) {
  return {
    prospect_conversations: 2,
    customer_support_conversations: 1,
    sample_quality: 'Small sample; conclusions are directional.',
    executive_summary: ['Price and practical meals mattered commercially.'],
    sales_funnel_signals: {
      initial_contacts: 2,
      meaningful_interest: 1,
      explicit_purchase_intent: 1,
      checkout_reached: 1,
      purchase_confirmed: null,
      drop_off_points: ['One conversation stopped after price.'],
    },
    prospect_wants: [],
    questions_and_objections: [],
    what_helped_sales: [],
    what_hurt_sales: [],
    marketing_positioning_insights: {
      customer_language: ['Wants help knowing what to eat.'],
      ad_landing_page_insights: ['Test daily decision relief as a headline.'],
      signals_supporting_positioning: ['Daily meal guidance resonated.'],
      signals_challenging_positioning: [],
    },
    product_customer_experience_insights: [],
    technical_findings: [],
    test_traffic_handling: 'No reliable test marker was supplied; no conversations were excluded.',
    priorities_next_week: ['Test one landing-page message.'],
    ticket_recommended: false,
    proposed_ticket: null,
    ...overrides,
  };
}

function runFormatter(audit) {
  return vm.runInNewContext(`(function () { ${formatterSource} })()`, {
    $json: { choices: [{ message: { content: JSON.stringify(audit) } }] },
    $: (name) => {
      assert.equal(name, 'Prepare Weekly Intelligence Input');
      return { first: () => ({ json: {
        reporting_start_date: '2026-08-17',
        reporting_end_date: '2026-08-23',
        total_conversations: 3,
      } }) };
    },
  })[0].json;
}

test('uses one weekly Monday schedule in the canonical Mexico City timezone', () => {
  const interval = nodes.get('Weekly Schedule Trigger').parameters.rule.interval;
  assert.deepEqual(interval, [{ field: 'weeks', triggerAtDay: [1], triggerAtHour: 8 }]);
  assert.equal(workflow.settings.timezone, 'America/Mexico_City');
  assert.equal(workflow.active, false);
  assert.equal(fs.existsSync(path.join(root, 'n8n', 'Dietavity Daily Conversation Auditor.json')), false);
});

test('query selects the previous seven complete local calendar days with half-open boundaries', () => {
  const query = nodes.get('Fetch Canonical Messages - Previous 7 Complete Days').parameters.query;
  assert.match(query, /NOW\(\) AT TIME ZONE 'America\/Mexico_City'/);
  assert.match(query, /current_local_date - 7/);
  assert.match(query, /message\.timestamp >= bounds\.window_start/);
  assert.match(query, /message\.timestamp < bounds\.window_end/);
  assert.match(query, /current_local_date - 1/);
  assert.doesNotMatch(query, /NOW\(\) - INTERVAL '7 days'|24 hours/i);
  assert.match(query, /FROM bounds\s+LEFT JOIN public\.messages AS message/);
  assert.doesNotMatch(query, /onboarding_chat_memory|public\.(?:users|profiles|purchases|subscriptions)/i);
});

test('reporting contract distinguishes sample, funnel, evidence, marketing, product, and technical sections', () => {
  const schema = generator.RESPONSE_SCHEMA;
  for (const property of [
    'sample_quality', 'sales_funnel_signals', 'prospect_wants', 'questions_and_objections',
    'marketing_positioning_insights', 'product_customer_experience_insights',
    'technical_findings', 'priorities_next_week', 'proposed_ticket',
  ]) assert.ok(schema.required.includes(property), `missing ${property}`);

  assert.equal(schema.properties.sales_funnel_signals.properties.purchase_confirmed.type, 'null');
  assert.equal(schema.properties.priorities_next_week.maxItems, 3);
  const html = runFormatter(baseAudit()).report_html;
  for (const heading of [
    'SALES FUNNEL SIGNALS', 'WHAT PROSPECTS WANTED', 'QUESTIONS &amp; OBJECTIONS',
    'WHAT HELPED SALES', 'WHAT HURT SALES', 'MARKETING &amp; POSITIONING INSIGHTS',
    'PRODUCT / CUSTOMER EXPERIENCE INSIGHTS', 'TECHNICAL FINDINGS', 'ENGINEERING TICKET',
  ]) assert.match(html, new RegExp(heading));
  assert.match(html, /Purchase confirmed:<\/strong> Not observable from public\.messages alone/);
});

test('single anecdotes cannot be described as recurring evidence by contract', () => {
  assert.match(builtSource, /One conversation is an isolated observation, not a recurring pattern/);
  assert.match(builtSource, /Normally assign weak evidence/);
  const theme = generator.RESPONSE_SCHEMA.properties.questions_and_objections.items;
  assert.deepEqual(theme.properties.evidence_strength.enum, ['weak', 'moderate', 'strong']);
  assert.deepEqual(theme.properties.count.anyOf.map((option) => option.type), ['integer', 'null']);
});

test('canonical product context prevents feature invention and prepared-food-delivery scope expansion', () => {
  const context = generator.AUDITOR_CANONICAL_CONTEXT;
  assert.match(context, /Programa personalizado Dietavity de 28 días/);
  assert.match(context, /Precio: \$149 MXN/);
  assert.match(context, /un solo pago/);
  assert.match(context, /incluye desayuno, comida, cena y snack/i);
  assert.match(context, /not a prepared-food delivery service/);
  assert.match(builtSource, /Product capability requires verification/);
  assert.match(builtSource, /never a recommendation to build food delivery/);

  const audit = baseAudit({
    product_customer_experience_insights: [{
      classification: 'PRODUCT / OFFER',
      insight: 'Prepared-food expectation indicates positioning clarity, not a delivery feature request.',
      evidence_strength: 'weak',
    }],
    ticket_recommended: true,
    proposed_ticket: {
      classification: 'TECHNICAL DEFECT', title: 'Build food delivery', objective: 'Deliver meals',
      observed_evidence: 'One confused prospect', required_behavior: 'Add couriers',
      regression_cases: [], acceptance_criteria: [], non_goals: [],
    },
  });
  const html = runFormatter(audit).report_html;
  assert.match(html, /None recommended this week/);
  assert.doesNotMatch(html, /Build food delivery/);
});

test('medical conversations remain bounded to general support without therapeutic claims', () => {
  assert.match(builtSource, /never a diagnosis, therapeutic promise, clinical diet, medication change/);
  assert.match(generator.AUDITOR_CANONICAL_CONTEXT, /No diagnostiques, prescribas tratamientos, modifiques medicamentos/);
  assert.match(builtSource, /appropriate professional medical care|atención médica o profesional apropiada/);
});

test('marketing insight extraction is required even when no engineering ticket exists', () => {
  const marketing = generator.RESPONSE_SCHEMA.properties.marketing_positioning_insights;
  assert.deepEqual(marketing.required, [
    'customer_language', 'ad_landing_page_insights',
    'signals_supporting_positioning', 'signals_challenging_positioning',
  ]);
  const html = runFormatter(baseAudit()).report_html;
  assert.match(html, /Test one landing-page message/);
  assert.match(html, /None recommended this week/);
});

test('genuine supported technical defects can still produce one human-approved ticket', () => {
  const technical = {
    title: 'Duplicate outbound delivery',
    observed: 'Two identical outbound replies followed one inbound.',
    impact: 'Trust and messaging cost.',
    severity: 'high',
    reproducibility: 'supported',
    evidence_strength: 'moderate',
    evidence: ['CONVERSATION-A1B2C3D4'],
  };
  const audit = baseAudit({
    technical_findings: [technical],
    ticket_recommended: true,
    proposed_ticket: {
      classification: 'TECHNICAL DEFECT',
      title: 'Prevent duplicate outbound delivery',
      objective: 'Keep one side-effect path per inbound.',
      observed_evidence: 'CONVERSATION-A1B2C3D4',
      required_behavior: 'Send at most one reply.',
      regression_cases: ['Duplicate execution'],
      acceptance_criteria: ['One outbound'],
      non_goals: ['No Sales Engine redesign'],
    },
  });
  const html = runFormatter(audit).report_html;
  assert.match(html, /Duplicate outbound delivery/);
  assert.match(html, /PROPOSED - REQUIRES HUMAN APPROVAL/);
  assert.equal((html.match(/PROPOSED - REQUIRES HUMAN APPROVAL/g) || []).length, 1);
});

test('test traffic is not excluded without reliable metadata or text heuristics', () => {
  const query = generator.AUDIT_QUERY;
  assert.doesNotMatch(query, /metadata|test|debug/i);
  assert.match(builtSource, /No reliable test-traffic marker is supplied/);
  assert.match(builtSource, /Do not exclude conversations or call them organic based on message-text guesses/);
  assert.match(builtSource, /without removing it from counts/);
});

test('critical conversational failure signals stay visible while runtime errors use the existing handler', () => {
  assert.match(builtSource, /payment-state corruption/);
  assert.match(builtSource, /duplicate charges/);
  assert.match(builtSource, /privacy\/security issues/);
  assert.match(builtSource, /widespread Checkout failure/);
  assert.match(builtSource, /existing Global Error Handler/);
  assert.equal(workflow.settings.errorWorkflow, 'sa10JQEAbxNYvCGG');
});

test('few-conversation and no-ticket outputs remain readable and bounded', () => {
  const html = runFormatter(baseAudit({
    prospect_conversations: 99,
    customer_support_conversations: 99,
    executive_summary: ['Only one conversation supports this isolated observation.'],
    priorities_next_week: [],
  })).report_html;
  assert.match(html, /Conversations reviewed:<\/strong> 3/);
  assert.match(html, /Prospect conversations:<\/strong> 3/);
  assert.match(html, /Small sample/);
  assert.match(html, /No conversation-derived priority/);
  assert.match(html, /None recommended this week/);
});
