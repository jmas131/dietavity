'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, 'n8n', 'Dietavity Weekly Report.json');
const builderPath = path.join(root, 'n8n', 'source', 'Dietavity Weekly Report.builder.js');

const WEEKLY_QUERY = `SELECT
  COALESCE(message.session_id, 'user:' || message.user_id::text) AS session_id,
  message.timestamp AS created_at,
  message.direction AS role,
  regexp_replace(
    message.body,
    'https://checkout\\.stripe\\.com/[^[:space:]]+',
    '[Checkout URL]',
    'gi'
  ) AS content
FROM public.messages AS message
WHERE message.timestamp >= NOW() - INTERVAL '7 days'
  AND message.direction IN ('inbound', 'outbound')
  AND message.body IS NOT NULL
ORDER BY session_id, message.timestamp, message.id;`;

function applyTicket15(workflow, builderSource) {
  const copy = structuredClone(workflow);
  const node = (name) => {
    const found = copy.nodes.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`Missing workflow node: ${name}`);
    return found;
  };

  node('SQL query').parameters.query = WEEKLY_QUERY;
  node('Build Onboarding Analysis Input').parameters.jsCode = builderSource.trimEnd();
  return copy;
}

function serialize(workflow) {
  return `${JSON.stringify(workflow, null, 2)}\n`;
}

function main() {
  const currentText = fs.readFileSync(workflowPath, 'utf8');
  const current = JSON.parse(currentText);
  const builderSource = fs.readFileSync(builderPath, 'utf8');
  const generatedText = serialize(applyTicket15(current, builderSource));

  if (process.argv.includes('--check')) {
    if (generatedText !== currentText) {
      console.error('Dietavity Weekly Report.json is not synchronized with Ticket 15 sources.');
      process.exitCode = 1;
    }
    return;
  }

  fs.writeFileSync(workflowPath, generatedText);
}

if (require.main === module) main();

module.exports = { WEEKLY_QUERY, applyTicket15, serialize };
