const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const serverPath = require.resolve('../server');
const supabasePath = require.resolve('../lib/supabase');

const publicRoutes = [
  ['/', 'home'],
  ['/servicio', 'service-features'],
  ['/programa-de-28-dias', 'purchase'],
  ['/terminos-y-condiciones', 'terms-and-conditions'],
  ['/aviso-de-privacidad', 'privacy-policy'],
  ['/privacidad/solicitud', 'privacy-request'],
  ['/pago-exitoso', 'success'],
  ['/pago-cancelado', 'cancel']
];

function loadApp() {
  delete require.cache[serverPath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {}
  };

  return require(serverPath);
}

function routeHandler(app, routePath) {
  const layer = app.router.stack.find(candidate =>
    candidate.route?.path === routePath && candidate.route.methods.get
  );

  assert.ok(layer, `Missing GET route ${routePath}`);
  return layer.route.stack[0].handle;
}

async function renderRoute(app, routePath) {
  const result = {};
  const response = {
    status(code) { result.status = code; return response; },
    render(view, data = {}) {
      result.status ||= 200;
      result.view = view;
      result.data = data;
      return response;
    }
  };

  await routeHandler(app, routePath)({}, response);
  result.html = await ejs.renderFile(
    path.resolve(__dirname, `../views/${result.view}.ejs`),
    result.data
  );
  return result;
}

test('all Ticket 7 public routes render successfully', async () => {
  const app = loadApp();

  for (const [routePath, expectedView] of publicRoutes) {
    const result = await renderRoute(app, routePath);
    assert.equal(result.status, 200, routePath);
    assert.equal(result.view, expectedView, routePath);
    assert.match(result.html, /<!DOCTYPE html>/i, routePath);
  }
});

test('home presents the one-time 28-day offer and current capabilities', async () => {
  const { html } = await renderRoute(loadApp(), '/');

  assert.match(html, /Deja de pensar qué vas a comer cada día/i);
  assert.match(html, /programa de 28 días con comidas fáciles, familiares y saludables/i);
  assert.match(html, /\$149 MXN/);
  assert.match(html, /Pago único/i);
  assert.match(html, /4 semanas/i);
  assert.match(html, /desayunos, comidas, cenas y snacks/i);
  assert.match(html, /calorías estimadas/i);
  assert.match(html, /recetas/i);
  assert.match(html, /lista de compras/i);
  assert.match(html, /No me gustó/i);
  assert.match(html, /portal web y PWA/i);
  assert.match(html, /WhatsApp/i);
  assert.doesNotMatch(html, /\$99|\$249|\/mes|suscripción mensual|plan mensual/i);
});

test('service describes the practical four-step customer program', async () => {
  const { html } = await renderRoute(loadApp(), '/servicio');

  assert.match(html, /Cuéntanos sobre ti/i);
  assert.match(html, /Creamos tu programa/i);
  assert.match(html, /Sabes qué comer cada día/i);
  assert.match(html, /Te acompañamos/i);
  assert.match(html, /\$149 MXN/i);
  assert.match(html, /Un solo pago/i);
  assert.doesNotMatch(html, /\$99|\$249|\/mes|suscripción mensual|plan mensual/i);
});

test('terms reflect a one-time purchase without monthly renewal language', async () => {
  const { html } = await renderRoute(loadApp(), '/terminos-y-condiciones');

  assert.match(html, /duración de 28 días/i);
  assert.match(html, /pago único/i);
  assert.match(html, /Stripe Checkout/i);
  assert.match(html, /no almacena números completos de tarjeta/i);
  assert.match(html, /no realiza diagnósticos/i);
  assert.doesNotMatch(html, /\$99|\$249|\/mes|suscripción mensual|plan mensual/i);
});

test('success and cancel distinguish payment completion from Checkout abandonment', async () => {
  const app = loadApp();
  const success = await renderRoute(app, '/pago-exitoso');
  const cancel = await renderRoute(app, '/pago-cancelado');

  assert.match(success.html, /¡Pago confirmado!/i);
  assert.match(success.html, /completa tu perfil/i);
  assert.doesNotMatch(success.html, /suscripción.*activa/i);
  assert.match(cancel.html, /compra no se completó/i);
  assert.match(cancel.html, /Checkout se cerró/i);
  assert.doesNotMatch(cancel.html, /suscripción.*cancelada/i);
});

test('privacy notice explains processing without publishing infrastructure vendors or the privacy mailbox', async () => {
  const { html } = await renderRoute(loadApp(), '/aviso-de-privacidad');
  const visibleText = html.replace(/<[^>]*>/g, ' ');

  for (const expected of [
    /datos personales sensibles/i,
    /alergias alimentarias/i,
    /condiciones médicas/i,
    /inteligencia artificial/i,
    /proveedores especializados/i,
    /procesamiento de pagos/i,
    /analítica web de terceros/i,
    /derechos ARCO/i,
    /\/privacidad\/solicitud/i
  ]) {
    assert.match(html, expected);
  }

  assert.doesNotMatch(html, /\[RESPONSABLE LEGAL DE DIETAVITY\]/);
  assert.doesNotMatch(html, /\[DOMICILIO DEL RESPONSABLE\]/);
  assert.doesNotMatch(html, /noindex,\s*nofollow/i);
  assert.match(html, /<meta name="robots" content="index, follow">/i);
  assert.match(html, /Versión del Aviso de Privacidad:\s*2026-08-11/i);
  assert.match(html, /consentimiento expreso/i);
  assert.match(html, /Setup/i);
  assert.doesNotMatch(visibleText, /soporte@dietavity\.com/i);
  assert.doesNotMatch(visibleText, /OpenAI|Supabase|Twilio|Meta|Google Analytics|n8n|Node\.js/i);
});

test('setup requires unchecked express consent and directly links its wording to Privacy', () => {
  const source = require('node:fs').readFileSync(
    path.resolve(__dirname, '../views/setup.ejs'),
    'utf8'
  );
  const consentInput = source.match(/<input(?=[^>]*name="sensitive_data_consent")[^>]*>/)?.[0];

  assert.ok(consentInput, 'Missing sensitive-data consent checkbox');
  assert.match(consentInput, /type="checkbox"/);
  assert.match(consentInput, /required/);
  assert.doesNotMatch(consentInput, /\bchecked\b/);
  assert.match(source, /Consiento expresamente[\s\S]*?href="\/aviso-de-privacidad"[\s\S]*?>Aviso de Privacidad<\/a>/);
});

test('Analytics is limited to the confirmed public pages and absent from sensitive/status pages', () => {
  const fs = require('node:fs');
  const analyticsTemplates = ['home', 'service-features', 'purchase', 'terms-and-conditions'];
  const analyticsFreeTemplates = ['setup', 'plan', 'success', 'cancel', 'privacy-policy', 'privacy-request'];

  for (const template of analyticsTemplates) {
    const source = fs.readFileSync(path.resolve(__dirname, `../views/${template}.ejs`), 'utf8');
    assert.match(source, /googletagmanager\.com\/gtag\/js\?id=/, template);
    assert.match(source, /gtag\('config',\s*'G-[A-Z0-9]+'\)/, template);
  }

  for (const template of analyticsFreeTemplates) {
    const source = fs.readFileSync(path.resolve(__dirname, `../views/${template}.ejs`), 'utf8');
    assert.doesNotMatch(source, /googletagmanager|gtag\s*\(/i, template);
  }
});

test('Ticket 7B internally tracks unresolved launch compliance and refund review', () => {
  const report = require('node:fs').readFileSync(
    path.resolve(__dirname, '../docs/TICKET-7B-PRIVACY-MVP-LAUNCH.md'),
    'utf8'
  );

  assert.match(report, /OPEN LAUNCH COMPLIANCE ITEM/);
  assert.match(report, /Add the verified identity and domicile of the responsible party/);
  assert.match(report, /This issue is unresolved/);
  assert.match(report, /BUSINESS POLICY APPROVED — FINAL LEGAL WORDING PENDING REVIEW/);
});

test('all public and setup templates expose Terms and Privacy links', async () => {
  const templatesWithBothLinks = [
    'home',
    'service-features',
    'purchase',
    'success',
    'cancel',
    'setup'
  ];

  for (const template of templatesWithBothLinks) {
    const source = require('node:fs').readFileSync(
      path.resolve(__dirname, `../views/${template}.ejs`),
      'utf8'
    );

    assert.match(source, /href="\/terminos-y-condiciones"/, template);
    assert.match(source, /href="\/aviso-de-privacidad"/, template);
  }

  const terms = require('node:fs').readFileSync(
    path.resolve(__dirname, '../views/terms-and-conditions.ejs'),
    'utf8'
  );
  const privacy = require('node:fs').readFileSync(
    path.resolve(__dirname, '../views/privacy-policy.ejs'),
    'utf8'
  );

  assert.match(terms, /href="\/aviso-de-privacidad"/);
  assert.match(privacy, /href="\/terminos-y-condiciones"/);
});
