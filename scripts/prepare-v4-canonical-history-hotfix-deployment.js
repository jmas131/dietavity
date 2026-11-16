'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [sourcePath, backupPath, artifactPath, validationPath] = process.argv.slice(2);
if (!sourcePath || !backupPath || !artifactPath || !validationPath) {
  throw new Error('Usage: node scripts/prepare-v4-canonical-history-hotfix-deployment.js <fresh-export.json> <backup.json> <artifact.json> <validation.json>');
}

const sourceText = fs.readFileSync(sourcePath, 'utf8');
const source = JSON.parse(sourceText);
const artifact = JSON.parse(JSON.stringify(source));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const one = (workflow, name) => {
  const matches = workflow.nodes.filter(node => node.name === name);
  if (matches.length !== 1) throw new Error(`Expected exactly one node named ${name}, found ${matches.length}`);
  return matches[0];
};

if (source.id !== 'DbdFTtuPwxTZSkp3' || source.name !== 'Dietavity Sales Engine (Ticket 10)' || source.active !== true) {
  throw new Error('Unexpected production workflow identity or activation state');
}
if (source.connections?.['Route Session Claim State']?.main?.[0]?.[0]?.node !== 'IF Media Without Text') {
  throw new Error('Media hotfix acquired route is absent');
}
if (source.connections?.['IF Media Without Text']?.main?.[1]?.[0]?.node !== 'Get V4 Conversation Context') {
  throw new Error('Media hotfix text route is absent');
}
const mediaLogUserId = one(source, 'Prepare Log Data Message Without Text').parameters.assignments.assignments
  .find(assignment => assignment.name === 'user_id')?.value;
if (mediaLogUserId !== "={{ $('Claim Next Session Inbound').item.json.user_id || null }}") {
  throw new Error('Media hotfix log user_id is absent');
}
if (!one(source, 'Reserve Media Clarification').parameters.options.queryReplacement.includes("user_id: ($('Claim Next Session Inbound').item.json.user_id || null)")) {
  throw new Error('Media hotfix reservation user_id is absent');
}

const context = one(artifact, 'Get V4 Conversation Context');
const contextIndex = artifact.nodes.indexOf(context);
const before = `), bounded_history AS (\n  SELECT * FROM chronological_history\n  ORDER BY source_processing_order DESC, role_sort DESC, timestamp DESC, id DESC`;
const after = `), nonempty_history AS (\n  SELECT * FROM chronological_history\n  WHERE text !~ '^[[:space:]]*$'\n), bounded_history AS (\n  SELECT * FROM nonempty_history\n  ORDER BY source_processing_order DESC, role_sort DESC, timestamp DESC, id DESC`;
if (!context.parameters.query.includes(before) || context.parameters.query.includes('nonempty_history AS')) {
  throw new Error('Unexpected V4 context query baseline');
}
context.parameters.query = context.parameters.query.replace(before, () => after);

const differences = (beforeValue, afterValue, currentPath = '') => {
  if (Object.is(beforeValue, afterValue)) return [];
  if (!beforeValue || !afterValue || typeof beforeValue !== 'object' || typeof afterValue !== 'object' || Array.isArray(beforeValue) !== Array.isArray(afterValue)) {
    return [{ path: currentPath, before: beforeValue, after: afterValue }];
  }
  const keys = new Set([...Object.keys(beforeValue), ...Object.keys(afterValue)]);
  return [...keys].flatMap(key => differences(beforeValue[key], afterValue[key], currentPath ? `${currentPath}.${key}` : key));
};
const changes = differences(source, artifact);
if (changes.length !== 1 || changes[0].path !== `nodes.${contextIndex}.parameters.query`) {
  throw new Error(`Expected exactly one semantic change, got ${JSON.stringify(changes.map(change => change.path))}`);
}

const identity = ['id', 'versionId', 'active', 'settings', 'meta', 'tags', 'nodeGroups', 'pinData'];
for (const key of identity) if (JSON.stringify(source[key]) !== JSON.stringify(artifact[key])) throw new Error(`Production ${key} changed`);
for (let index = 0; index < source.nodes.length; index += 1) {
  if (source.nodes[index].id !== artifact.nodes[index].id) throw new Error(`Node ID changed at index ${index}`);
  if (JSON.stringify(source.nodes[index].credentials) !== JSON.stringify(artifact.nodes[index].credentials)) throw new Error(`Credential binding changed on ${source.nodes[index].name}`);
}

fs.mkdirSync(path.dirname(backupPath), { recursive: true });
fs.writeFileSync(backupPath, sourceText);
fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
const validation = {
  source: { path: sourcePath, sha256: sha256(sourceText), workflowId: source.id, versionId: source.versionId, active: source.active, nodeCount: source.nodes.length, connectionCount: Object.keys(source.connections).length },
  backup: { path: backupPath, sha256: sha256(fs.readFileSync(backupPath, 'utf8')) },
  artifact: { path: artifactPath, sha256: sha256(fs.readFileSync(artifactPath, 'utf8')) },
  confirmedMediaHotfix: true,
  semanticChanges: changes,
  preserved: ['workflow identity', 'activation state', 'settings', 'metadata', 'node IDs', 'credential bindings', 'connections except the V4 context query'],
};
fs.mkdirSync(path.dirname(validationPath), { recursive: true });
fs.writeFileSync(validationPath, `${JSON.stringify(validation, null, 2)}\n`);
console.log(JSON.stringify(validation, null, 2));
