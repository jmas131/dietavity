'use strict';

const SESSION_LEASE_MINUTES = 15;
const RECOVERY_POLLER_MINUTES = 1;
const MONITOR_INTERVAL_MINUTES = 5;
const EXPIRED_LEASE_GRACE_MINUTES = MONITOR_INTERVAL_MINUTES;
const STALE_UNCLAIMED_HEAD_MINUTES = SESSION_LEASE_MINUTES + MONITOR_INTERVAL_MINUTES;
const ALERT_DEDUPLICATION_MINUTES = 60;
const ALERT_RESERVATION_MINUTES = 10;

function classifyInboundHead(head, now) {
  if (!head || head.processing_completed_at) return null;
  const current = new Date(now).getTime();
  const received = new Date(head.timestamp).getTime();
  const lease = head.processing_lease_until ? new Date(head.processing_lease_until).getTime() : null;
  if (head.reconciliation_state === 'operator_required') return 'operator_required';
  if (head.processing_owner && lease === null) return 'missing_lease_expiration';
  if (head.processing_owner && lease !== null && lease <= current - EXPIRED_LEASE_GRACE_MINUTES * 60_000) return 'expired_lease';
  if (!head.processing_owner && Number.isFinite(received) && received <= current - STALE_UNCLAIMED_HEAD_MINUTES * 60_000) return 'stale_unclaimed_head';
  return null;
}

function canReserveAlert(alert, now) {
  const current = new Date(now).getTime();
  if (alert?.reservation_expires_at && new Date(alert.reservation_expires_at).getTime() > current) return false;
  return !alert?.last_alerted_at || new Date(alert.last_alerted_at).getTime() <= current - ALERT_DEDUPLICATION_MINUTES * 60_000;
}

module.exports = {
  SESSION_LEASE_MINUTES,
  RECOVERY_POLLER_MINUTES,
  MONITOR_INTERVAL_MINUTES,
  EXPIRED_LEASE_GRACE_MINUTES,
  STALE_UNCLAIMED_HEAD_MINUTES,
  ALERT_DEDUPLICATION_MINUTES,
  ALERT_RESERVATION_MINUTES,
  classifyInboundHead,
  canReserveAlert,
};
