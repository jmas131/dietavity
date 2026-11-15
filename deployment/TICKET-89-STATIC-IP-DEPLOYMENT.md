# Ticket 89 — Static Docker IP deployment and rollback

## Scope and interruption

The tracked Compose template recreates the existing `root_default` bridge with
the same subnet and gateway, then gives n8n `172.18.0.2` and Gotenberg
`172.18.0.3`. Docker cannot change bridge IPAM settings in place, so n8n and
Gotenberg will be unavailable from `docker compose down` until `up` completes.
The expected interruption is the stop/create/start interval. PM2, the public
website, public HTTPS configuration, Nginx configuration, the external
`n8n_data` volume, and V4 message state are not changed or restarted.

## Disposable local IPAM check

Before production, validate Docker's static-address and dynamic-pool behavior
on a disposable local bridge using a subnet that cannot overlap production.
Use an already-cached image; do not pull an image merely for this check. The
following is a local structural validation only, not an endpoint test:

```bash
docker image inspect postgres:16 >/dev/null
ticket89_validation_network=ticket89-ipam-validation
docker network create --driver bridge --subnet 172.30.89.0/24 --gateway 172.30.89.1 --ip-range 172.30.89.128/25 "$ticket89_validation_network"
docker create --name ticket89-ipam-n8n --network "$ticket89_validation_network" --ip 172.30.89.2 --entrypoint sleep postgres:16 600
docker create --name ticket89-ipam-gotenberg --network "$ticket89_validation_network" --ip 172.30.89.3 --entrypoint sleep postgres:16 600
docker start ticket89-ipam-n8n ticket89-ipam-gotenberg
docker network inspect "$ticket89_validation_network"
docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ticket89-ipam-n8n ticket89-ipam-gotenberg
docker rm -f ticket89-ipam-n8n ticket89-ipam-gotenberg
docker network rm "$ticket89_validation_network"
```

The inspection must show the test gateway, the `/25` dynamic pool, and static
addresses `.2` and `.3`, which lie outside that pool. Perform cleanup even when
an assertion fails.

## Preconditions

Run from the VPS only during an approved maintenance window. Use the actual
production file at `/root/docker-compose.yml`; first merge the reviewed
network changes into that file without changing images, environment values,
ports, or volumes.

```bash
set -euo pipefail
export COMPOSE_PROJECT_NAME=root
export COMPOSE_FILE=/root/docker-compose.yml

docker compose config --quiet
docker compose config | grep -F 'name: n8n_data'
docker volume inspect n8n_data >/dev/null
docker network inspect root_default >/dev/null
docker compose images
docker compose version
docker compose up --help | grep -F -- '--pull'
cp /root/docker-compose.yml /root/docker-compose.yml.ticket89.prechange
```

Capture the live container identities, verify the actual mounts before any
downtime, and retain the exact local image IDs. This establishes that the
external reference resolves to the data volume in use, not merely to a volume
with a matching name:

```bash
N8N_ID="$(docker compose ps -q n8n)"
GOTENBERG_ID="$(docker compose ps -q gotenberg)"
test -n "$N8N_ID" && test -n "$GOTENBERG_ID"
docker inspect --format '{{range .Mounts}}{{printf "%s %s %s %s\n" .Type .Name .Source .Destination}}{{end}}' "$N8N_ID"
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/node/.n8n"}}{{printf "%s:%s" .Type .Name}}{{end}}{{end}}' "$N8N_ID")" = 'volume:n8n_data'
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/files"}}{{printf "%s" .Source}}{{end}}{{end}}' "$N8N_ID")" = '/local-files'
N8N_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$N8N_ID")"
GOTENBERG_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$GOTENBERG_ID")"
docker image inspect "$N8N_IMAGE_ID" "$GOTENBERG_IMAGE_ID" >/dev/null
printf '%s\n' "$N8N_IMAGE_ID" >/root/ticket89-n8n.image-id
printf '%s\n' "$GOTENBERG_IMAGE_ID" >/root/ticket89-gotenberg.image-id
```

Ensure `root_default` has exactly the two expected service attachments before
it is removed. Abort on any additional attachment; do not disconnect it:

```bash
EXPECTED_ATTACHMENTS="$(printf '%s\n%s\n' "$N8N_ID" "$GOTENBERG_ID" | sort)"
ACTUAL_ATTACHMENTS="$(docker network inspect --format '{{range $id, $_ := .Containers}}{{println $id}}{{end}}' root_default | sort)"
test "$ACTUAL_ATTACHMENTS" = "$EXPECTED_ATTACHMENTS"
```

Abort if any preflight assertion fails, if the installed Compose version does
not support `--pull never`, or if the live image IDs are missing locally.
`external: true` means Compose must use `n8n_data` and must not create or
prefix a replacement volume.

In the n8n editor, record the activation state of `Dietavity WhatsApp Recovery
Poller`, then temporarily deactivate it for the short maintenance window.
Leave `Dietavity Ledger Health Monitor` enabled. Confirm this checkpoint before
stopping containers; it prevents recovery work from racing known planned
unavailability while retaining independent visibility into ledger health.

## Controlled recreation

Do not pass `--volumes`, `-v`, `pull`, or `--build`.

```bash
docker compose down
if docker network inspect root_default >/dev/null 2>&1; then
  docker network rm root_default
fi
docker compose up -d --no-build --pull never --force-recreate
docker compose ps
docker network inspect root_default
docker inspect --format '{{range $name, $network := .NetworkSettings.Networks}}{{printf "%s %s\\n" $name $network.IPAddress}}{{end}}' "$(docker compose ps -q n8n)"
docker inspect --format '{{range $name, $network := .NetworkSettings.Networks}}{{printf "%s %s\\n" $name $network.IPAddress}}{{end}}' "$(docker compose ps -q gotenberg)"
docker inspect --format '{{.Name}} {{.Image}}' "$(docker compose ps -q n8n)" "$(docker compose ps -q gotenberg)"
test "$(docker inspect --format '{{.Image}}' "$(docker compose ps -q n8n)")" = "$(cat /root/ticket89-n8n.image-id)"
test "$(docker inspect --format '{{.Image}}' "$(docker compose ps -q gotenberg)")" = "$(cat /root/ticket89-gotenberg.image-id)"
```

The final inspection must show the same captured image IDs, n8n at
`172.18.0.2`, Gotenberg at `172.18.0.3`, gateway `172.18.0.1`, and an IPAM
pool of `172.18.128.0/25`. `--pull never` prevents a tag such as `:8` from
silently fetching a newer image; abort rather than omitting that flag.

## Nginx listener checkpoint and recovery

Before resuming the Recovery Poller, verify the private listener exists on the
recreated bridge and that Nginx did not lose its bound address:

```bash
sudo ss -ltn 'sport = :12751' | grep -F '172.18.0.1:12751'
```

The unauthenticated n8n request in the next section must return `401`; it is a
second listener check from the actual authorized source. If either check fails,
keep the Recovery Poller paused, do not broaden `allow` rules, and do not expose
the listener publicly. Verify the bridge address and private Nginx configuration,
then reload only the unchanged Nginx configuration:

```bash
docker network inspect root_default
sudo nginx -t
sudo systemctl reload nginx
sudo ss -ltn 'sport = :12751' | grep -F '172.18.0.1:12751'
```

If the listener remains unavailable, stop the change, preserve the external
volume, and follow rollback below. Do not restart PM2, change public HTTPS, or
replace the narrow `172.18.0.2` allowlist as a workaround.

## Access verification

Do not echo credentials. Use the existing n8n HTTP-header credential to run a
controlled V4 request in the n8n editor/manual execution; a valid authenticated
request must reach V4. Confirm its execution status and HTTP status there, not
by logging the credential value.

From n8n, an unauthenticated request to the V4 endpoint must return `401`;
this proves source access reached the application but did not bypass V4
authentication. Use an existing shell HTTP client only if present:

```bash
docker compose exec -T n8n sh -ec '
  command -v curl >/dev/null
  test "$(curl -sS -o /dev/null -w "%{http_code}" -X POST http://172.18.0.1:12751/internal/conversation-engine/v4/resolve -H "content-type: application/json" -d "{}")" = 401
  test "$(curl -sS -o /dev/null -w "%{http_code}" http://gotenberg:3000/health)" = 200
'
```

Before the change window, verify the listed n8n image contains `curl`; if it
does not, use the approved existing n8n manual-execution path for the first
check and a pre-existing diagnostic client—do not install packages or pull a
diagnostic image. Gotenberg must remain blocked regardless of header presence:

```bash
docker compose exec -T gotenberg sh -ec '
  command -v curl >/dev/null
  test "$(curl -sS -o /dev/null -w "%{http_code}" -X POST http://172.18.0.1:12751/internal/conversation-engine/v4/resolve -H "content-type: application/json" -d "{}")" = 403
'
```

Finally, use the normal controlled inbound test path, then verify that the
Recovery Poller has no pending recovery for that inbound and that the Ledger
Health Monitor remains healthy. Do not create a separate delivery path.

Only after the n8n/V4 and Gotenberg checks pass, reactivate `Dietavity WhatsApp
Recovery Poller` and record its resumed state. Run its normal controlled
post-recovery check, then use the canonical ledger/recovery view to verify that
the controlled inbound is complete, has no pending recovery, and has no orphan
outbound reservation. Keep `Dietavity Ledger Health Monitor` enabled throughout
and verify its next execution is healthy after the Poller resumes.

## Rollback

Rollback creates a fresh dynamic `root_default` bridge; the deleted bridge
cannot be recovered and no step relies on it. Restore the pre-change Compose
file from the backup created in the preflight, validate it, and recreate only
the services/network:

```bash
docker compose down
if docker network inspect root_default >/dev/null 2>&1; then
  docker network rm root_default
fi
cp /root/docker-compose.yml.ticket89.prechange /root/docker-compose.yml
docker compose config --quiet
docker volume inspect n8n_data >/dev/null
docker compose up -d --no-build --pull never --force-recreate
docker compose ps
```

The rollback does not remove `n8n_data`, pull images, modify Nginx, or restart
PM2. A rollback is successful only after the Nginx listener checkpoint, an
authenticated n8n-to-V4 request, the n8n unauthenticated `401` check, and the
Gotenberg `403` check all pass. It restores dynamic addressing only; Nginx
still permits only `172.18.0.2`, so rollback connectivity is valid only after
confirming n8n was again assigned that address. If Docker assigns another
address, keep the Poller paused and stop: use the approved Nginx rollback
configuration or restore the static-IP Compose configuration. Never broaden
access to a Docker subnet.

## Halfway-failure rule

If `up` fails after the old network is gone, do not report recovery merely
because containers later start. First re-run `docker compose config --quiet`,
confirm `n8n_data` still exists, ensure the cached image IDs remain available,
and forward-recover the approved static-IP configuration with `--pull never`.
Then complete every listener, access-control, Poller, and ledger checkpoint in
this runbook. Use rollback only when the approved previous Compose file is
available and its dynamic-address consequences are understood.
