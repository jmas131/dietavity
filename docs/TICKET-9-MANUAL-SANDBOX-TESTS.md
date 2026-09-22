# Ticket 9 Manual Sandbox Tests

Use a non-production n8n import, a scrubbed Supabase test project, Stripe test mode, and a Twilio WhatsApp sandbox. Keep the workflow inactive until credentials and environment values are verified. Never replay production customer webhooks.

For every case, inspect `messages` directly with the service role and verify exact `body`, direction, SID, idempotency key, parent link, and status.

1. Send `Hola` from a fresh number. Expect one anonymous inbound `received` row and one outbound `accepted` row. Confirm the Twilio request uses the outbound reservation's exact `session_id` and `body`, and that the handset receives that text.
2. Replay the identical inbound Twilio SID sequentially and concurrently. Expect no second AI call, Stripe call, reminder, reservation, or Twilio send.
3. Send a normal sales turn whose AI draft is deterministically replaced. Confirm the ledger contains only the final visible text.
4. Send `Hola, quiero comprar el programa. ¿Me mandas el enlace?`. Expect one Stripe Session and one Checkout row containing the actual test URL. Replay the SID and confirm counts remain one.
5. Run `¿Cuánto cuesta?` then `Sí`. Confirm Ticket 8D behavior is unchanged and each turn/reply is stored once.
6. Trigger known-user deterministic and nutrition responses. Confirm one inbound and one outbound row with `user_id`, without legacy duplicate rows.
7. Force a Twilio 4xx. Confirm the outbound row remains `failed` and downstream business state is not advanced.
8. Force a network timeout/ambiguous response. Confirm `unknown`, an operational alert, and no automatic resend.
9. Schedule a reminder. Confirm the scheduled-template reservation uses the exact configured canonical body, status becomes `scheduled`, `reminder_message_sid` remains populated, and the confirmation has its own accepted row.
10. Send media without text. Confirm the inbound event and clarification are represented without claiming fabricated inbound text.
11. Complete a Stripe test purchase. Confirm anonymous rows link to the new user without body/timestamp changes and the Setup link is reserved and accepted once.
12. Exercise Ticket 6 recurring cancellation success and failure. Confirm business behavior is unchanged and each visible response is canonical.
13. Run the Weekly Report and verify ordered actual messages, redacted Checkout URLs, and absence of provider/internal metadata.
14. Use anon and authenticated Supabase clients to verify `messages` remains unreadable and unwritable.

Live smoke tests after controlled activation:

- `¡Hola! Quiero más información.`
- `¿Cuánto cuesta?` followed by `Sí`
- Reset identity, then `Hola, quiero comprar el programa. ¿Me mandas el enlace?`

Record inbound/outbound SIDs and row IDs in the private deployment log, then replay only the sandbox/test SID to prove the no-op gate.
