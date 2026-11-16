'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const workflow = require(path.join(root, 'n8n/Dietavity Sales Engine (Ticket 10).json'));
const context = workflow.nodes.find(node => node.name === 'Get V4 Conversation Context');

test('V4 history excludes blank ledger projections before its chronological 30-entry bound', () => {
  assert.ok(context);
  const query = context.parameters.query;
  assert.match(query, /nonempty_history AS \(\s*SELECT \* FROM chronological_history\s*WHERE text !~ '\^\[\[:space:\]\]\*\$'/s);
  assert.match(query, /bounded_history AS \(\s*SELECT \* FROM nonempty_history\s*ORDER BY source_processing_order DESC, role_sort DESC, timestamp DESC, id DESC\s*LIMIT 30/s);

  const projectedRows = [
    { role: 'customer', text: '', source_processing_order: 1 },
    { role: 'assistant', text: ' \n\t ', source_processing_order: 1 },
    { role: 'customer', text: 'Tengo pollo', source_processing_order: 2 },
    { role: 'assistant', text: '¿Tienes alguna verdura?', source_processing_order: 2 },
  ];
  assert.deepEqual(projectedRows.filter(row => /\S/u.test(row.text)), projectedRows.slice(2));

  const valid = Array.from({ length: 31 }, (_, index) => ({ text: `mensaje ${index + 1}`, source_processing_order: index + 1 }));
  const bounded = [...valid, { text: ' \n ', source_processing_order: 32 }].filter(row => /\S/u.test(row.text)).slice(-30);
  assert.equal(bounded.length, 30);
  assert.equal(bounded[0].text, 'mensaje 2');
  assert.equal(bounded.at(-1).text, 'mensaje 31');
});

test('generator carries the same V4 nonempty-history SQL correction', () => {
  const generator = fs.readFileSync(path.join(root, 'scripts/refactor-ticket-10-workflow.js'), 'utf8');
  assert.match(generator, /nonempty_history AS \(\s*SELECT \* FROM chronological_history\s*WHERE text !~ '\^\[\[:space:\]\]\*\$'/s);
});
