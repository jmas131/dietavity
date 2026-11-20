# Ticket 96H minimal provider smoke test

`scripts/ticket-96h-media-smoke.js` is a direct, test-only harness around
`lib/media-enrichment.js`. It does not load n8n, Express, Supabase, or the
canonical workflow; it has no database code and never sends WhatsApp messages.
It keeps downloaded binary media only in process memory and prints only
sanitized status codes.

## Prerequisites

Before a live run, an operator must verify all of the following without
printing secrets:

- A dedicated Twilio WhatsApp sandbox/test sender and a test-only account or
  subaccount.
- Test-only Twilio Media API key/secret authorized for that account.
- A separate OpenAI project/key with a recorded spending limit.
- One synthetic food JPEG, PNG, or WebP and one synthetic Spanish Ogg/Opus
  voice note shorter than 60 seconds already represented by Media API paths in
  that same test account. Obtaining these paths requires a separately approved
  test inbound-media action; this harness does not create media or send a
  message.

The test-only environment must provide the listed variables in the script's
`REQUIRED` export. `SMOKE_TWILIO_TEST_ACCOUNT_SID` is used to reject a media
path belonging to any other account. Do not store values in the repository,
shell history, test output, or an application `.env` file.

## Commands

Preflight is network-inert and safe to run before credentials/media exist:

```bash
node scripts/ticket-96h-media-smoke.js
```

It reports only missing variable names. A `ready_for_explicit_live_authorization`
result is not permission to incur provider charges.

After explicit approval for a test-only provider run, load values through the
operator's protected secret mechanism and execute:

```bash
TICKET_96H_LIVE_CONFIRMATION=ticket-96h-test-only-provider-run \
node scripts/ticket-96h-media-smoke.js --live
```

The live result contains only `pass`, `redirect_detected`, `retryable_failure`,
or `terminal_failure` for `image` and `audio`, plus sanitized authorization
event names. It never prints transcript text, image observation, raw media,
Base64, Media API URL, message SID, account SID, headers, or credential data.

The retrieval wrapper preserves `maxRedirects: 0`. A `redirect_detected`
result is a stop condition: it proves the response was not followed and needs
a separately reviewed policy before media activation.

## Local OpenAI-only mode

Local mode performs no Twilio request and needs no Twilio account, credential,
or Media API descriptor. It reads one synthetic local food image and one
synthetic local Spanish Ogg/Opus voice recording only into process memory, then
injects their bytes through the existing enrichment module's download seam.
The production image prompt, model defaults, image validation, Ogg/Opus
duration guard, and transcription request are unchanged.

Required protected environment inputs are `OPENAI_API_KEY`,
`SMOKE_OPENAI_TEST_PROJECT`, `SMOKE_LOCAL_IMAGE_PATH`, and
`SMOKE_LOCAL_AUDIO_PATH`. The image must be JPEG, PNG, or WebP within the
existing pixel limit; the audio must be a structurally valid Ogg/Opus recording
of 60 seconds or less. Unsupported, malformed, missing, oversized, or long
inputs fail before an OpenAI request.

The non-paid local preflight validates only local inputs:

```bash
node scripts/ticket-96h-media-smoke.js --local
```

After explicit authorization for a spending-limited test OpenAI project, run:

```bash
TICKET_96H_LOCAL_CONFIRMATION=ticket-96h-local-openai-run \
node scripts/ticket-96h-media-smoke.js --local --live
```

Local mode prints only `pass`, `retryable_failure`, or `terminal_failure` per
media kind. On failure it also emits one sanitized diagnostic category, never
the provider response: `openai_http_400`, `openai_http_401`,
`openai_http_403`, `openai_http_404`, `openai_http_429`, `openai_http_5xx`,
`openai_timeout`, `openai_network_failure`, or
`openai_response_contract`. It does not write output files or print source
paths, images, audio, Base64, transcripts, observations, prompts, headers, or
credentials.

## Confirmed OpenAI-only result

A controlled run with synthetic local inputs passed image recognition through
`gpt-4.1-mini` and Spanish Ogg/Opus transcription through
`gpt-4o-mini-transcribe`. This confirms the live OpenAI request contracts and
nonempty bounded outputs. It is not a semantic-quality evaluation and does not
exercise Twilio, n8n, Supabase, canonical persistence, Recovery Poller, or
WhatsApp delivery.

## What this proves and does not prove

A live PASS proves only direct test-account Media API retrieval plus OpenAI
image/transcription connectivity through the existing enrichment module. It
does not validate Twilio webhook signatures, n8n routing, Supabase persistence,
FIFO/recovery, outbound WhatsApp sending, or production configuration.
