'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  SERIALIZE, SERIALIZE_ROUTE, RELEASE, ROUTE, RELEASE_ROUTE_MARKER, serializationCode,
} = require('../scripts/apply-ticket-85m-serialization-fix');

const valid = n => ({ json: { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, session_id: `session-${n}`, claim_state: 'acquired' } });
function split(items) {
  const output = vm.runInNewContext(`(function(){${serializationCode()}})()`, { $input: { all: () => items } });
  assert.ok(Array.isArray(output));
  assert.ok(output.every(item => item && item.json && !Array.isArray(item)));
  return {
    pass: output.filter(item => item.json[RELEASE_ROUTE_MARKER] !== 'release'),
    release: output.filter(item => item.json[RELEASE_ROUTE_MARKER] === 'release'),
  };
}

let result = split([valid(1)]);
assert.equal(result.pass.length, 1);
assert.equal(result.release.length, 0);

result = split([valid(1), valid(2), valid(3)]);
assert.equal(JSON.stringify(result.pass.map(item => item.json.id)), JSON.stringify([valid(1).json.id]));
assert.equal(JSON.stringify(result.release.map(item => item.json.id)), JSON.stringify([valid(2).json.id, valid(3).json.id]));

result = split([valid(1), valid(1), valid(2)]);
assert.equal(JSON.stringify(result.pass.map(item => item.json.id)), JSON.stringify([valid(1).json.id]));
assert.equal(JSON.stringify(result.release.map(item => item.json.id)), JSON.stringify([valid(2).json.id]));

const nonAcquired = [
  { json: { claim_state: 'empty', session_id: 'empty' } },
  { json: { claim_state: 'deferred', session_id: 'deferred' } },
  { json: { claim_state: 'busy', session_id: 'busy' } },
  { json: { claim_state: 'reconciliation', id: valid(9).json.id, session_id: 'reconciliation' } },
];
result = split(nonAcquired);
assert.equal(result.pass.length, 4);
assert.equal(result.release.length, 0);
assert.throws(() => split([{ json: { id: '', session_id: 'bad', claim_state: 'acquired' } }]), /V4_ACQUIRED_CLAIM_INVALID/);

const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json'), 'utf8'));
const node = name => workflow.nodes.find(candidate => candidate.name === name);
assert.equal(node(SERIALIZE).parameters.mode, 'runOnceForAllItems');
assert.match(node(SERIALIZE).parameters.jsCode, /return output;/);
assert.doesNotMatch(node(SERIALIZE).parameters.jsCode, /return \[pass, release\];/);
assert.equal(node(SERIALIZE_ROUTE).type, 'n8n-nodes-base.switch');
assert.deepEqual(workflow.connections[SERIALIZE].main, [[{ node: SERIALIZE_ROUTE, type: 'main', index: 0 }]]);
assert.deepEqual(workflow.connections[SERIALIZE_ROUTE].main, [
  [{ node: RELEASE, type: 'main', index: 0 }],
  [{ node: ROUTE, type: 'main', index: 0 }],
]);
assert.match(node(RELEASE).parameters.query, /processing_owner = input\.payload->>'processing_owner'/);
assert.match(node(RELEASE).parameters.query, /processing_completed_at IS NULL/);
assert.match(node(RELEASE).parameters.query, /NOT EXISTS[\s\S]*outbound\.in_reply_to_id = anchor\.id/);
console.log('PASS Ticket 85M acquired-claim serialization (flat output and structural routes)');
