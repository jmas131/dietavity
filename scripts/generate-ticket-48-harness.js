'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createHarness} = require('../lib/ticket-48-harness');
const policy = require('../lib/sales-engine-v3');
const contract = require('../lib/sales-response-contract');
const {OFFER_VERSION} = require('../lib/dietavity-knowledge');
const library = require('../test-support/ticket-48/scenarios.json');
const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json');
const outputPath = path.join(root, 'n8n/Dietavity Autonomous Conversation Harness (Ticket 48).json');
const canonicalNames = ['Build Canonical Dietavity Knowledge', 'Parse Sales Interpretation',
  'Apply Deterministic Commercial Policy', 'Build Constrained Sales Response', 'Validate Sales Response Contract'];
const helperNames = ['normalizeMessage', 'detectOfferContext', 'hasDeterministicExplicitPurchase', 'isStrongAffirmation',
  'validContext', 'responseHasAmbiguousQuestion', 'glp1ResponseViolatesScope',
  'hasExplicitCurrentReminderRequest', 'explicitProductQuestions', 'productAnswerCoverage', 'multiTopicDiagnostics',
  'medicationIntent', 'currentQuestionUnits', 'currentQuestionClauses', 'currentQuestionDetails',
  'constrainedSampleRequest', 'practicalGuidanceQuestion', 'uncertaintySubject', 'currentClauseCoverage',
  'currentConversationalTask', 'taskProductMessage', 'conversationalTaskCoverage'];
const helpers = {...policy, ...contract, ...require('../lib/sales-conversational-task')};
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function buildPrelude(production) {
  const get = name => { const n = production.nodes.find(n => n.name === name); if (!n) throw new Error(`Missing canonical node ${name}`); return n; };
  // The adapter mirrors this reviewed UPDATE, not the event/lease machinery.
  // A canonical SQL change requires explicit adapter review before regeneration.
  const stateSqlHash = hash(get('Persist Sales Response State and Events').parameters.query);
  if (stateSqlHash !== '50eeff767392a6a6caa47d7c50867f2db6c0cf038c34ddf58ffa29ab0feb9679') {
    throw new Error('Canonical state SQL changed: review the Ticket 48 memory adapter');
  }
  const canonical = canonicalNames.map(name => {
    const code = get(name).parameters.jsCode;
    // These imported sources must remain pure Code nodes. Fail generation closed
    // if a future canonical change adds capabilities instead of policy logic.
    if (/\b(?:require|fetch|eval|Function|process|globalThis|global|Buffer|XMLHttpRequest)\b|\$helpers|\$http|\$env|\$getWorkflowStaticData|import\s*\(/.test(code)) throw new Error(`Unsafe canonical capability: ${name}`);
    return `${JSON.stringify(name)}: function($, $input) {\n${code}\n}`;
  }).join(',\n');
  const structuredModel = structuredClone(get('Sales Response Model').parameters);
  structuredModel.options = {...structuredModel.options, responseFormat: 'json_object'};
  const metadata = {structured_output: {transport: 'json_object', validation: 'strict local schema', max_repairs_per_output: 1},
    sales_engine_artifact: path.basename(sourcePath), sales_engine_sha256: hash(JSON.stringify(production)),
    state_adapter_version: 'ticket48-memory-v1', state_sql_sha256: hash(get('Persist Sales Response State and Events').parameters.query),
    interpretation_prompt: get('Interpret Sales Buyer Signal').parameters.options.systemMessage,
    models: {customer: structuredModel, customer_repair: structuredModel, judge: structuredModel, judge_repair: structuredModel,
      sales_interpretation: get('Sales Interpretation Model').parameters, sales_response: get('Sales Response Model').parameters},
    scenario_library_sha256: hash(JSON.stringify(library)), harness_sha256: hash(createHarness.toString())};
  return `const OFFER_VERSION = ${JSON.stringify(OFFER_VERSION)};\n${helperNames.map(n => helpers[n].toString()).join('\n')}\nconst harness = (${createHarness.toString()})({${canonical}}, {${helperNames.join(',')}, currentQuestionFacts: ${JSON.stringify(require('../lib/dietavity-knowledge').MULTI_TOPIC_ANSWERS)}}, ${JSON.stringify(metadata)}, ${JSON.stringify(library)});\n`;
}
function buildHarness(production) {
  const prelude = buildPrelude(production);
  const nodes = [], connections = {};
  const add = (name, type, typeVersion, parameters, extra = {}) => {
    const n = {name, id: hash(`ticket48:${name}`).slice(0, 32), type, typeVersion, parameters,
      position: [nodes.length * 240, 0], ...extra}; nodes.push(n); return n;
  };
  const code = (name, body) => add(name, 'n8n-nodes-base.code', 2, {jsCode: `${prelude}\n${body}`});
  const edge = (from, to, branch = 0, type = 'main') => {
    connections[from] ||= {}; connections[from][type] ||= [];
    while (connections[from][type].length <= branch) connections[from][type].push([]);
    connections[from][type][branch].push({node: to, type, index: 0});
  };
  const branch = (name, expression) => add(name, 'n8n-nodes-base.if', 2.2, {conditions: {options: {caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2},
    conditions: [{id: hash(name).slice(0, 32), leftValue: expression, rightValue: true, operator: {type: 'boolean', operation: 'true', singleValue: true}}], combinator: 'and'}, options: {}});
  const agent = (name, modelName, sourceName) => {
    const source = production.nodes.find(n => n.name === sourceName);
    const a = add(name, source.type, source.typeVersion, {promptType: 'define', text: '={{ $json.model_input }}',
      options: {systemMessage: '={{ $json.model_system }}', maxIterations: 1}}, {onError: 'continueRegularOutput', retryOnFail: false});
    const modelSource = production.nodes.find(n => n.name === modelName);
    const m = add(`${name} Model`, modelSource.type, modelSource.typeVersion, structuredClone(modelSource.parameters),
      {credentials: {openAiApi: {name: 'Dietavity Autonomous Harness OpenAI'}}});
    if (['Generate Customer Turn', 'Repair Customer Output', 'Generate Judge', 'Repair Judge Output'].includes(name)) {
      // JSON object mode already exists on this self-hosted model-node type.
      // Exact required fields/types are enforced by the portable validator.
      m.parameters.options = {...m.parameters.options, responseFormat: 'json_object'};
    }
    m.position = [a.position[0], 260]; edge(m.name, name, 0, 'ai_languageModel');
  };
  add('Manual Trigger', 'n8n-nodes-base.manualTrigger', 1, {});
  add('Load Test Scenario', 'n8n-nodes-base.code', 2, {jsCode: `// Select 1 to 8 library IDs. No arbitrary workflow IDs, URLs or customer identities.\nreturn [{json: {target: 'sales', scenario_ids: ['curious_glp1_001'], max_customer_turns: 12}}];`});
  code('Initialize Synthetic Customer', 'return [{json: harness.initialize($input.first().json, String($execution.id))}];');
  code('Prepare Customer Turn', 'return [{json: harness.prepareCustomer($input.first().json)}];');
  agent('Generate Customer Turn', 'Sales Response Model', 'Generate Sales Response v3');
  code('Validate Customer Turn', "return [{json: harness.acceptCustomer($('Prepare Customer Turn').item.json, $input.first().json)}];");
  branch('Customer Repair Needed?', '={{ $json.customer_repair_needed === true }}');
  code('Prepare Customer Repair', 'return [{json: harness.prepareCustomerRepair($input.first().json)}];');
  agent('Repair Customer Output', 'Sales Response Model', 'Generate Sales Response v3');
  code('Validate Customer Repair', "return [{json: harness.acceptCustomer($('Prepare Customer Repair').item.json, $input.first().json, true)}];");
  branch('Customer Valid?', '={{ !$json.termination_reason }}');
  code('Prepare Isolated Sales Engine', 'return [{json: harness.prepareInterpretation($input.first().json)}];');
  branch('Engine Prepared?', '={{ !$json.termination_reason }}');
  agent('Interpret Isolated Sales Turn', 'Sales Interpretation Model', 'Interpret Sales Buyer Signal');
  code('Execute Isolated Sales Policy', "return [{json: harness.decide($('Prepare Isolated Sales Engine').item.json, $input.first().json)}];");
  branch('Needs Sales Response?', '={{ $json.needs_response === true }}');
  agent('Generate Isolated Sales Response', 'Sales Response Model', 'Generate Sales Response v3');
  code('Capture Final Customer-Visible Response', "return [{json: harness.capture($('Execute Isolated Sales Policy').item.json, $input.first().json)}];");
  code('Intercept External Action', 'return [{json: harness.capture($input.first().json, null)}];');
  branch('Termination?', '={{ Boolean($json.termination_reason) }}');
  code('Prepare Independent Judge', 'return [{json: harness.prepareJudge($input.first().json)}];');
  agent('Generate Judge', 'Sales Response Model', 'Generate Sales Response v3');
  code('Validate Judge Output', "return [{json: harness.acceptJudge($('Prepare Independent Judge').item.json, $input.first().json)}];");
  branch('Judge Repair Needed?', '={{ $json.judge_repair_needed === true }}');
  code('Prepare Judge Repair', 'return [{json: harness.prepareJudgeRepair($input.first().json)}];');
  agent('Repair Judge Output', 'Sales Response Model', 'Generate Sales Response v3');
  code('Validate Judge Repair', "return [{json: harness.acceptJudge($('Prepare Judge Repair').item.json, $input.first().json, true)}];");
  code('Record Scenario Report', 'return [{json: harness.finish($input.first().json)}];');
  branch('Batch Complete?', '={{ $json.done === true }}');
  code('Test Report', 'return [{json: harness.batchReport($input.first().json)}];');
  for (const [from,to] of [['Manual Trigger','Load Test Scenario'],['Load Test Scenario','Initialize Synthetic Customer'],
    ['Initialize Synthetic Customer','Prepare Customer Turn'],['Prepare Customer Turn','Generate Customer Turn'],
    ['Generate Customer Turn','Validate Customer Turn'],['Validate Customer Turn','Customer Repair Needed?'],
    ['Customer Repair Needed?','Prepare Customer Repair'],['Prepare Customer Repair','Repair Customer Output'],
    ['Repair Customer Output','Validate Customer Repair'],['Validate Customer Repair','Customer Valid?'],
    ['Customer Valid?','Prepare Isolated Sales Engine'],['Prepare Isolated Sales Engine','Engine Prepared?'],
    ['Engine Prepared?','Interpret Isolated Sales Turn'],
    ['Interpret Isolated Sales Turn','Execute Isolated Sales Policy'],['Execute Isolated Sales Policy','Needs Sales Response?'],
    ['Needs Sales Response?','Generate Isolated Sales Response'],['Generate Isolated Sales Response','Capture Final Customer-Visible Response'],
    ['Capture Final Customer-Visible Response','Termination?'],['Intercept External Action','Termination?'],
    ['Termination?','Prepare Independent Judge'],['Prepare Independent Judge','Generate Judge'],
    ['Generate Judge','Validate Judge Output'],['Validate Judge Output','Judge Repair Needed?'],
    ['Judge Repair Needed?','Prepare Judge Repair'],['Prepare Judge Repair','Repair Judge Output'],
    ['Repair Judge Output','Validate Judge Repair'],['Validate Judge Repair','Record Scenario Report'],
    ['Record Scenario Report','Batch Complete?'],['Batch Complete?','Test Report']]) edge(from,to);
  edge('Customer Repair Needed?', 'Customer Valid?', 1);
  edge('Judge Repair Needed?', 'Record Scenario Report', 1);
  edge('Customer Valid?', 'Prepare Independent Judge', 1);
  edge('Engine Prepared?', 'Prepare Independent Judge', 1);
  edge('Needs Sales Response?', 'Intercept External Action', 1);
  edge('Termination?', 'Prepare Customer Turn', 1);
  edge('Batch Complete?', 'Prepare Customer Turn', 1);
  return {name: 'Dietavity Autonomous Conversation Harness (Ticket 48)', active: false, nodes, connections, pinData: {},
    settings: {executionOrder: production.settings.executionOrder, timezone: production.settings.timezone,
      executionTimeout: 1800, saveManualExecutions: true}, tags: []};
}
function main() {
  const output = JSON.stringify(buildHarness(JSON.parse(fs.readFileSync(sourcePath, 'utf8'))), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== output) throw new Error('Ticket 48 artifact is stale');
  } else { fs.writeFileSync(outputPath, output); console.log(path.relative(root, outputPath)); }
}
if (require.main === module) main();
module.exports = {buildHarness, buildPrelude, canonicalNames, sourcePath, outputPath};
