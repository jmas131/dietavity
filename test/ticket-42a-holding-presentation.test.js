'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('legacy acquisition routes serve the current WhatsApp assistant landing', async () => {
  const supabasePath = require.resolve('../lib/supabase');
  const serverPath = require.resolve('../server');
  delete require.cache[serverPath];
  require.cache[supabasePath] = {id:supabasePath,filename:supabasePath,loaded:true,exports:{}};
  const app = require('../server');
  for (const url of ['/','/servicio','/programa-de-28-dias','/programa-glp1']) {
    const route = app.router.stack.find(layer => layer.route?.path === url && layer.route.methods.get);
    assert.ok(route, url);
    const result = {};
    await route.route.stack[0].handle({}, { render(view) { result.view = view; } });
    assert.equal(result.view, 'purchase', url);
  }
  const purchase = app.router.stack.find(layer => layer.route?.path === '/comprar' && layer.route.methods.get);
  const result = {};
  await purchase.route.stack[0].handle({}, { redirect(status, location) { result.status = status; result.location = location; } });
  assert.deepEqual(result, {status: 301, location: '/'});
});

test('the retired holding template is no longer reached by a public route', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /app\.get\('\/programa-glp1'[\s\S]*?res\.render\('purchase'\)/);
});
