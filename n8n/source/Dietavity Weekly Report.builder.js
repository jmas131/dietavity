const conversations = new Map();

const sanitizeForAnalysis = (value) => String(value ?? '')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email removed]')
  .replace(/https?:\/\/[^\s<>"']*(?:\/setup\/|\/recuperar-acceso(?:\/|\?|$)|portal[_-]?token|[?&]token=)[^\s<>"']*/gi, '[link removed]')
  .replace(/\+\d(?:[\s().-]*\d){7,14}\b/g, '[phone removed]')
  .replace(/\b(?:tel(?:éfono)?|whatsapp|cel(?:ular)?|móvil)\s*[:=-]?\s*(?:\+?\d[\s().-]*){7,15}\b/gi, '[phone removed]')
  .replace(/\b\d{10}\b/g, '[phone removed]');

for (const item of items) {
  const session = item.json.session_id;
  if (!conversations.has(session)) conversations.set(session, []);

  const role = item.json.role === 'inbound' ? 'User' : 'Assistant';
  conversations.get(session).push(
    `${role}: ${sanitizeForAnalysis(item.json.content)}`
  );
}

let user_message = `
Dietavity customer-visible WhatsApp conversations with activity in the last 7 days.

Conversations observed in the last 7 days:
${conversations.size}

`;

Array.from(conversations.values()).forEach((messages, index) => {
  user_message += `
==================================================
CONVERSATION ${index + 1}
==================================================

${messages.join('\n\n')}

`;
});

const system_message = `
You are a senior product analyst for Dietavity, a WhatsApp AI nutrition assistant focused on longevity nutrition.

Analyze the conversations observed during the last 7 days for aggregate commercial and product learning.

Generate a report containing:

1. Conversations observed during the last 7 days.
2. Most common user goals.
3. Main objections.
4. Main causes of drop-off or abandonment.
5. Assistant failure cases.
6. Purchase-intent signals.
7. Common questions and FAQ candidates.
8. Onboarding improvement recommendations.
9. Marketing and positioning insights.
10. Representative user patterns, paraphrased and aggregated.

Focus on practical recommendations that help explain hesitation, misunderstandings, repeated questions, strong purchase intent, assistant failures, and opportunities for onboarding, FAQs, marketing, and positioning.

Privacy and reporting requirements:
- Do not reproduce verbatim customer messages.
- Paraphrase representative user patterns; do not invent quotes.
- Do not include personal identifiers or infer identities.
- Aggregate and generalize health-related information.
- Do not expose sensitive personal details unless strictly necessary to explain an aggregate product or safety issue.

Output as clean HTML suitable for an email body.

HTML requirements:
- Use headings, paragraphs, and lists.
- Highlight important numbers using <strong>.
- Do not include markdown.
- Do not include html, head, or body tags.
- Return only the HTML fragment.
`;

return [{
  json: {
    system_message,
    user_message,
    total_conversations: conversations.size,
    total_messages: items.length
  }
}];
