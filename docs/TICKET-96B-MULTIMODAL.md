# Ticket 96B multimodal sandbox guide

## Environment

Set no feature flag in production until the activation checks below are complete. Sandbox needs:

- `DIETAVITY_MEDIA_IMAGES_ENABLED=true` to enable JPEG, PNG, and WebP images.
- `DIETAVITY_MEDIA_AUDIO_ENABLED=true` to enable short Ogg/Opus WhatsApp voice notes. Other audio containers deliberately receive the unsupported-media clarification in this MVP because their duration is not safely inspected locally.
- `TWILIO_MEDIA_API_KEY` and `TWILIO_MEDIA_API_SECRET`: restricted server-side credentials able to retrieve Twilio Media API objects; they are never exposed to n8n.
- `OPENAI_API_KEY`, `MEDIA_VISION_MODEL` (default `gpt-4.1-mini`) and `MEDIA_TRANSCRIPTION_MODEL` (default `gpt-4o-mini-transcribe`).
- Existing `DIETAVITY_CONVERSATION_ENGINE_SECRET`, shared only by n8n and Express.

Keep both media flags unset or `false` for rollback. Pruning does not make execution history safe by itself: n8n receives only the four-field attachment descriptor and bounded derived text, never raw binary or Base64.

## Confirmed provider smoke result

Ticket 96H's controlled OpenAI-only smoke test passed for a synthetic food
image through `gpt-4.1-mini` and a synthetic Spanish Ogg/Opus recording through
`gpt-4o-mini-transcribe`. It confirms authenticated API processing and bounded,
nonempty outputs through the production enrichment contract. It does not prove
semantic accuracy, Twilio Media API retrieval or redirects, webhook signature
validation, n8n routing, Supabase persistence, FIFO recovery, or WhatsApp
delivery.

## Migration and sandbox order

1. Back up the sandbox database and apply `20261118_ticket_96b_media_enrichment.sql`.
2. Deploy the Express code with both flags disabled; verify `/internal/media-enrichment/v1/resolve` rejects missing/invalid internal authentication.
3. Import the authoritative JSON workflow into an inactive sandbox workflow and confirm its existing credential/trigger references without changing production.
4. Verify the trusted ingress validates Twilio signatures, and that the Media API credentials are scoped and can fetch a sandbox attachment.
5. Enable one flag, send synthetic/sandbox media through the normal webhook, and confirm exactly one canonical inbound row, one bounded enrichment, and one outbound reservation. Repeat after a forced temporary Express/OpenAI failure to confirm Recovery Poller retries rather than sends a fallback duplicate.
6. Enable the other flag only after the same checks. Inspect execution history access/retention and application logs for absence of media URLs, binary, Base64, and secrets.

## Production activation prerequisites

- Integrate the reviewed Ticket 96I gate into this exact workflow artifact:
  `Incoming Message -> Authorize Production WhatsApp Recipient -> Canonicalize
  Inbound WhatsApp`. The gate accepts only `data.to` in exact
  `whatsapp:+E.164` form and compares the stripped value with the protected
  plain-E.164 `DIETAVITY_PRODUCTION_WHATSAPP_RECIPIENT`. Update the existing
  workflow ID in place; never import or activate a second Twilio trigger.
- Evidence from the actual ingress/trigger that Twilio webhook signature validation is enforced.
- Restricted Twilio Media API credentials and network access from Express only.
- A private n8n-to-Express route for `/internal/media-enrichment/v1/resolve`
  that accepts only the sandbox/production n8n origin, passes the existing
  internal header secret, and is unreachable from the public internet. Confirm
  the deployed private route matches the workflow URL before import.
- n8n execution-data access, pruning, and binary-data configuration reviewed; operators with execution-history access accept the retained bounded transcript/observation risk.
- Approved privacy notice/consent wording covering images, recordings, transcripts, derived observations, OpenAI processing, retention, and instructions not to send medical/identity documents.
- Current OpenAI model availability, account access, retention terms, and cost limits verified by the operator.
- A sandbox end-to-end run for text-only, image-only, captioned image,
  voice-only, captioned voice, unsupported media, expired media, transient
  retrieval recovery, and duplicate inbound delivery, with canonical-ledger
  and exactly-one-outbound evidence.

## Minimal production order

1. During a quiet period, export the active Sales Engine and record its ID,
   credentials, and sole Event Streams subscription. Confirm the 96I recipient
   gate remains directly before canonicalization.
2. Deploy the Express code and private route with
   `DIETAVITY_MEDIA_IMAGES_ENABLED=false` and
   `DIETAVITY_MEDIA_AUDIO_ENABLED=false`. Verify the endpoint rejects missing
   internal authentication and that the server-side Twilio credentials are
   present without displaying them.
3. Apply `20261118_ticket_96b_media_enrichment.sql` through the approved
   production migration procedure. The migration stores only descriptor and
   bounded enrichment metadata; it does not create binary storage.
4. In the existing Sales Engine workflow ID, add the reviewed media nodes while
   preserving the 96I gate, canonical reservation, FIFO claim, existing
   credentials, and the one active trigger. Do not use workflow import as an
   in-place update mechanism.
5. Recheck n8n execution history: no binary, Base64, full Media API URL, or
   secret may appear. Keep the feature flags disabled until this is accepted.
6. Enable images only for one approved staff WhatsApp test. Verify one inbound
   reservation, one bounded `media_enrichment`, V4 `media_context`, and one
   accepted outbound reservation. Repeat the duplicate-delivery and transient
   retrieval checks before enabling audio.
7. Enable audio only after the identical Ogg/Opus test passes. A Twilio Media
   API 401/403 must create the terminal operator-required ledger outcome and
   error-handler incident, with no customer clarification and no retry loop.

## Rollback

Set the relevant feature flag to `false` and restart/reload only the Express service through the normal deployment process. Newly received media takes the existing deterministic clarification route; text-only traffic and already reserved outbound replies are unchanged. Do not delete ledger rows or retry reservations manually.

If the workflow graph needs rollback, restore the backed-up graph in the same
workflow ID while retaining the Ticket 96I recipient gate. Verify exactly one
active Event Streams subscription. The media migration is additive and should
remain applied; do not roll it back manually.
