# Ticket 89 — Sanitized Ticket 76 Nginx baseline

[`nginx/ticket76-conversation-engine-private.conf.template`](nginx/ticket76-conversation-engine-private.conf.template)
is a sanitized, directive-for-directive representation of the captured
production private Conversation Engine server block.

## Confirmed baseline

- The listener is `172.18.0.1:12751` and the default server name is `_`.
- Both exact V1 and V4 resolve locations accept `POST` only.
- Both locations allow `172.18.0.2` only, then deny every other source.
- Both locations proxy to their same-version loopback route on
  `127.0.0.1:3000`, pass the existing secret header through without embedding
  a value, and retain the 5-second connect and 25-second send/read timeouts.
- All other paths return `404`.

## Production path and deployment dependencies

The active production configuration path is
`/etc/nginx/conf.d/ticket76-conversation-engine-private.conf`; its inclusion
was confirmed through `sudo nginx -T`. It is included from Nginx's `http`
context. Keep that path and include relationship unchanged during Ticket 89.

This listener depends on the Docker bridge owning `172.18.0.1`, n8n using the
authorized bridge address, and the PM2-hosted Node process listening on
`127.0.0.1:3000`. It does not hold the shared-secret value; n8n supplies the
request header through its existing credential.

This baseline intentionally makes no Ticket 89 static-IP/IPAM change.
