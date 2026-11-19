# Ticket 96B isolated sandbox runbook

This runbook prepares a temporary sandbox on the existing VPS without sharing
production n8n state, providers, database, or Express process. It is an
operator procedure; it does not authorize production changes.

## Activation blockers and ownership

Before any sandbox workflow is activated, the operator change record must name
one sandbox owner and an exact UTC retention deadline no later than seven
calendar days after the final synthetic-media test. There is no default owner
or implicit retention approval. The run is blocked until both are recorded.

The Compose image is currently a version tag, not an immutable digest. Before
starting it, an operator must obtain the `sha256` digest for the approved n8n
2.46.4 image from the approved registry, verify the reported version after
pulling it, record both pieces of evidence, and replace the tag in the local
sandbox Compose copy. Do not invent or substitute a digest.

## Isolation model

| Component | Production | Ticket 96B sandbox |
| --- | --- | --- |
| Docker bridge | `root_default` / `172.18.0.0/16` | `dietavity_ticket96b_sandbox` / `172.19.0.0/24` |
| n8n data | external `n8n_data` | `dietavity_ticket96b_n8n_data` only |
| n8n address | `172.18.0.2` | `172.19.0.2` |
| Express listener | `127.0.0.1:3000` | `127.0.0.1:3101` |
| private Nginx listener | `172.18.0.1:12751` | `172.19.0.1:12751` |
| database/providers | production credentials | sandbox-only credentials |

The sandbox Nginx private listener allows only `172.19.0.2`, passes the
existing internal-secret header, proxies only the V1, V4, and Ticket 96B media
routes to the sandbox Express listener, and returns `404` for every other
path. It never exposes an internal route publicly.

## Before any service starts

1. Obtain operator approval for a temporary Docker bridge, named n8n volume,
   loopback Express process, sandbox DNS/TLS name, and Nginx configuration.
2. Check VPS headroom before creation: reserve at least 512 MiB RAM, 0.5 CPU,
   256 PIDs, a small n8n volume, and normal outbound HTTPS capacity. Stop if
   this would pressure production; these are caps, not evidence of available
   capacity.
3. Confirm `172.19.0.0/24` does not overlap an existing Docker, VPN, or routed
   subnet. Never attach the sandbox container to `root_default`.
4. Obtain a separate Supabase sandbox project/database, sandbox Twilio
   WhatsApp sender and Media API credential, sandbox OpenAI project/key with a
   spending cap, and a new internal shared secret. Do not copy production
   `.env`, n8n volume, credential export, or PM2 environment.
5. Obtain legal approval for `docs/TICKET-96B-PRIVACY-DRAFT.md` before any
   non-synthetic media test.

## Sandbox-only n8n environment access

The canonical Sales Engine has these `$env` references: `OPENAI_API_KEY`,
`STRIPE_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_MESSAGING_SERVICE_SID`,
`TWILIO_SALES_REMINDER_CONTENT_SID`, and
`TWILIO_SALES_REMINDER_CANONICAL_BODY`. `OPENAI_API_KEY`, `STRIPE_API_KEY`,
and `TWILIO_SALES_REMINDER_CONTENT_SID` are referenced more than once. The
committed Global Error Handler, WhatsApp Recovery Poller, and Ledger Health
Monitor contain no `$env` references.

Existing n8n credentials remain preferred for Twilio, Postgres/Supabase,
OpenAI model nodes, and the internal-header credential. The six listed values
remain environment-backed to avoid an unrelated rewrite of the canonical
workflow. Therefore only this isolated sandbox sets
`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, with the exact allowlist declared in
`ticket-96b-sandbox.env.example`.

Before import, an operator verifies each allowlisted value by safe identity
evidence, never by printing it: OpenAI project name/limit, Stripe test-mode
indicator, Twilio sandbox account and Messaging Service identities, approved
sandbox template identity/body, and absence of any other inherited `OPENAI_*`,
`STRIPE_*`, or `TWILIO_*` environment variable. Failure of any comparison is a
stop condition. Do not source a production environment file.

## Configuration and launch order

1. Create untracked `0600` copies of `ticket-96b-sandbox.env.example` and
   `ticket-96b-sandbox-express.env.example`; fill only sandbox values.
2. After the image-digest gate passes, start the sandbox n8n Compose project from
   `docker-compose.ticket-96b-sandbox.template.yml`. Keep editor access on
   `127.0.0.1:5679` (SSH tunnel/VPN only); do not publish it publicly.
3. Start a separate service-manager entry for the committed Express source at
   `127.0.0.1:3101` using only the sandbox Express environment. Both media
   feature flags remain `false`.
4. Install the two sandbox Nginx templates only after `nginx -t` succeeds:
   the webhook listener requires dedicated sandbox DNS/TLS; the private
   listener must bind `172.19.0.1:12751`. Do not alter the production Ticket
   76 listener.
5. Apply `database/migrations/20261118_ticket_96b_media_enrichment.sql` to the
   sandbox database only, using the approved administrative migration path.
6. Import `n8n/Dietavity Sales Engine (Ticket 10).json` as a new **inactive**
   workflow in sandbox n8n. Never import a credential export.
7. Before activation, edit only the imported sandbox copy's five internal
   HTTP Request URLs from `172.18.0.1` to `172.19.0.1`:
   `Call Conversation Engine`, `Call Conversation Engine Recovery`, `Call V4
   Conversation Engine`, `Call V4 Conversation Engine Recovery`, and `Call
   Media Enrichment`.
8. Bind newly created sandbox-only Postgres/Supabase, Twilio, OpenAI, Stripe
   test-mode, and internal-header credentials. Confirm the sandbox instance
   has no production Global Error Handler association; use a sandbox-only
   error handler or leave error-workflow association absent during setup.

## Exact public webhook gate

The repository records the Twilio Trigger's webhook ID
`bce2dfd3-7d1c-4217-9a6c-a350858e4726`, but does not establish its deployed
n8n callback path. `ticket96b-sandbox-webhook.conf.template` therefore returns
`404` for every `/webhook/` path by default.

While the imported workflow remains inactive, the operator must obtain the
single production callback URL shown by the sandbox n8n Twilio Trigger, record
only its path (not credentials), and verify it belongs to **Incoming Message**
and its recorded webhook ID. Only then may the operator add one exact
`location = <verified path>` block from the template. All other `/webhook/`,
`/webhook-test/`, Stripe, payment, program-generation, and editor paths must
remain `404`. If n8n cannot show a stable callback path before activation, stop
and obtain a reviewed trigger-path procedure; do not proxy a wildcard path.

## Mandatory safety checks

1. Verify every imported credential by account/project identity, never secret
   value: sandbox database, sandbox WhatsApp sender, test-mode Stripe, and
   sandbox OpenAI project.
2. Confirm the Twilio ingress/trigger rejects a deliberately invalid webhook
   signature without creating an execution. Repository artifacts alone do not
   prove this.
3. From the sandbox n8n container, verify the private V1/V4/media endpoints
   reject missing/wrong internal headers and accept the correct header only.
   From the host/public network, verify the private listener is unreachable.
4. Confirm effective n8n settings, not only Compose environment: successful,
   failed, progress, and manual execution retention; pruning; execution-data
   access; and binary-data storage. Execute a synthetic media-shaped request
   and inspect n8n storage/history for no raw media, Base64, full media URL,
   or secret.
5. Configure Twilio's sandbox webhook only after the workflow remains inactive
   and all preceding checks pass. Verify the endpoint rejects invalid
   signatures before enabling a test trigger.
6. Keep both media flags disabled through text-only, credential, and private
   route checks. Enable one flag at a time for synthetic-media validation.

## TLS, DNS, firewall, and public-surface acceptance

Before entering a sandbox webhook in Twilio, retain the following evidence in
the sandbox change record, without secrets:

| Gate | PASS evidence | FAIL condition |
| --- | --- | --- |
| DNS | `dig +short` resolves the sandbox hostname to the approved VPS address only | Missing, production, or unexpected address |
| TLS | `openssl s_client -servername <sandbox-host> -connect <sandbox-host>:443` shows a valid hostname-matching, unexpired chain | Name mismatch, expiry, trust failure, or wrong certificate |
| Public HTTP | `curl -I http://<sandbox-host>` is refused or reaches an approved non-content redirect; it never serves n8n | Any n8n/editor/workflow response over HTTP |
| Exact callback | HTTPS request to the one verified callback reaches sandbox n8n; a random `/webhook/...` path returns `404` | Wildcard path proxies or another workflow path is reachable |
| Unknown host/direct IP | Requests using an unknown `Host` and direct IP do not reach sandbox n8n; verify the existing Nginx default virtual host/firewall rejects them | Any sandbox n8n response or public internal route |
| Internal routes | Public/host requests to `172.19.0.1:12751` fail; only a request from `172.19.0.2` with the header reaches Express | Any public reachability or missing-header acceptance |

The sandbox Nginx template does not declare `default_server`, because blindly
changing a shared VPS default server could affect production. The operator must
inspect the existing default virtual-host/firewall behavior and record the
unknown-host/direct-IP result before activation.

## Media retrieval and redirect gate

The application intentionally uses authenticated Twilio retrieval with
`maxRedirects: 0`. During the first sandbox image and Ogg/Opus test, record
only the HTTP status class and whether a `Location` header is present; do not
log the media URL or response body. A redirect is safely not followed, but it
also prevents successful media processing. If Twilio returns a redirect, stop
media activation and obtain a separately reviewed redirect policy.

## Retention, privacy, and cleanup

Synthetic food images and synthetic Ogg/Opus files are the default and only
authorized test media. A real customer attachment needs separate written
privacy approval, a documented necessity, and a new retention decision.

The sandbox limits successful, failed, progress, and manual n8n execution
storage through its Compose configuration, but this is only a proposed setting.
Before activation, the operator must prove the effective settings in the
sandbox instance and inspect one synthetic execution. PASS requires no stored
raw media, Base64, full Media API URL, authorization header, API key, or secret
in execution records, n8n binary storage, Express logs, or the sandbox
database. A bounded descriptor and derived observation/transcript in the
canonical ledger are expected.

If sensitive payloads appear, immediately deactivate the workflow, set both
media flags to `false`, stop sandbox n8n and Express, revoke the affected
sandbox credentials, restrict access to the volume/database, and notify the
sandbox owner. Do not continue testing. At the recorded retention deadline,
the owner deletes sandbox n8n volume/executions, synthetic message records,
and sandbox database/project according to the provider's deletion controls,
then records completion. Preserve only non-sensitive pass/fail evidence.

## Pre-activation evidence checklist

Every row is PASS/FAIL; an unknown value is FAIL.

| Item | PASS evidence without revealing secrets |
| --- | --- |
| Sandbox Supabase | Project ref/name differs from production; service-role test reaches only sandbox `messages` schema |
| Sandbox Twilio | Account/subaccount and WhatsApp sender identities match the sandbox change record; no production sender appears |
| Stripe | Every bound credential reports test mode, or payment paths are deliberately unbound and unreachable |
| OpenAI | Project identity and spend cap match the change record |
| Internal secret | Missing/wrong header receives `401`; correct sandbox credential works; value is never displayed |
| Network isolation | Docker inspect proves only `dietavity_ticket96b_sandbox`; no `root_default` attachment |
| Signature validation | Deliberately invalid Twilio signature creates no execution and receives rejection |
| Webhook restriction | Exact verified callback works; random webhook, unknown host, direct IP, and editor path fail as specified above |
| Migration | Sandbox backup/reference and migration review are recorded before application; no production project is selected |
| n8n retention | Effective settings and synthetic-execution inspection meet the retention pass rule above |
| Redirect behavior | Synthetic Twilio media retrieval records only status class/redirect presence; no redirect is required for PASS |
| Privacy | Synthetic-only scope, named owner, exact retention deadline, and required approval status are recorded |

## End-to-end validation and rollback

Run the ordered Ticket 96B matrix in `docs/TICKET-96B-MULTIMODAL.md`, using
synthetic images/audio and sandbox WhatsApp identities only. For each case,
verify one canonical inbound, bounded attachment/enrichment metadata only,
and one idempotent outbound reservation. Check duplicate inbound and recovery
cases before considering any production work.

Rollback is isolated: deactivate the sandbox workflow, set both sandbox media
flags to `false`, stop the sandbox Express service and Compose project, and
retain the sandbox database/volume only as required for test evidence. Do not
touch production volumes, workflows, credentials, or database rows.
