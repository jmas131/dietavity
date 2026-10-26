const sanitize = (value) => String(value ?? '')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL REDACTED]')
  .replace(/https?:\/\/[^\s<>"']*(?:[?&](?:token|access_token|key|session)=|\/(?:setup|recuperar-acceso)\/)[^\s<>"']*/gi, '[SENSITIVE LINK REDACTED]')
  .replace(/\b(?:sk|pk|cs|pi|cus|sub|whsec)_(?:live|test)?_?[A-Za-z0-9_-]{8,}\b/gi, '[TOKEN REDACTED]')
  .replace(/\b(?:SM|MM|PN|AC)[A-F0-9]{32}\b/gi, '[PROVIDER ID REDACTED]')
  .replace(/\+\d(?:[\s().-]*\d){7,14}\b/g, '[PHONE REDACTED]')
  .replace(/\b\d{10}\b/g, '[PHONE REDACTED]');
const escape = (value) => sanitize(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const content = $json.choices?.[0]?.message?.content;
if (!content) throw new Error('Weekly product intelligence auditor returned no model content');
let audit;
try { audit = typeof content === 'string' ? JSON.parse(content) : content; } catch (error) { throw new Error(`Weekly product intelligence auditor returned invalid JSON: ${error.message}`); }
const prepared = $('Prepare Weekly Intelligence Input').first().json;
const snapshot = prepared.deterministic_snapshot || {};
const total = Number(prepared.total_conversations) || 0;
const label = /^CONVERSATION-[A-F0-9]{8}$/;
const list = (values, empty = 'No supported finding.') => Array.isArray(values) && values.length ? `<ul>${values.map((value) => `<li>${escape(value)}</li>`).join('')}</ul>` : `<p>${escape(empty)}</p>`;
const findings = (values) => Array.isArray(values) && values.length ? values.slice(0, 8).map((item) => {
  const labels = [...new Set((item.evidence || []).filter((value) => label.test(String(value))))].slice(0, 10);
  return `<h3>${escape(item.theme || 'Untitled finding')}</h3><p><strong>OBSERVED:</strong> ${escape(item.observed || '')}</p><p><strong>INTERPRETATION:</strong> ${escape(item.interpretation || '')}</p><p><strong>RECOMMENDED ACTION:</strong> ${escape(item.recommended_action || '')}</p><p><strong>Evidence strength:</strong> ${escape(item.evidence_strength || 'weak')}<br><strong>Anonymous evidence:</strong> ${labels.length ? labels.map(escape).join(', ') : 'None supplied.'}</p>`;
}).join('') : '<p>No supported finding.</p>';
const usage = audit.usage_classification || {};
const boundedConversationCount = (value) => Math.max(0, Math.min(total, Number.isInteger(value) ? value : 0));
let html = '<h1>DIETAVITY WEEKLY PRODUCT &amp; CONVERSATION INTELLIGENCE</h1>';
html += `<p><strong>Reporting period:</strong> ${escape(prepared.reporting_start_date)} to ${escape(prepared.reporting_end_date)} (America/Mexico_City; previous 7 complete days)</p>`;
html += '<h2>EXECUTIVE SUMMARY</h2>' + list(audit.executive_summary);
html += '<h2>USAGE SNAPSHOT</h2>';
html += `<p><strong>Deterministic from ledger:</strong><br>Conversations observed: ${Number(snapshot.conversations_observed) || 0}<br>Messages observed: ${Number(snapshot.messages_observed) || 0}<br>New conversations: ${Number(snapshot.new_conversations) || 0}<br>Returning conversations: ${Number(snapshot.returning_conversations) || 0}<br>Conversations with multiple inbound messages: ${Number(snapshot.conversations_with_multiple_inbound_messages) || 0}<br>Conversations active on multiple local days: ${Number(snapshot.conversations_active_on_multiple_local_days) || 0}</p>`;
html += `<p><strong>LLM-classified from anonymized conversation content:</strong><br>Activated conversations: ${boundedConversationCount(usage.activated_conversations)}<br>Genuine food-decision interactions: ${Math.max(0, Number.isInteger(usage.food_decision_interactions) ? usage.food_decision_interactions : 0)}<br>Conversations with repeat food-decision usage: ${boundedConversationCount(usage.repeat_food_decision_conversations)}</p>` + list(usage.notes);
html += '<h2>WHAT USERS NEED HELP WITH</h2>' + findings(audit.what_users_need_help_with);
html += '<h2>RECOMMENDATION QUALITY</h2>' + findings(audit.recommendation_quality);
html += '<h2>GLP-1 / APPETITE PATTERNS</h2>' + findings(audit.glp1_appetite_patterns);
html += '<h2>MEDICAL / SAFETY BOUNDARY HANDLING</h2>' + findings(audit.medical_boundary_handling);
html += '<h2>PRODUCT FRICTION / CONFUSION</h2>' + findings(audit.product_friction_confusion);
html += '<h2>COMMERCIAL / WILLINGNESS-TO-PAY SIGNALS</h2><p>Informational only; no current price or payment offer is assumed.</p>' + findings(audit.commercial_wtp_signals);
html += '<h2>TECHNICAL / CONVERSATION FAILURES</h2>' + findings(audit.technical_conversation_failures);
html += '<h2>REPRESENTATIVE ANONYMIZED CONVERSATION EVIDENCE</h2>' + findings(audit.representative_evidence);
html += '<h2>TOP 3 RECOMMENDED ACTIONS</h2>' + list((audit.priorities_next_week || []).slice(0, 3), 'No conversation-derived priority.');
return [{ json: { report_html: html, reporting_start_date: prepared.reporting_start_date, reporting_end_date: prepared.reporting_end_date } }];
