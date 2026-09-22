const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflowText = fs.readFileSync(
  path.join(root, 'n8n/Global Error Handler.json'),
  'utf8'
);
const workflow = JSON.parse(workflowText);
const nodes = new Map(workflow.nodes.map(node => [node.name, node]));
const buildLog = nodes.get('Build Log JSON');
const insertLog = nodes.get('Insert Error Log (Error Handler)');

function assignment(name) {
  return buildLog.parameters.assignments.assignments.find(item => item.name === name);
}

function evaluateExpression(value, json) {
  const match = value.match(/^=\{\{\s*([\s\S]*?)\s*\}\}$/);
  assert.ok(match, 'Expected an n8n expression, received: ' + value);
  return Function('$json', 'return (' + match[1] + ');')(json);
}

test('Ticket 13 removes anonymous and service-role REST logging', () => {
  assert.equal(insertLog.type, 'n8n-nodes-base.postgres');
  assert.equal(workflow.active, false);
  assert.doesNotMatch(workflowText, /SUPABASE_ANONYMOUS_KEY/);
  assert.doesNotMatch(workflowText, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(
    JSON.stringify(insertLog),
    /rest\/v1\/logs|["']Authorization["']\s*:|apikey/i
  );
});

test('Ticket 13 inserts the durable error event with the established Postgres credential', () => {
  assert.equal(insertLog.credentials.postgres.name, 'Postgres account');
  assert.equal(insertLog.credentials.postgres.id, 'gXJ1myheSM6x1XB8');
  assert.equal(insertLog.parameters.operation, 'executeQuery');
  assert.match(insertLog.parameters.query, /INSERT INTO public\.logs\s*\(/i);
  assert.match(insertLog.parameters.query, /'global_workflow_error'/);
  assert.match(insertLog.parameters.query, /'error'/);
  assert.match(
    insertLog.parameters.query,
    /jsonb_build_object\([\s\S]*'workflow'[\s\S]*'workflow_id'[\s\S]*'lastNodeExecuted'/
  );
});

test('Ticket 13 sanitizes and bounds oversized error messages', () => {
  const oversized = 'sensitive\n\t"\\' + 'x'.repeat(800);
  const result = evaluateExpression(assignment('error_message').value, {
    execution: { error: { message: oversized } }
  });

  assert.equal(result.length, 500);
  assert.doesNotMatch(result, /[\n\r\t"\\]/);
  assert.match(insertLog.parameters.query, /LEFT\([\s\S]*error_message[\s\S]*500\)/);
});

test('Ticket 13 parameterizes an allow-listed context instead of dumping execution state', () => {
  const queryReplacement = insertLog.parameters.options.queryReplacement;
  assert.match(insertLog.parameters.query, /\$1::jsonb/);
  assert.match(queryReplacement, /JSON\.stringify\(\{/);
  assert.match(queryReplacement, /workflow_id/);
  assert.match(queryReplacement, /last_node_executed/);
  assert.match(queryReplacement, /execution_id/);
  assert.match(queryReplacement, /execution_url/);
  assert.doesNotMatch(queryReplacement, /JSON\.stringify\(\$json\)|\$json\.execution\b/);
  assert.doesNotMatch(insertLog.parameters.query, /stack|headers|environment/i);
});

test('Ticket 13 keeps database logging and email preparation as independent branches', () => {
  const branches = workflow.connections['Build Log JSON'].main[0].map(connection => connection.node);
  assert.deepEqual(
    [...branches].sort(),
    ['Build Email Error Content', 'Insert Error Log (Error Handler)'].sort()
  );
  assert.deepEqual(
    workflow.connections['Build Email Error Content'].main[0].map(connection => connection.node),
    ['Send Error Notification']
  );
  assert.ok(!workflow.connections['Insert Error Log (Error Handler)'].main.flat().some(
    connection =>
      connection.node === 'Build Email Error Content' ||
      connection.node === 'Send Error Notification'
  ));
});

test('Ticket 13 preserves backend-only logs security without a schema migration', () => {
  const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
  const migrations = fs.readdirSync(path.join(root, 'database/migrations'))
    .filter(file => file.endsWith('.sql'))
    .map(file => fs.readFileSync(path.join(root, 'database/migrations', file), 'utf8'))
    .join('\n');

  assert.match(schema, /ALTER TABLE public\.logs ENABLE ROW LEVEL SECURITY;/);
  assert.match(schema, /GRANT ALL ON TABLE public\.logs TO service_role;/);
  assert.doesNotMatch(schema, /CREATE POLICY[^;]*ON public\.logs/si);
  assert.doesNotMatch(migrations, /CREATE POLICY[^;]*ON public\.logs/si);
  assert.doesNotMatch(migrations, /ALTER TABLE public\.logs DISABLE ROW LEVEL SECURITY;/i);
  assert.doesNotMatch(
    migrations,
    /GRANT[^;]*ON (?:TABLE )?public\.logs[^;]*TO (?:anon|authenticated)/i
  );
});
