'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json');
const outputPath = path.join(root, 'n8n/Dietavity Sales Conversation Test Harness (Ticket 41A).json');
const FAKE_IDENTITIES = ['+5215554111111', '+5215554222222'];
const SESSION_PREFIX = 'ticket41a:';
const CANONICAL_NODES = [
  'Get Onboarding Session', 'If Existing Onboarding Session', 'Initialize Sales Lead v3',
  'Build Canonical Dietavity Knowledge', 'Interpret Sales Buyer Signal', 'Sales Interpretation Model',
  'Parse Sales Interpretation', 'Apply Deterministic Commercial Policy', 'Route Authorized Sales Action',
  'Build Constrained Sales Response', 'Generate Sales Response v3', 'Sales Response Model',
  'Postgres Chat Memory', 'Validate Sales Response Contract',
];

function stableId(label) {
  const hex = crypto.createHash('sha256').update(`ticket41a:${label}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function before(source, marker) {
  const index = source.indexOf(marker);
  if (index < 0) throw new Error(`Canonical SQL boundary missing: ${marker}`);
  return source.slice(0, index);
}
function buildHarness(production) {
  const canonical = name => {
    const found = production.nodes.find(node => node.name === name);
    if (!found) throw new Error(`Missing canonical node: ${name}`);
    return found;
  };
  const nodes = CANONICAL_NODES.map(name => {
    const copied = structuredClone(canonical(name));
    copied.id = stableId(name);
    // Map credentials explicitly on import; never bind automatically to production IDs.
    if (copied.credentials) {
      copied.credentials = Object.fromEntries(Object.keys(copied.credentials).map(type => [type, {
        name: type === 'postgres' ? 'Dietavity Conversation Harness Postgres' : 'Dietavity Conversation Harness OpenAI',
      }]));
    }
    return copied;
  });
  const node = name => nodes.find(n => n.name === name);
  const add = (name, type, typeVersion, parameters, notes) => {
    const added = { name, id: stableId(name), type, typeVersion, parameters, position: [0, 0], notes };
    nodes.push(added);
    return added;
  };
  const addCode = (name, jsCode, notes) => add(name, 'n8n-nodes-base.code', 2, {jsCode}, notes);
  const addSql = (name, query, queryReplacement, notes) => {
    const added = add(name, canonical('Get Onboarding Session').type,
      canonical('Get Onboarding Session').typeVersion,
      {operation: 'executeQuery', query, options: {queryReplacement}}, notes);
    added.credentials = structuredClone(node('Get Onboarding Session').credentials);
    return added;
  };

  const trigger = add('When chat message received', '@n8n/n8n-nodes-langchain.chatTrigger', 1.1,
    {public: false, options: {responseMode: 'lastNode', loadPreviousSession: 'notSupported'}},
    'Manual n8n Chat/Test only. Keep public access off and workflow inactive. No WhatsApp webhook.');
  trigger.webhookId = stableId('chat-test-webhook');
  add('Configure Fake Identity', 'n8n-nodes-base.set', canonical('Set Session Id').typeVersion, {
    assignments: {assignments: [{id: stableId('fake-identity'), name: 'fake_whatsapp_id', type: 'string', value: FAKE_IDENTITIES[0]}]},
    options: {},
  }, `Select ${FAKE_IDENTITIES.join(' or ')} here. Chat payload identities are ignored. Wait for each turn to finish before sending another.`);
  addCode('Set Session Id', `const fakeIdentity = $input.first().json.fake_whatsapp_id;
const allowed = ${JSON.stringify(FAKE_IDENTITIES)};
const chat = $('When chat message received').item.json;
if (!allowed.includes(fakeIdentity)) throw new Error('HARNESS_FAKE_IDENTITY_REQUIRED');
if (chat.action && chat.action !== 'sendMessage') throw new Error('HARNESS_SEND_MESSAGE_ONLY');
if (typeof chat.chatInput !== 'string' || !chat.chatInput.trim() || chat.chatInput.length > 4096) {
  throw new Error('HARNESS_TEXT_MESSAGE_REQUIRED');
}
return [{ json: {
  session_id: ${JSON.stringify(SESSION_PREFIX)} + fakeIdentity,
  fake_whatsapp_id: fakeIdentity,
  chatInput: chat.chatInput
} }];`, 'Guard exact operator-selected fake identities before any database or model access. Namespace the canonical session key; never fabricate a Twilio Message SID.');

  // Reuse canonical session INSERT/ON CONFLICT; deliberately exclude business events.
  const initializer = node('Initialize Sales Lead v3');
  initializer.parameters.query = before(initializer.parameters.query, '), inserted_event AS (') + ')\nSELECT * FROM inserted_session;';
  initializer.notes = 'Canonical session initialization, with lead event writes removed for this harness only. Test keys are namespaced; no production funnel evidence is created.';

  // Keep the established Postgres AI memory node. After validation, replace its
  // latest AI entry with the final response, then mark it as test-chat evidence.
  node('Postgres Chat Memory').parameters.sessionKey = "={{ $('Set Session Id').item.json.session_id }}";
  addSql('Get Recent Sales Clarification Context', `SELECT COALESCE((
  SELECT COALESCE(message->'data'->>'content', message->>'content')
  FROM public.onboarding_chat_memory
  WHERE session_id = $1::jsonb->>'session_id'
    AND message->>'type' = 'ai'
    AND COALESCE(message->'data'->'additional_kwargs'->>'ticket41a_final',
      message->'additional_kwargs'->>'ticket41a_final') = 'true'
  ORDER BY created_at DESC, id DESC LIMIT 1
), '') AS recent_sales_assistant_message,
  1 / (CASE WHEN EXISTS (
    SELECT 1 FROM public.onboarding_chat_memory
    WHERE session_id = $1::jsonb->>'session_id' AND message->>'type' = 'ai'
      AND COALESCE(message->'data'->'additional_kwargs'->>'ticket41a_final',
        message->'additional_kwargs'->>'ticket41a_final', 'false') <> 'true'
  ) THEN 0 ELSE 1 END) AS harness_history_validated;`,
  "={{ JSON.stringify({ session_id: $('Set Session Id').item.json.session_id }) }}",
  'Test adapter for canonical recent-response input. Reads only validated Chat replies from the namespaced AI memory; never reads or writes the WhatsApp ledger.');

  const stateSql = before(canonical('Persist Sales Response State and Events').parameters.query, '), event_names AS (');
  addSql('Persist Harness Response State', stateSql + `), final_memory AS (
  UPDATE public.onboarding_chat_memory AS memory
  SET message = CASE WHEN jsonb_typeof(memory.message->'data') = 'object'
    THEN jsonb_set(memory.message, '{data}',
      (memory.message->'data') || jsonb_build_object('content', decision.payload->>'output',
        'additional_kwargs', COALESCE(NULLIF(memory.message->'data'->'additional_kwargs', 'null'::jsonb), '{}'::jsonb)
          || '{"ticket41a_final":true}'::jsonb))
    ELSE memory.message || jsonb_build_object('content', decision.payload->>'output',
      'additional_kwargs', COALESCE(NULLIF(memory.message->'additional_kwargs', 'null'::jsonb), '{}'::jsonb)
        || '{"ticket41a_final":true}'::jsonb)
    END,
      updated_at = NOW()
  FROM decision
  WHERE memory.id = (
    SELECT id FROM public.onboarding_chat_memory
    WHERE session_id = decision.payload->>'session_id' AND message->>'type' = 'ai'
    ORDER BY created_at DESC, id DESC LIMIT 1
  )
    AND memory.session_id IN ('ticket41a:+5215554111111', 'ticket41a:+5215554222222')
  RETURNING memory.id
)
SELECT updated_session.*, (1 / (SELECT COUNT(*) FROM final_memory)::integer) AS harness_memory_updated
FROM updated_session;`,
  "={{ JSON.stringify($('Validate Sales Response Contract').item.json) }}",
  'Canonical response-state UPDATE, no funnel events. Persist final validated Chat output in the existing test AI-memory entry. Manual sequential turns only; no provider acceptance is fabricated.');

  const outputFields = `const input = $('Set Session Id').item.json;
const report = {
  session_id: input.session_id,
  fake_whatsapp_id: input.fake_whatsapp_id,
  user_message: input.chatInput,
  offer_context: decision.offer_context || null,
  interpretation: (() => { try { return $('Parse Sales Interpretation').item.json; } catch { return null; } })(),
  topic: decision.topic || null,
  health_scope: decision.topic === 'health_scope',
  medication_intent: decision.medication_intent || null,
  deterministic_response: decision.deterministic_response || null,
  deterministic_reason: decision.deterministic_reason || null,
  material_question: decision.material_question === true,
  fallback_identity: decision.fallback_identity || null,
  current_question_details_preserved: decision.current_question_details_preserved === true,
  unconfirmed_current_question_count: decision.unconfirmed_current_question_count || 0,
  explicit_current_questions_present: decision.explicit_current_questions_present === true,
  explicit_current_question_topics: decision.explicit_current_question_topics || [],
  historical_state_used_for_intent: decision.historical_state_used_for_intent === true,
  multi_topic_turn: decision.multi_topic_turn === true,
  generated_answer_coverage: decision.generated_answer_coverage || null,
  final_answer_coverage: decision.final_answer_coverage || null,
  coverage_warnings: decision.coverage_warnings || [],
  buyer_signal: decision.buyer_signal,
  strategy: decision.strategy,
  assistant_response: assistantResponse,
  generated_response: (() => { try { return $('Generate Sales Response v3').item.json.output || null; } catch { return null; } })(),
  final_validated_response: assistantResponse,
  checkout_authorized: decision.checkout_authorized === true,
  checkout_authorization_type: decision.checkout_authorization_type || null,
  allow_purchase_cta: decision.allow_purchase_cta === true,
  next_last_question_type: decision.next_last_question_type || null,
  offer_version: decision.offer_version,
  checkout_would_be_created: checkoutWouldBeCreated,
  holding_page_would_be_sent: decision.holding_page_would_be_sent === true,
  intercepted_action: interceptedAction,
};
return [{ json: { ...report, output: assistantResponse } }];`;
  addCode('Return Chat Response', `const persisted = $input.first().json;
if (Number(persisted.harness_memory_updated) !== 1) throw new Error('HARNESS_FINAL_MEMORY_NOT_PERSISTED');
const decision = $('Validate Sales Response Contract').item.json;
if (persisted.session_id !== decision.session_id) throw new Error('HARNESS_SESSION_STATE_MISMATCH');
const assistantResponse = decision.output;
const checkoutWouldBeCreated = false;
const interceptedAction = null;
${outputFields}`, 'Last-node Chat response plus minimal inspection fields; generated and final answers for test-only inspection; no prompts, credentials, or provider identifiers.');
  addCode('Intercept External Action', `const decision = $input.first().json;
const checkoutWouldBeCreated = decision.pending_action === 'send_checkout' && decision.checkout_authorized === true;
if (decision.pending_action === 'send_checkout' && !checkoutWouldBeCreated) throw new Error('HARNESS_UNAUTHORIZED_CHECKOUT');
if (!['send_checkout', 'schedule_requested_reminder'].includes(decision.pending_action)) throw new Error('HARNESS_UNEXPECTED_ACTION');
const interceptedAction = decision.pending_action;
const assistantResponse = checkoutWouldBeCreated
  ? '[TEST ONLY] Checkout would be created. No Stripe session or payment was created.'
  : '[TEST ONLY] Reminder intercepted. No reminder, WhatsApp message, or email was scheduled or sent.';
${outputFields}`, 'Terminal boundary before Checkout authorization persistence, Stripe, reminders, and all external delivery. No action is executed or simulated as a successful purchase.');

  const connections = {};
  const selected = new Set(nodes.map(n => n.name));
  for (const name of CANONICAL_NODES) {
    if (!production.connections[name]) continue;
    connections[name] = Object.fromEntries(Object.entries(production.connections[name]).map(([type, outputs]) => [type,
      outputs.map(edges => edges.filter(edge => selected.has(edge.node)).map(edge => ({...edge}))),
    ]));
  }
  const connect = (from, to) => {connections[from] = {main: [[{node: to, type: 'main', index: 0}]]};};
  connect('When chat message received', 'Configure Fake Identity');
  connect('Configure Fake Identity', 'Set Session Id');
  connect('Set Session Id', 'Get Onboarding Session');
  connect('Get Recent Sales Clarification Context', 'Apply Deterministic Commercial Policy');
  connections['Route Authorized Sales Action'].main[0] = [{node: 'Intercept External Action', type: 'main', index: 0}];
  connections['Route Authorized Sales Action'].main[1] = [{node: 'Intercept External Action', type: 'main', index: 0}];
  connect('Validate Sales Response Contract', 'Persist Harness Response State');
  connect('Persist Harness Response State', 'Return Chat Response');

  // Compact manual inspection layout, independent of the large production canvas.
  const mainOrder = ['When chat message received', 'Configure Fake Identity', 'Set Session Id',
    'Get Onboarding Session', 'If Existing Onboarding Session', 'Initialize Sales Lead v3',
    'Build Canonical Dietavity Knowledge', 'Interpret Sales Buyer Signal', 'Parse Sales Interpretation',
    'Get Recent Sales Clarification Context', 'Apply Deterministic Commercial Policy', 'Route Authorized Sales Action',
    'Build Constrained Sales Response', 'Generate Sales Response v3', 'Validate Sales Response Contract',
    'Persist Harness Response State', 'Return Chat Response'];
  mainOrder.forEach((name, i) => {node(name).position = [i * 240, 0];});
  node('Initialize Sales Lead v3').position[1] = 220;
  node('Intercept External Action').position = [12 * 240, -240];
  node('Sales Interpretation Model').position = [7 * 240, 220];
  node('Sales Response Model').position = [13 * 240, 220];
  node('Postgres Chat Memory').position = [14 * 240, 220];
  return {
    name: 'Dietavity Sales Conversation Test Harness (Ticket 41A)', nodes, connections,
    pinData: {}, active: false,
    settings: {executionOrder: production.settings.executionOrder, timezone: production.settings.timezone},
    versionId: stableId('workflow-version'), tags: [],
  };
}
const serialize = workflow => `${JSON.stringify(workflow, null, 2)}\n`;
function main() {
  const generated = serialize(buildHarness(JSON.parse(fs.readFileSync(sourcePath, 'utf8'))));
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== generated) {
      console.error('Ticket 41A harness is not synchronized with the canonical Sales Engine.');
      process.exitCode = 1;
    }
  } else {
    fs.writeFileSync(outputPath, generated);
    console.log(`Wrote ${path.relative(root, outputPath)}`);
  }
}
if (require.main === module) main();
module.exports = {buildHarness, serialize, CANONICAL_NODES, FAKE_IDENTITIES, SESSION_PREFIX};
