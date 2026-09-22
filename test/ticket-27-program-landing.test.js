'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const serverPath = require.resolve('../server');
const supabasePath = require.resolve('../lib/supabase');
const purchaseSource = fs.readFileSync(path.join(root, 'views/purchase.ejs'), 'utf8');
const landingCss = fs.readFileSync(path.join(root, 'public/css/ticket-27-landing.css'), 'utf8');

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

async function renderLanding(app, data = {}) {
  const result = {};
  const response = {
    render(view, locals = {}) {
      result.status = 200;
      result.view = view;
      result.locals = { ...data, ...locals };
    },
  };
  await routeHandler(app, 'get', '/programa-de-28-dias')({}, response);
  result.html = await ejs.renderFile(
    path.join(root, 'views', `${result.view}.ejs`),
    result.locals,
  );
  return result;
}

test('Ticket 27 makes the 28-day route canonical and permanently redirects /comprar', async () => {
  const app = loadApp();
  const landing = await renderLanding(app, { metaPixelId: '' });
  assert.equal(landing.status, 200);
  assert.equal(landing.view, 'purchase');

  const redirect = {};
  await routeHandler(app, 'get', '/comprar')({}, {
    redirect(status, location) {
      redirect.status = status;
      redirect.location = location;
    },
  });
  assert.deepEqual(redirect, {
    status: 301,
    location: '/programa-de-28-dias',
  });
});

test('Ticket 27 implements the canonical SEO contract with one H1', async () => {
  const { html } = await renderLanding(loadApp(), { metaPixelId: '' });
  assert.match(html, /<link rel="canonical" href="https:\/\/dietavity\.com\/programa-de-28-dias">/);
  assert.match(html, /<title>Programa personalizado de alimentación de 28 días \| Dietavity<\/title>/);
  assert.match(html, /<meta name="description" content="Descubre qué comer cada día con un programa personalizado de 28 días, comidas fáciles y familiares, y apoyo por WhatsApp\.\s*">/);
  assert.equal((html.match(/<h1\b/gi) || []).length, 1);
  assert.match(html, /<h1[^>]*>COMER MEJOR<br>SE NOTA\.<\/h1>/);
});

test('Ticket 27 presents accurate commercial facts and direct Checkout CTAs', async () => {
  const { html } = await renderLanding(loadApp(), { metaPixelId: '' });
  const visible = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  for (const fact of [
    /28 días/i,
    /\$149 MXN/,
    /un solo pago/i,
    /Sin suscripción[\s\S]*Sin renovación automática/i,
    /Desayuno/i,
    /Comida/i,
    /Cena/i,
    /Snack/i,
    /dentro de los próximos 30 días/i,
  ]) assert.match(visible, fact);

  assert.ok((html.match(/class="[^"]*checkout-button/g) || []).length >= 2);
  assert.match(html, /fetch\('\/api\/checkout'/);
  assert.doesNotMatch(html, /href="\/comprar"/);
  assert.doesNotMatch(html, /<form\b|<input\b|name="(?:phone|email|whatsapp|session_id)"/i);
});

test('Ticket 27 preserves Pixel funnel metadata without private identifiers', async () => {
  const { html } = await renderLanding(loadApp(), { metaPixelId: '123456789012345' });
  assert.match(html, /data-page-event="ViewContent"/);
  assert.match(html, /window\.fbq\('track', 'InitiateCheckout', \{ content_name: '28-Day Program', value: 149, currency: 'MXN' \}\)/);
  assert.doesNotMatch(html, /\b(?:whatsapp_id|portal_token|stripe_checkout|user_id|session_id)\b/i);
});

test('Ticket 27 includes approved assistance, social, legal, and clean external links', async () => {
  const { html } = await renderLanding(loadApp(), { metaPixelId: '' });
  const destinations = [
    ['Facebook', 'https://www.facebook.com/dietavity/'],
    ['Instagram', 'https://www.instagram.com/dietavity/'],
    ['X', 'https://x.com/Dietavity'],
    ['TikTok', 'https://tiktok.com/@dietavity'],
    ['YouTube', 'https://www.youtube.com/@dietavity'],
    ['WhatsApp', 'https://wa.me/18158698400'],
  ];
  for (const [platform, url] of destinations) {
    assert.match(html, new RegExp(`href="${url.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}"`), platform);
    assert.match(html, new RegExp(`aria-label="Dietavity en ${platform}"`), platform);
  }
  assert.doesNotMatch(html, /(?:facebook|instagram|x\.com|tiktok|youtube|wa\.me)[^"']*[?&]utm_/i);
  assert.match(html, /href="\/terminos-y-condiciones"/);
  assert.match(html, /href="\/aviso-de-privacidad"/);
});

test('Ticket 27 updates Home, Service, and Cancel while preserving responsive landing art direction', () => {
  for (const template of ['home.ejs', 'service-features.ejs', 'cancel.ejs']) {
    const source = fs.readFileSync(path.join(root, 'views', template), 'utf8');
    assert.match(source, /href="\/programa-de-28-dias"/, template);
    assert.doesNotMatch(source, /href="\/comprar"/, template);
  }

  assert.doesNotMatch(purchaseSource, /images\/landing\/pollo-arroz-verduras\.webp|fetchpriority="high"/);
  assert.match(landingCss, /@media\s*\(min-width:\s*700px\)/);
  assert.match(landingCss, /overflow-x:\s*hidden/);
  assert.match(landingCss, /:focus-visible/);
  assert.match(landingCss, /prefers-reduced-motion/);
});
