'use strict';

// Builds an inactive, production-specific Ticket75 shadow candidate.  The
// operator export is the base; the repository workflow is used only as a
// closed definition of the Ticket75 nodes and edges.  This intentionally does
// not invoke the ordinary Ticket 10 generator, because that generator starts
// from the historical canonical-ledger artifact rather than the fresh export.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const templatePath = path.join(root, 'n8n', 'Dietavity Sales Engine (Ticket 10).json');
const EXPECTED_ID = '9oRFrbGVuK91LaAD';
const EXPECTED_NAME = 'Dietavity Sales Engine (Ticket 10)';
const ERROR_WORKFLOW_ID = 'sa10JQEAbxNYvCGG';
const ACQUIRED = 'Route Session Claim State';
const BUSY_WAIT = 'Wait Before Session Claim Retry';
const CLAIM = 'Claim Next Session Inbound';
const LEGACY_ENTRY = 'Get User from Supabase';
const PROTECTED_NODES = Object.freeze([
  'Build Canonical Dietavity Knowledge',
  'Interpret Sales Buyer Signal',
  'Parse Sales Interpretation',
  'Apply Deterministic Commercial Policy',
  'Build Constrained Sales Response',
  'Validate Sales Response Contract',
  'Reserve Checkout Reply',
  'Wait Before Session Claim Retry',
  'Loop Paid WhatsApp Parts',
]);
const REQUIRED_LEGACY_NODES = Object.freeze([
  LEGACY_ENTRY,
  'Prepare Paid WhatsApp Message Parts',
  'Reserve Paid Assistant Reply',
  'Loop Paid WhatsApp Parts',
  'Send All Intents Message',
  'Update Paid Assistant Reply Delivery',
  'Assert Paid Assistant Reply Accepted',
  'Update Last Assistant Message',
  'Mark Session Inbound Complete',
]);

const stable = value => JSON.stringify(value, null, 2) + '\n';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const edges = (workflow, source, output = 0) => (workflow.connections[source]?.main?.[output] || []).map(edge => edge.node);
const fail = message => { const error = new Error(`T75G3D_MERGE_INVALID: ${message}`); error.code = 'T75G3D_MERGE_INVALID'; throw error; };

function nodeMap(workflow) {
  const map = new Map();
  for (const node of workflow.nodes || []) {
    if (!node || typeof node.name !== 'string' || !node.name) fail('workflow contains an unnamed node');
    if (map.has(node.name)) fail(`duplicate node name ${node.name}`);
    map.set(node.name, node);
  }
  return map;
}

function validateConnections(workflow) {
  const names = nodeMap(workflow);
  const ids = new Set();
  for (const node of workflow.nodes) {
    if (!node.id || ids.has(node.id)) fail(`duplicate or missing node id ${node.id || '(missing)'}`);
    ids.add(node.id);
  }
  for (const [source, definition] of Object.entries(workflow.connections || {})) {
    if (!names.has(source)) fail(`connection source missing node ${source}`);
    for (const group of definition.main || []) for (const edge of group || []) {
      if (!names.has(edge.node)) fail(`connection target missing node ${edge.node}`);
      if (edge.type !== 'main' || !Number.isInteger(edge.index) || edge.index < 0) fail(`invalid connection from ${source}`);
    }
  }
}

function validateFreshBase(workflow) {
  if (workflow.id !== EXPECTED_ID) fail(`expected workflow id ${EXPECTED_ID}`);
  if (workflow.name !== EXPECTED_NAME) fail(`expected workflow name ${EXPECTED_NAME}`);
  if (workflow.active !== true) fail('fresh export must represent active production state');
  if (workflow.settings?.errorWorkflow !== ERROR_WORKFLOW_ID) fail('Global Error Handler association differs');
  const nodes = nodeMap(workflow);
  for (const name of [CLAIM, ACQUIRED, BUSY_WAIT, ...PROTECTED_NODES, ...REQUIRED_LEGACY_NODES]) if (!nodes.has(name)) fail(`required production node missing: ${name}`);
  if (JSON.stringify(edges(workflow, ACQUIRED, 0)) !== JSON.stringify([LEGACY_ENTRY])) fail('acquired claim seam is not Route Session Claim State -> Get User from Supabase');
  if (JSON.stringify(edges(workflow, ACQUIRED, 1)) !== JSON.stringify([BUSY_WAIT])) fail('busy branch is not Route Session Claim State -> Wait Before Session Claim Retry');
  if (JSON.stringify(edges(workflow, BUSY_WAIT, 0)) !== JSON.stringify([CLAIM])) fail('busy retry does not return to Claim Next Session Inbound');
  validateConnections(workflow);
}

function ticket75Nodes(template) {
  const nodes = template.nodes.filter(node => /^75(?:e1|f2|g3b|g3c)/.test(String(node.id || '')));
  if (nodes.length === 0) fail('repository Ticket75 topology definitions are absent');
  return nodes;
}

function ticket75Connections(template, addedNames) {
  const selected = {};
  for (const name of addedNames) {
    // A terminal live fail-closed node intentionally has no outgoing edge.
    if (template.connections[name]) selected[name] = clone(template.connections[name]);
  }
  return selected;
}

function preservationManifest(base, candidate, sourceSha) {
  const baseNodes = nodeMap(base); const candidateNodes = nodeMap(candidate);
  const differences = [];
  for (const node of candidate.nodes) if (!baseNodes.has(node.name)) differences.push({ category: 'ticket75_added_node', node_id: node.id, node_name: node.name });
  for (const node of base.nodes) {
    if (!candidateNodes.has(node.name)) fail(`candidate removed production node ${node.name}`);
    if (JSON.stringify(node) !== JSON.stringify(candidateNodes.get(node.name))) fail(`candidate changed production node ${node.name}`);
  }
  if (base.active !== candidate.active) differences.push({ category: 'ticket75_required_setting', setting: 'active', from: base.active, to: candidate.active, reason: 'candidate must be inactive on import' });
  const allSources = new Set([...Object.keys(base.connections || {}), ...Object.keys(candidate.connections || {})]);
  for (const source of [...allSources].sort()) {
    const before = base.connections[source]; const after = candidate.connections[source];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (!before && after && /^75(?:e1|f2|g3b|g3c)/.test(String(candidateNodes.get(source)?.id || ''))) {
      differences.push({ category: 'ticket75_added_edge', source, connections: after }); continue;
    }
    if (source === ACQUIRED && JSON.stringify(before?.main?.[0]) === JSON.stringify([{ node: LEGACY_ENTRY, type: 'main', index: 0 }]) && JSON.stringify(after?.main?.[0]) === JSON.stringify([{ node: 'Route Sales Engine V2 Claim', type: 'main', index: 0 }]) && JSON.stringify(before?.main?.slice(1)) === JSON.stringify(after?.main?.slice(1))) {
      differences.push({ category: 'ticket75_required_modified_edge', source, output: 0, from: LEGACY_ENTRY, to: 'Route Sales Engine V2 Claim' }); continue;
    }
    fail(`unclassified connection difference at ${source}`);
  }
  return {
    contract_version: 'ticket-75g3d-preservation-v1',
    source_identity: { workflow_id: base.id, workflow_name: base.name, active: base.active, node_count: base.nodes.length, sha256: sourceSha },
    candidate_identity: { workflow_id: candidate.id, workflow_name: candidate.name, active: candidate.active, node_count: candidate.nodes.length },
    protected_production_nodes: PROTECTED_NODES.map(name => ({ name, sha256: sha256(stable(baseNodes.get(name))), unchanged: true })),
    differences,
  };
}

function merge({ fresh, template }) {
  validateFreshBase(fresh); validateConnections(template);
  const candidate = clone(fresh); const current = nodeMap(candidate);
  const additions = ticket75Nodes(template);
  for (const node of additions) {
    if (current.has(node.name) || candidate.nodes.some(existing => existing.id === node.id)) fail(`Ticket75 node collides with production node ${node.name}`);
    candidate.nodes.push(clone(node)); current.set(node.name, node);
  }
  const addedNames = new Set(additions.map(node => node.name));
  Object.assign(candidate.connections, ticket75Connections(template, addedNames));
  candidate.connections[ACQUIRED] = clone(candidate.connections[ACQUIRED]);
  candidate.connections[ACQUIRED].main[0] = [{ node: 'Route Sales Engine V2 Claim', type: 'main', index: 0 }];
  // An import is safe by construction.  The route itself remains disabled by
  // default in its environment-backed code node; no cohort is in this JSON.
  candidate.active = false;
  if (candidate.id !== fresh.id || candidate.name !== fresh.name || candidate.settings?.errorWorkflow !== fresh.settings?.errorWorkflow) fail('candidate changed production identity or Global Error Handler association');
  for (const name of PROTECTED_NODES) if (JSON.stringify(nodeMap(fresh).get(name)) !== JSON.stringify(nodeMap(candidate).get(name))) fail(`protected production node changed: ${name}`);
  if (JSON.stringify(edges(candidate, ACQUIRED, 1)) !== JSON.stringify(edges(fresh, ACQUIRED, 1)) || JSON.stringify(edges(candidate, BUSY_WAIT, 0)) !== JSON.stringify(edges(fresh, BUSY_WAIT, 0))) fail('busy branch changed');
  validateConnections(candidate);
  return candidate;
}

function run(argv) {
  const [sourcePath, outputPath, manifestPath] = argv;
  if (!sourcePath || !outputPath || !manifestPath) throw new Error('Usage: node scripts/merge-ticket-75g3d-production-workflow.js <fresh-production-export.json> <candidate.json> <manifest.json>');
  const source = fs.readFileSync(sourcePath, 'utf8'); const fresh = JSON.parse(source);
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const candidate = merge({ fresh, template }); const manifest = preservationManifest(fresh, candidate, sha256(source));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(outputPath, stable(candidate)); fs.writeFileSync(manifestPath, stable(manifest));
  process.stdout.write(`Wrote ${path.relative(root, outputPath)} and ${path.relative(root, manifestPath)}\n`);
}

if (require.main === module) run(process.argv.slice(2));

module.exports = { EXPECTED_ID, EXPECTED_NAME, ERROR_WORKFLOW_ID, PROTECTED_NODES, REQUIRED_LEGACY_NODES, merge, preservationManifest, validateFreshBase, sha256, stable };
