'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const view = path.join(root, 'views/glp1-holding.ejs');
test('HTTP holding page and existing brand assets return 200', async () => {
  const supabasePath = require.resolve('../lib/supabase');
  require.cache[supabasePath] = {id:supabasePath,filename:supabasePath,loaded:true,exports:{}};
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const url of ['/programa-glp1','/images/dietavity-logo.webp','/images/dietavity-favicon-96x96.png','/css/glp1-holding.css','/css/ticket-27-landing.css']) {
      const response = await fetch(base + url);
      assert.equal(response.status, 200, url);
      if (url !== '/programa-glp1') continue;
      const html = await response.text();
      for (const line of ['Estamos abriendo esta modalidad de Dietavity de forma gradual.',
        'Te enviaremos por WhatsApp el enlace para completar tu compra.',
        '$149 MXN · 28 días · pago único · sin suscripción']) assert.ok(html.includes(line));
      assert.match(html, /rel="icon" href="\/images\/dietavity-favicon-96x96.png"/);
      assert.match(html, /class="brand-link"/);
      assert.doesNotMatch(html, /<(?:form|button|input|h1)\b|checkout.stripe.com|buy.stripe.com|InitiateCheckout|['"]Purchase['"]/i);
      const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(m=>m[1]);
      assert.deepEqual(links, ['/','/','/terminos-y-condiciones','/aviso-de-privacidad']);
    }
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
test('GA queues one standard configuration and one observation event; optional Meta queues only PageView', async () => {
  for (const metaPixelId of ['', '123456789012345']) {
    const html = await ejs.renderFile(view, {metaPixelId});
    const dataLayer = [];
    const context = {window:{dataLayer},dataLayer};
    for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInNewContext(script[1],context);
    const calls = dataLayer.map(args=>Array.from(args));
    assert.equal(calls.filter(args=>args[0]==='config' && args[1]==='G-L3F2YSYBMP').length,1);
    assert.deepEqual(calls.filter(args=>args[0]==='event'),[['event','glp1_purchase_intent_page_view']]);
    assert.match(html,/gtag\/js\?id=G-L3F2YSYBMP/);
    assert.doesNotMatch(html,/data-page-event=/);
    if (!metaPixelId) { assert.doesNotMatch(html,/meta-pixel-loader/); continue; }
    assert.match(html,/src="\/js\/meta-pixel.js"/);
    const pixelCalls = [];
    vm.runInNewContext(fs.readFileSync(path.join(root,'public/js/meta-pixel.js'),'utf8'), {
      window:{fbq:(...args)=>pixelCalls.push(args)},
      document:{currentScript:{dataset:{pixelId:metaPixelId}}},
    });
    assert.deepEqual(pixelCalls,[['init',metaPixelId],['track','PageView']]);
  }
});
