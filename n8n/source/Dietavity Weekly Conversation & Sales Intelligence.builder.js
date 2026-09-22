const crypto = require('crypto');

const canonicalProductContext = __CANONICAL_PRODUCT_CONTEXT__;
const secret = String($env.DAILY_AUDITOR_HMAC_SECRET || '');
if (secret.length < 32) {
  throw new Error('DAILY_AUDITOR_HMAC_SECRET must contain at least 32 characters');
}

const redact = (value) => String(value ?? '')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL REDACTED]')
  .replace(/https?:\/\/[^\s<>"']*(?:\/setup\/|\/portal\/|\/recuperar-acceso(?:\/|\?|$)|portal[_-]?token|[?&](?:token|access_token|key|session)=)[^\s<>"']*/gi, '[SENSITIVE LINK REDACTED]')
  .replace(/\b(?:sk|pk|cs|pi|cus|sub|whsec)_(?:live|test)?_?[A-Za-z0-9_-]{8,}\b/gi, '[TOKEN REDACTED]')
  .replace(/\b(?:portal[_-]?token|access[_-]?token)\s*[:=]\s*[A-Za-z0-9._~-]{8,}\b/gi, '[TOKEN REDACTED]')
  .replace(/\+\d(?:[\s().-]*\d){7,14}\b/g, '[PHONE REDACTED]')
  .replace(/\b(?:tel(?:éfono)?|whatsapp|cel(?:ular)?|móvil)\s*[:=-]?\s*(?:\+?\d[\s().-]*){7,15}\b/gi, '[PHONE REDACTED]')
  .replace(/\b\d{10}\b/g, '[PHONE REDACTED]');

const labelFor = (sessionId) => `CONVERSATION-${crypto
  .createHmac('sha256', secret)
  .update(String(sessionId), 'utf8')
  .digest('hex')
  .slice(0, 8)
  .toUpperCase()}`;

const rawRows = items.map((item) => item.json || {});
const reportingStartDate = rawRows.find((row) => row.reporting_start_date)?.reporting_start_date;
const reportingEndDate = rawRows.find((row) => row.reporting_end_date)?.reporting_end_date;
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(reportingStartDate || '')) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(reportingEndDate || ''))) {
  throw new Error('Weekly auditor query did not return a valid reporting window');
}

const rows = rawRows
  .filter((row) => row.id && row.session_id && row.timestamp && row.body != null)
  .sort((left, right) => {
    const byTime = new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
    return byTime || String(left.id).localeCompare(String(right.id));
  });

const conversations = new Map();
for (const row of rows) {
  const label = labelFor(row.session_id);
  if (!conversations.has(label)) conversations.set(label, []);

  const actor = row.direction === 'inbound' ? 'CUSTOMER' : 'DIETAVITY';
  const kind = row.message_kind ? ` [${String(row.message_kind).slice(0, 60)}]` : '';
  const delivery = row.direction === 'outbound' && row.delivery_status
    ? ` [delivery: ${String(row.delivery_status).slice(0, 40)}]`
    : '';
  conversations.get(label).push(`${actor}${kind}${delivery}:\n${redact(row.body)}`);
}

const totalConversations = conversations.size;
const period = `${reportingStartDate} to ${reportingEndDate}`;
if (totalConversations === 0) {
  return [{
    json: {
      analysis_required: false,
      reporting_start_date: reportingStartDate,
      reporting_end_date: reportingEndDate,
      total_conversations: 0,
      report_html: `<h1>WEEKLY CONVERSATION &amp; SALES INTELLIGENCE REPORT</h1><p><strong>Reporting period:</strong> ${period} (America/Mexico_City; previous 7 complete days)</p><p><strong>Conversations reviewed:</strong> 0</p><p><strong>Prospect conversations:</strong> 0<br><strong>Customer/support conversations:</strong> 0<br><strong>Sample quality:</strong> No relevant conversations; no commercial conclusions can be drawn.</p><h2>EXECUTIVE SUMMARY</h2><ul><li>No customer-visible conversations were available for analysis.</li></ul><h2>PRIORITIES FOR NEXT WEEK</h2><p>No conversation-derived priority.</p><h2>ENGINEERING TICKET</h2><p>None recommended this week.</p>`,
    },
  }];
}

const transcript = Array.from(conversations.entries())
  .map(([label, messages]) => `${label}\n\n${messages.join('\n\n')}`)
  .join('\n\n==================================================\n\n');

const system_message = `You are Dietavity's Weekly Conversation & Sales Intelligence Auditor. Your primary question is: What did this week's WhatsApp conversations teach us that can help Dietavity generate more revenue or improve customer experience?

Analyze complete conversations across contact intent, recurring questions and objections, observable funnel progression, what helped or hurt sales, customer language, Meta-ad and landing-page insights, positioning, product/offer lessons, customer experience, and genuine technical defects. Do not force customer support or probable testing into sales categories.

EVIDENCE CONTRACT
- Separate OBSERVED (directly supported), INTERPRETATION (what it may mean), and RECOMMENDED ACTION (what to consider).
- Counts must represent distinct conversations, not messages. Use count null when a meaningful count cannot be supported.
- One conversation is an isolated observation, not a recurring pattern. Normally assign weak evidence; severity may independently justify escalation.
- Set evidence strength from the number of supporting conversations, consistency, and ambiguity. State when the sample is too small for strong conclusions.
- Use only supplied anonymous conversation labels. Paraphrase and minimize personal content. Never infer identity.

FUNNEL CONTRACT
- For prospects, identify initial contact, meaningful interest, explicit purchase intent, Checkout reached, and observed drop-off only when supported by messages.
- A Checkout link means Checkout reached, not payment. This input has no reliable purchase-state source, so purchase_confirmed must be null.

PRODUCT AND SAFETY CONTRACT
${canonicalProductContext}

- Do not invent capabilities, policies, people, files, special payment behavior, guarantees, refunds, factura/invoicing, therapeutic diets, clinical outcomes, medical adaptations, or human escalation. If not verified above, write "Product capability requires verification".
- Confusion that Dietavity delivers prepared food is positioning/product clarity, never a recommendation to build food delivery.
- A medical-condition conversation may yield a safety or clarity observation, but never a diagnosis, therapeutic promise, clinical diet, medication change, or unsupported health claim.

CLASSIFICATION AND ACTION CONTRACT
- Classify nontechnical lessons as MARKETING, SALES CONVERSATION, PRODUCT / OFFER, CUSTOMER EXPERIENCE, or NO ACTION. Use TECHNICAL DEFECT only for an actual system/software failure.
- Preserve contradictory positioning evidence; do not force support for current positioning.
- Routine sales-quality observations wait for this weekly report. Workflow/runtime failures are already routed immediately to Dietavity's existing Global Error Handler, so do not propose another monitoring system.
- Still surface message evidence of payment-state corruption, duplicate charges, unsafe health responses, privacy/security issues, repeated duplicate outbound delivery, widespread Checkout failure, or widespread messaging failure.
- Priorities are recommendations for human review only. Do not modify messages, ads, copy, product behavior, database state, tickets, or production configuration.

TEST/DEBUG TRAFFIC
No reliable test-traffic marker is supplied. Do not exclude conversations or call them organic based on message-text guesses. State this limitation in test_traffic_handling. You may describe an observation as possibly test-related when context suggests it, without removing it from counts.

ENGINEERING TICKET THRESHOLD
Recommend at most one ticket, only when an actual technical/system defect is supported or reproducible, engineering is the appropriate solution, and no unverified product assumption is required. ticket_recommended must be false and proposed_ticket null otherwise. Marketing, sales, offer, prepared-food-delivery confusion, and isolated nontechnical anecdotes never justify an engineering ticket. Any proposed ticket requires human approval.`;

const user_message = `Reporting period: ${period}, America/Mexico_City. This is the previous 7 complete local calendar days; the current partial day is excluded.
Conversations reviewed: ${totalConversations}
Canonical source: public.messages customer-visible inbound/outbound ledger.

${transcript}`;

return [{
  json: {
    analysis_required: true,
    reporting_start_date: reportingStartDate,
    reporting_end_date: reportingEndDate,
    total_conversations: totalConversations,
    total_messages: rows.length,
    system_message,
    user_message,
  },
}];
