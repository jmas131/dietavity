'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const serverPath = require.resolve('../server');
const supabasePath = require.resolve('../lib/supabase');
const purchaseSource = fs.readFileSync(path.join(root, 'views/purchase.ejs'), 'utf8');
const homeSource = fs.readFileSync(path.join(root, 'views/home.ejs'), 'utf8');
const serviceSource = fs.readFileSync(path.join(root, 'views/service-features.ejs'), 'utf8');
const cancelSource = fs.readFileSync(path.join(root, 'views/cancel.ejs'), 'utf8');

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

async function renderRoute(app, routePath) {
  const route = app.router.stack.find(layer =>
    layer.route?.path === routePath && layer.route.methods.get,
  );
  assert.ok(route, `Missing GET ${routePath}`);

  const result = {};
  const response = {
    status(status) { result.status = status; return response; },
    render(view, data = {}) {
      result.status ||= 200;
      result.view = view;
      result.data = data;
      return response;
    },
  };

  await route.route.stack[0].handle({}, response);
  result.html = await ejs.renderFile(path.join(root, 'views', `${result.view}.ejs`), result.data);
  return result;
}

function checkoutBrowser({ fetch } = {}) {
  const listeners = new Map();
  const redirects = [];
  const analytics = [];
  const button = {
    disabled: false,
    textContent: 'Comprar por $149 MXN',
    addEventListener(event, listener) { listeners.set(event, listener); },
  };
  const error = { hidden: true, textContent: '' };
  const script = purchaseSource.match(
    /<script id="purchase-checkout-script">([\s\S]*?)<\/script>/,
  )?.[1];
  assert.ok(script, 'Missing purchase Checkout script');

  const context = {
    document: {
      getElementById(id) {
        if (id === 'purchase-button') return button;
        if (id === 'purchase-error') return error;
        throw new Error(`Unexpected element: ${id}`);
      },
    },
    window: { location: { assign(url) { redirects.push(url); } } },
    fetch,
    gtag(...args) { analytics.push(args); },
  };
  vm.runInNewContext(script, context);

  return {
    analytics,
    button,
    click: () => listeners.get('click')(),
    error,
    redirects,
  };
}

test('Ticket 25 exposes an unauthenticated public purchase page without collecting identity', async () => {
  const result = await renderRoute(loadApp(), '/programa-de-28-dias');

  assert.equal(result.status, 200);
  assert.equal(result.view, 'purchase');
  assert.match(result.html, /<h1[^>]*>\s*COMER MEJOR<br>SE NOTA\.\s*<\/h1>/i);
  assert.doesNotMatch(result.html, /<input\b|<textarea\b|<select\b|<form\b/i);
  assert.doesNotMatch(result.html, /name=["'](?:phone|email|whatsapp|session_id)/i);
  assert.doesNotMatch(result.html, /\b(?:whatsapp_id|session_id|user_id|portal_token|twilio)\b/i);
  assert.doesNotMatch(result.html, /href=["']\/api\/checkout["']/i);
});

test('Ticket 25 purchase page states the concise, accurate product and payment contract', async () => {
  const { html } = await renderRoute(loadApp(), '/programa-de-28-dias');
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  for (const expected of [
    /programa personalizado de 28 días/i,
    /Desayuno, comida, cena y snack/i,
    /Acceso desde tu portal Dietavity/i,
    /Apoyo por WhatsApp durante tu programa/i,
    /Personalización después de la compra/i,
    /\$149 MXN/,
    /Un solo pago/i,
    /Sin suscripción[\s\S]*Sin renovación automática/i,
    /Tarjeta de crédito o débito · OXXO · Apple Pay/i,
    /Pago procesado de forma segura por Stripe/i,
  ]) {
    assert.match(text, expected);
  }

  assert.doesNotMatch(text, /Japón|Italia|España|Noruega|nutriólogo|médico|garantiz/i);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /href="\/css\/ticket-27-landing\.css"/);
  assert.match(html, /id="purchase-button"[\s\S]*?class="[^"]*checkout-button[^"]*"/);
  assert.match(html, /href="\/terminos-y-condiciones"/);
  assert.match(html, /href="\/aviso-de-privacidad"/);
});

test('Ticket 25 purchase CTA POSTs without identity and redirects only to Stripe Checkout', async () => {
  const calls = [];
  const browser = checkoutBrowser({
    async fetch(url, options) {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_ticket_25' };
        },
      };
    },
  });

  const pending = browser.click();
  assert.equal(browser.button.disabled, true);
  assert.equal(browser.button.textContent, 'Preparando tu pago...');
  assert.equal(browser.error.hidden, true);
  await pending;

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/checkout');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.body, '{}');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(browser.redirects, ['https://checkout.stripe.com/c/pay/cs_test_ticket_25']);
  assert.deepEqual(browser.analytics, [['event', 'purchase_cta_click']]);
});

test('Ticket 25 suppresses concurrent double clicks while preserving Checkout cookie semantics', async () => {
  let requests = 0;
  let complete;
  const response = new Promise(resolve => { complete = resolve; });
  const browser = checkoutBrowser({
    async fetch() {
      requests += 1;
      return response;
    },
  });

  const first = browser.click();
  const repeated = browser.click();
  assert.equal(requests, 1);
  assert.equal(browser.button.disabled, true);
  assert.equal(browser.analytics.length, 1);

  complete({
    ok: true,
    async json() {
      return { checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_double_click' };
    },
  });
  await Promise.all([first, repeated]);
  assert.equal(requests, 1);
  assert.equal(browser.redirects.length, 1);
});

test('Ticket 25 converts technical, HTTP, malformed, and unsafe Checkout failures to safe retry', async () => {
  for (const fetch of [
    async () => { throw new Error('secret Stripe provider failure'); },
    async () => ({
      ok: false,
      async json() { return { error: 'private upstream database details' }; },
    }),
    async () => ({
      ok: true,
      async json() { throw new SyntaxError('private invalid JSON'); },
    }),
    async () => ({
      ok: true,
      async json() { return {}; },
    }),
    async () => ({
      ok: true,
      async json() { return { checkout_url: 'https://attacker.test/fake-checkout' }; },
    }),
  ]) {
    const browser = checkoutBrowser({ fetch });
    await browser.click();

    assert.equal(browser.button.disabled, false);
    assert.equal(browser.button.textContent, 'Comprar por $149 MXN');
    assert.equal(browser.error.hidden, false);
    assert.equal(browser.error.textContent, 'No pudimos iniciar el pago. Intenta de nuevo.');
    assert.equal(browser.redirects.length, 0);
    assert.doesNotMatch(browser.error.textContent, /secret|private|database|attacker/i);
  }
});

test('Ticket 25 re-enables a genuinely failed Checkout for a single safe retry', async () => {
  let calls = 0;
  const browser = checkoutBrowser({
    async fetch() {
      calls += 1;
      if (calls === 1) throw new Error('temporary failure');
      return {
        ok: true,
        async json() {
          return { checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_retry' };
        },
      };
    },
  });

  await browser.click();
  assert.equal(browser.button.disabled, false);
  assert.equal(browser.error.hidden, false);

  await browser.click();
  assert.equal(calls, 2);
  assert.equal(browser.error.hidden, true);
  assert.deepEqual(browser.redirects, ['https://checkout.stripe.com/c/pay/cs_test_retry']);
});

test('Ticket 25 Home makes website purchase primary while preserving secondary WhatsApp', () => {
  const hero = homeSource.match(/<section class="text-center mb-5">[\s\S]*?<\/section>/)?.[0];
  assert.ok(hero);
  assert.match(hero, /href="\/programa-de-28-dias"[\s\S]*?>\s*Comprar por \$149 MXN\s*<\/a>/);
  assert.match(hero, /href="https:\/\/wa\.me\/18158698400"[\s\S]*?Pregúntanos por WhatsApp/);
  assert.ok(hero.indexOf('href="/programa-de-28-dias"') < hero.indexOf('href="https://wa.me/18158698400"'));
  assert.equal((homeSource.match(/href="\/programa-de-28-dias"/g) || []).length, 2);
  assert.doesNotMatch(homeSource,
    /href="https:\/\/wa\.me\/18158698400"[\s\S]{0,150}?class="btn btn-success/);
});

test('Ticket 25 Service and canceled Checkout return high-intent visitors to purchase', () => {
  assert.match(serviceSource, /href="\/programa-de-28-dias" class="btn[^\"]*dietavity-button"[\s\S]*?Comienza tu programa/);
  assert.match(serviceSource, /href="https:\/\/wa\.me\/18158698400"[\s\S]*?Pregúntanos por WhatsApp/);
  assert.match(cancelSource, /href="\/programa-de-28-dias" class="btn[^\"]*dietavity-button"[\s\S]*?Volver a intentar/);
  assert.match(cancelSource, /href="https:\/\/wa\.me\/18158698400"[\s\S]*?Pregúntanos por WhatsApp/);
  assert.ok(
    [...ejs.render(purchaseSource).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].some(([, attributes, content]) =>
      /\bhref=["']https:\/\/wa\.me\/18158698400["']/.test(attributes) &&
      /\bEscribe en WhatsApp\b/.test(content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')),
    ),
    'The rendered WhatsApp CTA must say "Escribe en WhatsApp" and link to https://wa.me/18158698400',
  );
});

test('Ticket 25 reuses existing privacy-safe public Google Analytics conventions', () => {
  assert.match(purchaseSource, /googletagmanager\.com\/gtag\/js\?id=G-L3F2YSYBMP/);
  assert.match(purchaseSource, /gtag\('config', 'G-L3F2YSYBMP'\)/);
  assert.match(purchaseSource, /gtag\('event', 'purchase_page_view'\)/);
  assert.match(purchaseSource, /gtag\('event', 'purchase_cta_click'\)/);

  for (const [name, source] of [
    ['home', homeSource],
    ['service', serviceSource],
    ['purchase', purchaseSource],
  ]) {
    assert.match(source, /gtag\('event', 'whatsapp_secondary_click'\)/, name);
  }

  assert.doesNotMatch(cancelSource, /googletagmanager|gtag\s*\(/i);
});
