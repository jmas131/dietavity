const crypto = require('crypto');

const canonicalProductContext = __CANONICAL_PRODUCT_CONTEXT__;
const secret = String($env.DAILY_AUDITOR_HMAC_SECRET || '');
if (secret.length < 32) throw new Error('DAILY_AUDITOR_HMAC_SECRET must contain at least 32 characters');

const redact = (value) => String(value ?? '')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL REDACTED]')
  .replace(/https?:\/\/[^\s<>"']*(?:[?&](?:token|access_token|key|session)=|\/(?:setup|recuperar-acceso)\/)[^\s<>"']*/gi, '[SENSITIVE LINK REDACTED]')
  .replace(/\b(?:sk|pk|cs|pi|cus|sub|whsec)_(?:live|test)?_?[A-Za-z0-9_-]{8,}\b/gi, '[TOKEN REDACTED]')
  .replace(/\+\d(?:[\s().-]*\d){7,14}\b/g, '[PHONE REDACTED]')
  .replace(/\b(?:tel(?:éfono)?|whatsapp|cel(?:ular)?|móvil)\s*[:=-]?\s*(?:\+?\d[\s().-]*){7,15}\b/gi, '[PHONE REDACTED]')
  .replace(/\b\d{10}\b/g, '[PHONE REDACTED]');
const labelFor = (sessionId) => `CONVERSATION-${crypto.createHmac('sha256', secret).update(String(sessionId), 'utf8').digest('hex').slice(0, 8).toUpperCase()}`;
const rawRows = items.map((item) => item.json || {});
const reportingStartDate = rawRows.find((row) => row.reporting_start_date)?.reporting_start_date;
const reportingEndDate = rawRows.find((row) => row.reporting_end_date)?.reporting_end_date;
const windowStart = rawRows.find((row) => row.window_start)?.window_start;
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(reportingStartDate || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(reportingEndDate || '')) || !windowStart) throw new Error('Weekly product intelligence query returned invalid reporting bounds');

const rows = rawRows.filter((row) => row.id && row.session_id && row.timestamp && row.body != null)
  .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp) || String(a.id).localeCompare(String(b.id)));
const conversations = new Map();
for (const row of rows) {
  const label = labelFor(row.session_id);
  if (!conversations.has(label)) conversations.set(label, { messages: [], first_observed_at: row.first_observed_at, inbound_count: 0, local_days: new Set() });
  const conversation = conversations.get(label);
  conversation.inbound_count += row.direction === 'inbound' ? 1 : 0;
  if (row.local_message_date) conversation.local_days.add(String(row.local_message_date));
  const actor = row.direction === 'inbound' ? 'CUSTOMER' : 'DIETAVITY';
  conversation.messages.push(`${actor}${row.message_kind ? ` [${String(row.message_kind).slice(0, 60)}]` : ''}:\n${redact(row.body)}`);
}
const totalConversations = conversations.size;
const windowStartAt = new Date(windowStart).getTime();
const deterministic_snapshot = {
  conversations_observed: totalConversations,
  messages_observed: rows.length,
  new_conversations: [...conversations.values()].filter((item) => new Date(item.first_observed_at).getTime() >= windowStartAt).length,
  returning_conversations: [...conversations.values()].filter((item) => new Date(item.first_observed_at).getTime() < windowStartAt).length,
  conversations_with_multiple_inbound_messages: [...conversations.values()].filter((item) => item.inbound_count > 1).length,
  conversations_active_on_multiple_local_days: [...conversations.values()].filter((item) => item.local_days.size > 1).length,
};
const period = `${reportingStartDate} to ${reportingEndDate}`;
if (!totalConversations) return [{ json: { analysis_required: false, reporting_start_date: reportingStartDate, reporting_end_date: reportingEndDate, total_conversations: 0, deterministic_snapshot, report_html: `<h1>DIETAVITY WEEKLY PRODUCT &amp; CONVERSATION INTELLIGENCE</h1><p><strong>Reporting period:</strong> ${period} (America/Mexico_City; previous 7 complete days)</p><p>No customer-visible conversations were available for analysis.</p>` } }];

const transcript = [...conversations.entries()].map(([label, item]) => `${label}\n\n${item.messages.join('\n\n')}`).join('\n\n==================================================\n\n');
const system_message = `Eres el analista semanal de producto de Dietavity. Responde en español. Tu objetivo es explicar evidencia real de uso del asistente de decisiones de comida por WhatsApp, no un embudo de ventas anterior.

${canonicalProductContext}

MÉTRICAS Y EVIDENCIA
- Los números en “instantánea determinística” son hechos del ledger. No los recalcules, estimes ni contradigas.
- Clasifica semánticamente activación: una conversación supera saludo/curiosidad y solicita ayuda real de decisión de comida, además de recibir orientación sustantiva. Un saludo solo no activa.
- Clasifica de forma cualitativa interacciones de decisión de comida, repetición de decisiones, necesidad, utilidad, practicidad, continuidad de contexto, patrones de apetito/GLP-1, restaurante/menú/antojos, fricción, confusión y señales de disposición a pagar.
- No inventes retención Day-1/3/7, usuarios, actividad previa, resultados clínicos, ni métricas de Meta. La repetición factual de mensajes y días ya está en la instantánea; el significado de repetición de decisiones es clasificación semántica.
- Distingue OBSERVADO, INTERPRETACIÓN y ACCIÓN RECOMENDADA. Una conversación es evidencia aislada y normalmente débil. Usa solo etiquetas anónimas proporcionadas; parafrasea y minimiza contenido.

CALIDAD Y SEGURIDAD
- Evalúa si la recomendación fue útil, práctica, culinariamente razonable, no genérica y coherente con el contexto previo.
- Para preguntas médicas, evalúa si hubo redirección segura y, cuando era separable, ayuda de comida práctica sin diagnóstico, tratamiento, prescripción ni cambio de medicación.
- Señales comerciales son informativas: no supongas precio, pago, suscripción, renovación ni oferta actual. No propongas automatización de pagos.
- Los fallos técnicos solo describen fallos de sistema realmente evidenciados. No inventes una infraestructura nueva.
- Las tres prioridades son recomendaciones humanas basadas en evidencia; no modifican producto, mensajes ni configuración.`;
const user_message = `Periodo: ${period}, America/Mexico_City. Son los siete días calendario completos previos; se excluye el día actual parcial.
Fuente canónica: ledger public.messages de comunicación visible.
Instantánea determinística: ${JSON.stringify(deterministic_snapshot)}
Limitación: se reportan sesiones/conversaciones, no usuarios únicos, porque una sesión puede preceder a un usuario vinculado.

${transcript}`;
return [{ json: { analysis_required: true, reporting_start_date: reportingStartDate, reporting_end_date: reportingEndDate, total_conversations: totalConversations, total_messages: rows.length, deterministic_snapshot, system_message, user_message } }];
