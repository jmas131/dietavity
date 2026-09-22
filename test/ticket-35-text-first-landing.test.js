'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const serverPath = require.resolve('../server');
const supabasePath = require.resolve('../lib/supabase');
const source = fs.readFileSync(path.join(root, 'views/purchase.ejs'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/ticket-27-landing.css'), 'utf8');

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

async function renderLanding() {
  const app = loadApp();
  const route = app.router.stack.find((layer) =>
    layer.route?.path === '/programa-de-28-dias' && layer.route.methods.get
  );
  assert.ok(route);
  const result = {};
  await route.route.stack[0].handle({}, {
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

test('Ticket 35 renders the complete text-first sales narrative', async () => {
  const { status, view, html } = await renderLanding();
  const text = visibleText(html);

  assert.equal(status, 200);
  assert.equal(view, 'purchase');
  assert.equal((html.match(/<h1\b/gi) || []).length, 1);
  for (const expected of [
    'COMER MEJOR SE NOTA.',
    'NO PIENSES QUÉ COMER. DIETAVITY LO HACE POR TI.',
    'HECHO CON BASE EN TUS PREFERENCIAS.',
    'ASÍ SE VE NO TENER QUE PENSARLO.',
    'MENOS IMPROVISACIÓN. MÁS ORDEN.',
    'TU SEMANA. TU LISTA. TODO EN ORDEN.',
    'NO SOLO IMPORTA QUÉ COMES HOY.',
    'TÚ COMES. NOSOTROS PENSAMOS.',
  ]) assert.ok(text.includes(expected), expected);

  const orderedSections = [
    'hero-section', 'decision-section', 'personalization-section',
    'product-section', 'receive-section', 'practical-section',
    'shopping-section', 'aspiration-section', 'longevity-section',
    'steps-section', 'offer-section', 'brand-close',
  ];
  let prior = -1;
  for (const section of orderedSections) {
    const next = html.indexOf(`class="${section}`);
    assert.ok(next > prior, `${section} should appear in the requested order`);
    prior = next;
  }
});

test('Ticket 35 shows only implemented product and personalization concepts', async () => {
  const { html } = await renderLanding();
  const text = visibleText(html);

  for (const expected of [
    '$149 MXN', 'Desayuno', 'Comida', 'Cena', 'Snack',
    'Como de todo', 'Vegetariana', 'Vegana', 'Pescetariana',
    'Alergias', 'Alimentos que prefieres evitar', 'Preferencias personales',
    'NO ME GUSTÓ', 'LISTA DE COMPRAS', 'FRUTAS Y VERDURAS',
    'Pago procesado de forma segura por Stripe',
  ]) assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

  assert.doesNotMatch(text, /garantiza|vivirás más|pérdida de peso|metabolismo|piel|Mercado Pago|PayPal/i);
  assert.doesNotMatch(html, /<form\b|<input\b|<select\b|<textarea\b/i);
});

test('Ticket 35 removes food photography and uses CSS-only product mockups', async () => {
  const { html } = await renderLanding();
  const images = html.match(/<img\b[^>]*>/gi) || [];

  assert.equal(images.length, 1);
  assert.match(images[0], /dietavity-logo\.webp/);
  assert.doesNotMatch(html, /images\/landing\/|pollo-arroz-verduras\.webp|fetchpriority/i);
  assert.match(html, /class="setup-mockup"/);
  assert.match(html, /class="portal-mockup"/);
  assert.match(html, /class="shopping-mockup"/);
  assert.doesNotMatch(css, /background-image\s*:|url\s*\(/i);
});

test('Ticket 35 keeps Checkout and all established funnel analytics unchanged', async () => {
  const { html } = await renderLanding();

  assert.ok((html.match(/class="[^"]*checkout-button/g) || []).length >= 3);
  assert.match(html, /id="purchase-button"/);
  assert.match(html, /fetch\('\/api\/checkout'/);
  assert.match(html, /credentials: 'same-origin'/);
  assert.match(source, /checkout\\\.stripe\\\.com/);
  assert.match(html, /gtag\('event', 'purchase_page_view'\)/);
  assert.match(html, /gtag\('event', 'purchase_cta_click'\)/);
  assert.match(html, /id="meta-pixel-loader"[^>]*data-page-event="ViewContent"/);
  assert.match(html, /window\.fbq\('track', 'InitiateCheckout', \{ content_name: '28-Day Program', value: 149, currency: 'MXN' \}\)/);
});

test('Ticket 35 preserves navigation, assistance, social, and legal destinations', async () => {
  const { html } = await renderLanding();

  assert.match(html, /<nav class="desktop-nav"[^>]*>/);
  assert.match(html, /<details class="mobile-menu">/);
  assert.match(html, /<summary aria-label="Abrir menú de navegación">/);
  for (const route of ['/', '/servicio', '/terminos-y-condiciones', '/aviso-de-privacidad']) {
    assert.match(html, new RegExp(`href="${route.replaceAll('/', '\\/')}"`));
  }
  assert.match(html, /href="https:\/\/wa\.me\/18158698400"/);
  for (const platform of ['Facebook', 'Instagram', 'X', 'TikTok', 'YouTube', 'WhatsApp']) {
    assert.match(html, new RegExp(`aria-label="Dietavity en ${platform}"`));
  }
});

test('Ticket 35 preserves SEO and improves responsive accessibility', async () => {
  const { html } = await renderLanding();

  assert.match(html, /<link rel="canonical" href="https:\/\/dietavity\.com\/programa-de-28-dias">/);
  assert.match(html, /<title>Programa personalizado de alimentación de 28 días \| Dietavity<\/title>/);
  assert.match(html, /<meta name="description"/);
  assert.match(html, /<meta name="robots" content="index, follow">/);
  assert.match(html, /<meta property="og:title"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/dietavity\.com\/og\.png">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /class="skip-link" href="#contenido"/);
  assert.match(html, /role="alert"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media \(min-width: 700px\)/);
  assert.match(css, /@media \(min-width: 960px\)/);
});
