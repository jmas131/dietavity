'use strict';

// Generates a deliberately small, import-only n8n Chat workflow.  The Direct
// RAG intelligence nodes are copied from the current Ticket 10 artifact so
// prompts, taxonomy, resolver, and final gate retain one generator source.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json');
const outputPath = path.join(root, 'n8n/Dietavity Direct RAG Chat Harness.json');
const TEST_SESSION_ID = 'direct-rag-chat-harness:v1:synthetic-dietavity-customer';
const DIRECT_RAG_NODES = [
  'Interpret Sales Obligations', 'Sales Obligations Model',
  'Parse Direct RAG Obligations', 'Resolve Direct RAG Obligations',
  'Build Direct RAG Composition Envelope', 'Compose Grounded Sales Response',
  'Grounded Sales Response Model', 'Final Direct RAG Customer Response Gate',
];

function stableId(label) {
  const hex = crypto.createHash('sha256').update(`direct-rag-chat-harness:${label}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function clone(value) { return structuredClone(value); }
function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function buildHarness(production) {
  const source = name => {
    const found = production.nodes.find(node => node.name === name);
    if (!found) throw new Error(`Missing current Direct RAG node: ${name}`);
    return found;
  };
  const nodes = DIRECT_RAG_NODES.map(name => {
    const node = clone(source(name));
    node.id = stableId(name);
    if (node.credentials?.openAiApi) node.credentials = { openAiApi: { name: 'Dietavity Direct RAG Chat Harness OpenAI' } };
    return node;
  });
  const node = name => nodes.find(value => value.name === name);
  const add = (name, type, typeVersion, parameters, notes, credentials) => {
    const value = { name, id: stableId(name), type, typeVersion, parameters, position: [0, 0], notes };
    if (credentials) value.credentials = credentials;
    nodes.push(value);
    return value;
  };
  const postgresCredentials = { postgres: { name: 'Dietavity Direct RAG Chat Harness Postgres' } };
  const addCode = (name, jsCode, notes) => add(name, 'n8n-nodes-base.code', 2, { jsCode }, notes);
  const addSql = (name, query, queryReplacement, notes) => add(name, 'n8n-nodes-base.postgres', 2.6,
    { operation: 'executeQuery', query, options: { queryReplacement } }, notes, postgresCredentials);

  add('When Chat Message Received', '@n8n/n8n-nodes-langchain.chatTrigger', 1.1,
    { public: false, options: { responseMode: 'lastNode', loadPreviousSession: 'notSupported' } },
    'Manual developer Chat only. Keep the imported workflow inactive until intentionally used; it is not a WhatsApp webhook.');
  node('When Chat Message Received').webhookId = stableId('chat-webhook');
  addCode('Prepare Test Turn', `const chat = $('When Chat Message Received').item.json;
if (chat.action && chat.action !== 'sendMessage') throw new Error('DIRECT_RAG_HARNESS_SEND_MESSAGE_ONLY');
if (typeof chat.chatInput !== 'string' || !chat.chatInput.trim() || chat.chatInput.length > 2000) throw new Error('DIRECT_RAG_HARNESS_TEXT_REQUIRED');
return [{ json: { session_id: ${JSON.stringify(TEST_SESSION_ID)}, current_message: chat.chatInput.trim() } }];`,
  'Pins every Chat turn to one synthetic, non-phone identity. Ignores all Chat-supplied session and provider identifiers.');
  addSql('Get Test Conversation History', `SELECT COALESCE(jsonb_agg(entry ORDER BY harness_sequence ASC), '[]'::jsonb) AS history
FROM (
  SELECT CASE WHEN message->'data'->>'harness_sequence' ~ '^[0-9]+$' THEN (message->'data'->>'harness_sequence')::bigint END AS harness_sequence, jsonb_build_object(
    'role', CASE WHEN message->>'type' = 'ai' THEN 'assistant' ELSE 'customer' END,
    'text', COALESCE(message->'data'->>'content', message->>'content', '')
  ) AS entry
  FROM public.onboarding_chat_memory
  WHERE session_id = $1::jsonb->>'session_id'
    AND message->'data'->>'harness_sequence' ~ '^[0-9]+$'
  ORDER BY harness_sequence DESC
  LIMIT 12
) AS bounded_history;`,
  "={{ JSON.stringify($('Prepare Test Turn').item.json) }}",
  'Reads only the namespaced synthetic transcript from AI memory. The persisted harness_sequence is the authoritative monotonic order: latest 12 are selected descending, then returned oldest-to-newest. It never reads the canonical WhatsApp messages ledger.');
  addCode('Build Direct RAG Test Context', `const turn = $('Prepare Test Turn').item.json;
const rawHistory = $input.first().json.history;
let rows = Array.isArray(rawHistory) ? rawHistory : [];
if (typeof rawHistory === 'string') { try { rows = JSON.parse(rawHistory); } catch { rows = []; } }
const history = rows.slice(-12).map(row => ({ role: row.role === 'assistant' ? 'assistant' : 'customer', text: String(row.text || '').slice(0, 1000) }));
return [{ json: { contract_version: 'direct-rag-v3-proposition-test', locale: 'es-MX', session_id: turn.session_id, inbound_message_id: null, inbound_message_sid: null, current_message: turn.current_message, history, most_recent_assistant_message: history.filter(row => row.role === 'assistant').at(-1)?.text || '', customer_state: { paid: false }, commercial_state: { purchase_context: false, checkout_suppressed: true }, offer_version: 'glp1-whatsapp-free-test-v3' } }];`,
  'Side-effect-free adapter for the Ticket 10 Direct RAG V3 context. The synthetic harness never grants purchase context or a paid customer state.');
  // The cloned production nodes expect this exact context-node name. Renaming
  // only the adapter keeps their generated prompt/resolver/gate byte-for-byte
  // synchronized with Ticket 10.
  node('Parse Direct RAG Obligations').parameters.jsCode = node('Parse Direct RAG Obligations').parameters.jsCode
    .replace("$('Build Direct RAG Conversation Context')", "$('Build Direct RAG Test Context')");
  addCode('Assert No External Action', `const value = $input.first().json;
if (value.authorized_action !== null || value.checkout_authorized !== false || value.pending_action !== 'respond') throw new Error('DIRECT_RAG_HARNESS_EXTERNAL_ACTION_BLOCKED');
return [{ json: value }];`,
  'Hard terminal guard: even if future source changes create an action, this harness fails before any Checkout, delivery, reservation, or state mutation.');
  addSql('Persist Test Conversation', `WITH turn AS (SELECT $1::jsonb AS payload), locked AS (
  SELECT pg_advisory_xact_lock(hashtext(payload->>'session_id')) FROM turn
), next_sequence AS (
  SELECT COALESCE(MAX((memory.message->'data'->>'harness_sequence')::bigint), 0) AS last_sequence
  FROM public.onboarding_chat_memory AS memory
  CROSS JOIN turn CROSS JOIN locked
  WHERE memory.session_id = turn.payload->>'session_id'
    AND memory.message->'data'->>'harness_sequence' ~ '^[0-9]+$'
), inserted AS (
  INSERT INTO public.onboarding_chat_memory (session_id, message)
  SELECT payload->>'session_id', jsonb_build_object('type', 'human', 'data', jsonb_build_object('content', payload->>'current_message', 'harness_sequence', last_sequence + 1)) FROM turn CROSS JOIN next_sequence
  UNION ALL
  SELECT payload->>'session_id', jsonb_build_object('type', 'ai', 'data', jsonb_build_object('content', payload->>'output', 'harness_sequence', last_sequence + 2)) FROM turn CROSS JOIN next_sequence
  RETURNING id
)
SELECT (SELECT COUNT(*) FROM inserted) AS persisted_turn_messages;`,
  "={{ JSON.stringify({ session_id: $('Prepare Test Turn').item.json.session_id, current_message: $('Prepare Test Turn').item.json.current_message, output: $('Final Direct RAG Customer Response Gate').item.json.output }) }}",
  'Writes exactly the synthetic user/assistant transcript after the final Direct RAG gate with a transaction-locked, monotonic synthetic sequence. No users, sessions, messages ledger, funnel events, delivery reservations, or provider identifiers are touched.');
  addCode('Respond to Chat', `const persisted = $input.first().json;
if (Number(persisted.persisted_turn_messages) !== 2) throw new Error('DIRECT_RAG_HARNESS_TRANSCRIPT_NOT_PERSISTED');
const result = $('Final Direct RAG Customer Response Gate').item.json;
return [{ json: { output: result.output, assistant_response: result.output, test_identity: ${JSON.stringify(TEST_SESSION_ID)}, checkout_executed: false, checkout_suppressed_reason: result.checkout_suppressed_reason || null } }];`,
  'Last-node Chat response. It returns only the final gated customer response and safe test metadata.');
  add('Reset Test Conversation', 'n8n-nodes-base.manualTrigger', 1, {},
    'Run this separate manual branch to delete only this harness’s fixed synthetic transcript before a new conversation.');
  addSql('Clear Test Conversation', `DELETE FROM public.onboarding_chat_memory
WHERE session_id = $1::jsonb->>'session_id'
RETURNING id;`, `={{ JSON.stringify({ session_id: ${JSON.stringify(TEST_SESSION_ID)} }) }}`,
  'Reset is strictly limited to the synthetic Direct RAG Chat Harness session; no real customer history or analytics can match it.');

  const connections = {};
  const connect = (from, to) => { connections[from] = { main: [[{ node: to, type: 'main', index: 0 }]] }; };
  connect('When Chat Message Received', 'Prepare Test Turn');
  connect('Prepare Test Turn', 'Get Test Conversation History');
  connect('Get Test Conversation History', 'Build Direct RAG Test Context');
  connect('Build Direct RAG Test Context', 'Interpret Sales Obligations');
  connect('Interpret Sales Obligations', 'Parse Direct RAG Obligations');
  connections['Sales Obligations Model'] = { ai_languageModel: [[{ node: 'Interpret Sales Obligations', type: 'ai_languageModel', index: 0 }]] };
  connect('Parse Direct RAG Obligations', 'Resolve Direct RAG Obligations');
  connect('Resolve Direct RAG Obligations', 'Assert No External Action');
  connect('Assert No External Action', 'Build Direct RAG Composition Envelope');
  connect('Build Direct RAG Composition Envelope', 'Compose Grounded Sales Response');
  connections['Grounded Sales Response Model'] = { ai_languageModel: [[{ node: 'Compose Grounded Sales Response', type: 'ai_languageModel', index: 0 }]] };
  connect('Compose Grounded Sales Response', 'Final Direct RAG Customer Response Gate');
  connect('Final Direct RAG Customer Response Gate', 'Persist Test Conversation');
  connect('Persist Test Conversation', 'Respond to Chat');
  connect('Reset Test Conversation', 'Clear Test Conversation');

  const mainOrder = ['When Chat Message Received', 'Prepare Test Turn', 'Get Test Conversation History', 'Build Direct RAG Test Context', 'Interpret Sales Obligations', 'Parse Direct RAG Obligations', 'Resolve Direct RAG Obligations', 'Assert No External Action', 'Build Direct RAG Composition Envelope', 'Compose Grounded Sales Response', 'Final Direct RAG Customer Response Gate', 'Persist Test Conversation', 'Respond to Chat'];
  mainOrder.forEach((name, index) => { node(name).position = [index * 250, 300]; });
  node('Sales Obligations Model').position = [1000, 480];
  node('Grounded Sales Response Model').position = [2500, 480];
  node('Reset Test Conversation').position = [0, 700];
  node('Clear Test Conversation').position = [250, 700];
  return { name: 'Dietavity Direct RAG Chat Harness', active: false, settings: {}, pinData: {}, nodes, connections };
}

if (require.main === module) {
  const production = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  fs.writeFileSync(outputPath, serialize(buildHarness(production)));
  console.log(`Wrote ${path.relative(root, outputPath)}`);
}
module.exports = { buildHarness, serialize, DIRECT_RAG_NODES, TEST_SESSION_ID };
