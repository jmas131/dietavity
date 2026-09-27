# Ticket75G.4 — controlled disabled-installation preflight

This is an operator runbook and preflight record. It is **not** deployment
authorization. Every installation and verification step keeps
`SALES_ENGINE_V2_CONTROL=disabled`; it must not set a cohort or invoke a
claimed-turn request. Ticket75H requires later, separate authorization.

## Current evidence and preflight verdict

Repository facts at `1fc6bbbe54fdc5b408da204767b8ef264cb612f3`:

| Item | State | Evidence / consequence |
| --- | --- | --- |
| G.3A replay migration | ready, not yet production-verified | `20260927_ticket_75g3a_assertion_replay.sql`, SHA `17276707b6ba2871b80997aaa775073cf4ccbfc825ce5f21fb22085678837315` |
| F.1 diagnostic migration | ready, not yet production-verified | `20260926_ticket_75f1_v2_lifecycle_diagnostics.sql`, SHA `473e8ce367c4ac31bd01ba3e416e748394f14f9dd003db1f357b88e4465855e8` |
| D.1 reservation migration | intentionally excluded | it must remain absent for shadow |
| G.3D merge | ready | repeat it against an immediate fresh export; never install the checked-in candidate directly |
| Disabled runtime | fail closed | missing/disabled configuration does not assemble model, action, reservation, diagnostics, or replay adapters |
| HTTP timeout | **implementation required** | the generated claimed-turn HTTP nodes currently have empty `options`; no explicit 100-second timeout is represented |
| private listener | **implementation/operator decision required** | `server.js` currently calls `app.listen(3000)` without a host, so an installation must not rely on an unverified firewall to make the internal endpoint private |
| n8n JWT support | **operator verification required** | repository node definitions use `n8n-nodes-base.jwt`, but installed production capability has not been independently observed |
| diagnostic governance | **operator approval required** | F.1 deliberately has no embedded retention/purge policy |

Prior read-only topology evidence, which must be rechecked immediately before
the controlled change, was: host-managed Node at `/var/www/dietavity`, PM2
process `dietavity`, Node listening on port 3000, public nginx proxying to
`127.0.0.1:3000`, and local Docker-hosted n8n. It is not sufficient to select
a network path today. The active Sales Engine remains
`9oRFrbGVuK91LaAD`; Recovery Poller and Global Error Handler remain separate
authoritative workflow components.

## Required preflight observations (read-only)

An authorized operator records the following without printing secrets,
credential values, environment values, customer rows, or business rows.

| Observation | Safe evidence required | Stop condition |
| --- | --- | --- |
| Node release/layout | deployment revision, `/var/www/dietavity` layout, package-lock state, `pm2 describe dietavity` process metadata | process name/path differs from the assumed deployment model |
| listener | `ss -ltnp` or equivalent, limited to port 3000 | listener/network exposure cannot be established |
| nginx | active site configuration names and listener/location metadata, with secret includes omitted | no way to restrict the exact internal route |
| n8n | container ID, image digest, `n8n --version`, network names/gateways, read-only workflow metadata | not version 2.34.5 or node availability differs |
| database | catalog-only audit through the approved audit path | G.3A/F.1 state cannot be classified before a migration attempt |
| workflow backup/update | supported export/update operation preserving an existing workflow ID, credentials, settings, and error handler | importing creates a duplicate trigger or cannot preserve identity |

No command in this document authorizes `sudo`, root login, credential export,
or a production mutation. Commands shown below are templates for an operator
at a separately approved gate.

## G.3C JWT compatibility gate

Before a credential is created, the operator must prove from the actual n8n
2.34.5 image/node catalog that the installed native JWT node supports all of:

- `n8n-nodes-base.jwt`, `sign`, PEM-backed `jwtAuth`, RS256, and a supplied
  `kid`;
- expression-backed `iss`, exact audience
  `dietavity.sales-engine-v2.claimed-turn`, `client_id`, UUID `jti`, `iat`,
  `nbf`, and `exp`;
- an encrypted credential reference in the workflow while keeping PEM material
  out of exports; and
- per-execution signing, not a static bearer or pre-generated token.

A read-only installed-node catalog or package metadata inspection is preferred.
If that cannot prove credential serialization behavior, a temporary credential
and non-production test execution require a distinct operator authorization;
do not create either as part of disabled installation. A capability failure is
a stop condition, not permission to use a Code node, environment private key,
or static token.

## Required small implementation gate

Before Gate B or Gate D below, implement and review a narrow repository change
that:

1. sets the n8n claimed-turn request timeout explicitly to `100000` ms in the
   authoritative Ticket75 topology definition; and
2. supplies a deliberate Node listener binding configuration so the website
   may remain nginx-served while port 3000 is not accidentally reachable from
   arbitrary networks.

The change must preserve ordinary website routes, default to a safe listener,
and update the G.3D merge candidate through its repository topology source. It
requires focused generator/server tests. This runbook remains applicable after
that change; it must be regenerated and re-reviewed rather than hand-patching
the candidate.

## Network design decision

The selected target is a **dedicated private Docker bridge plus a restricted
nginx listener**:

1. Node binds only to loopback after the implementation gate.
2. nginx exposes only `POST /internal/sales-engine-v2/claimed-turn` on a port
   bound to the gateway address of a dedicated, named Docker network.
3. The n8n container joins that network and reaches the listener through the
   network's discovered gateway/address; the workflow URL is a non-secret
   configuration value, not a fixed address embedded in JSON.
4. nginx proxies the exact method/path to loopback Node. All other methods and
   paths on that listener return a non-processing denial. No forwarded header
   participates in authentication; the Node RS256 assertion remains mandatory.
5. Host firewall rules deny public access to the private listener and direct
   port 3000 access. The operator verifies both from the actual interface and
   network configuration before changing the workflow.

This is preferred over exposing the existing public nginx listener or moving
n8n to host networking. A default Docker gateway address is never assumed:
the operator creates/inspects the named network, records its gateway, binds
nginx to that gateway, and verifies it again after a container restart. The
rollback is removal of the private listener and detachment of n8n from that
network; it never changes the public web listener.

## Timeout and lease budget

After the implementation gate, use these exact values:

| Boundary | Value | Reason |
| --- | ---: | --- |
| assertion maximum TTL | 60 seconds | enforced by G.3A/G.3C configuration |
| Node claimed-turn deadline | 90 seconds | bounded runtime work, including its internal model attempts |
| n8n HTTP timeout | 100 seconds | ten-second client margin beyond Node deadline |
| internal nginx send/read timeout | 105 seconds | five-second proxy margin beyond n8n timeout |
| Ticket17 lease | 15 minutes / 900 seconds | production export evidence |

The ordering is `60-second assertion-at-start`, then `90-second Node deadline
< 100-second n8n timeout < 105-second proxy timeout << 900-second lease`.
Even a client timeout leaves at least 800 seconds before the lease expiry for
the existing legacy continuation. n8n must retain `retryOnFail` unset for the
claimed-turn request. A timeout/network ambiguity in shadow rejoins legacy
once; it never invokes Node again. Future live has its separately frozen
fail-closed behavior.

## Diagnostic governance decision package

Operator approval is required for this proposal before any shadow cohort:

- retention: 14 days for `v2_lifecycle_diagnostic_events`;
- access: a named operational/audit role with cataloged, read-only access
  through a controlled support procedure; no application/client grants;
- responsibility: the designated production data operations owner reviews
  access and performs the purge;
- purge: an explicit, reviewed, bounded scheduled or manual deletion process
  outside request authentication and business execution;
- purpose: operations only. Diagnostics are not authority for response,
  action, reservation, provider acceptance, completion, or recovery;
- prohibited data: prose, contact/profile/health data, prompts, model output,
  provider SID/payload, destination, tokens, assertions, keys, credentials,
  and generic text hashes.

For the one-identity initial shadow, a logged controlled manual purge is
acceptable only with that explicit approval, documented retention start/end,
and an approved reader. No migration is required merely to choose 14 days;
automatic deletion requires its own reviewed operational job or forward
migration and is not silently introduced here.

## RS256 key and credential procedure (later operator execution)

1. At Gate C, generate an RSA keypair in the approved production key-handling
   environment. Do not paste it into a shell history, repository, workflow,
   Code node, or Node configuration.
2. Put the private PEM only into an encrypted n8n `jwtAuth` credential, with
   access restricted to the credential administrator and the Sales Engine.
3. Put only the matching public verification key in Node's non-logged public
   key map, keyed by a new opaque `kid`; configure the issuer and client ID as
   non-secret values.
4. Configure the exact audience, a 60-second maximum TTL, and no cohort. The
   assertion has `alg=RS256`, `kid`, `iss`, `aud`, `client_id`, fresh UUID
   `jti`, `iat`, `nbf=iat-5`, and `exp=iat+60`.
5. Verify the pairing with an approved non-customer test only. Confirm Node
   accepts the public key, durable replay rejects a second assertion, and a
   workflow export contains only a credential reference.
6. Rotation keeps old and new public keys available during the reviewed
   overlap, moves the credential/reference to the new `kid`, then removes the
   old public key. Emergency revocation removes/rejects the affected `kid`
   before any replacement key is enabled.

## Database installation: Gate A

Use an approved migration role and the documented direct production migration
service. Do not use the catalog audit role to mutate. Verify artifact bytes on
the deployment host before every execution:

```bash
sha256sum database/migrations/20260927_ticket_75g3a_assertion_replay.sql
sha256sum database/migrations/20260926_ticket_75f1_v2_lifecycle_diagnostics.sql
# Values must equal the two G.3A/F.1 SHA-256 values in this document.
```

For each migration, first use the read-only audit service to establish the
object is absent. Then, at the explicit DB-migration authorization gate, use
the approved migration connection with a single explicit transaction and
stop-on-error behavior, for example:

```bash
env PGSERVICE=<approved-migration-service> \
  psql -X -v ON_ERROR_STOP=1 --single-transaction \
  -f database/migrations/<approved-ticket-migration>.sql
```

Apply G.3A first, then F.1. Do not run D.1. On an interrupted/ambiguous
attempt, stop and use the read-only audit path to determine transaction state;
never blindly rerun a migration. A failed uncommitted transaction is rolled
back by PostgreSQL. A committed migration is retained and corrected only by a
reviewed forward migration.

Post-commit catalog-only verification must confirm:

- G.3A table `public.sales_engine_v2_assertion_replays`, primary key
  `(issuer, client_id, jti)`, RLS and FORCE RLS, no direct grants, fixed
  search-path `SECURITY DEFINER` consume/cleanup functions, and
  service-role-only function execution;
- F.1 table `public.v2_lifecycle_diagnostic_events`, primary key `event_key`,
  RLS and FORCE RLS, no direct grants, and service-role-only
  `public.record_v2_lifecycle_diagnostic(jsonb)` execution; and
- `public.reserve_v2_approved_logical_reply(jsonb)` remains absent.

The read-only catalog check must inspect `pg_class`, `pg_constraint`,
`pg_proc`, `pg_roles`/function ACLs, and `pg_policies` only. It must not query
customer or business rows.

## Node and network installation: Gate B

At a separately authorized gate:

1. Capture the current deploy revision, PM2 process metadata, listener state,
   and a rollback artifact/version. Do not read `/root/.env`.
2. Deploy the reviewed repository artifact and only necessary dependencies to
   the established application directory. Capture the previous artifact for
   rollback. Do not apply D.1.
3. Add only the disabled configuration:

```text
SALES_ENGINE_V2_CONTROL=disabled
SALES_ENGINE_V2_SHADOW_COHORT_IDS=
SALES_ENGINE_V2_LIVE_COHORT_IDS=
```

   Do not set a route generation, model configuration, pseudonym key, public
   key map, or signing configuration while disabled unless the operator's
   configuration mechanism requires harmless placeholders. Never log values.
4. Apply the approved loopback Node binding and private nginx/Docker bridge
   design. Validate nginx configuration before reload and verify the exact
   method/path restriction from the n8n network only.
5. Use the established PM2 reload mechanism only after the artifact/config and
   network configuration are complete. Confirm the ordinary web pages and
   portal routes remain healthy.
6. A safe disabled endpoint check must prove only a bounded disabled response;
   it must use no valid assertion, no customer claim, and no business input.
   Do not send an authenticated claimed-turn request during this gate.

Rollback: restore the captured Node artifact and prior PM2 configuration, then
remove the private listener/network attachment. A failed Node reload must
return to the known-good artifact before any workflow change.

## Credential and workflow installation: Gates C and D

At Gate C, complete the JWT compatibility and key procedure above. Leave
route control disabled and cohorts empty. Credential configuration failure
means zero Node call and no workflow modification.

Immediately before Gate D:

1. Export the current active Sales Engine using the established non-mutating
   export path; hash it and record workflow ID, active state, error workflow,
   and node count.
2. Run `scripts/merge-ticket-75g3d-production-workflow.js` against that exact
   export. Do not use the checked-in candidate as input.
3. Review the generated preservation manifest. Require only closed classified
   differences, unchanged nine protected nodes, unchanged busy branch, legacy
   transport/completion topology, credentials, and error-handler association.
4. Confirm the newly generated candidate is inactive and carries disabled
   route configuration with empty cohorts. Confirm its JSON contains a
   credential reference only, never PEM/JWT/secret.
5. Use only an n8n update mechanism proven to preserve the existing workflow
   ID and trigger ownership. Do not import a second webhook-owning workflow,
   activate a duplicate, or swap workflows on an assumption. If preservation
   cannot be proven, stop.
6. Capture the immediate pre-change workflow export as rollback. Bind the
   managed credential reference through n8n administration, not workflow JSON.

Rollback: restore that immediate pre-change workflow through the same
identity-preserving controlled update mechanism, confirm the Global Error
Handler association and active legacy topology, and remove no migration.

## Gate E: disabled-installation acceptance matrix

All evidence is required before Ticket75H may be proposed:

| Requirement | Required result |
| --- | --- |
| website and portal | existing health/regression checks pass |
| Sales Engine / Recovery Poller / Error Handler | IDs, active state, and legacy topology match pre-change evidence |
| Ticket17 | acquired and busy behavior unchanged |
| G.3A / F.1 | catalog, RLS/FORCE RLS, ACL, security-definer, and RPC checks pass |
| D.1 | absent |
| Node | reviewed runtime deployed and disabled response verified |
| network | exact internal endpoint privately reachable only from intended n8n path; no public direct route |
| RS256 | credential bound, public-key verification configured, no private material in export/logs |
| route controls | `disabled`; both cohorts empty |
| disabled behavior | zero signing, Node calls, v2 diagnostics, actions, reservations, transports, completion, or recovery side effects |
| legacy behavior | customer response and provider/completion path unchanged |
| rollback | current Node, nginx/network, credential, and workflow pre-change artifacts available |

Diagnostic-recording or endpoint failures cannot pass this gate by merely being
ignored. The proof is that no enabled v2 path has been reachable while legacy
continues normally.

## Authorization gates and rollback matrix

Each row needs explicit human authorization; authorization never carries to a
later row.

| Gate | Authorized mutation | Failure response |
| --- | --- | --- |
| A | G.3A then F.1 database migrations | rollback uncommitted transaction; use forward corrective migration after commit |
| B | Node artifact, loopback binding, private network/nginx | restore Node artifact/config and prior listener/network state |
| C | RSA credential and non-secret Node verification configuration | revoke/remove new `kid` and credential reference; no workflow route activation |
| D | identity-preserving disabled Sales Engine update | restore immediate pre-change workflow export through proven update method |
| E | disabled verification only | apply the relevant rollback above; do not enable a cohort as a diagnostic shortcut |
| H (later) | shadow cohort/drills | separate authorization, not implied by G.4 |

Database rollback never means destructive removal of a committed additive
migration. Credential rollback removes/revokes only the new signing material
under the credential administrator's procedure. Network rollback restores the
pre-change configuration. Workflow rollback restores the immediately captured
export, retaining the existing workflow identity and error handler.
