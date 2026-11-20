#!/usr/bin/env node
'use strict';

// This tool is deliberately inert unless an operator supplies explicit
// test-only authority. It never writes files, sends WhatsApp messages, or
// prints media references, provider responses, transcripts, observations, or
// credential material.
const axios = require('axios');
const fs = require('fs');
const {
  createMediaEnricher, MediaEnrichmentError, descriptor, detectedType,
  imageDimensions, oggDurationSeconds, MAX_IMAGE_PIXELS, MAX_AUDIO_SECONDS,
} = require('../lib/media-enrichment');

const LIVE_CONFIRMATION = 'ticket-96h-test-only-provider-run';
const LOCAL_CONFIRMATION = 'ticket-96h-local-openai-run';
const REQUIRED = Object.freeze([
  'SMOKE_TWILIO_TEST_ACCOUNT_SID', 'TWILIO_MEDIA_API_KEY', 'TWILIO_MEDIA_API_SECRET',
  'OPENAI_API_KEY', 'SMOKE_OPENAI_TEST_PROJECT',
  'SMOKE_IMAGE_MEDIA_PATH', 'SMOKE_IMAGE_CONTENT_TYPE', 'SMOKE_IMAGE_MESSAGE_SID',
  'SMOKE_AUDIO_MEDIA_PATH', 'SMOKE_AUDIO_CONTENT_TYPE', 'SMOKE_AUDIO_MESSAGE_SID',
]);
const ACCOUNT = /^AC[0-9a-f]{32}$/i;
const LOCAL_ACCOUNT = `AC${'0'.repeat(32)}`;
const LOCAL_IMAGE_SID = `SM${'1'.repeat(32)}`;
const LOCAL_AUDIO_SID = `SM${'2'.repeat(32)}`;

function missing(env = process.env) { return REQUIRED.filter(name => !String(env[name] || '').trim()); }
function mediaCase(kind, env = process.env) {
  const prefix = kind === 'image' ? 'SMOKE_IMAGE' : 'SMOKE_AUDIO';
  const raw = {
    media_path: String(env[`${prefix}_MEDIA_PATH`] || ''),
    content_type: String(env[`${prefix}_CONTENT_TYPE`] || ''),
    provider_message_sid: String(env[`${prefix}_MESSAGE_SID`] || ''),
    ordinal: 0,
  };
  const result = descriptor(raw);
  const account = String(env.SMOKE_TWILIO_TEST_ACCOUNT_SID || '');
  if (!ACCOUNT.test(account) || !raw.media_path.startsWith(`/2010-04-01/Accounts/${account}/`)) throw new MediaEnrichmentError('test_media_account_invalid');
  if (result.kind !== kind) throw new MediaEnrichmentError('test_media_kind_invalid');
  return raw;
}
function status(error) {
  const code = error instanceof MediaEnrichmentError ? error.code : 'unexpected_failure';
  if (code === 'twilio_redirect_detected') return 'redirect_detected';
  return error instanceof MediaEnrichmentError && error.transient ? 'retryable_failure' : 'terminal_failure';
}
function diagnostic(error) {
  if (!(error instanceof MediaEnrichmentError)) return 'local_unexpected_failure';
  return error.diagnostic || ({
    enrichment_invalid_request: 'openai_http_400',
    enrichment_authorization_failed: 'openai_authorization_failure',
    enrichment_model_unavailable: 'openai_http_404',
    enrichment_rate_limited: 'openai_http_429',
    enrichment_provider_unavailable: 'openai_http_5xx',
    enrichment_timeout: 'openai_timeout',
    enrichment_network_unavailable: 'openai_network_failure',
    enrichment_response_invalid: 'openai_response_contract',
  }[error.code] || error.code);
}
function output(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function buildHttp() {
  return Object.freeze({
    async get(url, options) {
      try { return await axios.get(url, options); }
      catch (error) {
        const code = Number(error?.response?.status);
        if (code >= 300 && code < 400) throw new MediaEnrichmentError('twilio_redirect_detected');
        throw error;
      }
    },
    post: axios.post.bind(axios),
  });
}
function localRequired(env = process.env) { return ['OPENAI_API_KEY', 'SMOKE_OPENAI_TEST_PROJECT', 'SMOKE_LOCAL_IMAGE_PATH', 'SMOKE_LOCAL_AUDIO_PATH'].filter(name => !String(env[name] || '').trim()); }
function localDescriptor(kind, contentType) {
  const sid = kind === 'image' ? LOCAL_IMAGE_SID : LOCAL_AUDIO_SID;
  const raw = { media_path: `/2010-04-01/Accounts/${LOCAL_ACCOUNT}/Messages/${sid}/Media/ME${kind === 'image' ? '3' : '4'}${'0'.repeat(31)}`, content_type: contentType, provider_message_sid: sid, ordinal: 0 };
  descriptor(raw);
  return raw;
}
function localInput(kind, filePath) {
  if (typeof filePath !== 'string' || !filePath || !fs.statSync(filePath).isFile()) throw new MediaEnrichmentError('local_media_file_invalid');
  const bytes = fs.readFileSync(filePath);
  const type = detectedType(bytes);
  if (kind === 'image') {
    const dimensions = imageDimensions(bytes, type);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type) || !dimensions || !dimensions[0] || !dimensions[1] || dimensions[0] * dimensions[1] > MAX_IMAGE_PIXELS) throw new MediaEnrichmentError('local_image_invalid');
  } else if (type !== 'audio/ogg' || oggDurationSeconds(bytes) === null || oggDurationSeconds(bytes) > MAX_AUDIO_SECONDS) throw new MediaEnrichmentError('local_audio_invalid');
  return Object.freeze({ item: localDescriptor(kind, type), bytes });
}
function localHttp(bytes) { return Object.freeze({ async get() { return { data: bytes }; }, post: axios.post.bind(axios) }); }
async function local(env = process.env, { createEnricher = createMediaEnricher, httpFactory = localHttp } = {}) {
  const image = localInput('image', env.SMOKE_LOCAL_IMAGE_PATH);
  const audio = localInput('audio', env.SMOKE_LOCAL_AUDIO_PATH);
  const results = [];
  for (const [kind, input] of [['image', image], ['audio', audio]]) {
    try {
      const diagnostics = [];
      const enricher = createEnricher({
        http: httpFactory(input.bytes), twilioKey: 'local-memory', twilioSecret: 'local-memory',
        diagnosticLogger: { warn: event => diagnostics.push(event?.diagnostic || 'openai_diagnostic_unavailable') },
      });
      const value = await enricher.enrich(input.item);
      results.push({ kind, status: value.kind === kind && typeof value.text === 'string' && value.text.trim() ? 'pass' : 'terminal_failure' });
    } catch (error) { results.push({ kind, status: status(error), diagnostic: diagnostic(error) }); }
  }
  output({ mode: 'local_openai_smoke', results });
  return results.every(result => result.status === 'pass') ? 0 : 1;
}
async function live(env = process.env) {
  const cases = [['image', mediaCase('image', env)], ['audio', mediaCase('audio', env)]];
  const events = [];
  const enricher = createMediaEnricher({ http: buildHttp(), diagnosticLogger: { error: event => events.push(event?.event === 'twilio_media_retrieval_authorization_failed' ? 'twilio_media_retrieval_authorization_failed' : 'operator_error') } });
  const results = [];
  for (const [kind, item] of cases) {
    try {
      const value = await enricher.enrich(item);
      results.push({ kind, status: value.kind === kind && typeof value.text === 'string' && value.text.trim() ? 'pass' : 'terminal_failure' });
    } catch (error) { results.push({ kind, status: status(error) }); }
  }
  output({ mode: 'live_provider_smoke', results, operator_events: [...new Set(events)] });
  return results.every(result => result.status === 'pass') ? 0 : 1;
}
async function main(env = process.env, argv = process.argv.slice(2)) {
  if (argv.includes('--local')) {
    const absent = localRequired(env);
    if (absent.length) {
      output({ mode: 'local_openai_smoke', status: 'blocked_missing_local_test_only_inputs', missing: absent });
      return 2;
    }
    try { localInput('image', env.SMOKE_LOCAL_IMAGE_PATH); localInput('audio', env.SMOKE_LOCAL_AUDIO_PATH); }
    catch (error) { output({ mode: 'local_openai_smoke', status: status(error) }); return 2; }
    if (!argv.includes('--live')) {
      output({ mode: 'local_openai_smoke', status: 'ready_for_explicit_local_openai_authorization' });
      return 0;
    }
    if (env.TICKET_96H_LOCAL_CONFIRMATION !== LOCAL_CONFIRMATION) {
      output({ mode: 'local_openai_smoke', status: 'blocked_missing_explicit_local_openai_authorization' });
      return 2;
    }
    process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = 'true';
    process.env.DIETAVITY_MEDIA_AUDIO_ENABLED = 'true';
    return local(env);
  }
  const absent = missing(env);
  if (!argv.includes('--live')) {
    output({ mode: 'preflight', status: absent.length ? 'blocked_missing_test_only_inputs' : 'ready_for_explicit_live_authorization', missing: absent });
    return absent.length ? 2 : 0;
  }
  if (env.TICKET_96H_LIVE_CONFIRMATION !== LIVE_CONFIRMATION) {
    output({ mode: 'live_provider_smoke', status: 'blocked_missing_explicit_test_only_authorization' });
    return 2;
  }
  if (absent.length) {
    output({ mode: 'live_provider_smoke', status: 'blocked_missing_test_only_inputs', missing: absent });
    return 2;
  }
  process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = 'true';
  process.env.DIETAVITY_MEDIA_AUDIO_ENABLED = 'true';
  return live(env);
}

if (require.main === module) {
  const localMode = process.argv.slice(2).includes('--local');
  main().then(code => { process.exitCode = code; }).catch(error => {
    output({ mode: localMode ? 'local_openai_smoke' : 'live_provider_smoke', status: status(error), diagnostic: diagnostic(error) });
    process.exitCode = 1;
  });
}
module.exports = Object.freeze({ LIVE_CONFIRMATION, LOCAL_CONFIRMATION, REQUIRED, missing, mediaCase, localRequired, localDescriptor, localInput, status, diagnostic, local, main });
