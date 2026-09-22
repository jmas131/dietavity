'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const serverPath = require.resolve('../server');
const supabasePath = require.resolve('../lib/supabase');

function loadApp() {
  delete require.cache[serverPath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {},
  };
  return require(serverPath);
}

function routeHandler(app, method, routePath) {
  const layer = app.router.stack.find(candidate =>
    candidate.route?.path === routePath && candidate.route.methods[method],
  );
  assert.ok(layer, `Missing ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle;
}

async function renderLanding() {
  const result = {};
  await routeHandler(loadApp(), 'get', '/programa-de-28-dias')({}, {
    render(view, locals = {}) {
      result.status = 200;
      result.view = view;
      result.locals = { metaPixelId: '123456789012345', ...locals };
    },
  });
  result.html = await ejs.renderFile(
    path.join(root, 'views', `${result.view}.ejs`),
    result.locals,
  );
  return result;
}

function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

test('Ticket 33 renders the diet-based personalization example', async () => {
  const { status, view, html } = await renderLanding();
  const text = visibleText(html);

  assert.equal(status, 200);
  assert.equal(view, 'purchase');

  for (const expected of [
    'HECHO CON BASE EN TUS PREFERENCIAS.',
    '¿Sigues alguna dieta?',
    'Como de todo',
    'Vegetariana',
    'Vegana',
    'Pescetariana',
    'También consideramos:',
    'Alergias',
    'Alimentos que prefieres evitar',
    'Preferencias personales',
  ]) assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  for (const removed of [
    '¿Qué quieres conseguir?',
    'Comer más saludable',
    'Controlar mi peso',
    'Organizar mis comidas',
  ]) assert.doesNotMatch(text, new RegExp(removed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(html, /<li class="selected"><b aria-hidden="true">●<\/b> Como de todo<\/li>/);
  assert.doesNotMatch(html, /<form\b|<input\b|<select\b|<textarea\b/i);
});

test('Ticket 33 preserves Checkout and Meta Pixel funnel instrumentation', async () => {
  const { html } = await renderLanding();

  assert.match(html, /id="purchase-button"[^>]*>CREAR MI PROGRAMA[\s\S]*?<\/button>/);
  assert.match(html, /fetch\('\/api\/checkout'/);
  assert.match(html, /id="meta-pixel-loader"[^>]*data-page-event="ViewContent"/);
  assert.match(html, /window\.fbq\('track', 'InitiateCheckout', \{ content_name: '28-Day Program', value: 149, currency: 'MXN' \}\)/);
});
