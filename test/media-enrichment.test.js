'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { descriptor, magic, detectedType, matchesDeclaredType, imageDimensions, oggDurationSeconds, createMediaEnricher, MediaEnrichmentError, openAiFailure, publicAddress, createTwilioCdnLookup } = require('../lib/media-enrichment');
const sid = 'SM' + 'a'.repeat(32); const account = 'AC' + 'b'.repeat(32); const mediaSid = 'ME' + 'c'.repeat(32); const path = `/2010-04-01/Accounts/${account}/Messages/${sid}/Media/${mediaSid}`;
function opusOgg(seconds = 1, { eos = true, opusHead = true } = {}) {
  const head = Buffer.alloc(19); head.write(opusHead ? 'OpusHead' : 'BadHead!'); head[8] = 1; head[9] = 1; head.writeUInt16LE(312, 10);
  const page = Buffer.alloc(28 + head.length); page.write('OggS'); page[4] = 0; page[5] = 0x02 | (eos ? 0x04 : 0); page.writeBigUInt64LE(BigInt(Math.round(seconds * 48000) + 312), 6); page.writeUInt32LE(7, 14); page.writeUInt32LE(0, 18); page[26] = 1; page[27] = head.length; head.copy(page, 28); return page;
}
function png(width, height) { const chunks = []; const add = (type, data) => { const chunk = Buffer.alloc(12 + data.length); chunk.writeUInt32BE(data.length, 0); chunk.write(type, 4); data.copy(chunk, 8); chunks.push(chunk); }; const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; add('IHDR', ihdr); add('IEND', Buffer.alloc(0)); return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), ...chunks]); }
function jpeg(width, height) { const data = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08, height >> 8, height & 255, width >> 8, width & 255,0x01,0x01,0x11,0x00,0xff,0xd9]); return data; }
function webpVp8x(width, height) { const vp8x = Buffer.alloc(18); vp8x.write('VP8X'); vp8x.writeUInt32LE(10, 4); vp8x.writeUIntLE(width - 1, 12, 3); vp8x.writeUIntLE(height - 1, 15, 3); const vp8 = Buffer.alloc(18); vp8.write('VP8 '); vp8.writeUInt32LE(10, 4); vp8[8] = 0; vp8[11] = 0x9d; vp8[12] = 0x01; vp8[13] = 0x2a; vp8.writeUInt16LE(width, 14); vp8.writeUInt16LE(height, 16); const out = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), vp8x, vp8]); out.writeUInt32LE(out.length - 8, 4); return out; }
function httpFailure(status) { const error = new Error(`HTTP ${status}`); error.response = { status }; return error; }
async function withAudioEnabled(run) { const old = process.env.DIETAVITY_MEDIA_AUDIO_ENABLED; process.env.DIETAVITY_MEDIA_AUDIO_ENABLED = 'true'; try { return await run(); } finally { if (old === undefined) delete process.env.DIETAVITY_MEDIA_AUDIO_ENABLED; else process.env.DIETAVITY_MEDIA_AUDIO_ENABLED = old; } }
test('accepts only a canonical single Twilio image descriptor', () => assert.equal(descriptor({ media_path:path, content_type:'image/jpeg', provider_message_sid:sid, ordinal:0 }).kind, 'image'));
test('accepts only an identifier-only Event Streams attachment descriptor', () => {
  assert.deepEqual(descriptor({ account_sid: account, provider_message_sid: sid, ordinal: 0 }), { account_sid: account, provider_message_sid: sid, ordinal: 0, source: 'event_streams' });
  for (const value of [
    { account_sid: 'invalid', provider_message_sid: sid, ordinal: 0 },
    { account_sid: account, provider_message_sid: 'invalid', ordinal: 0 },
    { account_sid: account, provider_message_sid: sid, ordinal: 1 },
    { account_sid: account, provider_message_sid: sid, ordinal: 0, content_type: 'image/jpeg' },
  ]) assert.throws(() => descriptor(value), MediaEnrichmentError);
});
test('rejects arbitrary URLs, mismatched SIDs and multiple ordinals', () => { for (const value of [{ media_path:'https://evil.test/a',content_type:'image/jpeg',provider_message_sid:sid,ordinal:0 }, { media_path:path,content_type:'image/jpeg',provider_message_sid:'SM'+'d'.repeat(32),ordinal:0 }, { media_path:path,content_type:'image/jpeg',provider_message_sid:sid,ordinal:1 }]) assert.throws(() => descriptor(value), MediaEnrichmentError); });
test('recognizes supported image and voice container signatures', () => { assert.equal(magic(Buffer.from([0xff,0xd8,0xff]),'image'),true); assert.equal(magic(Buffer.from('OggS'),'audio'),true); assert.equal(magic(Buffer.from('not media'),'image'),false); });
test('accepts only the declared detected format, with the Ogg/Opus Twilio alias', () => {
  assert.equal(matchesDeclaredType('image/jpeg', 'image/jpeg'), true);
  assert.equal(matchesDeclaredType('image/jpeg', 'image/png'), false);
  assert.equal(matchesDeclaredType('audio/ogg', 'audio/opus'), true);
  assert.equal(matchesDeclaredType('audio/ogg', 'audio/mpeg'), false);
  assert.equal(detectedType(Buffer.from('not media')), null);
  assert.throws(() => descriptor({ media_path:path, content_type:'audio/mpeg', provider_message_sid:sid, ordinal:0 }), MediaEnrichmentError);
});
test('reads Ogg granule duration for the 60 second voice-note guard', () => {
  assert.equal(oggDurationSeconds(opusOgg(60)), 60);
  assert.equal(oggDurationSeconds(opusOgg(1, { eos: false })), null);
  assert.equal(oggDurationSeconds(opusOgg(1, { opusHead: false })), null);
});
test('reliably reads supported PNG, JPEG, and WebP dimensions', () => {
  assert.deepEqual(imageDimensions(png(320, 240), 'image/png'), [320, 240]);
  assert.deepEqual(imageDimensions(jpeg(320, 240), 'image/jpeg'), [320, 240]);
  assert.deepEqual(imageDimensions(webpVp8x(320, 240), 'image/webp'), [320, 240]);
  assert.equal(imageDimensions(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png'), null);
  assert.equal(imageDimensions(Buffer.from('RIFFxxxxWEBPVP8X'), 'image/webp'), null);
});
test('resolves Event Streams media metadata before binary download and OpenAI processing', async () => {
  const old = process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = 'true';
  const calls = [];
  const enricher = createMediaEnricher({ apiKey: 'openai-test', twilioKey: 'key', twilioSecret: 'secret', twilioAccountSid: account, http: {
    async get(url, options) {
      calls.push({ url, options });
      if (url.endsWith('/Media.json')) return { data: { media_list: [{ account_sid: account, parent_sid: sid, sid: mediaSid, content_type: 'image/png', uri: `${path}.json` }] } };
      assert.equal(url, `https://api.twilio.com${path}`); return { data: png(1, 1) };
    },
    async post() { return { data: { choices: [{ message: { content: 'Ensalada.' } }] } }; },
  }});
  try {
    assert.deepEqual(await enricher.enrich({ account_sid: account, provider_message_sid: sid, ordinal: 0 }), { kind: 'image', text: 'Ensalada.' });
    assert.equal(calls.length, 2); assert.equal(calls[0].options.maxRedirects, 0); assert.equal(calls[1].options.maxRedirects, 0);
  } finally { if (old === undefined) delete process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; else process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = old; }
});
test('follows only one validated Twilio CDN redirect without forwarding credentials', async () => {
  const old = process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = 'true';
  const calls = [];
  const enricher = createMediaEnricher({ apiKey: 'openai-test', twilioKey: 'key', twilioSecret: 'secret', http: {
    async get(url, options) {
      calls.push({ url, options });
      if (calls.length === 1) return { status: 302, headers: { location: 'https://mms.twiliocdn.com/signed-media' } };
      return { status: 200, data: png(1, 1) };
    },
    async post() { return { data: { choices: [{ message: { content: 'Ensalada.' } }] } }; },
  }});
  try {
    assert.deepEqual(await enricher.enrich({ media_path:path, content_type:'image/png', provider_message_sid:sid, ordinal:0 }), { kind: 'image', text: 'Ensalada.' });
    assert.equal(calls.length, 2); assert.deepEqual(calls[0].options.auth, { username: 'key', password: 'secret' });
    assert.equal(calls[1].url, 'https://mms.twiliocdn.com/signed-media');
    assert.equal(calls[1].options.auth, undefined); assert.equal(calls[1].options.headers, undefined);
    assert.equal(calls[1].options.maxRedirects, 0); assert.equal(calls[1].options.proxy, false); assert.ok(calls[1].options.httpsAgent);
  } finally { if (old === undefined) delete process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; else process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = old; }
});
test('classifies unsupported initial redirect statuses without a second request', async () => {
  const old = process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = 'true';
  try {
    for (const [status, redirectStatus] of [[301, '301'], [303, '303'], [307, '307'], [308, '308'], [399, 'other_3xx']]) {
      const enricher = createMediaEnricher({ twilioKey:'key', twilioSecret:'secret', http: { async get() { throw httpFailure(status); } } });
      await assert.rejects(enricher.enrich({ media_path:path, content_type:'image/png', provider_message_sid:sid, ordinal:0 }), error =>
        error.code === 'media_retrieval_redirect_invalid' && !error.transient
        && error.diagnostic === 'twilio_media_download_redirect_status_unapproved'
        && error.redirectStatus === redirectStatus && error.redirectDiagnostic === undefined);
    }
  } finally { if (old === undefined) delete process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; else process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = old; }
});
test('classifies rejected Twilio CDN redirect destinations without a second request', async () => {
  const old = process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = 'true';
  try {
    const cases = [
      ['http://mms.twiliocdn.com/file', { scheme:'http', host_class:'approved_twilio_cdn', port:'default', userinfo:'absent' }],
      ['https://other.twiliocdn.com/file', { scheme:'https', host_class:'other_twilio_cdn', port:'default', userinfo:'absent' }],
      ['https://evil.test/opaque-path?signed=secret', { scheme:'https', host_class:'non_twilio_cdn', port:'default', userinfo:'absent' }],
      ['https://mms.twiliocdn.com:444/file', { scheme:'https', host_class:'approved_twilio_cdn', port:'explicit', userinfo:'absent' }],
      ['https://user@mms.twiliocdn.com/file', { scheme:'https', host_class:'approved_twilio_cdn', port:'default', userinfo:'present' }],
    ];
    for (const [location, expected] of cases) {
      let calls = 0;
      const enricher = createMediaEnricher({ twilioKey:'key', twilioSecret:'secret', http: { async get() { calls += 1; return { status: 302, headers: { location } }; } } });
      await assert.rejects(enricher.enrich({ media_path:path, content_type:'image/png', provider_message_sid:sid, ordinal:0 }), error =>
        error.code === 'media_retrieval_redirect_invalid' && !error.transient
        && error.diagnostic === 'twilio_media_download_redirect_destination_unapproved'
        && assert.deepEqual(error.redirectDiagnostic, expected) === undefined);
      assert.equal(calls, 1);
    }
    const malformed = createMediaEnricher({ twilioKey:'key', twilioSecret:'secret', http: { async get() { return { status:302, headers:{} }; } } });
    await assert.rejects(malformed.enrich({ media_path:path, content_type:'image/png', provider_message_sid:sid, ordinal:0 }), error =>
      error.diagnostic === 'twilio_media_download_redirect_invalid' && error.redirectDiagnostic === undefined);
  } finally { if (old === undefined) delete process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; else process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = old; }
});
test('rejects a further CDN redirect and keeps CDN transport failures retryable', async () => {
  const old = process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = 'true';
  const item = { media_path:path, content_type:'image/png', provider_message_sid:sid, ordinal:0 };
  const redirecting = createMediaEnricher({ twilioKey:'key', twilioSecret:'secret', http: { async get(_url, options) { if (options.auth) return { status: 302, headers: { location: 'https://mms.twiliocdn.com/signed-media' } }; throw httpFailure(302); } } });
  const unavailable = createMediaEnricher({ twilioKey:'key', twilioSecret:'secret', http: { async get(_url, options) { if (options.auth) return { status: 302, headers: { location: 'https://mms.twiliocdn.com/signed-media' } }; throw httpFailure(503); } } });
  try {
    await assert.rejects(redirecting.enrich(item), error => error.code === 'media_retrieval_redirect_invalid' && error.diagnostic === 'twilio_media_cdn_download_redirect_unapproved');
    await assert.rejects(unavailable.enrich(item), error => error.code === 'media_unavailable' && error.transient && error.diagnostic === 'twilio_media_cdn_download_http_5xx');
  } finally { if (old === undefined) delete process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; else process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = old; }
});
test('CDN lookup uses its approved public address directly and refuses private results', async () => {
  assert.equal(publicAddress('1.1.1.1'), true); assert.equal(publicAddress('127.0.0.1'), false); assert.equal(publicAddress('::1'), false);
  const resolve = (lookup, host) => new Promise(resolve => lookup(host, {}, (error, address, family) => resolve({ error, address, family })));
  const publicLookup = createTwilioCdnLookup((_host, _options, done) => done(null, [{ address: '1.1.1.1', family: 4 }]));
  const privateLookup = createTwilioCdnLookup((_host, _options, done) => done(null, [{ address: '127.0.0.1', family: 4 }]));
  assert.deepEqual(await resolve(publicLookup, 'mms.twiliocdn.com'), { error: null, address: '1.1.1.1', family: 4 });
  assert.equal((await resolve(privateLookup, 'mms.twiliocdn.com')).error.code, 'TICKET_96B_CDN_PRIVATE_ADDRESS');
});
test('Event Streams metadata lookup fails closed for bad identity and classifies provider failures', async () => {
  const old = process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = 'true';
  const event = { account_sid: account, provider_message_sid: sid, ordinal: 0 };
  const enrich = response => createMediaEnricher({ twilioKey: 'key', twilioSecret: 'secret', twilioAccountSid: account, http: { async get() { if (response instanceof Error) throw response; return response; } } }).enrich(event);
  try {
    await assert.rejects(enrich({ data: { media_list: [{ account_sid: account, parent_sid: sid, sid: mediaSid, content_type: 'image/jpeg', uri: `/2010-04-01/Accounts/${account}/Messages/${sid}/Media/ME${'d'.repeat(32)}.json` }] } }), error => error.code === 'invalid_attachment');
    await assert.rejects(enrich({ data: { media_list: [] } }), error => error.code === 'media_unavailable' && error.transient && error.diagnostic === 'twilio_media_metadata_empty');
    await assert.rejects(enrich(httpFailure(404)), error => error.code === 'media_not_found' && !error.transient);
    await assert.rejects(enrich(httpFailure(401)), error => error.code === 'media_retrieval_authorization_failed' && !error.transient);
    await assert.rejects(enrich(httpFailure(429)), error => error.code === 'media_unavailable' && error.transient && error.diagnostic === 'twilio_media_metadata_http_429');
    await assert.rejects(enrich(httpFailure(503)), error => error.code === 'media_unavailable' && error.transient && error.diagnostic === 'twilio_media_metadata_http_5xx');
  } finally { if (old === undefined) delete process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; else process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = old; }
});
test('Event Streams descriptors skip metadata lookup while both media flags are disabled', async () => {
  let calls = 0; const enricher = createMediaEnricher({ twilioKey: 'key', twilioSecret: 'secret', twilioAccountSid: account, http: { async get() { calls += 1; } } });
  await assert.rejects(enricher.enrich({ account_sid: account, provider_message_sid: sid, ordinal: 0 }), error => error.code === 'media_disabled');
  assert.equal(calls, 0);
});
test('Event Streams account mismatches are terminal and never query Twilio', async () => {
  const old = process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = 'true';
  let calls = 0; const enricher = createMediaEnricher({ twilioKey: 'key', twilioSecret: 'secret', twilioAccountSid: `AC${'f'.repeat(32)}`, http: { async get() { calls += 1; } } });
  try { await assert.rejects(enricher.enrich({ account_sid: account, provider_message_sid: sid, ordinal: 0 }), error => error.code === 'media_retrieval_authorization_failed'); assert.equal(calls, 0); }
  finally { if (old === undefined) delete process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; else process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = old; }
});
test('bounds Twilio download before transcription and rejects a long voice note', async () => {
  const old = process.env.DIETAVITY_MEDIA_AUDIO_ENABLED; process.env.DIETAVITY_MEDIA_AUDIO_ENABLED = 'true';
  const ogg = opusOgg(61);
  let request;
  const enricher = createMediaEnricher({ twilioKey:'key', twilioSecret:'secret', http: {
    async get(_url, options) { request = options; return { data: ogg }; },
    async post() { throw new Error('must not transcribe'); },
  }});
  try {
    await assert.rejects(enricher.enrich({ media_path:path, content_type:'audio/ogg', provider_message_sid:sid, ordinal:0 }), error => error.code === 'audio_too_long');
    assert.equal(request.maxRedirects, 0); assert.ok(request.maxContentLength > 0); assert.ok(request.maxBodyLength > 0);
  } finally { if (old === undefined) delete process.env.DIETAVITY_MEDIA_AUDIO_ENABLED; else process.env.DIETAVITY_MEDIA_AUDIO_ENABLED = old; }
});
test('rejects malformed Ogg duration evidence and images with unknown or excessive dimensions', async () => {
  const oldAudio = process.env.DIETAVITY_MEDIA_AUDIO_ENABLED; const oldImage = process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; process.env.DIETAVITY_MEDIA_AUDIO_ENABLED = 'true'; process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = 'true';
  const run = (content_type, bytes) => createMediaEnricher({ twilioKey:'key', twilioSecret:'secret', http: { async get() { return { data: bytes }; }, async post() { throw new Error('must not call OpenAI'); } } }).enrich({ media_path:path, content_type, provider_message_sid:sid, ordinal:0 });
  try {
    await assert.rejects(run('audio/ogg', opusOgg(1, { eos: false })), error => error.code === 'invalid_attachment');
    await assert.rejects(run('image/png', png(5001, 5000)), error => error.code === 'invalid_attachment');
    await assert.rejects(run('image/webp', Buffer.from('RIFFxxxxWEBPVP8X')), error => error.code === 'invalid_attachment');
  } finally { if (oldAudio === undefined) delete process.env.DIETAVITY_MEDIA_AUDIO_ENABLED; else process.env.DIETAVITY_MEDIA_AUDIO_ENABLED = oldAudio; if (oldImage === undefined) delete process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; else process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = oldImage; }
});
test('classifies missing Twilio media as terminal customer fallback', async () => {
  for (const status of [404, 410]) await withAudioEnabled(async () => {
    const enricher = createMediaEnricher({ twilioKey:'key', twilioSecret:'secret', http: { async get() { throw httpFailure(status); } } });
    await assert.rejects(enricher.enrich({ media_path:path, content_type:'audio/ogg', provider_message_sid:sid, ordinal:0 }), error => error.code === 'media_not_found' && !error.transient);
  });
});
test('reports bounded diagnostics for retryable Twilio metadata and download failures', async () => {
  const failures = [
    [httpFailure(429), 'twilio_media_download_http_429'],
    [httpFailure(500), 'twilio_media_download_http_5xx'],
    [new Error('timeout'), 'twilio_media_download_timeout'],
    [Object.assign(new Error('tls'), { code: 'EPROTO' }), 'twilio_media_download_tls_failure'],
    [Object.assign(new Error('dns'), { code: 'ENOTFOUND' }), 'twilio_media_download_dns_failure'],
  ];
  for (const [error, diagnostic] of failures) await withAudioEnabled(async () => {
    const enricher = createMediaEnricher({ twilioKey:'key', twilioSecret:'secret', http: { async get() { throw error; } } });
    await assert.rejects(enricher.enrich({ media_path:path, content_type:'audio/ogg', provider_message_sid:sid, ordinal:0 }), failure => failure.code === 'media_unavailable' && failure.transient && failure.diagnostic === diagnostic);
  });
});
test('surfaces Twilio authorization failures as terminal operator incidents', async () => {
  for (const status of [401, 403]) await withAudioEnabled(async () => {
    const events = []; const enricher = createMediaEnricher({ twilioKey:'key', twilioSecret:'secret', diagnosticLogger: { error: event => events.push(event) }, http: { async get() { throw httpFailure(status); } } });
    await assert.rejects(enricher.enrich({ media_path:path, content_type:'audio/ogg', provider_message_sid:sid, ordinal:0 }), failure => failure.code === 'media_retrieval_authorization_failed' && !failure.transient);
    assert.deepEqual(events, [{ event: 'twilio_media_retrieval_authorization_failed', status }]);
  });
});
test('valid Ogg/Opus media still reaches the transcription contract', async () => withAudioEnabled(async () => {
  const enricher = createMediaEnricher({ apiKey:'openai-test', twilioKey:'key', twilioSecret:'secret', http: { async get() { return { data: opusOgg(1) }; }, async post(_url, form) { assert.ok(form instanceof FormData); return { data: { text: 'Comí una ensalada.' } }; } } });
  assert.deepEqual(await enricher.enrich({ media_path:path, content_type:'audio/opus', provider_message_sid:sid, ordinal:0 }), { kind: 'audio', text: 'Comí una ensalada.' });
}));
test('rejects a MIME/signature mismatch before any OpenAI request', async () => {
  const old = process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = 'true';
  const enricher = createMediaEnricher({ twilioKey:'key', twilioSecret:'secret', http: {
    async get() { return { data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }; },
    async post() { throw new Error('must not call OpenAI'); },
  }});
  try { await assert.rejects(enricher.enrich({ media_path:path, content_type:'image/jpeg', provider_message_sid:sid, ordinal:0 }), error => error.code === 'invalid_attachment'); }
  finally { if (old === undefined) delete process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; else process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = old; }
});
test('feature flags fail closed before a download', async () => { const enricher=createMediaEnricher({ twilioKey:'x',twilioSecret:'y',http:{get(){throw new Error('must not download');}}}); await assert.rejects(enricher.enrich({media_path:path,content_type:'image/jpeg',provider_message_sid:sid,ordinal:0}), error => error.code === 'image_disabled'); });
test('classifies OpenAI HTTP, network, timeout, and response-contract failures without retaining provider bodies', async () => {
  assert.deepEqual(openAiFailure(httpFailure(400)), { code: 'enrichment_invalid_request', transient: false, diagnostic: 'openai_http_400' });
  assert.deepEqual(openAiFailure(httpFailure(401)), { code: 'enrichment_authorization_failed', transient: false, diagnostic: 'openai_http_401' });
  assert.deepEqual(openAiFailure(httpFailure(403)), { code: 'enrichment_authorization_failed', transient: false, diagnostic: 'openai_http_403' });
  assert.deepEqual(openAiFailure(httpFailure(404)), { code: 'enrichment_model_unavailable', transient: false, diagnostic: 'openai_http_404' });
  assert.deepEqual(openAiFailure(httpFailure(429)), { code: 'enrichment_rate_limited', transient: true, diagnostic: 'openai_http_429' });
  assert.deepEqual(openAiFailure(httpFailure(503)), { code: 'enrichment_provider_unavailable', transient: true, diagnostic: 'openai_http_5xx' });
  assert.deepEqual(openAiFailure(Object.assign(new Error('request timeout'), { code: 'ECONNABORTED' })), { code: 'enrichment_timeout', transient: true, diagnostic: 'openai_timeout' });
  assert.deepEqual(openAiFailure(Object.assign(new Error('connection failed'), { code: 'ENOTFOUND' })), { code: 'enrichment_network_unavailable', transient: true, diagnostic: 'openai_network_failure' });
});
test('surfaces sanitized OpenAI diagnostics and rejects an empty response contract', async () => {
  const old = process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = 'true';
  const events = [];
  const item = { media_path:path, content_type:'image/png', provider_message_sid:sid, ordinal:0 };
  try {
    const providerFailure = createMediaEnricher({ twilioKey:'key', twilioSecret:'secret', diagnosticLogger: { warn: event => events.push(event) }, http: { async get() { return { data: png(1, 1) }; }, async post() { throw httpFailure(429); } } });
    await assert.rejects(providerFailure.enrich(item), failure => failure.code === 'enrichment_rate_limited' && failure.transient && failure.diagnostic === 'openai_http_429');
    assert.deepEqual(events, [{ event: 'openai_media_enrichment_failed', diagnostic: 'openai_http_429' }]);
    const invalidResponse = createMediaEnricher({ twilioKey:'key', twilioSecret:'secret', http: { async get() { return { data: png(1, 1) }; }, async post() { return { data: { choices: [] } }; } } });
    await assert.rejects(invalidResponse.enrich(item), failure => failure.code === 'enrichment_response_invalid' && !failure.transient && failure.diagnostic === 'openai_response_contract');
  } finally { if (old === undefined) delete process.env.DIETAVITY_MEDIA_IMAGES_ENABLED; else process.env.DIETAVITY_MEDIA_IMAGES_ENABLED = old; }
});
