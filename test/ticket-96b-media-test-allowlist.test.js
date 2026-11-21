'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const app = require('../server');
const { mediaTestAllowlist } = require('../lib/media-enrichment');

const secret = 's'.repeat(32);
const allowed = '+15550000002';
const attachment = {
  media_path: `/2010-04-01/Accounts/AC${'a'.repeat(32)}/Messages/SM${'b'.repeat(32)}/Media/ME${'c'.repeat(32)}`,
  content_type: 'image/jpeg',
  provider_message_sid: `SM${'b'.repeat(32)}`,
  ordinal: 0,
};
async function invoke(handler, payload) {
  let status; let body;
  await handler({ get: name => name === 'x-dietavity-conversation-engine-secret' ? secret : undefined, body: payload }, {
    status(value) { status = value; return this; },
    json(value) { body = value; return this; },
  });
  return { status, body };
}

test('test-identity allowlist accepts only a nonempty unique JSON E.164 array', () => {
  assert.deepEqual([...mediaTestAllowlist(JSON.stringify([allowed]))], [allowed]);
  for (const value of ['', 'not-json', '[]', JSON.stringify([allowed, allowed]), JSON.stringify(['whatsapp:' + allowed]), JSON.stringify([allowed + ' '])]) {
    assert.equal(mediaTestAllowlist(value), null);
  }
});

test('non-allowlisted and malformed allowlist requests cannot call enrichment', async () => {
  let calls = 0;
  const handler = app.createMediaEnrichmentHandler({
    secret,
    enricher: { async enrich() { calls += 1; return { kind: 'image', text: 'should not run' }; } },
    allowlistProvider: () => new Set([allowed]),
  });
  assert.deepEqual(await invoke(handler, { attachment, sender: '+15550000003' }), {
    status: 200, body: { outcome: 'fallback', code: 'media_not_authorized' },
  });
  const malformedConfigHandler = app.createMediaEnrichmentHandler({
    secret,
    enricher: { async enrich() { calls += 1; return { kind: 'image', text: 'should not run' }; } },
    allowlistProvider: () => null,
  });
  assert.deepEqual(await invoke(malformedConfigHandler, { attachment, sender: allowed }), {
    status: 200, body: { outcome: 'fallback', code: 'media_not_authorized' },
  });
  assert.equal(calls, 0);
});

test('allowlisted media reaches enrichment with only its four-field descriptor', async () => {
  let received;
  const handler = app.createMediaEnrichmentHandler({
    secret,
    enricher: { async enrich(value) { received = value; return { kind: 'image', text: 'observación sintética' }; } },
    allowlistProvider: () => new Set([allowed]),
  });
  assert.deepEqual(await invoke(handler, { attachment, sender: allowed }), {
    status: 200, body: { kind: 'image', text: 'observación sintética' },
  });
  assert.deepEqual(received, attachment, 'the allowlist wrapper passes only the four-field descriptor to enrichment');
});

test('an allowlisted sender still receives fallback while the relevant feature flag is disabled', async () => {
  const previous = process.env.DIETAVITY_MEDIA_IMAGES_ENABLED;
  process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = 'false';
  try {
    const handler = app.createMediaEnrichmentHandler({ secret, allowlistProvider: () => new Set([allowed]) });
    assert.deepEqual(await invoke(handler, { attachment, sender: allowed }), {
      status: 200, body: { outcome: 'fallback', code: 'image_disabled' },
    });
  } finally {
    if (previous === undefined) delete process.env.DIETAVITY_MEDIA_IMAGES_ENABLED;
    else process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = previous;
  }
});

test('text-only workflow routing remains separate and allowlist values are absent from exported JSON', () => {
  const workflowText = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json'), 'utf8');
  const workflow = JSON.parse(workflowText);
  const route = workflow.nodes.find(node => node.name === 'Route Media Enrichment');
  const call = workflow.nodes.find(node => node.name === 'Call Media Enrichment');
  assert.equal(route.parameters.rules.values[1].conditions.conditions[0].rightValue, 0);
  assert.match(call.parameters.jsonBody, /attachment/);
  assert.match(call.parameters.jsonBody, /sender/);
  assert.doesNotMatch(workflowText, /DIETAVITY_MEDIA_TEST_WHATSAPP_ALLOWLIST/);
});
