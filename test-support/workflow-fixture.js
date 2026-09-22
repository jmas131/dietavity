const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(
  __dirname,
  '..',
  'archive',
  'Dietavity Sales Engine v3 (Ticket 8).json',
);

function loadWorkflow() {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

module.exports = { loadWorkflow, workflowPath };
