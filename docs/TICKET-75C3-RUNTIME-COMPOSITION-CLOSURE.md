# Ticket75C.3 — Runtime Composition Closure

## Determination

**READY_FOR_T75D.** The checked-in server remains disabled by default. This ticket provides an injected, fail-closed composition path only; it adds no production configuration, delivery integration, or external call.

## Call graph

```text
Ticket75A auth / route / replay / claim verification
  → Ticket75B canonical input bundle
  → Ticket75C.3 composition factory
  → Ticket68 (resolver, guidance/artifact gates, Ticket65D action boundary,
              FinalComposerInput, Ticket66, Ticket67)
  → Ticket68A manifest
  → bounded Ticket75 claimed-turn result
```

`createClaimedTurnComposition` receives only injected stage adapters, action dependencies, and policy configuration. It derives deterministic per-stage run IDs from the Ticket75A invocation identity, creates the Ticket71 authority fact resolver from the canonical snapshot, selects the canonical reviewed-knowledge store, and delegates all domain behavior to Ticket68.

## Live and shadow behavior

Live composition selects the existing Ticket65D executor with its injected reservation store and provider set. An eligible action reaches a provider only after the durable reservation path. Ticket65D success is the only route by which a validated destination can enter FinalComposerInput.

Shadow composition selects the non-executing action executor. Its action state is explicitly `not_executed`, which Ticket65C.1 maps to `unavailable_now` with no destination. This is not a fabricated ActionResult. The small Ticket68/PreComposer closed-state extension preserves that existing semantic distinction through composition.

The shadow composition test proves an action-bearing turn makes exactly one local shadow-executor call and **zero** reservation, complete, fail, Stripe, holding-provider, outbound, Twilio, and completion calls.

## Claimed-turn result

The runtime returns `ticket-75-claimed-turn-v1` output only after validation. Eligible output contains the existing bounded Ticket68 turn result and `{ text, post_gate_delivery_manifest }`. The manifest is Ticket68A evidence and permission for a later boundary, never delivery evidence. Ineligible output contains no customer text or manifest. Raw contexts, history, authorities, prompts, model/provider payloads, and credentials are never returned.

## Fail-closed boundaries

Abort/deadline is checked before canonical construction, during injected operations, after Ticket68, and before HTTP success. A late result becomes `deadline_exceeded`. Canonical authority errors retain their Ticket75A distinctions; action composition unavailability maps to `action_lifecycle_unavailable`; unclassified internals are redacted. Missing offer binding remains the Ticket75B unresolved scope—not a default offer and not a database outage.

No endpoint code interprets intent, infers an offer, inserts a Checkout URL, creates an outbound row, sends Twilio, completes an inbound claim, renews a lease, or accesses n8n/Recovery Poller behavior.

## Offline evidence and remaining work

Deterministic offline tests cover canonical social composition, Ticket68A manifest production, live checkout lifecycle ordering, action-bearing shadow suppression, bounded HTTP output, and claimed-turn authentication/route/claim regressions. Ticket61–68, Ticket75A/B, and Ticket75C.1/C.2 regression tests remain separately exercised.

The repository-wide suite retains the same unrelated legacy failures reported before this ticket: Ticket10 synchronization and Ticket51–56 legacy sales scenarios. Ticket37A remains **REQUIRED BEFORE T75D**. T75D must supply the atomic post-generation revalidation/reservation/delivery boundary; this ticket deliberately does not reserve outbound delivery, call Twilio, or mark an inbound complete.
