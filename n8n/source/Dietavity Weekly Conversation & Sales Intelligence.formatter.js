const sanitizeReport = (value) => String(value ?? '')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL REDACTED]')
  .replace(/https?:\/\/[^\s<>"']*(?:\/setup\/|\/portal\/|\/recuperar-acceso(?:\/|\?|$)|portal[_-]?token|[?&](?:token|access_token|key|session)=)[^\s<>"']*/gi, '[SENSITIVE LINK REDACTED]')
  .replace(/\b(?:sk|pk|cs|pi|cus|sub|whsec)_(?:live|test)?_?[A-Za-z0-9_-]{8,}\b/gi, '[TOKEN REDACTED]')
  .replace(/\b(?:SM|MM|PN|AC)[A-F0-9]{32}\b/gi, '[PROVIDER ID REDACTED]')
  .replace(/\+\d(?:[\s().-]*\d){7,14}\b/g, '[PHONE REDACTED]')
  .replace(/\b(?:tel(?:éfono)?|whatsapp|cel(?:ular)?|móvil)\s*[:=-]?\s*(?:\+?\d[\s().-]*){7,15}\b/gi, '[PHONE REDACTED]')
  .replace(/\b\d{10}\b/g, '[PHONE REDACTED]');

const escapeHtml = (value) => sanitizeReport(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const content = $json.choices?.[0]?.message?.content;
if (!content) throw new Error('Weekly conversation intelligence auditor returned no model content');

let audit;
try {
  audit = typeof content === 'string' ? JSON.parse(content) : content;
} catch (error) {
  throw new Error(`Weekly conversation intelligence auditor returned invalid JSON: ${error.message}`);
}

const prepared = $('Prepare Weekly Intelligence Input').first().json;
const total = Number(prepared.total_conversations) || 0;
const labelPattern = /^CONVERSATION-[A-F0-9]{8}$/;
const boundedCount = (value) => Math.max(0, Math.min(total, Number.isInteger(value) ? value : 0));
const list = (values, emptyText = 'No supported finding.') => Array.isArray(values) && values.length
  ? `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`
  : `<p>${escapeHtml(emptyText)}</p>`;
const evidence = (values) => Array.isArray(values)
  ? [...new Set(values.filter((label) => labelPattern.test(String(label))))].slice(0, 10)
  : [];
const renderFindings = (values) => Array.isArray(values) && values.length
  ? values.slice(0, 8).map((finding) => {
    const labels = evidence(finding.evidence);
    const count = Number.isInteger(finding.count) ? Math.min(total, Math.max(1, finding.count)) : null;
    return `<h3>${escapeHtml(finding.theme || 'Untitled theme')}</h3>` +
      `<p><strong>Count:</strong> ${count === null ? 'Not reliably countable' : count}</p>` +
      `<p><strong>OBSERVED:</strong> ${escapeHtml(finding.observed || 'No observation supplied.')}</p>` +
      `<p><strong>INTERPRETATION:</strong> ${escapeHtml(finding.interpretation || 'No interpretation supplied.')}</p>` +
      `<p><strong>RECOMMENDED ACTION:</strong> ${escapeHtml(finding.recommended_action || 'No action recommended.')}</p>` +
      `<p><strong>Evidence strength:</strong> ${escapeHtml(finding.evidence_strength || 'weak')}<br>` +
      `<strong>Anonymous evidence:</strong> ${labels.length ? labels.map(escapeHtml).join(', ') : 'None supplied.'}</p>`;
  }).join('')
  : '<p>No supported finding.</p>';

const funnel = audit.sales_funnel_signals || {};
const marketing = audit.marketing_positioning_insights || {};
const productInsights = Array.isArray(audit.product_customer_experience_insights)
  ? audit.product_customer_experience_insights.slice(0, 6)
  : [];
const technicalFindings = Array.isArray(audit.technical_findings)
  ? audit.technical_findings.slice(0, 5)
  : [];

let html = '<h1>WEEKLY CONVERSATION &amp; SALES INTELLIGENCE REPORT</h1>';
html += `<p><strong>Reporting period:</strong> ${escapeHtml(prepared.reporting_start_date)} to ${escapeHtml(prepared.reporting_end_date)} (America/Mexico_City; previous 7 complete days)</p>`;
html += `<p><strong>Conversations reviewed:</strong> ${total}<br>`;
html += `<strong>Prospect conversations:</strong> ${boundedCount(audit.prospect_conversations)}<br>`;
html += `<strong>Customer/support conversations:</strong> ${boundedCount(audit.customer_support_conversations)}<br>`;
html += `<strong>Sample quality:</strong> ${escapeHtml(audit.sample_quality || 'Not assessed.')}</p>`;

html += '<h2>EXECUTIVE SUMMARY</h2>' + list((audit.executive_summary || []).slice(0, 5));
html += '<h2>SALES FUNNEL SIGNALS</h2>';
html += `<p><strong>Initial contacts:</strong> ${boundedCount(funnel.initial_contacts)}<br>`;
html += `<strong>Meaningful interest:</strong> ${boundedCount(funnel.meaningful_interest)}<br>`;
html += `<strong>Explicit purchase intent:</strong> ${boundedCount(funnel.explicit_purchase_intent)}<br>`;
html += `<strong>Checkout reached:</strong> ${boundedCount(funnel.checkout_reached)}<br>`;
html += '<strong>Purchase confirmed:</strong> Not observable from public.messages alone.</p>';
html += '<h3>Main observed drop-off points</h3>' + list((funnel.drop_off_points || []).slice(0, 5));

html += '<h2>WHAT PROSPECTS WANTED</h2>' + renderFindings(audit.prospect_wants);
html += '<h2>QUESTIONS &amp; OBJECTIONS</h2>' + renderFindings(audit.questions_and_objections);
html += '<h2>WHAT HELPED SALES</h2>' + list((audit.what_helped_sales || []).slice(0, 6));
html += '<h2>WHAT HURT SALES</h2>' + list((audit.what_hurt_sales || []).slice(0, 6));

html += '<h2>MARKETING &amp; POSITIONING INSIGHTS</h2>';
html += '<h3>Customer language</h3>' + list((marketing.customer_language || []).slice(0, 6));
html += '<h3>Potential ad/landing-page insights</h3>' + list((marketing.ad_landing_page_insights || []).slice(0, 6));
html += '<h3>Signals supporting current positioning</h3>' + list((marketing.signals_supporting_positioning || []).slice(0, 5));
html += '<h3>Signals challenging current positioning</h3>' + list((marketing.signals_challenging_positioning || []).slice(0, 5));

html += '<h2>PRODUCT / CUSTOMER EXPERIENCE INSIGHTS</h2>';
html += productInsights.length
  ? `<ul>${productInsights.map((item) => `<li><strong>${escapeHtml(item.classification || 'NO ACTION')}:</strong> ${escapeHtml(item.insight || '')} <em>(Evidence: ${escapeHtml(item.evidence_strength || 'weak')})</em></li>`).join('')}</ul>`
  : '<p>No supported finding.</p>';

html += '<h2>TECHNICAL FINDINGS</h2>';
html += technicalFindings.length
  ? technicalFindings.map((finding) => {
    const labels = evidence(finding.evidence);
    return `<h3>${escapeHtml(finding.title || 'Untitled technical finding')}</h3>` +
      `<p><strong>OBSERVED:</strong> ${escapeHtml(finding.observed || '')}</p>` +
      `<p><strong>Impact:</strong> ${escapeHtml(finding.impact || '')}<br>` +
      `<strong>Severity:</strong> ${escapeHtml(finding.severity || 'low')}<br>` +
      `<strong>Reproducibility:</strong> ${escapeHtml(finding.reproducibility || 'unclear')}<br>` +
      `<strong>Evidence strength:</strong> ${escapeHtml(finding.evidence_strength || 'weak')}<br>` +
      `<strong>Anonymous evidence:</strong> ${labels.length ? labels.map(escapeHtml).join(', ') : 'None supplied.'}</p>`;
  }).join('')
  : '<p>No genuine technical/system issue was supported by this week&#39;s conversations.</p>';

html += '<h2>TEST / DEBUG TRAFFIC HANDLING</h2>';
html += `<p>${escapeHtml(audit.test_traffic_handling || 'No reliable test marker was supplied; no conversations were silently excluded.')}</p>`;
html += '<h2>PRIORITIES FOR NEXT WEEK</h2>' + list((audit.priorities_next_week || []).slice(0, 3), 'No conversation-derived priority.');
html += '<h2>ENGINEERING TICKET</h2>';

const ticket = audit.ticket_recommended === true && technicalFindings.length > 0 &&
  audit.proposed_ticket && typeof audit.proposed_ticket === 'object' &&
  audit.proposed_ticket.classification === 'TECHNICAL DEFECT'
  ? audit.proposed_ticket
  : null;
if (!ticket) {
  html += '<p>None recommended this week.</p>';
} else {
  html += '<p><strong>PROPOSED - REQUIRES HUMAN APPROVAL</strong></p>';
  html += `<h3>${escapeHtml(ticket.title || 'Untitled proposed ticket')}</h3>`;
  html += `<p><strong>Objective:</strong> ${escapeHtml(ticket.objective || '')}</p>`;
  html += `<p><strong>Observed Evidence:</strong> ${escapeHtml(ticket.observed_evidence || '')}</p>`;
  html += `<p><strong>Required Behavior:</strong> ${escapeHtml(ticket.required_behavior || '')}</p>`;
  html += '<h4>Regression Cases</h4>' + list((ticket.regression_cases || []).slice(0, 8), 'None supplied.');
  html += '<h4>Acceptance Criteria</h4>' + list((ticket.acceptance_criteria || []).slice(0, 8), 'None supplied.');
  html += '<h4>Non-Goals</h4>' + list((ticket.non_goals || []).slice(0, 8), 'None supplied.');
}

return [{
  json: {
    report_html: html,
    reporting_start_date: prepared.reporting_start_date,
    reporting_end_date: prepared.reporting_end_date,
  },
}];
