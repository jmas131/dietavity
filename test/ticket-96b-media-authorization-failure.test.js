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

test('redirect destination diagnostics expose only fixed categories', async () => {
  const error = new MediaEnrichmentError('media_retrieval_redirect_invalid', false, 'twilio_media_download_redirect_destination_unapproved');
  error.redirectDiagnostic = {
    scheme: 'https', host_class: 'other_twilio_cdn', port: 'explicit', userinfo: 'absent',
  };
  const handler = app.createMediaEnrichmentHandler({
    secret: sharedSecret,
    allowlistProvider: allowlisted,
    enricher: { async enrich() { throw error; } },
  });
  const result = await invoke(handler);
  assert.deepEqual(result, {
    status: 200,
    body: {
      outcome: 'operator_required',
      code: 'media_retrieval_redirect_invalid',
      diagnostic: 'twilio_media_download_redirect_destination_unapproved',
      redirect: { scheme: 'https', host_class: 'other_twilio_cdn', port: 'explicit', userinfo: 'absent' },
    },
  });
  assert.doesNotMatch(JSON.stringify(result.body), /signed|token|https?:\/\/|mms\.twiliocdn\.com/i);
});

test('redirect status diagnostics expose only the allowlisted initial status', async () => {
  const error = new MediaEnrichmentError('media_retrieval_redirect_invalid', false, 'twilio_media_download_redirect_status_unapproved');
  error.redirectStatus = '307';
  const handler = app.createMediaEnrichmentHandler({
    secret: sharedSecret,
    allowlistProvider: allowlisted,
    enricher: { async enrich() { throw error; } },
  });
  assert.deepEqual(await invoke(handler), {
    status: 200,
    body: {
      outcome: 'operator_required',
      code: 'media_retrieval_redirect_invalid',
      diagnostic: 'twilio_media_download_redirect_status_unapproved',
      redirect_status: '307',
    },
  });
});

test('untrusted redirect status values cannot reach n8n', async () => {
  const error = new MediaEnrichmentError('media_retrieval_redirect_invalid', false, 'twilio_media_download_redirect_status_unapproved');
  error.redirectStatus = '307 https://untrusted.example/signed-token';
  const handler = app.createMediaEnrichmentHandler({
    secret: sharedSecret,
    allowlistProvider: allowlisted,
    enricher: { async enrich() { throw error; } },
  });
  assert.deepEqual(await invoke(handler), {
    status: 200,
    body: { outcome: 'operator_required', code: 'media_retrieval_redirect_invalid', diagnostic: 'media_operator_incident' },
  });
});

test('unallowlisted redirect values cannot reach n8n', async () => {
  const error = new MediaEnrichmentError('media_retrieval_redirect_invalid', false, 'twilio_media_download_redirect_destination_unapproved');
  error.redirectDiagnostic = {
    scheme: 'https', host_class: 'non_twilio_cdn', port: 'default', userinfo: 'absent', location: 'https://evil.test/path?signed=token',
  };
  const handler = app.createMediaEnrichmentHandler({
    secret: sharedSecret,
    allowlistProvider: allowlisted,
    enricher: { async enrich() { throw error; } },
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

test('audio attachment validation exposes only the fixed failing-stage diagnostic', async () => {
  const diagnostics = [
    'twilio_media_audio_metadata_invalid',
    'twilio_media_audio_declared_mime_unsupported',
    'twilio_media_audio_size_limit_exceeded',
    'twilio_media_audio_signature_mismatch',
    'twilio_media_audio_ogg_invalid',
  ];
  for (const diagnostic of diagnostics) {
    const handler = app.createMediaEnrichmentHandler({
      secret: sharedSecret,
      allowlistProvider: allowlisted,
      enricher: { async enrich() { throw new MediaEnrichmentError('invalid_attachment', false, diagnostic); } },
    });
    assert.deepEqual(await invoke(handler), {
      status: 200,
      body: { outcome: 'fallback', code: 'invalid_attachment', diagnostic },
    });
  }
});

test('untrusted audio attachment diagnostics cannot reach n8n', async () => {
  const handler = app.createMediaEnrichmentHandler({
    secret: sharedSecret,
    allowlistProvider: allowlisted,
    enricher: { async enrich() { throw new MediaEnrichmentError('invalid_attachment', false, 'https://untrusted.example/signed-token'); } },
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

test('CDN network failures expose only a fixed transport class', async () => {
  for (const transportClass of ['connection_refused', 'network_unreachable', 'host_unreachable', 'connection_reset', 'dns_other', 'tls_other', 'network_other']) {
    const error = new MediaEnrichmentError('media_unavailable', true, 'twilio_media_cdn_download_network_failure');
    error.transportClass = transportClass;
    const handler = app.createMediaEnrichmentHandler({
      secret: sharedSecret,
      allowlistProvider: allowlisted,
      enricher: { async enrich() { throw error; } },
    });
    assert.deepEqual(await invoke(handler), {
      status: 503,
      body: { outcome: 'retry', code: 'media_unavailable', diagnostic: 'twilio_media_cdn_download_network_failure', transport_class: transportClass },
    });
  }
});

test('untrusted CDN transport values are reduced to network_other and excluded elsewhere', async () => {
  const cdnError = new MediaEnrichmentError('media_unavailable', true, 'twilio_media_cdn_download_network_failure');
  cdnError.transportClass = 'ECONNRESET https://untrusted.example/signed-token';
  const cdnHandler = app.createMediaEnrichmentHandler({
    secret: sharedSecret,
    allowlistProvider: allowlisted,
    enricher: { async enrich() { throw cdnError; } },
  });
  assert.deepEqual(await invoke(cdnHandler), {
    status: 503,
    body: { outcome: 'retry', code: 'media_unavailable', diagnostic: 'twilio_media_cdn_download_network_failure', transport_class: 'network_other' },
  });
  const otherError = new MediaEnrichmentError('media_unavailable', true, 'twilio_media_download_network_failure');
  otherError.transportClass = 'connection_reset';
  const otherHandler = app.createMediaEnrichmentHandler({
    secret: sharedSecret,
    allowlistProvider: allowlisted,
    enricher: { async enrich() { throw otherError; } },
  });
  assert.deepEqual(await invoke(otherHandler), {
    status: 503,
    body: { outcome: 'retry', code: 'media_unavailable', diagnostic: 'twilio_media_download_network_failure' },
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
  assert.deepEqual(run({ outcome:'fallback', code:'invalid_attachment', diagnostic:'twilio_media_audio_ogg_invalid' }), [{ json:{ route:'fallback', code:'invalid_attachment' } }]);
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
