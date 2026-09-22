'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const homeSource = fs.readFileSync(path.join(root, 'views', 'home.ejs'), 'utf8');
const serviceSource = fs.readFileSync(path.join(root, 'views', 'service-features.ejs'), 'utf8');

async function render(source) {
  return ejs.render(source);
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

test('Ticket 22 home hero leads with the daily decision problem and practical solution', async () => {
  const html = await render(homeSource);
  const hero = html.match(/<section class="text-center mb-5">[\s\S]*?<\/section>/)?.[0];

  assert.ok(hero, 'home hero not found');
  assert.match(hero, /<h1[^>]*>\s*Deja de pensar qué vas a comer cada día\.\s*<\/h1>/i);
  assert.match(hero, /programa de 28 días con comidas fáciles, familiares y saludables/i);
  assert.match(hero, /adaptadas a tus objetivos y preferencias/i);
  assert.match(hero, /\$149 MXN/);
  assert.match(hero, /Pago único/i);
  assert.doesNotMatch(hero, /Japón|Italia|España|Noruega|culturas más longevas|dietas? extranjeras?/i);
});

test('Ticket 22 makes reduced decision-making and personalization immediate home benefits', async () => {
  const text = visibleText(await render(homeSource));

  for (const expected of [
    'Nosotros hacemos el plan. Tú sabes qué comer cada día.',
    'Menos tiempo pensando qué preparar.',
    'Fácil de seguir',
    'Comidas prácticas con ingredientes cotidianos.',
    'Pensado para ti',
    'Adaptado a tus objetivos, preferencias y restricciones.',
    'Menos decisiones',
    'Abre tu programa y descubre qué comer cada día.',
  ]) {
    assert.ok(text.includes(expected), expected);
  }

  assert.ok(text.indexOf('Fácil de seguir') < text.indexOf('Lo que incluye tu programa'));
});

test('Ticket 22 retains accurate home product facts and supporting longevity methodology', async () => {
  const text = visibleText(await render(homeSource));

  for (const expected of [
    /28 días/i,
    /desayunos, comidas, cenas y snacks/i,
    /\$149 MXN/,
    /Un solo pago\. No es una suscripción recurrente\./i,
    /portal Dietavity/i,
    /WhatsApp/i,
    /poblaciones más longevas del mundo/i,
  ]) {
    assert.match(text, expected);
  }

  assert.ok(text.indexOf('Deja de pensar qué vas a comer cada día.') < text.indexOf('Nuestro enfoque'));
  assert.doesNotMatch(text, /Baja de peso en 28 días|15 minutos|ingredientes.*disponibles en todas partes|100%.*mexican/i);
});

test('Ticket 22 service page follows practical-to-methodology-to-price hierarchy', async () => {
  const text = visibleText(await render(serviceSource));
  const ordered = [
    'Dietavity te dice qué comer cada día',
    'comidas fáciles, familiares y saludables',
    'Cuéntanos sobre ti',
    'Creamos tu programa',
    'Sabes qué comer cada día',
    'Te acompañamos',
    'Tu programa está en el portal Dietavity',
    'Nuestro enfoque',
    '$149 MXN',
  ];

  let previous = -1;
  for (const expected of ordered) {
    const index = text.indexOf(expected);
    assert.ok(index > previous, `${expected} must appear in order`);
    previous = index;
  }

  assert.match(text, /objetivos, preferencias y restricciones relevantes/i);
  assert.match(text, /desayuno, comida, cena y snack/i);
  assert.match(text, /Un solo pago\. Sin renovación automática\./i);
  assert.match(text, /Checkout seguro de Stripe/i);
});

test('Ticket 22 describes familiarity without promising a Mexican or foreign-country diet', async () => {
  const home = visibleText(await render(homeSource));
  const service = visibleText(await render(serviceSource));

  assert.match(home, /alimentos cotidianos/i);
  assert.match(service, /alimentos familiares e ingredientes cotidianos/i);
  assert.match(service, /sin imponer una cocina extranjera ni convertir cada comida en un platillo mexicano/i);
  assert.doesNotMatch(`${home} ${service}`, /dieta japonesa|dieta italiana|dieta española|dieta noruega|todas las comidas.*mexicanas/i);
});

test('Ticket 22 preserves CTA destinations, analytics, and legal navigation', () => {
  for (const [name, source] of [['home', homeSource], ['service', serviceSource]]) {
    assert.match(source, /href="https:\/\/wa\.me\/18158698400"/, name);
    assert.match(source, />\s*Comienza tu programa\s*<\/a>/, name);
    assert.match(source, /googletagmanager\.com\/gtag\/js\?id=G-L3F2YSYBMP/, name);
    assert.match(source, /gtag\('config', 'G-L3F2YSYBMP'\)/, name);
    assert.match(source, /href="\/terminos-y-condiciones"/, name);
    assert.match(source, /href="\/aviso-de-privacidad"/, name);
  }
});
