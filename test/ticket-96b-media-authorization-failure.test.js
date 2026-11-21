'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
// Server startup wires unrelated routes. These local inert values prevent
// Supabase client construction from reaching external services in this test.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const app = require('../server');
const { MediaEnrichmentError } = require('../lib/media-enrichment');
const sharedSecret = 's'.repeat(32);
const sender = '+15550000002';
const attachment = {
  media_path: `/2010-04-01/Accounts/AC${'a'.repeat(32)}/Messages/SM${'b'.repeat(32)}/Media/ME${'c'.repeat(32)}`,
  content_type: 'image/jpeg',
  provider_message_sid: `SM${'b'.repeat(32)}`,
  ordinal: 0,
};

async function invoke(handler, payload = { attachment, sender }) {
  let status; let response;
  await handler({ get: name => name === 'x-dietavity-conversation-engine-secret' ? sharedSecret : undefined, body: payload }, {
    status(value) { status = value; return this; },
    json(value) { response = value; return this; },
  });
  return { status, body: response };
}

const allowlisted = () => new Set([sender]);

test('Twilio and OpenAI configuration failures become terminal operator-required results, not customer fallback', async () => {
  for (const code of ['media_retrieval_authorization_failed', 'enrichment_authorization_failed', 'enrichment_model_unavailable']) {
    const handler = app.createMediaEnrichmentHandler({
      secret: sharedSecret,
      allowlistProvider: allowlisted,
      enricher: { async enrich() { throw new MediaEnrichmentError(code); } },
    });
    assert.deepEqual(await invoke(handler), {
      status: 200,
      body: { outcome: 'operator_required', code },
    });
  }
});

test('permanent malformed media remains a deterministic fallback', async () => {
  const handler = app.createMediaEnrichmentHandler({
    secret: sharedSecret,
    allowlistProvider: allowlisted,
    enricher: { async enrich() { throw new MediaEnrichmentError('invalid_attachment'); } },
  });
  assert.deepEqual(await invoke(handler), { status: 200, body: { outcome: 'fallback', code: 'invalid_attachment' } });
});

test('transient retrieval failures remain retryable and do not take either terminal route', async () => {
  const handler = app.createMediaEnrichmentHandler({
    secret: sharedSecret,
    allowlistProvider: allowlisted,
    enricher: { async enrich() { throw new MediaEnrichmentError('media_unavailable', true); } },
  });
  assert.deepEqual(await invoke(handler), { status: 503, body: { error: 'media_unavailable' } });
});

test('the workflow has a terminal authorization route with no outbound node', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json'), 'utf8'));
  const nodes = new Map(workflow.nodes.map(node => [node.name, node]));
  const route = nodes.get('Route Media Enrichment Result');
  const classify = nodes.get('Classify Media Enrichment Result');
  const run = value => Function('$input', `return (() => {${classify.parameters.jsCode}\n})()`)({ first: () => ({ json: value }) });
  for (const code of ['media_retrieval_authorization_failed', 'enrichment_authorization_failed', 'enrichment_model_unavailable']) {
    assert.deepEqual(run({ outcome: 'operator_required', code }), [{ json: { route: 'operator_required', code } }]);
  }
  assert.equal(route.parameters.rules.values[1].conditions.conditions[0].rightValue, 'operator_required');
  assert.match(nodes.get('Record Media Retrieval Authorization Incident').parameters.query, /processing_completed_at = NOW\(\)/);
  assert.match(nodes.get('Record Media Retrieval Authorization Incident').parameters.query, /media_enrichment_error/);
  assert.match(nodes.get('Record Media Retrieval Authorization Incident').parameters.query, /enrichment_model_unavailable/);
  assert.match(nodes.get('Fail Closed Media Retrieval Authorization').parameters.jsCode, /TICKET_96B_MEDIA_OPERATOR_REQUIRED/);
  assert.doesNotMatch(JSON.stringify(workflow.connections['Record Media Retrieval Authorization Incident']), /Twilio|Send|Reserve Media Clarification/);
});
