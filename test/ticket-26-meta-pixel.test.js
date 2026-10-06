'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const serverPath = require.resolve('../server');
const supabasePath = require.resolve('../lib/supabase');
const pixelSource = fs.readFileSync(path.join(root, 'public/js/meta-pixel.js'), 'utf8');
const purchaseSource = fs.readFileSync(path.join(root, 'views/purchase.ejs'), 'utf8');
const originalPixelId = process.env.META_PIXEL_ID;

test.after(() => {
  if (originalPixelId === undefined) delete process.env.META_PIXEL_ID;
  else process.env.META_PIXEL_ID = originalPixelId;
});

function loadApp({ pixelId, purchase, user } = {}) {
  if (pixelId === undefined) delete process.env.META_PIXEL_ID;
  else process.env.META_PIXEL_ID = pixelId;

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
    }

    select() { return this; }
    eq(field, value) { this.filters.push([field, value]); return this; }

    row() {
      const candidate = this.table === 'purchases' ? purchase : user;
      return candidate && this.filters.every(([field, value]) => candidate[field] === value)
        ? candidate
        : null;
    }

    async maybeSingle() { return { data: this.row(), error: null }; }
    async single() {
      const data = this.row();
      return data ? { data, error: null } : { data: null, error: { message: 'not found' } };
    }
  }

  delete require.cache[serverPath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: { from(table) { return new Query(table); } },
  };

  return require(serverPath);
}

function routeHandler(app, routePath) {
  const layer = app.router.stack.find(candidate =>
    candidate.route?.path === routePath && candidate.route.methods.get,
  );
  assert.ok(layer, `Missing GET ${routePath}`);
  return layer.route.stack[0].handle;
}

async function invokeRoute(app, routePath, request = {}) {
  const result = { cookies: [], headers: {} };
  const response = {
    status(code) { result.status = code; return response; },
    send(body) { result.status ||= 200; result.body = body; return response; },
    redirect(location) { result.status = 302; result.location = location; return response; },
    cookie(name, value, options) {
      result.cookies.push({ name, value, options });
      return response;
    },
    set(name, value) { result.headers[name] = value; return response; },
    render(view, data = {}) {
      result.status ||= 200;
      result.view = view;
      result.data = data;
      return response;
    },
  };

  await routeHandler(app, routePath)({ query: {}, headers: {}, ...request }, response);
  if (result.view) {
    result.html = await ejs.renderFile(
      path.join(root, 'views', `${result.view}.ejs`),
      { ...app.locals, ...result.data },
    );
  }
  return result;
}

function runPixel({ event, storage } = {}) {
  const calls = [];
  const insertedScripts = [];
  const sessionStorage = storage || new Map();
  const context = {
    document: {
      currentScript: { dataset: { pixelId: '123456789012345', pageEvent: event || '' } },
      createElement() { return {}; },
      getElementsByTagName() {
        return [{ parentNode: { insertBefore(script) { insertedScripts.push(script); } } }];
      },
    },
    window: {
      sessionStorage: {
        getItem(key) { return sessionStorage.get(key) || null; },
        setItem(key, value) { sessionStorage.set(key, value); },
      },
    },
  };

  vm.runInNewContext(pixelSource, context);
  const queued = context.window.fbq?.queue || [];
  for (const args of queued) calls.push(Array.from(args));
  return { calls, context, insertedScripts, storage: sessionStorage };
}

function runPixelAgain(browser, event) {
  browser.context.document.currentScript = {
    dataset: { pixelId: '123456789012345', pageEvent: event || '' },
  };
  vm.runInNewContext(pixelSource, browser.context);
  browser.calls.splice(0, browser.calls.length,
    ...(browser.context.window.fbq.queue || []).map(args => Array.from(args)));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function checkoutBrowser({ fetch, fbq } = {}) {
  const listeners = new Map();
  const button = {
    disabled: false,
    textContent: 'Comprar por $149 MXN',
    addEventListener(event, listener) { listeners.set(event, listener); },
  };
  const error = { hidden: true, textContent: '' };
  const script = purchaseSource.match(
    /<script id="purchase-checkout-script">([\s\S]*?)<\/script>/,
  )?.[1];
  const context = {
    document: {
      getElementById(id) { return id === 'purchase-button' ? button : error; },
    },
    window: {
      fbq,
      location: { assign() {} },
    },
    fetch,
    gtag() {},
  };
  vm.runInNewContext(script, context);
  return { button, error, click: () => listeners.get('click')() };
}

test('configured public pages install one shared Pixel loader and PageView once', async () => {
  const app = loadApp({ pixelId: '123456789012345' });

  for (const routePath of ['/', '/servicio', '/programa-de-28-dias', '/terminos-y-condiciones', '/pago-cancelado']) {
    const result = await invokeRoute(app, routePath);
    assert.equal((result.html.match(/id="meta-pixel-loader"/g) || []).length, 1, routePath);
    assert.equal((result.html.match(/src="\/js\/meta-pixel\.js"/g) || []).length, 1, routePath);
    assert.match(result.html, /data-pixel-id="123456789012345"/, routePath);
  }

  const browser = runPixel();
  runPixelAgain(browser);
  assert.equal(browser.insertedScripts.length, 1);
  assert.deepEqual(browser.calls, [
    ['init', '123456789012345'],
    ['track', 'PageView'],
  ]);
});

test('missing and invalid Pixel configuration render no loader and do not affect pages', async () => {
  for (const pixelId of [undefined, '', 'not-a-pixel', '1234', '123<script>']) {
    const result = await invokeRoute(loadApp({ pixelId }), '/programa-de-28-dias');
    assert.equal(result.status, 200);
    assert.doesNotMatch(result.html, /id="meta-pixel-loader"|connect\.facebook\.net/);
    assert.match(result.html, /PROBAR GRATIS EN WHATSAPP/);
  }
});

test('/programa-de-28-dias emits ViewContent without retired commercial metadata', () => {
  const browser = runPixel({ event: 'ViewContent' });
  assert.deepEqual(plain(browser.calls.at(-1)), ['track', 'ViewContent']);
  assert.doesNotMatch(pixelSource,
    /whatsapp|portal_token|stripe|user_id|email|phone|health|dietary/i);
});

test('WhatsApp CTA records Contact without creating Checkout', () => {
  assert.match(purchaseSource, /window\.fbq\('track', 'Contact'/);
  assert.match(purchaseSource, /gtag\('event', 'whatsapp_cta_click'/);
  assert.doesNotMatch(purchaseSource, /InitiateCheckout|fetch\('\/api\/checkout|purchase-checkout-script/);
});

test('Purchase is rendered only after durable paid state on a no-referrer clean URL', async () => {
  const user = {
    id: crypto.randomUUID(),
    whatsapp_id: '+525512345678',
    portal_token: 'private-portal-token',
  };
  const paid = {
    user_id: user.id,
    payment_status: 'paid',
    stripe_checkout_session_id: 'cs_test_ticket_26',
  };
  const app = loadApp({ pixelId: '123456789012345', purchase: paid, user });
  const verifiedRedirect = await invokeRoute(app, '/pago-exitoso', {
    query: { session_id: 'cs_test_ticket_26' },
  });

  assert.equal(verifiedRedirect.status, 302);
  assert.equal(verifiedRedirect.location, '/pago-exitoso');
  assert.equal(verifiedRedirect.headers['Referrer-Policy'], 'no-referrer');
  assert.deepEqual(verifiedRedirect.cookies[0], {
    name: 'dietavity_meta_purchase',
    value: 'whatsapp',
    options: {
      httpOnly: true, secure: true, sameSite: 'lax',
      maxAge: 5 * 60 * 1000, path: '/pago-exitoso',
    },
  });

  const verified = await invokeRoute(app, '/pago-exitoso', {
    headers: { cookie: 'dietavity_meta_purchase=whatsapp' },
  });
  assert.equal(verified.data.purchaseVerified, true);
  assert.match(verified.html, /<meta name="referrer" content="no-referrer">/);
  assert.match(verified.html, /data-page-event="Purchase"/);
  assert.doesNotMatch(verified.html, /cs_test_ticket_26|private-portal-token/);

  const pending = await invokeRoute(loadApp({ pixelId: '123456789012345' }), '/pago-exitoso', {
    query: { session_id: 'cs_test_ticket_26' },
  });
  assert.equal(pending.data.purchaseVerified, false);
  assert.doesNotMatch(pending.html, /meta-pixel-loader|data-page-event="Purchase"/);

  const unverified = await invokeRoute(loadApp({ pixelId: '123456789012345' }), '/pago-exitoso');
  assert.equal(unverified.data.purchaseVerified, false);
  assert.doesNotMatch(unverified.html, /data-page-event="Purchase"/);
});

test('Purchase uses a non-identifying session marker to suppress refresh duplicates', () => {
  const browser = runPixel({ event: 'Purchase' });
  runPixelAgain(browser, 'Purchase');

  assert.equal(browser.calls.filter(call => call[1] === 'Purchase').length, 1);
  assert.deepEqual(plain(browser.calls.find(call => call[1] === 'Purchase')), [
    'track', 'Purchase',
    { content_name: '28-Day Program', value: 149, currency: 'MXN' },
  ]);
  assert.equal(browser.storage.get('dietavity_meta_purchase_v1'), '1');
});

test('unconfigured tracking preserves the Ticket 24 direct website Setup redirect', async () => {
  const user = {
    id: crypto.randomUUID(),
    whatsapp_id: null,
    portal_token: crypto.randomBytes(32).toString('hex'),
  };
  const purchase = {
    user_id: user.id,
    payment_status: 'paid',
    stripe_checkout_session_id: 'cs_test_ticket_26',
  };
  const result = await invokeRoute(loadApp({ purchase, user }), '/pago-exitoso', {
    query: { session_id: 'cs_test_ticket_26' },
  });

  assert.equal(result.status, 302);
  assert.equal(result.location, `/setup/${user.portal_token}`);
});
