'use strict';

const ACCEPTED_STATUSES = new Set(['accepted', 'scheduled', 'sent', 'delivered']);
const SID_PATTERN = /^(SM|MM)[0-9a-fA-F]{32}$/;

function logicalReplyKey(row) {
  return row?.metadata?.logical_reply_key || row?.idempotency_key || '';
}

function isLogicalReplyFullyAccepted(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  if (!rows[0].in_reply_to_id || !rows[0].session_id) return false;
  const keys = new Set(rows.map(logicalReplyKey));
  if (keys.size !== 1 || keys.has('')) return false;
  const declaredCounts = new Set(rows.map((row) => Number(row?.metadata?.part_count ?? 1)));
  if (declaredCounts.size !== 1) return false;
  const partCount = [...declaredCounts][0];
  if (!Number.isInteger(partCount) || partCount < 1 || rows.length !== partCount) return false;
  const indexes = rows.map((row) => Number(row?.metadata?.part_index ?? 1));
  if (indexes.some((index) => !Number.isInteger(index) || index < 1 || index > partCount)) return false;
  if (new Set(indexes).size !== partCount) return false;
  for (let index = 1; index <= partCount; index += 1) {
    if (!indexes.includes(index)) return false;
  }
  return rows.every((row) => row.in_reply_to_id === rows[0].in_reply_to_id
    && row.session_id === rows[0].session_id
    && validPart(row)
    && ACCEPTED_STATUSES.has(row.delivery_status)
    && (SID_PATTERN.test(String(row.provider_message_sid || ''))
      || row?.metadata?.provider_acceptance_evidence === 'message_sid'));
}

function validPart(row) {
  const m = row.metadata || {};
  const declared = ['logical_reply_key', 'part_index', 'part_count'].some((key) => Object.hasOwn(m, key));
  if (!declared) return Boolean(row.idempotency_key) && !/:part:/.test(row.idempotency_key);
  if (typeof m.logical_reply_key !== 'string' || !m.logical_reply_key
    || !Number.isInteger(m.part_index) || !Number.isInteger(m.part_count)
    || m.part_count < 1 || m.part_count > 999 || m.part_index < 1 || m.part_index > m.part_count) return false;
  return row.idempotency_key === (m.part_index === 1 ? m.logical_reply_key
    : `${m.logical_reply_key}:part:${String(m.part_index).padStart(3, '0')}`);
}

// One canonical SQL predicate, embedded into completion, stale recovery, the
// Global Error Handler, and operator recovery. Legacy single-part replies use
// their idempotency key with implicit part_index=part_count=1.
function fullyAcceptedSql(inboundIdSql) {
  return `EXISTS (
    SELECT 1 FROM public.messages AS lr_any
    WHERE lr_any.in_reply_to_id = ${inboundIdSql} AND lr_any.direction = 'outbound'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM (
      SELECT
        COALESCE(NULLIF(lr.metadata->>'logical_reply_key', ''), lr.idempotency_key) AS logical_key,
        COUNT(*) AS row_count,
        COUNT(DISTINCT lr.part_index) AS index_count,
        MIN(lr.part_index) AS min_index,
        MAX(lr.part_index) AS max_index,
        MIN(lr.part_count) AS min_count,
        MAX(lr.part_count) AS max_count,
        BOOL_AND(COALESCE(
          lr.delivery_status IN ('accepted', 'scheduled', 'sent', 'delivered')
          AND (
            lr.provider_message_sid ~ '^(SM|MM)[0-9a-fA-F]{32}$'
            OR lr.metadata->>'provider_acceptance_evidence' = 'message_sid'
          )
          AND lr.session_id = (SELECT session_id FROM public.messages WHERE id = ${inboundIdSql})
          AND lr.part_index BETWEEN 1 AND lr.part_count
          AND lr.part_count BETWEEN 1 AND 999
          AND lr.idempotency_key = CASE WHEN lr.part_index = 1
            THEN COALESCE(NULLIF(lr.metadata->>'logical_reply_key', ''), lr.idempotency_key)
            ELSE (lr.metadata->>'logical_reply_key') || ':part:' || LPAD(lr.part_index::text, 3, '0') END
          AND (NOT lr.declared OR NULLIF(lr.metadata->>'logical_reply_key', '') IS NOT NULL)
          AND (NOT lr.declared OR jsonb_typeof(lr.metadata->'logical_reply_key') = 'string')
          AND (lr.declared OR lr.idempotency_key NOT LIKE '%:part:%')
        , FALSE)) AS all_accepted
      FROM (
        SELECT source.*,
          source.metadata ?| ARRAY['logical_reply_key', 'part_index', 'part_count'] AS declared,
          CASE WHEN NOT (source.metadata ?| ARRAY['logical_reply_key', 'part_index', 'part_count']) THEN 1
            WHEN jsonb_typeof(source.metadata->'part_index') = 'number' AND source.metadata->>'part_index' ~ '^[1-9][0-9]{0,2}$'
            THEN (source.metadata->>'part_index')::integer END AS part_index,
          CASE WHEN NOT (source.metadata ?| ARRAY['logical_reply_key', 'part_index', 'part_count']) THEN 1
            WHEN jsonb_typeof(source.metadata->'part_count') = 'number' AND source.metadata->>'part_count' ~ '^[1-9][0-9]{0,2}$'
            THEN (source.metadata->>'part_count')::integer END AS part_count
        FROM public.messages AS source
      ) AS lr
      WHERE lr.in_reply_to_id = ${inboundIdSql} AND lr.direction = 'outbound'
      GROUP BY COALESCE(NULLIF(lr.metadata->>'logical_reply_key', ''), lr.idempotency_key)
    ) AS logical_reply
    WHERE logical_reply.logical_key IS NULL
       OR logical_reply.min_count < 1
       OR logical_reply.min_count <> logical_reply.max_count
       OR logical_reply.row_count <> logical_reply.min_count
       OR logical_reply.index_count <> logical_reply.min_count
       OR logical_reply.min_index <> 1
       OR logical_reply.max_index <> logical_reply.min_count
       OR logical_reply.all_accepted IS NOT TRUE
  )`;
}

module.exports = { ACCEPTED_STATUSES, fullyAcceptedSql, isLogicalReplyFullyAccepted, logicalReplyKey, validPart };
