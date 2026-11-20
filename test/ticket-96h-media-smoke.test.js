'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const pathModule = require('node:path');
const { LIVE_CONFIRMATION, LOCAL_CONFIRMATION, missing, mediaCase, localInput, status, diagnostic, local } = require('../scripts/ticket-96h-media-smoke');
const { MediaEnrichmentError, createMediaEnricher } = require('../lib/media-enrichment');
const sid = `SM${'a'.repeat(32)}`;
const account = `AC${'b'.repeat(32)}`;
const path = `/2010-04-01/Accounts/${account}/Messages/${sid}/Media/ME${'c'.repeat(32)}`;
const env = {
  SMOKE_TWILIO_TEST_ACCOUNT_SID: account, TWILIO_MEDIA_API_KEY: 'test-key', TWILIO_MEDIA_API_SECRET: 'test-secret', OPENAI_API_KEY: 'test-openai', SMOKE_OPENAI_TEST_PROJECT: 'sandbox',
  SMOKE_IMAGE_MEDIA_PATH: path, SMOKE_IMAGE_CONTENT_TYPE: 'image/jpeg', SMOKE_IMAGE_MESSAGE_SID: sid,
  SMOKE_AUDIO_MEDIA_PATH: path, SMOKE_AUDIO_CONTENT_TYPE: 'audio/opus', SMOKE_AUDIO_MESSAGE_SID: sid,
};
test('Ticket 96H requires explicit test-only inputs and account-bound descriptors', () => {
  assert.ok(missing({}).includes('OPENAI_API_KEY'));
  assert.equal(missing(env).length, 0);
  assert.equal(mediaCase('image', env).content_type, 'image/jpeg');
  assert.equal(mediaCase('audio', env).content_type, 'audio/opus');
  assert.throws(() => mediaCase('image', { ...env, SMOKE_IMAGE_MEDIA_PATH: path.replace(account, `AC${'d'.repeat(32)}`) }), /test_media_account_invalid/);
  assert.equal(LIVE_CONFIRMATION, 'ticket-96h-test-only-provider-run');
});
test('Ticket 96H emits only controlled failure classifications', () => {
  assert.equal(status({}), 'terminal_failure');
  assert.equal(status(Object.assign(new Error(), { code: 'media_unavailable' })), 'terminal_failure');
  assert.equal(status(new MediaEnrichmentError('enrichment_rate_limited', true, 'openai_http_429')), 'retryable_failure');
  assert.equal(diagnostic(new MediaEnrichmentError('enrichment_model_unavailable', false, 'openai_http_404')), 'openai_http_404');
  assert.equal(diagnostic(new MediaEnrichmentError('enrichment_response_invalid')), 'openai_response_contract');
  assert.equal(diagnostic(new Error('provider response body must not be emitted')), 'local_unexpected_failure');
});
test('Ticket 96H local mode validates synthetic PNG and Ogg/Opus before provider use', () => {
  const root = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'ticket-96h-'));
  const imagePath = pathModule.join(root, 'image.png'); const audioPath = pathModule.join(root, 'audio.ogg'); const invalidPath = pathModule.join(root, 'invalid.bin'); const longAudioPath = pathModule.join(root, 'long.ogg');
  const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.from([0,0,0,13]), Buffer.from('IHDR'), Buffer.from([0,0,0,1,0,0,0,1,8,2,0,0,0]), Buffer.alloc(4), Buffer.alloc(4), Buffer.from('IEND'), Buffer.alloc(4)]);
  const opus = Buffer.alloc(47); opus.write('OggS'); opus[5] = 6; opus.writeBigUInt64LE(48312n, 6); opus.writeUInt32LE(7, 14); opus[26] = 1; opus[27] = 19; opus.write('OpusHead', 28); opus[36] = 1; opus[37] = 1; opus.writeUInt16LE(312, 38);
  try {
    fs.writeFileSync(imagePath, png); fs.writeFileSync(audioPath, opus); fs.writeFileSync(invalidPath, Buffer.from('not media'));
    const long = Buffer.from(opus); long.writeBigUInt64LE(2928312n, 6); fs.writeFileSync(longAudioPath, long);
    assert.equal(localInput('image', imagePath).item.ordinal, 0);
    assert.equal(localInput('audio', audioPath).item.ordinal, 0);
    assert.throws(() => localInput('image', invalidPath), /local_image_invalid/);
    assert.throws(() => localInput('audio', longAudioPath), /local_audio_invalid/);
    assert.equal(LOCAL_CONFIRMATION, 'ticket-96h-local-openai-run');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('Ticket 96H local inputs retain raw descriptors and reach mocked OpenAI requests', async () => {
  const root = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'ticket-96h-'));
  const imagePath = pathModule.join(root, 'image.png'); const audioPath = pathModule.join(root, 'audio.ogg');
  const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.from([0,0,0,13]), Buffer.from('IHDR'), Buffer.from([0,0,0,1,0,0,0,1,8,2,0,0,0]), Buffer.alloc(4), Buffer.alloc(4), Buffer.from('IEND'), Buffer.alloc(4)]);
  const opus = Buffer.alloc(47); opus.write('OggS'); opus[5] = 6; opus.writeBigUInt64LE(48312n, 6); opus.writeUInt32LE(7, 14); opus[26] = 1; opus[27] = 19; opus.write('OpusHead', 28); opus[36] = 1; opus[37] = 1; opus.writeUInt16LE(312, 38);
  const oldImage = process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; const oldAudio = process.env.DIETAVITY_MEDIA_AUDIO_ENABLED; process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = 'true'; process.env.DIETAVITY_MEDIA_AUDIO_ENABLED = 'true';
  const calls = [];
  try {
    fs.writeFileSync(imagePath, png); fs.writeFileSync(audioPath, opus);
    const exitCode = await local({ OPENAI_API_KEY: 'test-key', SMOKE_OPENAI_TEST_PROJECT: 'test-project', SMOKE_LOCAL_IMAGE_PATH: imagePath, SMOKE_LOCAL_AUDIO_PATH: audioPath }, {
      createEnricher: createMediaEnricher,
      httpFactory: bytes => ({ async get() { return { data: bytes }; }, async post(url) { calls.push(url); return url.endsWith('/chat/completions') ? { data: { choices: [{ message: { content: 'Imagen de prueba.' } }] } } : { data: { text: 'Audio de prueba.' } }; } }),
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(calls, ['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/audio/transcriptions']);
  } finally {
    if (oldImage === undefined) delete process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; else process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = oldImage;
    if (oldAudio === undefined) delete process.env.DIETAVITY_MEDIA_AUDIO_ENABLED; else process.env.DIETAVITY_MEDIA_AUDIO_ENABLED = oldAudio;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
