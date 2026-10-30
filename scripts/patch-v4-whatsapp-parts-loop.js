#!/usr/bin/env node
'use strict';

// Export-in/export-out patcher. It refuses unexpected wiring rather than
// guessing, and deliberately produces an inactive review/import artifact.
const fs = require('node:fs');
const path = require('node:path');

const RESERVATION = 'Reserve V4 Reply With Memory';
const INITIALIZER = 'Initialize V4 WhatsApp Parts Loop';
const LOOP = 'Loop V4 WhatsApp Parts';
const SEND = 'Respond to V4 Chat';
const ASSERT = 'Assert V4 Reply Accepted';
const COMPLETE = 'Mark Session Inbound Complete';
const RESET_MARKER = '_dietavity_v4_parts_loop_reset';
const RESET_EXPRESSION = `={{ $json.${RESET_MARKER} === true }}`;
const clone = value => JSON.parse(JSON.stringify(value));
const workflowFrom = value => (Array.isArray(value) ? value[0] : value)?.workflowData || (Array.isArray(value) ? value[0] : value);
function node(workflow, name) { const found = workflow.nodes.find(value => value.name === name); if (!found) throw new Error(`V4 loop patch refuses missing node: ${name}`); return found; }
function only(workflow, source, branch, target) { const edges = workflow.connections?.[source]?.main?.[branch]; if (!Array.isArray(edges) || edges.length !== 1 || edges[0].node !== target || edges[0].type !== 'main' || edges[0].index !== 0) throw new Error(`V4 loop patch refuses unexpected ${source} output ${branch}`); }
function initializerCode() { return `// Marker exists only on the reservation edge. The loop reset expression
// consumes it when a newly claimed turn enters this node; accepted-delivery
// feedback has no marker and therefore advances the current multipart set.
return $input.all().map((item) => ({
  ...item,
  json: { ...item.json, ${RESET_MARKER}: true },
}));`; }
function patchWorkflow(input) {
  const exported = clone(input); const workflow = workflowFrom(exported);
  if (!workflow?.nodes || !workflow.connections) throw new Error('V4 loop patch requires workflow nodes and connections');
  const reservation = node(workflow, RESERVATION); const loop = node(workflow, LOOP);
  node(workflow, SEND); node(workflow, ASSERT); node(workflow, COMPLETE);
  if (workflow.nodes.some(value => value.name === INITIALIZER)) throw new Error('V4 loop patch already applied');
  only(workflow, RESERVATION, 0, LOOP); only(workflow, ASSERT, 0, LOOP); only(workflow, LOOP, 1, SEND); only(workflow, LOOP, 0, COMPLETE);
  if (loop.parameters?.options?.reset !== undefined) throw new Error('V4 loop patch refuses existing reset option');
  workflow.nodes.push({ id: 'dietavity-v4-parts-loop-initializer', name: INITIALIZER, type: 'n8n-nodes-base.code', typeVersion: 2, position: [Number(reservation.position?.[0] || 0) + 128, Number(reservation.position?.[1] || 0) - 128], parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: initializerCode() } });
  workflow.connections[RESERVATION] = { main: [[{ node: INITIALIZER, type: 'main', index: 0 }]] };
  workflow.connections[INITIALIZER] = { main: [[{ node: LOOP, type: 'main', index: 0 }]] };
  loop.parameters = loop.parameters || {}; loop.parameters.options = { ...(loop.parameters.options || {}), reset: RESET_EXPRESSION };
  workflow.active = false;
  return exported;
}
if (require.main === module) { const [input, output] = process.argv.slice(2); if (!input || !output) throw new Error('Usage: patch-v4-whatsapp-parts-loop.js <input> <output>'); const patched = patchWorkflow(JSON.parse(fs.readFileSync(input, 'utf8'))); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(workflowFrom(patched), null, 2)}\n`); }
module.exports = { RESERVATION, INITIALIZER, LOOP, SEND, ASSERT, COMPLETE, RESET_MARKER, RESET_EXPRESSION, initializerCode, patchWorkflow };
