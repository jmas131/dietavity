# Ticket75G.3C: managed RS256 assertions

The inactive Sales Engine candidate uses the built-in n8n **JWT** node with a
`jwtAuth` PEM credential. The private key is entered only during controlled
operator credential configuration and remains in n8n encrypted credential
storage. It is not in the workflow JSON, repository, Code-node source, Node
application, diagnostic payloads, or generated artifacts.

Each shadow or future-live claimed turn follows this non-secret chain:

`configuration gate -> Crypto UUID JTI -> JWT RS256 sign -> signed-assertion
gate -> claimed-turn HTTP request`.

The JWT node is the signing boundary. It receives only an encrypted credential
reference and signs a fresh assertion; the HTTP node has no static credential
and receives the assertion only in its immediate `Authorization: Bearer`
header. The temporary assertion is not sent to the diagnostic recorder. No
customer, session, or inbound identity appears in the assertion.

## Closed assertion contract

The signing credential must be a PEM-key `jwtAuth` credential configured for
RS256. Its active key ID, issuer, and client ID are non-secret n8n environment
configuration. Every assertion uses:

- header: `alg=RS256`, configured `kid`;
- `iss`: configured service issuer;
- `aud`: `dietavity.sales-engine-v2.claimed-turn`;
- `client_id`: configured service client identity;
- fresh crypto-generated UUID `jti`;
- numeric `iat`, `nbf=iat-5`, and `exp=iat+60`.

Node verifies the exact configured issuer, audience, key ID, client mapping,
standard timestamps, and a maximum 60-second lifetime before it atomically
consumes `(issuer, client_id, jti)` through G.3A's durable replay RPC. The
Node configuration may lower, but not raise, this maximum.

For rotation, add a new signing credential/key ID and retain both public-key
entries in Node configuration during the approved overlap. Move the workflow
to the new credential/key ID, then remove the old Node public key to revoke
it. Emergency revocation removes/rejects that `kid` before any new assertion
can authenticate. No static bearer token is an acceptable substitute.

## Failure and privacy behavior

Missing signing configuration, UUID generation failure, malformed signer
output, or signer failure produces zero claimed-turn HTTP calls. In shadow it
creates only the bounded `signing_unavailable` workflow classification and
rejoins `Get User from Supabase` once; it is not a durable F.1 event because
no Node invocation identity exists. In future live it stops fail-closed and
never reaches legacy.

The workflow has no automatic HTTP retry. An assertion may be consumed if an
HTTP outcome is ambiguous; G.3A correctly rejects replay, and G.3B retains the
single-attempt shadow continuation. Private-key visibility remains limited to
authorized credential users and n8n's credential encryption key. Operators
must keep execution-access permissions narrow because a short-lived assertion
can appear transiently in execution data, although it is never persisted by
Ticket75 diagnostics or logged by the generated Code nodes.

## Controlled deployment requirements

Before activation, an operator must confirm native JWT-node behavior on the
actual pinned n8n image, create the encrypted PEM signing credential, configure
only non-secret issuer/client/kid values, configure the matching public-key map
in Node, test clock synchronization and a 60-second assertion, and apply the
approved key-access/execution-retention policy. No key or credential is created
by this repository change.

G.3D remains responsible for the controlled three-way workflow merge onto the
fresh production Sales Engine, preserving production semantic drift and adding
these inactive nodes without activating a cohort.
