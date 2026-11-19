'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('media enrichment endpoint rejects missing internal authentication before processing', async () => {
  const before = process.env.DIETAVITY_CONVERSATION_ENGINE_SECRET;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.DIETAVITY_CONVERSATION_ENGINE_SECRET = 'ticket-96b-test-secret';
  // Server startup wires unrelated website routes; no Supabase request occurs.
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  const app = require('../server');
  try {
    const stack = app.router?.stack || app._router?.stack || [];
    const route = stack.find(layer => layer.route?.path === '/internal/media-enrichment/v1/resolve');
    assert.ok(route, 'media route is registered');
    const handler = route.route.stack.at(-1).handle;
    let status; let body;
    await handler({ get: () => undefined, body: {} }, {
      status(value) { status = value; return this; },
      json(value) { body = value; return this; },
    });
    assert.equal(status, 401); assert.deepEqual(body, { error: 'unauthorized' });
  } finally {
    if (before === undefined) delete process.env.DIETAVITY_CONVERSATION_ENGINE_SECRET;
    else process.env.DIETAVITY_CONVERSATION_ENGINE_SECRET = before;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
