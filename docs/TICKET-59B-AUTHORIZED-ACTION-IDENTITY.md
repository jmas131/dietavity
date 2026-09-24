# Ticket 59B — Stable AuthorizedAction identity

Ticket 59 remains a pure policy matcher. Ticket 62 is the first deterministic boundary with all required authoritative inputs: Ticket 59's deterministic-policy source, the validated commercial authorization subject, the authorized action type, and `ConversationContext.current_message.canonical_message_id` from the reserved inbound ledger row.

For each current launch action (`provide_checkout_destination` or `provide_holding_page_destination`), Ticket 62 derives `action_identity_version: action-identity-v1` and `action_id: act-<sha256>`. The explicit JSON array serialization is:

```js
['action-identity-v1', canonical_message_id, authorization_subject_version,
 authorization_subject_id, action_type, policy_source.id, policy_source.version]
```

The UUID is normalized to lowercase before hashing; every other tuple member is an already validated canonical string. No obligation ID, array position, evidence, customer text, model metadata, runtime time, or random value participates.

`action_id` identifies the authorized logical action; it does not establish execution or delivery. `idempotency.execution_key` is separately derived as `aek-<sha256>` from `['action-execution-idempotency-v1', action_id]`. It is the future executor's durable reservation/deduplication key, not provider evidence and not an ActionResult.

Ticket 62 and Ticket 65 require both identities for final launch actions, preserve them byte-for-byte, and reject duplicate action IDs. Ticket 65C commercial semantics remain identity-free customer-expressible semantics. Raw Ticket 59 policy output deliberately remains pre-projection, so it does not manufacture these context-bound fields.

Retries over the same inbound UUID and semantic commercial authorization reproduce both values. A different inbound UUID, commercial subject, action type, or policy ID/version changes `action_id`. No reminder action is identified: reminder scheduling remains outside v2 launch scope. Ticket 65D may next add durable reservation/execution and bounded ActionResult handling without exposing executor internals to a Composer.
