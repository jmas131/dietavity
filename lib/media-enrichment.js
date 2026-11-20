'use strict';

// This module deliberately accepts only a Twilio Media API path captured from
// the signed webhook. It never follows customer-supplied URLs or logs content.
const axios = require('axios');
const { Blob, FormData } = globalThis;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// WhatsApp voice notes arrive as Ogg/Opus. Keeping this MVP to containers for
// which we can inspect the final granule position enforces the 60-second cap
// without adding a decoder or accepting an unverified duration claim.
const AUDIO_TYPES = new Set(['audio/ogg', 'audio/opus']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 60;
const MAX_IMAGE_PIXELS = 25_000_000;
const MEDIA_PATH = /^\/2010-04-01\/Accounts\/(AC[0-9a-f]{32})\/Messages\/((?:SM|MM)[0-9a-f]{32})\/Media\/(ME[0-9a-f]{32})$/i;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class MediaEnrichmentError extends Error {
  constructor(code, transient = false, diagnostic = null) {
    super(code); this.code = code; this.transient = transient; this.diagnostic = diagnostic;
  }
}
function enabled(name) { return String(process.env[name] || '').toLowerCase() === 'true'; }
function descriptor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4) throw new MediaEnrichmentError('invalid_attachment');
  const { media_path, content_type, provider_message_sid, ordinal } = value;
  const match = typeof media_path === 'string' && MEDIA_PATH.exec(media_path);
  if (!match || match[2] !== provider_message_sid || ordinal !== 0 || typeof content_type !== 'string') throw new MediaEnrichmentError('invalid_attachment');
  const kind = IMAGE_TYPES.has(content_type.toLowerCase()) ? 'image' : AUDIO_TYPES.has(content_type.toLowerCase()) ? 'audio' : null;
  if (!kind) throw new MediaEnrichmentError('unsupported_attachment');
  return { media_path, content_type: content_type.toLowerCase(), provider_message_sid, kind };
}
function detectedType(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff,0xd8,0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 4).toString() === 'OggS') return 'audio/ogg';
  if (buffer.subarray(0, 3).toString() === 'ID3') return 'audio/mpeg';
  if (buffer.subarray(4, 8).toString() === 'ftyp') return 'audio/mp4';
  if (buffer.subarray(0, 4).toString() === 'RIFF') return 'audio/webm';
  return null;
}
function matchesDeclaredType(detected, declared) {
  // Twilio can label an Opus-in-Ogg voice note as audio/opus or audio/ogg.
  // The container is Ogg in both cases; everything else must match exactly.
  return detected === declared || (detected === 'audio/ogg' && declared === 'audio/opus');
}
function magic(buffer, kind) { const type = detectedType(buffer); return kind === 'image' ? IMAGE_TYPES.has(type) : AUDIO_TYPES.has(type); }
function jpegMarkerIsFrame(marker) { return (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf); }
function pngDimensions(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.readUInt32BE(8) !== 13 || buffer.subarray(12, 16).toString() !== 'IHDR') return null;
  let at = 8; let first = true; let sawEnd = false; let dimensions = null;
  while (at + 12 <= buffer.length) {
    const size = buffer.readUInt32BE(at); const end = at + 12 + size;
    if (end > buffer.length) return null;
    const kind = buffer.subarray(at + 4, at + 8).toString();
    if (first) { if (kind !== 'IHDR' || size !== 13) return null; dimensions = [buffer.readUInt32BE(at + 8), buffer.readUInt32BE(at + 12)]; first = false; }
    if (kind === 'IEND') { if (size !== 0 || end !== buffer.length) return null; sawEnd = true; break; }
    at = end;
  }
  return sawEnd ? dimensions : null;
}
function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  for (let at = 2; at + 1 < buffer.length;) {
    if (buffer[at++] !== 0xff) return null;
    while (at < buffer.length && buffer[at] === 0xff) at += 1;
    if (at >= buffer.length) return null;
    const marker = buffer[at++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (at + 2 > buffer.length) return null;
    const size = buffer.readUInt16BE(at);
    if (size < 2 || at + size > buffer.length) return null;
    if (jpegMarkerIsFrame(marker)) {
      if (size < 8) return null;
      return [buffer.readUInt16BE(at + 5), buffer.readUInt16BE(at + 3)];
    }
    at += size;
  }
  return null;
}
function webpDimensions(buffer) {
  if (buffer.length < 20 || buffer.subarray(0, 4).toString() !== 'RIFF' || buffer.subarray(8, 12).toString() !== 'WEBP' || buffer.readUInt32LE(4) + 8 !== buffer.length) return null;
  let at = 12; let canvas = null; let image = false;
  while (at + 8 <= buffer.length) {
    const kind = buffer.subarray(at, at + 4).toString(); const size = buffer.readUInt32LE(at + 4); const data = at + 8; const end = data + size;
    if (end > buffer.length) return null;
    if (kind === 'VP8X') {
      if (size !== 10 || canvas) return null;
      canvas = [1 + buffer.readUIntLE(data + 4, 3), 1 + buffer.readUIntLE(data + 7, 3)];
    } else if (kind === 'VP8 ') {
      if (size < 10 || buffer[data] & 1 || !buffer.subarray(data + 3, data + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) return null;
      image = true; if (!canvas) canvas = [buffer.readUInt16LE(data + 6) & 0x3fff, buffer.readUInt16LE(data + 8) & 0x3fff];
    } else if (kind === 'VP8L') {
      if (size < 5 || buffer[data] !== 0x2f) return null;
      image = true;
      if (!canvas) { const b1 = buffer[data + 1]; const b2 = buffer[data + 2]; const b3 = buffer[data + 3]; const b4 = buffer[data + 4]; canvas = [1 + b1 + ((b2 & 0x3f) << 8), 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10)]; }
    }
    at = end + (size % 2);
  }
  return at === buffer.length && image ? canvas : null;
}
function imageDimensions(buffer, type) {
  if (type === 'image/png') return pngDimensions(buffer);
  if (type === 'image/jpeg') return jpegDimensions(buffer);
  if (type === 'image/webp') return webpDimensions(buffer);
  return null;
}
function oggDurationSeconds(buffer) {
  let at = 0; let serial = null; let expectedSequence = null; let finalGranule = null; let preSkip = null; let sawEnd = false;
  while (at + 27 <= buffer.length) {
    if (buffer.subarray(at, at + 4).toString() !== 'OggS' || buffer[at + 4] !== 0) return null;
    const flags = buffer[at + 5]; const segments = buffer[at + 26]; const tableEnd = at + 27 + segments;
    if (tableEnd > buffer.length) return null;
    let payloadLength = 0; for (let index = at + 27; index < tableEnd; index += 1) payloadLength += buffer[index];
    const end = tableEnd + payloadLength; if (end > buffer.length) return null;
    const pageSerial = buffer.readUInt32LE(at + 14); const sequence = buffer.readUInt32LE(at + 18);
    if (serial === null) { if (!(flags & 0x02) || (flags & 0x01)) return null; serial = pageSerial; expectedSequence = sequence; }
    if (pageSerial !== serial || sequence !== expectedSequence) return null;
    expectedSequence = (expectedSequence + 1) >>> 0;
    if (preSkip === null) {
      let packetLength = 0; let packetEnd = -1;
      for (let index = 0; index < segments; index += 1) { packetLength += buffer[at + 27 + index]; if (buffer[at + 27 + index] < 255) { packetEnd = index; break; } }
      if (packetEnd < 0 || packetLength < 19) return null;
      const packet = buffer.subarray(tableEnd, tableEnd + packetLength);
      if (packet.subarray(0, 8).toString() !== 'OpusHead' || packet[8] > 15 || !packet[9]) return null;
      preSkip = packet.readUInt16LE(10);
    }
    const granule = buffer.readBigUInt64LE(at + 6);
    if (flags & 0x04) { if (end !== buffer.length || sawEnd) return null; sawEnd = true; finalGranule = granule; }
    at = end;
  }
  if (at !== buffer.length || !sawEnd || finalGranule === null || preSkip === null || finalGranule < BigInt(preSkip)) return null;
  const duration = Number(finalGranule - BigInt(preSkip)) / 48000;
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}
function boundedText(value) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200) : ''; }
function openAiFailure(error) {
  const status = Number.isInteger(error?.response?.status) ? error.response.status : null;
  if (status === 400) return { code: 'enrichment_invalid_request', transient: false, diagnostic: 'openai_http_400' };
  if (status === 401 || status === 403) return { code: 'enrichment_authorization_failed', transient: false, diagnostic: `openai_http_${status}` };
  if (status === 404) return { code: 'enrichment_model_unavailable', transient: false, diagnostic: 'openai_http_404' };
  if (status === 429) return { code: 'enrichment_rate_limited', transient: true, diagnostic: 'openai_http_429' };
  if (status !== null && status >= 500) return { code: 'enrichment_provider_unavailable', transient: true, diagnostic: 'openai_http_5xx' };
  if (error?.code === 'ECONNABORTED' || /\btimeout\b/i.test(String(error?.message || ''))) return { code: 'enrichment_timeout', transient: true, diagnostic: 'openai_timeout' };
  return { code: 'enrichment_network_unavailable', transient: true, diagnostic: 'openai_network_failure' };
}
function createMediaEnricher({ http = axios, apiKey = process.env.OPENAI_API_KEY, twilioKey = process.env.TWILIO_MEDIA_API_KEY, twilioSecret = process.env.TWILIO_MEDIA_API_SECRET, visionModel = process.env.MEDIA_VISION_MODEL || 'gpt-4.1-mini', transcriptionModel = process.env.MEDIA_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe', diagnosticLogger = console } = {}) {
  async function download(item) {
    if (!twilioKey || !twilioSecret) throw new MediaEnrichmentError('media_unavailable', true);
    try {
      const response = await http.get(`https://api.twilio.com${item.media_path}`, { auth: { username: twilioKey, password: twilioSecret }, responseType: 'arraybuffer', timeout: 15000, maxRedirects: 0, maxContentLength: item.kind === 'image' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES, maxBodyLength: item.kind === 'image' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES, validateStatus: s => s >= 200 && s < 300 });
      const bytes = Buffer.from(response.data);
      const type = detectedType(bytes);
      if (bytes.length > (item.kind === 'image' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES) || !matchesDeclaredType(type, item.content_type)) throw new MediaEnrichmentError('invalid_attachment');
      const dimensions = item.kind === 'image' ? imageDimensions(bytes, type) : null;
      if (item.kind === 'image' && (!dimensions || !dimensions[0] || !dimensions[1] || dimensions[0] * dimensions[1] > MAX_IMAGE_PIXELS)) throw new MediaEnrichmentError('invalid_attachment');
      const duration = item.kind === 'audio' ? oggDurationSeconds(bytes) : null;
      if (item.kind === 'audio' && duration === null) throw new MediaEnrichmentError('invalid_attachment');
      if (duration > MAX_AUDIO_SECONDS) throw new MediaEnrichmentError('audio_too_long');
      return bytes;
    } catch (error) {
      if (error instanceof MediaEnrichmentError) throw error;
      const status = Number.isInteger(error?.response?.status) ? error.response.status : null;
      if (status === 404 || status === 410) throw new MediaEnrichmentError('media_not_found');
      if (status === 401 || status === 403) {
        // This is an operator configuration/authorization incident, never a
        // statement about the customer's attachment. Keep diagnostics free of
        // URLs, account IDs, message IDs, and response bodies.
        try { diagnosticLogger?.error?.({ event: 'twilio_media_retrieval_authorization_failed', status }); } catch { /* logging cannot change routing */ }
        throw new MediaEnrichmentError('media_retrieval_authorization_failed');
      }
      throw new MediaEnrichmentError('media_unavailable', true);
    }
  }
  return Object.freeze({ async enrich(raw) {
    const item = descriptor(raw);
    if (item.kind === 'image' && !enabled('DIETAVITY_MEDIA_IMAGES_ENABLED')) throw new MediaEnrichmentError('image_disabled');
    if (item.kind === 'audio' && !enabled('DIETAVITY_MEDIA_AUDIO_ENABLED')) throw new MediaEnrichmentError('audio_disabled');
    const bytes = await download(item);
    try {
      if (item.kind === 'image') {
        const dataUrl = `data:${item.content_type};base64,${bytes.toString('base64')}`;
        const r = await http.post('https://api.openai.com/v1/chat/completions', { model: visionModel, messages: [{ role: 'system', content: 'Describe only food, label, supplement or menu facts relevant to a general nutrition conversation. Do not diagnose.' }, { role: 'user', content: [{ type: 'text', text: 'Describe this image concisely in Spanish.' }, { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } }] }], max_tokens: 300 }, { timeout: 20000, headers: { Authorization: `Bearer ${apiKey}` } });
        const text = boundedText(r.data?.choices?.[0]?.message?.content);
        if (!text) throw new MediaEnrichmentError('enrichment_response_invalid', false, 'openai_response_contract');
        return { kind: 'image', text };
      }
      const form = new FormData(); form.append('model', transcriptionModel); form.append('language', 'es'); form.append('file', new Blob([bytes], { type: item.content_type }), 'voice');
      const r = await http.post('https://api.openai.com/v1/audio/transcriptions', form, { timeout: 20000, headers: { Authorization: `Bearer ${apiKey}` } });
      const text = boundedText(r.data?.text);
      if (!text) throw new MediaEnrichmentError('enrichment_response_invalid', false, 'openai_response_contract');
      return { kind: 'audio', text };
    } catch (error) {
      if (error instanceof MediaEnrichmentError) throw error;
      const failure = openAiFailure(error);
      // Deliberately log only a stable category: never provider bodies,
      // request headers, prompts, binary data, or customer identifiers.
      try { diagnosticLogger?.warn?.({ event: 'openai_media_enrichment_failed', diagnostic: failure.diagnostic }); } catch { /* logging cannot change routing */ }
      throw new MediaEnrichmentError(failure.code, failure.transient, failure.diagnostic);
    }
  }});
}
module.exports = Object.freeze({ createMediaEnricher, MediaEnrichmentError, descriptor, magic, detectedType, matchesDeclaredType, imageDimensions, oggDurationSeconds, openAiFailure, MAX_IMAGE_BYTES, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, MAX_IMAGE_PIXELS });
