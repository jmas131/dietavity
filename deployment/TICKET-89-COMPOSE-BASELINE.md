# Ticket 89 — Sanitized production Compose baseline

[`docker-compose.production.template.yml`](docker-compose.production.template.yml)
is a structural, sanitized representation of the verified production Compose
file. It preserves the two services, images, published ports, restart policies,
volume mounts, environment variable names, and the external `n8n_data` volume.

The production file defined no explicit `networks` block. Compose therefore
created the project default bridge, verified as `root_default` under project
`root`. Ticket 89 makes that same bridge explicit: it retains subnet
`172.18.0.0/16` and gateway `172.18.0.1`, assigns n8n `172.18.0.2` and
Gotenberg `172.18.0.3`, and reserves `172.18.128.0/25` for dynamic allocation.
That pool is disjoint from both static service addresses.

Every environment value is an environment-variable reference, including
non-secret settings, so this tracked file contains neither production
credentials nor copied deployment values. Supply them through the existing
untracked production environment mechanism at deployment time.

The original external-volume declaration resolves the exact Docker volume name
`n8n_data` (external volumes are not project-prefixed). The template makes that
resolved name explicit without converting it into a Compose-managed volume.
Before deployment, `docker volume inspect n8n_data` must confirm that the
existing production data volume has that exact name.

Before the static-IP implementation, collect the effective Ticket 76 Nginx
server/location configuration and its include path. The Compose capture does
not contain Nginx configuration, so an accurate sanitized Nginx template
cannot be derived from it.
