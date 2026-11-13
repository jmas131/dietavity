'use strict';

const fs = require('node:fs');
const { Pool } = require('pg');

const READ_COLUMNS = 'ledger_id,recorded_at,direction,provider_message_sid,idempotency_key,in_reply_to_id,delivery_status,provider_status,provider_error_code,processing_order,processing_lease_until,processing_completed_at,processing_outcome,turn_anchor_id,turn_position,turn_member_count,reconciliation_state,delivery_suppressed,is_historical,is_synthetic,is_canonical,logical_reply_key,part_index,part_count';
const AUDIT_VIEW = 'twilio_audit.twilio_ledger_audit_rows';

function assertReadOnlyMethod(method) { if (String(method || '').toUpperCase() !== 'GET') throw new Error('TWILIO_AUDIT_READ_ONLY_GET_REQUIRED'); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function sanitizeTwilioResource(value = {}) { return { sid: value.sid, direction: value.direction, from: value.from, to: value.to, date_sent: value.date_sent, date_created: value.date_created, status: value.status, error_code: value.error_code }; }
function utcCalendarDate(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new Error('TWILIO_AUDIT_DATE_INVALID'); return date.toISOString().slice(0, 10); }
function twilioCalendarBounds({ from, to }) { const end = new Date(to); if (Number.isNaN(end.getTime()) || Date.parse(from) >= end.getTime()) throw new Error('TWILIO_AUDIT_RANGE_INVALID'); return { lower: utcCalendarDate(from), upper: utcCalendarDate(new Date(end.getTime() - 1)) }; }

async function retryGet(request, { retries = 3, sleepFn = sleep } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await request();
      if (response.ok) return response;
      const retryAfter = Number(response.headers?.get?.('retry-after') || 0);
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === retries) throw Object.assign(new Error(`TWILIO_AUDIT_HTTP_${response.status}`), { status: response.status });
      await sleepFn((retryAfter > 0 ? retryAfter * 1000 : 100 * (2 ** attempt)) + Math.floor(Math.random() * 50));
    } catch (error) {
      last = error;
      if (attempt === retries || (error.status && error.status < 500 && error.status !== 429)) throw error;
      await sleepFn(100 * (2 ** attempt) + Math.floor(Math.random() * 50));
    }
  }
  throw last;
}

function createTwilioReader({ accountSid, apiKeySid, apiKeySecret, fetchFn = global.fetch, baseUrl = 'https://api.twilio.com', maxPages = 100 }) {
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid || '') || !/^SK[0-9a-f]{32}$/i.test(apiKeySid || '') || !apiKeySecret) throw new Error('TWILIO_AUDIT_CREDENTIALS_INVALID');
  if (typeof fetchFn !== 'function') throw new Error('FETCH_UNAVAILABLE');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000) throw new Error('TWILIO_AUDIT_PAGE_LIMIT_INVALID');
  const root = new URL(`/2010-04-01/Accounts/${accountSid}/Messages.json`, baseUrl);
  const authorization = `Basic ${Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString('base64')}`;
  return {
    async list({ from, to, pageSize = 200, onPageError, followPages = true }) {
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error('TWILIO_AUDIT_PAGE_SIZE_INVALID');
      const messages = []; let complete = true;
      const bounds = twilioCalendarBounds({ from, to });
      // Twilio documents DateSent expressions as GMT calendar dates. Exact
      // half-open UTC inclusion is deliberately enforced by the classifier.
      const first = new URL(root); first.searchParams.set('DateSent>=', bounds.lower); first.searchParams.set('DateSent<=', bounds.upper); first.searchParams.set('PageSize', String(pageSize));
      let next = first; const visited = new Set(); let pages = 0;
      while (next) {
        try {
          if (next.origin !== root.origin || !next.pathname.startsWith(`/2010-04-01/Accounts/${accountSid}/Messages`)) throw new Error('TWILIO_AUDIT_NEXT_PAGE_REJECTED');
          const nextKey = next.toString(); if (visited.has(nextKey)) throw new Error('TWILIO_AUDIT_REPEATED_PAGE'); visited.add(nextKey);
          if (++pages > maxPages) throw new Error('TWILIO_AUDIT_PAGE_LIMIT_REACHED');
          const response = await retryGet(() => { assertReadOnlyMethod('GET'); return fetchFn(next, { method: 'GET', headers: { authorization } }); });
          const body = await response.json();
          if (!Array.isArray(body.messages)) throw new Error('TWILIO_AUDIT_RESPONSE_INVALID');
          messages.push(...body.messages.map(sanitizeTwilioResource));
          if (!followPages) return { messages, complete, pages };
          next = body.next_page_uri ? new URL(body.next_page_uri, root) : null;
        } catch (error) { complete = false; if (onPageError) onPageError(error); break; }
      }
      return { messages, complete, pages };
    },
    async fetchMessage(sid) {
      if (!/^(SM|MM)[0-9a-f]{32}$/i.test(sid || '')) throw new Error('TWILIO_AUDIT_SID_INVALID');
      const url = new URL(`/2010-04-01/Accounts/${accountSid}/Messages/${sid}.json`, baseUrl);
      const response = await retryGet(() => { assertReadOnlyMethod('GET'); return fetchFn(url, { method: 'GET', headers: { authorization } }); });
      return sanitizeTwilioResource(await response.json());
    },
  };
}

function auditDatabaseConfig({ connectionString, sslRootCertPath, poolFactory = config => new Pool(config) }) {
  let parsed;
  try { parsed = new URL(connectionString); } catch { throw new Error('SUPABASE_AUDIT_DATABASE_URL_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.password || parsed.searchParams.get('sslmode') !== 'verify-full') throw new Error('SUPABASE_AUDIT_DATABASE_URL_INVALID');
  // Direct connections use the exact role name; Supavisor session pooler uses
  // role.project-ref. Never permit a postgres/service-role connection here.
  if (!/^twilio_ledger_auditor(?:\.[a-z0-9]+)?$/i.test(decodeURIComponent(parsed.username))) throw new Error('SUPABASE_AUDIT_DATABASE_ROLE_INVALID');
  if (!sslRootCertPath || !fs.existsSync(sslRootCertPath)) throw new Error('SUPABASE_AUDIT_TLS_CERT_REQUIRED');
  // node-postgres lets SSL URL parameters override config.ssl. Remove them
  // after validating verify-full, then supply the reviewed CA explicitly.
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword', 'sslnegotiation']) parsed.searchParams.delete(key);
  return {
    pool: poolFactory({ connectionString: parsed.toString(), max: 1, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 15_000, application_name: 'twilio-ledger-audit', ssl: { ca: fs.readFileSync(sslRootCertPath, 'utf8'), rejectUnauthorized: true } }),
  };
}

function createPostgresLedgerReader(options) {
  const { pool } = auditDatabaseConfig(options);
  return {
    async list({ from, to, pageSize = 1000 }) {
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error('POSTGRES_AUDIT_PAGE_SIZE_INVALID');
      const rows = []; const seen = new Set(); let cursor = null; let expectedCount = null; let client;
      try {
        client = await pool.connect();
        // All reads share one read-only repeatable-read snapshot. This makes
        // count/keyset coverage deterministic even while production receives
        // new messages, and makes accidental writes fail at PostgreSQL.
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const functionResult = await client.query("SELECT EXISTS (SELECT 1 FROM pg_proc AS procedure JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace WHERE procedure.prosecdef AND namespace.nspname !~ '^pg_' AND namespace.nspname <> 'information_schema' AND has_schema_privilege(current_user, namespace.oid, 'USAGE') AND has_function_privilege(current_user, procedure.oid, 'EXECUTE')) AS unsafe");
        if (functionResult.rows?.[0]?.unsafe === true) return { rows, complete: false, errorCode: 'POSTGRES_EFFECTIVE_FUNCTION_PRIVILEGE' };
        const countResult = await client.query(`SELECT count(*)::integer AS count FROM ${AUDIT_VIEW} WHERE recorded_at >= $1 AND recorded_at < $2`, [from, to]);
        expectedCount = Number(countResult.rows?.[0]?.count);
        if (!Number.isInteger(expectedCount) || expectedCount < 0) return { rows, complete: false, errorCode: 'POSTGRES_COUNT_UNAVAILABLE' };
        while (true) {
          const values = cursor ? [from, to, cursor.timestamp, cursor.id, pageSize] : [from, to, pageSize];
          const where = cursor ? 'AND (recorded_at > $3 OR (recorded_at = $3 AND ledger_id > $4))' : '';
          const limit = cursor ? '$5' : '$3';
          const result = await client.query(`SELECT ${READ_COLUMNS} FROM ${AUDIT_VIEW} WHERE recorded_at >= $1 AND recorded_at < $2 ${where} ORDER BY recorded_at ASC, ledger_id ASC LIMIT ${limit}`, values);
          if (!Array.isArray(result.rows)) return { rows, complete: false, errorCode: 'POSTGRES_RESPONSE_INVALID' };
          for (const row of result.rows) {
            if (!row?.ledger_id || !row?.recorded_at || seen.has(row.ledger_id)) return { rows, complete: false, errorCode: 'POSTGRES_CURSOR_INTEGRITY_FAILED' };
            const current = { timestamp: new Date(row.recorded_at).toISOString(), id: String(row.ledger_id) };
            if (Number.isNaN(Date.parse(current.timestamp)) || (cursor && (current.timestamp < cursor.timestamp || (current.timestamp === cursor.timestamp && current.id <= cursor.id)))) return { rows, complete: false, errorCode: 'POSTGRES_CURSOR_ORDER_INVALID' };
            seen.add(current.id); rows.push(row); cursor = current;
          }
          if (result.rows.length < pageSize) return { rows, complete: rows.length === expectedCount, errorCode: rows.length === expectedCount ? null : 'POSTGRES_SNAPSHOT_INTEGRITY_FAILED' };
        }
      } catch { return { rows, complete: false, errorCode: 'POSTGRES_READ_FAILED' }; }
      finally {
        if (client) { try { await client.query('ROLLBACK'); } catch {} client.release(); }
        await pool.end();
      }
    },
  };
}

module.exports = { AUDIT_VIEW, READ_COLUMNS, assertReadOnlyMethod, auditDatabaseConfig, createPostgresLedgerReader, createTwilioReader, retryGet, sanitizeTwilioResource, twilioCalendarBounds };
