'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('../lib/reply-recovery');
const fullRecipe = fs.readFileSync(path.join(__dirname, 'fixtures/ticket-37-long-recipe.txt'), 'utf8').trim();
const recipe = fullRecipe.split('\n\nConsejo práctico:')[0];
// Exact incident length, sanitized content; no production customer text.
const response = recipe + '\n\nConsejo práctico: conserva los ingredientes por separado.'
  + '.'.repeat(1889 - recipe.length - '\n\nConsejo práctico: conserva los ingredientes por separado.'.length);
const input = {
  inbound_id: 'b97863b2-611c-4ffc-91d0-13202cbfb298',
  outbound_id: '349000f3-1c94-4efe-97f2-03637584c671',
  expected_key: 'reply:SMf79859ae7c0c371d57060f58334c6bce:paid',
  expected_session_id: '+5215550000001', expected_hash: sha256(response),
  confirmed_error_code: '21617', evidence_reference: 'sanitized-test-evidence',
  window_inbound_sid: 'SMf79859ae7c0c371d57060f58334c6bce',
};
const inbound = { id: input.inbound_id, direction: 'inbound', session_id: input.expected_session_id,
  provider: 'twilio', provider_message_sid: input.window_inbound_sid,
  processing_order: 1, processing_completed_at: null, processing_owner: null, processing_lease_until: null,
  metadata: {}, body: '¿Me das una receta?', delivery_status: 'received' };
const base = { id: input.outbound_id, direction: 'outbound', session_id: input.expected_session_id,
  provider: 'twilio', provider_message_sid: null, in_reply_to_id: input.inbound_id,
  idempotency_key: input.expected_key, delivery_status: 'unknown', message_kind: 'paid_ai',
  metadata: {}, body: response, assistant_response: response };
module.exports = { base, inbound, input, response };
