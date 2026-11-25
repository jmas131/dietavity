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
  const cases = [
    ['media_retrieval_authorization_failed', 'twilio_media_download_http_401'],
    ['media_retrieval_redirect_invalid', 'twilio_media_download_redirect_unapproved'],
    ['enrichment_authorization_failed', 'openai_http_401'],
    ['enrichment_model_unavailable', 'openai_http_404'],
  ];
  for (const [code, diagnostic] of cases) {
    const handler = app.createMediaEnrichmentHandler({
      secret: sharedSecret,
      allowlistProvider: allowlisted,
      enricher: { async enrich() { throw new MediaEnrichmentError(code, false, diagnostic); } },
    });
    assert.deepEqual(await invoke(handler), {
      status: 200,
      body: { outcome: 'operator_required', code, diagnostic },
    });
  }
});

test('operator-required diagnostics are strictly allowlisted', async () => {
  const handler = app.createMediaEnrichmentHandler({
    secret: sharedSecret,
    allowlistProvider: allowlisted,
    enricher: { async enrich() { throw new MediaEnrichmentError('media_retrieval_redirect_invalid', false, 'https://untrusted.example/signed-token'); } },
  });
  assert.deepEqual(await invoke(handler), {
    status: 200,
    body: { outcome: 'operator_required', code: 'media_retrieval_redirect_invalid', diagnostic: 'media_operator_incident' },
  });
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
    enricher: { async enrich() { throw new MediaEnrichmentError('media_unavailable', true, 'twilio_media_metadata_http_5xx'); } },
  });
  assert.deepEqual(await invoke(handler), {
    status: 503,
    body: { outcome: 'retry', code: 'media_unavailable', diagnostic: 'twilio_media_metadata_http_5xx' },
  });
});

test('the workflow has a terminal authorization route with no outbound node', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json'), 'utf8'));
  const nodes = new Map(workflow.nodes.map(node => [node.name, node]));
  const route = nodes.get('Route Media Enrichment Result');
  const classify = nodes.get('Classify Media Enrichment Result');
  const run = value => Function('$input', `return (() => {${classify.parameters.jsCode}\n})()`)({ first: () => ({ json: value }) });
  for (const code of ['media_retrieval_authorization_failed', 'media_retrieval_redirect_invalid', 'enrichment_authorization_failed', 'enrichment_model_unavailable']) {
    assert.deepEqual(run({ outcome: 'operator_required', code, diagnostic: 'twilio_media_download_redirect_unapproved' }), [{ json: { route: 'operator_required', code } }]);
  }
  assert.equal(route.parameters.rules.values[1].conditions.conditions[0].rightValue, 'operator_required');
  assert.match(nodes.get('Record Media Retrieval Authorization Incident').parameters.query, /processing_completed_at = NOW\(\)/);
  assert.match(nodes.get('Record Media Retrieval Authorization Incident').parameters.query, /media_enrichment_error/);
  assert.match(nodes.get('Record Media Retrieval Authorization Incident').parameters.query, /enrichment_model_unavailable/);
  assert.match(nodes.get('Record Media Retrieval Authorization Incident').parameters.query, /media_retrieval_redirect_invalid/);
  assert.match(nodes.get('Fail Closed Media Retrieval Authorization').parameters.jsCode, /TICKET_96B_MEDIA_OPERATOR_REQUIRED/);
  assert.doesNotMatch(JSON.stringify(workflow.connections['Record Media Retrieval Authorization Incident']), /Twilio|Send|Reserve Media Clarification/);
});

test('n8n v4.3 HTTP node retains a structured 503 body for Recovery Poller retry', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'Dietavity Sales Engine (Ticket 10).json'), 'utf8'));
  const nodes = new Map(workflow.nodes.map(node => [node.name, node]));
  const call = nodes.get('Call Media Enrichment');
  const classify = nodes.get('Classify Media Enrichment Result');
  assert.deepEqual(call.parameters.options.response.response, {
    neverError: true,
    fullResponse: true,
    responseFormat: 'json',
  });
  const run = value => Function('$input', `return (() => {${classify.parameters.jsCode}\n})()`)({ first: () => ({ json: value }) });
  assert.throws(
    () => run({ statusCode: 503, body: { outcome: 'retry', code: 'media_unavailable', diagnostic: 'twilio_media_metadata_http_5xx' } }),
    /TICKET_96B_TRANSIENT_MEDIA:media_unavailable/,
  );
  assert.throws(
    () => run({ statusCode: 503, body: { error: { message: 'untrusted provider body' } } }),
    /TICKET_96B_MEDIA_RESPONSE_INVALID/,
  );
});
