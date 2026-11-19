# Ticket 96B multimodal sandbox guide

## Environment

Set no feature flag in production until the activation checks below are complete. Sandbox needs:

- `DIETAVITY_MEDIA_IMAGES_ENABLED=true` to enable JPEG, PNG, and WebP images.
- `DIETAVITY_MEDIA_AUDIO_ENABLED=true` to enable short Ogg/Opus WhatsApp voice notes. Other audio containers deliberately receive the unsupported-media clarification in this MVP because their duration is not safely inspected locally.
- `TWILIO_MEDIA_API_KEY` and `TWILIO_MEDIA_API_SECRET`: restricted server-side credentials able to retrieve Twilio Media API objects; they are never exposed to n8n.
- `OPENAI_API_KEY`, `MEDIA_VISION_MODEL` (default `gpt-4.1-mini`) and `MEDIA_TRANSCRIPTION_MODEL` (default `gpt-4o-mini-transcribe`).
- Existing `DIETAVITY_CONVERSATION_ENGINE_SECRET`, shared only by n8n and Express.

Keep both media flags unset or `false` for rollback. Pruning does not make execution history safe by itself: n8n receives only the four-field attachment descriptor and bounded derived text, never raw binary or Base64.

## Migration and sandbox order

1. Back up the sandbox database and apply `20261118_ticket_96b_media_enrichment.sql`.
2. Deploy the Express code with both flags disabled; verify `/internal/media-enrichment/v1/resolve` rejects missing/invalid internal authentication.
3. Import the authoritative JSON workflow into an inactive sandbox workflow and confirm its existing credential/trigger references without changing production.
4. Verify the trusted ingress validates Twilio signatures, and that the Media API credentials are scoped and can fetch a sandbox attachment.
5. Enable one flag, send synthetic/sandbox media through the normal webhook, and confirm exactly one canonical inbound row, one bounded enrichment, and one outbound reservation. Repeat after a forced temporary Express/OpenAI failure to confirm Recovery Poller retries rather than sends a fallback duplicate.
6. Enable the other flag only after the same checks. Inspect execution history access/retention and application logs for absence of media URLs, binary, Base64, and secrets.

## Production activation prerequisites

- Evidence from the actual ingress/trigger that Twilio webhook signature validation is enforced.
- Restricted Twilio Media API credentials and network access from Express only.
- n8n execution-data access, pruning, and binary-data configuration reviewed; operators with execution-history access accept the retained bounded transcript/observation risk.
- Approved privacy notice/consent wording covering images, recordings, transcripts, derived observations, OpenAI processing, retention, and instructions not to send medical/identity documents.
- Current OpenAI model availability, account access, retention terms, and cost limits verified by the operator.

## Rollback

Set the relevant feature flag to `false` and restart/reload only the Express service through the normal deployment process. Newly received media takes the existing deterministic clarification route; text-only traffic and already reserved outbound replies are unchanged. Do not delete ledger rows or retry reservations manually.
