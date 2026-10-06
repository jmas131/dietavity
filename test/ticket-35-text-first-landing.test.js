'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'views/purchase.ejs'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/ticket-27-landing.css'), 'utf8');

function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

test('public landing states the GLP-1 WhatsApp assistant proposition without obsolete commercial claims', async () => {
  const html = await ejs.renderFile(path.join(root, 'views/purchase.ejs'), { metaPixelId: '123456789012345' });
  const text = visibleText(html);

  for (const expected of [
    'Para personas que usan GLP-1', 'asistente de alimentación por WhatsApp',
    'qué has comido', 'cómo está tu apetito', 'alimentos tienes disponibles',
    'Pruébalo. Gratis.', 'No vendemos GLP-1.', 'No lo prescribimos.',
    'No modificamos tu tratamiento.'
  ]) assert.match(text, new RegExp(expected, 'i'));

  assert.doesNotMatch(text, /\$\s*149|28\s*d[ií]as|cuatro\s+comidas|desayuno,?\s*comida,?\s*cena|checkout|stripe|portal/i);
  assert.equal((html.match(/<h1\b/gi) || []).length, 1);
  assert.match(html, /class="chat-mockup"/);
  assert.match(html, /Tengo yogur, fruta y pan en casa\./);
  assert.match(html, /Prueba yogur con fruta; es una opción sencilla con lo que tienes\./);
  assert.doesNotMatch(html, /chat-bubble assistant[^>]*>[^<]*(?:medicamento|dosis|alergia|preferencia)/i);
  assert.match(html, /class="moment-list"/);
  assert.match(css, /@media \(min-width: 700px\)/);
  assert.match(css, /@media \(min-width: 960px\)/);
});

test('landing CTAs start a WhatsApp conversation and record a WhatsApp event, never checkout intent', async () => {
  const html = await ejs.renderFile(path.join(root, 'views/purchase.ejs'), { metaPixelId: '123456789012345' });
  const ctas = [...html.matchAll(/<a\b[^>]*class="primary-button"[^>]*href="([^"]+)"[^>]*onclick="([^"]+)"/g)];

  assert.equal(ctas.length, 2);
  for (const [, href, onclick] of ctas) {
    assert.match(href, /^https:\/\/wa\.me\/18158698400\?text=/);
    assert.match(onclick, /^trackWhatsAppCta\('/);
  }
  assert.match(html, /gtag\('event', 'glp1_whatsapp_assistant_page_view'\)/);
  assert.match(html, /gtag\('event', 'whatsapp_cta_click'/);
  assert.match(html, /window\.fbq\('track', 'Contact'/);
  assert.doesNotMatch(html, /purchase_cta_click|InitiateCheckout|fetch\('\/api\/checkout|checkout-button/i);
  assert.match(html, /id="meta-pixel-loader"[^>]*data-page-event="ViewContent"/);
});

test('landing keeps responsive navigation, accessibility, and public legal destinations', async () => {
  const html = await ejs.renderFile(path.join(root, 'views/purchase.ejs'), {});
  assert.match(html, /<nav class="desktop-nav"/);
  assert.match(html, /<details class="mobile-menu">/);
  assert.match(html, /class="skip-link" href="#contenido"/);
  assert.match(html, /href="\/terminos-y-condiciones"/);
  assert.match(html, /href="\/aviso-de-privacidad"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/dietavity\.com\/">/);
});
