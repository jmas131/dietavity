#!/usr/bin/env node
'use strict';

// Applies only Ticket 85M's Code-node single-output correction to the
// canonical Sales Engine export. It makes no n8n, database, or network calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json');
const SERIALIZE = 'Serialize V4 Acquired Claims';
const SERIALIZE_ROUTE = 'Route V4 Serialized Claim';
const RELEASE = 'Release Additional V4 Acquired Claims';
const ROUTE = 'Route Session Claim State';
const RELEASE_ROUTE_MARKER = '_dietavity_v4_claim_route';

function serializationCode() {
  return `// The downstream V4 path is one logical turn at a time. A duplicate
// claim record for the same anchor is ignored; a distinct additional acquired
// anchor is marked for the release branch. Non-acquired states retain their
// existing router behavior. A Code v2 node has one main output, so this must
// return one flat array of n8n items rather than output-shaped nested arrays.
const output = [];
const acquiredIds = new Set();
let primaryAcquired = false;
for (const item of $input.all()) {
  const value = item.json || {};
  if (value.claim_state !== 'acquired') {
    const { ${RELEASE_ROUTE_MARKER}: _ignoredRouteMarker, ...json } = value;
    output.push({ ...item, json });
    continue;
  }
  const id = typeof value.id === 'string' ? value.id : '';
  const sessionId = typeof value.session_id === 'string' ? value.session_id.trim() : '';
  if (!id || !sessionId) throw new Error('V4_ACQUIRED_CLAIM_INVALID');
  if (acquiredIds.has(id)) continue;
  acquiredIds.add(id);
  if (!primaryAcquired) {
    primaryAcquired = true;
    const { ${RELEASE_ROUTE_MARKER}: _ignoredRouteMarker, ...json } = value;
    output.push({ ...item, json });
  } else {
    output.push({ ...item, json: { ...value, ${RELEASE_ROUTE_MARKER}: 'release' } });
  }
}
return output;`;
}

function serializationRouteParameters() {
  return {
    mode: 'rules',
    rules: { values: [{
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
        conditions: [{
          id: 'ticket85m-release-additional-claim',
          leftValue: `={{ $json.${RELEASE_ROUTE_MARKER} }}`,
          rightValue: 'release',
          operator: { type: 'string', operation: 'equals' },
        }],
        combinator: 'and',
      },
      renameOutput: false,
    }] },
    looseTypeValidation: false,
    options: { fallbackOutput: 'extra' },
  };
}

function nodeByName(workflow, name) {
  const node = workflow.nodes.find(candidate => candidate.name === name);
  assert.ok(node, `missing node: ${name}`);
  return node;
}

function patchWorkflow(workflow) {
  assert.equal(workflow.id, 'DbdFTtuPwxTZSkp3', 'wrong workflow');
  const serializer = nodeByName(workflow, SERIALIZE);
  assert.equal(serializer.type, 'n8n-nodes-base.code');
  assert.equal(serializer.parameters.mode, 'runOnceForAllItems');
  assert.ok(!workflow.nodes.some(node => node.name === SERIALIZE_ROUTE), 'Ticket 85M route already exists');
  assert.deepEqual(workflow.connections[SERIALIZE]?.main, [
    [{ node: ROUTE, type: 'main', index: 0 }],
    [{ node: RELEASE, type: 'main', index: 0 }],
  ], 'unexpected pre-85M serializer edges');

  serializer.parameters.jsCode = serializationCode();
  workflow.nodes.push({
    id: 'd85m1f31-0000-4000-8000-000000000002',
    name: SERIALIZE_ROUTE,
    type: 'n8n-nodes-base.switch',
    typeVersion: 3.4,
    position: [Number(serializer.position[0]) + 256, Number(serializer.position[1])],
    parameters: serializationRouteParameters(),
  });
  workflow.connections[SERIALIZE] = { main: [[{ node: SERIALIZE_ROUTE, type: 'main', index: 0 }]] };
  workflow.connections[SERIALIZE_ROUTE] = { main: [
    [{ node: RELEASE, type: 'main', index: 0 }],
    [{ node: ROUTE, type: 'main', index: 0 }],
  ] };
  return workflow;
}

function main() {
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  fs.writeFileSync(workflowPath, `${JSON.stringify(patchWorkflow(workflow), null, 2)}\n`);
  console.log('PASS: applied Ticket 85M V4 acquired-claim serialization correction');
}

if (require.main === module) main();
module.exports = { SERIALIZE, SERIALIZE_ROUTE, RELEASE, ROUTE, RELEASE_ROUTE_MARKER, serializationCode, serializationRouteParameters, patchWorkflow };
