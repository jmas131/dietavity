'use strict';

const crypto = require('node:crypto');

const SID = /^(?:SM|MM)[0-9a-f]{32}$/i;
const TERMINAL_FAILURE = new Set(['failed', 'undelivered', 'canceled']);
const ACCEPTED = new Set(['accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered', 'read']);
const ISO = value => {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const map = (items, key) => items.reduce((result, item) => {
  const value = key(item);
  if (!value) return result;
  const list = result.get(value) || [];
  list.push(item); result.set(value, list); return result;
}, new Map());
const inWindow = (time, window) => time && time >= window.from && time < window.to;
const safeStatus = value => String(value || '').toLowerCase() || null;

function hmacRedactor(secret, rotation = 'v1') {
  if (typeof secret !== 'string' || secret.length < 16) throw new Error('AUDIT_HMAC_SECRET_REQUIRED');
  return (domain, value) => value == null ? null : `${rotation}:${crypto.createHmac('sha256', secret).update(`${domain}\0${value}`).digest('hex').slice(0, 24)}`;
}

function normalizeTwilio(raw, sender) {
  const sid = String(raw.sid || '');
  const direction = safeStatus(raw.direction);
  const outbound = direction?.startsWith('outbound');
  const inbound = direction === 'inbound';
  const endpointMatches = inbound ? raw.to === sender : outbound ? raw.from === sender : false;
  return {
    sid: SID.test(sid) ? sid : null,
    direction: inbound ? 'inbound' : outbound ? 'outbound' : null,
    endpointMatches,
    timestamp: ISO(raw.date_sent || raw.date_created),
    status: safeStatus(raw.status),
    errorCode: raw.error_code == null ? null : String(raw.error_code),
  };
}

function normalizeLedger(row) {
  const sid = String(row.provider_message_sid || '');
  const direction = row.direction === 'inbound' || row.direction === 'outbound' ? row.direction : null;
  return {
    id: String(row.ledger_id || row.id || ''),
    direction,
    sid: SID.test(sid) ? sid : null,
    timestamp: ISO(row.recorded_at || row.timestamp),
    inReplyToId: row.in_reply_to_id || null,
    idempotencyKey: row.idempotency_key || null,
    deliveryStatus: safeStatus(row.delivery_status),
    providerStatus: safeStatus(row.provider_status),
    providerErrorCode: row.provider_error_code == null ? null : String(row.provider_error_code),
    processingOrder: row.processing_order == null ? null : Number(row.processing_order),
    processingLeaseUntil: ISO(row.processing_lease_until),
    processingCompletedAt: ISO(row.processing_completed_at),
    processingOutcome: row.processing_outcome || null,
    turnAnchorId: row.turn_anchor_id || row.ledger_id || row.id || null,
    turnPosition: row.turn_position == null ? null : Number(row.turn_position),
    turnMemberCount: row.turn_member_count == null ? null : Number(row.turn_member_count),
    logicalReplyKey: row.logical_reply_key || row.idempotency_key || null,
    partIndex: row.part_index == null ? 1 : Number(row.part_index),
    partCount: row.part_count == null ? 1 : Number(row.part_count),
    reconciliationState: row.reconciliation_state || null,
    excluded: Boolean(row.is_historical || row.is_synthetic || row.delivery_suppressed || row.is_canonical === false),
    exclusionReason: row.is_historical ? 'historical' : row.is_synthetic ? 'synthetic' : row.delivery_suppressed ? 'delivery_suppressed' : row.is_canonical === false ? 'noncanonical' : null,
  };
}

function issue(category, confidence, values = {}) { return { category, confidence, ...values }; }

function classify({ twilioMessages, ledgerRows, window, sender, now = new Date().toISOString(), graceMinutes = 10, hmacSecret, hmacRotation = 'v1', coverage = { twilioComplete: true, ledgerComplete: true } }) {
  if (!window || !ISO(window.from) || !ISO(window.to) || Date.parse(window.from) >= Date.parse(window.to)) throw new Error('AUDIT_WINDOW_INVALID');
  const normalizedWindow = { from: ISO(window.from), to: ISO(window.to) };
  const redactor = hmacRedactor(hmacSecret, hmacRotation);
  const twilio = twilioMessages.map(item => normalizeTwilio(item, sender)).filter(item => item.sid && item.direction && item.endpointMatches);
  const ledger = ledgerRows.map(normalizeLedger).filter(item => item.id && item.direction);
  const eligibleLedger = ledger.filter(item => !item.excluded && item.sid);
  const discrepancies = [];
  const excluded = ledger.filter(item => item.excluded).map(item => issue('excluded', 'excluded', { reason: item.exclusionReason, ledger_id: redactor('ledger', item.id), timestamp: item.timestamp }));
  const twilioBySid = map(twilio, item => item.sid);
  const ledgerBySid = map(eligibleLedger, item => item.sid);
  const nowMs = Date.parse(now);
  const graceMs = graceMinutes * 60_000;
  const redacted = item => ({ twilio_sid: item.sid ? redactor('twilio_sid', item.sid) : null, ledger_id: item.id ? redactor('ledger', item.id) : null, timestamp: item.timestamp });

  for (const [sid, resources] of twilioBySid) if (resources.length > 1) discrepancies.push(issue('duplicate_provider_sid', 'confirmed', { twilio_sid: redactor('twilio_sid', sid), count: resources.length }));
  for (const [sid, rows] of ledgerBySid) if (rows.length > 1) discrepancies.push(issue('duplicate_provider_sid', 'confirmed', { twilio_sid: redactor('twilio_sid', sid), ledger_ids: rows.map(row => redactor('ledger', row.id)) }));

  for (const resource of twilio.filter(item => inWindow(item.timestamp, normalizedWindow))) {
    const rows = ledgerBySid.get(resource.sid) || [];
    if (!rows.length) {
      const oldEnough = nowMs - Date.parse(resource.timestamp) > graceMs;
      discrepancies.push(issue(resource.direction === 'inbound' ? 'inbound_unmatched_ledger' : 'outbound_unmatched_ledger', coverage.ledgerComplete && oldEnough ? 'confirmed' : 'inconclusive', { twilio_sid: redactor('twilio_sid', resource.sid), timestamp: resource.timestamp }));
    }
  }
  for (const row of eligibleLedger.filter(item => inWindow(item.timestamp, normalizedWindow))) {
    const resources = twilioBySid.get(row.sid) || [];
    if (!resources.length) discrepancies.push(issue(row.direction === 'inbound' ? 'inbound_unmatched_twilio' : 'outbound_unmatched_twilio', coverage.twilioComplete ? 'inconclusive' : 'coverage_incomplete', redacted(row)));
  }

  // A requested-window member may have an anchor just outside midnight. Audit
  // that logical turn once, using the overlap returned by the readers.
  const inboundById = new Map(ledger.filter(row => row.direction === 'inbound' && !row.excluded).map(row => [row.id, row]));
  const anchors = [...new Map(ledger.filter(row => row.direction === 'inbound' && !row.excluded && inWindow(row.timestamp, normalizedWindow)).map(member => [member.turnAnchorId, inboundById.get(member.turnAnchorId)]).filter(([, anchor]) => anchor)).values()];
  const outboundByAnchor = map(ledger.filter(row => row.direction === 'outbound' && !row.excluded), row => row.inReplyToId);
  const completionLatencies = []; const reservationLatencies = [];
  for (const anchor of anchors) {
    if (anchor.processingOutcome === 'superseded') continue;
    if (anchor.reconciliationState === 'operator_required' || anchor.processingOutcome === 'reconciliation') {
      discrepancies.push(issue('reconciliation_required', 'inconclusive', redacted(anchor))); continue;
    }
    const replies = outboundByAnchor.get(anchor.id) || [];
    const completeParts = replies.length > 0 && replies.every(row => row.logicalReplyKey === replies[0].logicalReplyKey && row.partCount === replies.length && row.partIndex >= 1 && row.partIndex <= row.partCount) && new Set(replies.map(row => row.partIndex)).size === replies.length;
    if (anchor.processingCompletedAt && !completeParts) discrepancies.push(issue('missing_logical_reply', coverage.ledgerComplete ? 'confirmed' : 'coverage_incomplete', redacted(anchor)));
    for (const reply of replies) {
      const resource = reply.sid ? (twilioBySid.get(reply.sid) || [])[0] : null;
      const providerStatus = resource?.status || reply.providerStatus || reply.deliveryStatus;
      const failed = TERMINAL_FAILURE.has(providerStatus) || TERMINAL_FAILURE.has(reply.deliveryStatus);
      const accepted = ACCEPTED.has(providerStatus) || ACCEPTED.has(reply.deliveryStatus);
      const terminalMismatch = resource && ((TERMINAL_FAILURE.has(providerStatus) && providerStatus !== reply.deliveryStatus) || (TERMINAL_FAILURE.has(reply.deliveryStatus) && providerStatus !== reply.deliveryStatus));
      if (terminalMismatch) discrepancies.push(issue('ledger_status_divergence', 'confirmed', { ...redacted(reply), provider_status: providerStatus, ledger_status: reply.deliveryStatus }));
      if (failed) discrepancies.push(issue('delivery_failure', 'confirmed', { ...redacted(reply), provider_status: providerStatus, provider_error_code: resource?.errorCode || reply.providerErrorCode }));
      else if (!accepted) discrepancies.push(issue('outbound_acceptance_inconclusive', 'inconclusive', redacted(reply)));
      else if (resource && reply.deliveryStatus && providerStatus !== reply.deliveryStatus && !(ACCEPTED.has(providerStatus) && ACCEPTED.has(reply.deliveryStatus))) discrepancies.push(issue('ledger_status_divergence', 'confirmed', { ...redacted(reply), provider_status: providerStatus, ledger_status: reply.deliveryStatus }));
    }
    const firstReplyAt = replies.map(row => row.timestamp).filter(Boolean).sort()[0];
    if (firstReplyAt && anchor.timestamp) reservationLatencies.push(Date.parse(firstReplyAt) - Date.parse(anchor.timestamp));
    if (anchor.processingCompletedAt && anchor.timestamp) completionLatencies.push(Date.parse(anchor.processingCompletedAt) - Date.parse(anchor.timestamp));
    else if (anchor.timestamp && nowMs - Date.parse(anchor.timestamp) > 20 * 60_000) discrepancies.push(issue('processing_delay', 'inconclusive', redacted(anchor)));
  }
  const percentile = (items, p) => { const values = items.filter(Number.isFinite).sort((a, b) => a - b); return values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : null; };
  const latency = items => ({ count: items.length, p50: percentile(items, .5), p95: percentile(items, .95), max: items.length ? Math.max(...items) : null });
  const counts = (direction, source) => source.filter(item => item.direction === direction && inWindow(item.timestamp, normalizedWindow)).length;
  const outboundTwilio = twilio.filter(item => item.direction === 'outbound' && inWindow(item.timestamp, normalizedWindow));
  const outboundLedger = eligibleLedger.filter(item => item.direction === 'outbound' && inWindow(item.timestamp, normalizedWindow));
  const confirmed = discrepancies.filter(item => item.confidence === 'confirmed');
  const inconclusive = discrepancies.filter(item => item.confidence === 'inconclusive');
  const incomplete = discrepancies.filter(item => item.confidence === 'coverage_incomplete');
  return {
    report_version: 'ticket-90b-v1', window: normalizedWindow,
    coverage: { twilio_complete: Boolean(coverage.twilioComplete), ledger_complete: Boolean(coverage.ledgerComplete), status: coverage.twilioComplete && coverage.ledgerComplete ? 'complete' : 'coverage_incomplete' },
    metrics: {
      inbound: { twilio_records: counts('inbound', twilio), eligible_ledger_records: counts('inbound', eligibleLedger) },
      outbound: {
        twilio_records: outboundTwilio.length, eligible_ledger_records: outboundLedger.length,
        acceptance: { accepted_or_later: outboundLedger.filter(row => ACCEPTED.has(row.deliveryStatus)).length, unresolved: outboundLedger.filter(row => !ACCEPTED.has(row.deliveryStatus) && !TERMINAL_FAILURE.has(row.deliveryStatus)).length },
        provider_delivery: { delivered_or_read: outboundTwilio.filter(row => ['delivered', 'read'].includes(row.status)).length, terminal_failure: outboundTwilio.filter(row => TERMINAL_FAILURE.has(row.status)).length, nonterminal: outboundTwilio.filter(row => !['delivered', 'read'].includes(row.status) && !TERMINAL_FAILURE.has(row.status)).length },
      },
      processing_latency_ms: { receipt_to_first_reservation: latency(reservationLatencies), receipt_to_completion: latency(completionLatencies) },
      technical_delivery_only: true,
    },
    discrepancies: { confirmed, inconclusive, coverage_incomplete: incomplete, excluded },
    summary: { confirmed_count: confirmed.length, inconclusive_count: inconclusive.length, coverage_incomplete_count: incomplete.length, excluded_count: excluded.length, conversational_response_quality_evaluated: false },
  };
}

module.exports = { ACCEPTED, SID, TERMINAL_FAILURE, classify, hmacRedactor, normalizeLedger, normalizeTwilio };
