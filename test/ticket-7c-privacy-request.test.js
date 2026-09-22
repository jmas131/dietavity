const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const serverPath = require.resolve('../server');
const supabasePath = require.resolve('../lib/supabase');
const privacyMailerPath = require.resolve('../lib/privacy-mailer');

function loadApp(options = {}) {
  const deliveries = [];

  delete require.cache[serverPath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {}
  };
  require.cache[privacyMailerPath] = {
    id: privacyMailerPath,
    filename: privacyMailerPath,
    loaded: true,
    exports: {
      async sendPrivacyRequest(payload) {
        deliveries.push(payload);
        if (options.deliveryFailure) throw new Error('SMTP detail must stay private');
      }
    }
  };

  return { app: require(serverPath), deliveries };
}

function routeLayer(app, method, routePath) {
  const layer = app.router.stack.find(candidate =>
    candidate.route?.path === routePath && candidate.route.methods[method]
  );
  assert.ok(layer, `Missing ${method.toUpperCase()} route ${routePath}`);
  return layer;
}

async function invokeRoute(app, method, routePath, request = {}) {
  const result = {};
  const response = {
    status(code) { result.status = code; return response; },
    render(view, data = {}) {
      result.status ||= 200;
      result.view = view;
      result.data = data;
      return response;
    },
    send(body) { result.status ||= 200; result.body = body; return response; }
  };
  const requestWithDefaults = {
    body: {},
    headers: {},
    ip: `test-${Math.random()}`,
    socket: {},
    ...request
  };
  const handlers = routeLayer(app, method, routePath).route.stack;

  async function run(index) {
    if (!handlers[index]) return;
    let nextPromise;
    await handlers[index].handle(requestWithDefaults, response, () => {
      nextPromise = run(index + 1);
      return nextPromise;
    });
    if (nextPromise) await nextPromise;
  }

  await run(0);
  return result;
}

async function renderResult(result) {
  return ejs.renderFile(
    path.resolve(__dirname, `../views/${result.view}.ejs`),
    result.data
  );
}

function validBody(overrides = {}) {
  return {
    name: '  Ana   María  ',
    email: ' ANA@example.com ',
    request_type: 'access',
    message: '  Quiero conocer los datos de mi cuenta.  ',
    company: '',
    ...overrides
  };
}

test('GET privacy request renders the MVP fields and no public mailbox', async () => {
  const { app } = loadApp();
  const result = await invokeRoute(app, 'get', '/privacidad/solicitud');
  const html = await renderResult(result);

  assert.equal(result.status, 200);
  for (const expected of [
    /Nombre/,
    /Correo electrónico/,
    /Tipo de solicitud/,
    /Mensaje/,
    /Enviar solicitud/
  ]) assert.match(html, expected);
  assert.match(html, /name="name"[^>]*required/s);
  assert.match(html, /name="email"[^>]*required/s);
  assert.match(html, /name="request_type"[^>]*required/s);
  assert.match(html, /name="message"[^>]*required/s);
  assert.doesNotMatch(html, /soporte@dietavity\.com/i);
  assert.doesNotMatch(html, /googletagmanager|gtag\s*\(/i);
});

test('valid privacy submission is normalized, delivered once, and confirmed safely', async () => {
  const { app, deliveries } = loadApp();
  const result = await invokeRoute(app, 'post', '/privacidad/solicitud', {
    body: validBody()
  });
  const html = await renderResult(result);

  assert.equal(result.status, 200);
  assert.deepEqual(deliveries, [{
    name: 'Ana María',
    email: 'ana@example.com',
    requestTypeLabel: 'Acceso',
    message: 'Quiero conocer los datos de mi cuenta.'
  }]);
  assert.match(html, /Recibimos tu solicitud/i);
  assert.match(html, /nos pondremos en contacto contigo/i);
  assert.doesNotMatch(html, /soporte@dietavity\.com/i);
});

test('each missing required field is rejected without delivery', async () => {
  for (const field of ['name', 'email', 'request_type', 'message']) {
    const { app, deliveries } = loadApp();
    const result = await invokeRoute(app, 'post', '/privacidad/solicitud', {
      body: validBody({ [field]: '' })
    });
    assert.equal(result.status, 400, field);
    assert.equal(deliveries.length, 0, field);
  }
});

test('invalid email, arbitrary request type, and oversized values are rejected', async () => {
  for (const body of [
    validBody({ email: 'not-an-email' }),
    validBody({ request_type: 'delete_everything_now' }),
    validBody({ name: 'N'.repeat(101) }),
    validBody({ message: 'M'.repeat(4001) })
  ]) {
    const { app, deliveries } = loadApp();
    const result = await invokeRoute(app, 'post', '/privacidad/solicitud', { body });
    assert.equal(result.status, 400);
    assert.equal(deliveries.length, 0);
  }
});

test('honeypot submissions receive the generic confirmation without delivery', async () => {
  const { app, deliveries } = loadApp();
  const result = await invokeRoute(app, 'post', '/privacidad/solicitud', {
    body: validBody({ company: 'Bot Company' })
  });
  const html = await renderResult(result);

  assert.equal(result.status, 200);
  assert.equal(deliveries.length, 0);
  assert.match(html, /Recibimos tu solicitud/i);
});

test('privacy endpoint limits excessive repeated submissions without a strict first-attempt block', async () => {
  const { app, deliveries } = loadApp();
  const ip = 'rate-limit-client';

  for (let index = 0; index < 5; index += 1) {
    const accepted = await invokeRoute(app, 'post', '/privacidad/solicitud', {
      ip,
      body: validBody({ company: 'Bot Company' })
    });
    assert.equal(accepted.status, 200);
  }

  const limited = await invokeRoute(app, 'post', '/privacidad/solicitud', {
    ip,
    body: validBody()
  });

  assert.equal(limited.status, 429);
  assert.equal(deliveries.length, 0);
});

test('delivery failure shows a nontechnical retry message and does not expose provider details', async () => {
  const { app } = loadApp({ deliveryFailure: true });
  const result = await invokeRoute(app, 'post', '/privacidad/solicitud', {
    body: validBody()
  });
  const html = await renderResult(result);

  assert.equal(result.status, 500);
  assert.match(html, /Intenta de nuevo/i);
  assert.doesNotMatch(html, /SMTP|stack|soporte@dietavity\.com/i);
});

test('SMTP delivery fixes the internal destination and contains only request fields', async () => {
  const nodemailerPath = require.resolve('nodemailer');
  const sent = [];
  const previousEnv = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    PRIVACY_EMAIL_FROM: process.env.PRIVACY_EMAIL_FROM
  };

  process.env.SMTP_HOST = 'smtp.example.test';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'sender@example.test';
  process.env.SMTP_PASS = 'test-secret';
  process.env.PRIVACY_EMAIL_FROM = 'privacy-form@example.test';

  require.cache[nodemailerPath] = {
    id: nodemailerPath,
    filename: nodemailerPath,
    loaded: true,
    exports: {
      createTransport(config) {
        assert.deepEqual(config, {
          host: 'smtp.example.test',
          port: 587,
          secure: false,
          auth: { user: 'sender@example.test', pass: 'test-secret' }
        });
        return { async sendMail(message) { sent.push(message); } };
      }
    }
  };
  delete require.cache[privacyMailerPath];

  try {
    const { sendPrivacyRequest } = require(privacyMailerPath);
    await sendPrivacyRequest({
      name: 'Ana',
      email: 'ana@example.com',
      requestTypeLabel: 'Acceso',
      message: 'Mi solicitud'
    });
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[privacyMailerPath];
    delete require.cache[nodemailerPath];
  }

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'soporte@dietavity.com');
  assert.equal(sent[0].replyTo, 'ana@example.com');
  assert.match(sent[0].subject, /Solicitud de privacidad Dietavity — Acceso/);
  assert.equal(
    sent[0].text,
    'Nombre: Ana\nCorreo electrónico: ana@example.com\nTipo de solicitud: Acceso\n\nMensaje:\nMi solicitud'
  );
});
