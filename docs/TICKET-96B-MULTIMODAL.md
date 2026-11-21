# Ticket 96B controlled production rollout guide

## Environment and security controls

Set no feature flag in production until the activation checks below are complete. Sandbox needs:

- `DIETAVITY_MEDIA_IMAGES_ENABLED=true` to enable JPEG, PNG, and WebP images.
- `DIETAVITY_MEDIA_AUDIO_ENABLED=true` to enable short Ogg/Opus WhatsApp voice notes. Other audio containers deliberately receive the unsupported-media clarification in this MVP because their duration is not safely inspected locally.
- `TWILIO_MEDIA_API_KEY` and `TWILIO_MEDIA_API_SECRET`: restricted server-side credentials able to retrieve Twilio Media API objects; they are never exposed to n8n.
- `OPENAI_API_KEY`, `MEDIA_VISION_MODEL` (default `gpt-4.1-mini`) and `MEDIA_TRANSCRIPTION_MODEL` (default `gpt-4o-mini-transcribe`).
- Existing `DIETAVITY_CONVERSATION_ENGINE_SECRET`, shared only by n8n and Express.
- `DIETAVITY_MEDIA_TEST_WHATSAPP_ALLOWLIST`: a protected Express-only JSON
  array of exact, plain E.164 test sender identities. It is required even when
  a media feature flag is enabled. Missing, malformed, empty, duplicate, or
  non-E.164 values deny media enrichment for every sender. Never add this
  value to workflow JSON, logs, credentials, or a response body.

Keep both media flags unset or `false` for rollback. Pruning does not make
execution history safe by itself: n8n handles only the four-field attachment
descriptor, the existing canonical sender identity used for the protected
allowlist check, and bounded derived text—never raw binary or Base64.

## Confirmed provider smoke result

Ticket 96H's controlled OpenAI-only smoke test passed for a synthetic food
image through `gpt-4.1-mini` and a synthetic Spanish Ogg/Opus recording through
`gpt-4o-mini-transcribe`. It confirms authenticated API processing and bounded,
nonempty outputs through the production enrichment contract. It does not prove
semantic accuracy, Twilio Media API retrieval or redirects, webhook signature
validation, n8n routing, Supabase persistence, FIFO recovery, or WhatsApp
delivery.

## Pre-deployment validation

1. Back up the production database according to the approved procedure and
   review `20261118_ticket_96b_media_enrichment.sql`; do not apply it before
   the workflow/Express rollback points are recorded.
2. Deploy the Express release with both flags disabled and a valid allowlist
   containing only approved staff test identities. Verify
   `/internal/media-enrichment/v1/resolve` rejects missing/invalid internal
   authentication.
3. Verify trusted ingress signature validation, restricted Media API access,
   private n8n-to-Express routing, and effective n8n execution/binary-data
   privacy settings before enabling either feature.
4. Confirm the existing workflow can be updated in place without a second
   Twilio Trigger or Event Streams subscription. Keep the media nodes inactive
   until the controlled procedure below reaches its enablement step.

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
- Controlled tests with approved identities for text-only, image-only,
  captioned image, voice-only, captioned voice, unsupported media, expired
  media, transient retrieval recovery, and duplicate inbound delivery, with
  canonical-ledger and exactly-one-outbound evidence.

## Minimal production order

1. During a quiet period, export the active Sales Engine and record its ID,
   credentials, and sole Event Streams subscription. Confirm the 96I recipient
   gate remains directly before canonicalization.
2. Set the protected, Express-only `DIETAVITY_MEDIA_TEST_WHATSAPP_ALLOWLIST`
   to a JSON array containing only the approved staff test sender(s). Confirm
   its presence and JSON/E.164 validity without printing it. This allowlist is
   independent of, and must not alter, the Ticket 96I production-recipient
   gate in n8n.
3. Deploy the Express code and private route with
   `DIETAVITY_MEDIA_IMAGES_ENABLED=false` and
   `DIETAVITY_MEDIA_AUDIO_ENABLED=false`. Verify the endpoint rejects missing
   internal authentication and that the server-side Twilio credentials are
   present without displaying them.
4. Apply `20261118_ticket_96b_media_enrichment.sql` through the approved
   production migration procedure. The migration stores only descriptor and
   bounded enrichment metadata; it does not create binary storage.
5. In the existing Sales Engine workflow ID, add the reviewed media nodes while
   preserving the 96I gate, canonical reservation, FIFO claim, existing
   credentials, and the one active trigger. Do not use workflow import as an
   in-place update mechanism.
6. Recheck n8n execution history: no binary, Base64, full Media API URL, or
   secret may appear. Keep the feature flags disabled until this is accepted.
7. Enable images only for one approved allowlisted staff WhatsApp test. Verify one inbound
   reservation, one bounded `media_enrichment`, V4 `media_context`, and one
   accepted outbound reservation. Repeat the duplicate-delivery and transient
   retrieval checks before enabling audio.
8. Enable audio only after the identical Ogg/Opus test passes. Twilio Media
   API 401/403 and OpenAI authorization/model-access failures must create the
   terminal operator-required ledger outcome and error-handler incident, with
   no customer clarification and no retry loop.

## Controlled allowlisted production rollout

This rollout uses the existing production infrastructure and is intentionally
not a general media launch.

1. During a quiet period, export the active Sales Engine by its existing ID and
   retain the current Express release/PM2 revision for rollback. Confirm there
   is one active Twilio Event Streams subscription and that the Ticket 96I
   recipient gate is the first node after `Incoming Message`.
2. Validate the protected test allowlist without printing it: it must be a
   nonempty JSON array of unique plain E.164 staff sender identities. Keep both
   media flags `false` and restart only Express so the new configuration is
   loaded.
3. Apply `20261118_ticket_96b_media_enrichment.sql` through the approved
   production migration procedure. It is additive; do not apply it through
   n8n or expose its function to browser roles.
4. Verify the private n8n-to-Express media route rejects a missing/wrong shared
   secret, accepts the configured header, and has server-side Twilio Media API
   credentials. Verify the trusted ingress signature check and that n8n
   execution history contains neither binary data nor Base64.
5. Update the existing Sales Engine workflow ID in place with this artifact;
   do not import/activate a duplicate Twilio Trigger or create another Event
   Streams subscription. Preserve all existing credentials, FIFO/recovery
   nodes, outbound reservation, and Ticket 96I connection.
6. Enable only `DIETAVITY_MEDIA_IMAGES_ENABLED=true`. Send one approved staff
   image from an allowlisted sender and confirm one canonical inbound, one
   bounded enrichment, V4 media context, and exactly one accepted outbound.
   Confirm an equivalent non-allowlisted media event receives only the normal
   clarification and does not call media enrichment.
7. Check duplicate delivery and a bounded transient-retrieval recovery before
   continuing. For controlled Twilio and OpenAI authorization/model-access
   failure checks, verify each creates `operator_required`, an actionable
   Global Error Handler incident naming the stable failure code, no outbound
   reservation, and no retry loop.
8. Enable `DIETAVITY_MEDIA_AUDIO_ENABLED=true` only after the image evidence is
   accepted, then repeat the same checks with one Spanish Ogg/Opus voice note.
9. Add identities to the protected allowlist only after explicit operator
   approval. Leave text-only processing unchanged for all other customers.

## Rollback

Set the relevant feature flag to `false` or remove the affected sender from the
protected allowlist, then restart/reload only the Express service through the
normal deployment process. Newly received media takes the existing deterministic
clarification route; text-only traffic and already reserved outbound replies are
unchanged. Do not delete ledger rows or retry reservations manually.

If the workflow graph needs rollback, restore the backed-up graph in the same
workflow ID while retaining the Ticket 96I recipient gate. Verify exactly one
active Event Streams subscription. The media migration is additive and should
remain applied; do not roll it back manually.
