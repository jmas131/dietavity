'use strict';

const { createClient } = require('@supabase/supabase-js');

const READ_COLUMNS = 'ledger_id,recorded_at,direction,provider_message_sid,idempotency_key,in_reply_to_id,delivery_status,provider_status,provider_error_code,processing_order,processing_lease_until,processing_completed_at,processing_outcome,turn_anchor_id,turn_position,turn_member_count,reconciliation_state,delivery_suppressed,is_historical,is_synthetic,is_canonical,logical_reply_key,part_index,part_count';

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
    async list({ from, to, pageSize = 200, onPageError }) {
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

function createSupabaseLedgerReader({ url, readOnlyKey, supabaseFactory = createClient, table = 'twilio_ledger_audit_rows' }) {
  if (!/^https:\/\//.test(url || '') || !readOnlyKey) throw new Error('SUPABASE_AUDIT_CREDENTIALS_INVALID');
  const client = supabaseFactory(url, readOnlyKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async list({ from, to, pageSize = 1000 }) {
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error('SUPABASE_AUDIT_PAGE_SIZE_INVALID');
      const rows = []; const seen = new Set(); let cursor = null; let expectedCount = null;
      while (true) {
        let query = client.from(table).select(READ_COLUMNS, { count: 'exact' }).gte('recorded_at', from).lt('recorded_at', to).order('recorded_at', { ascending: true }).order('ledger_id', { ascending: true });
        if (cursor) query = query.or(`recorded_at.gt.${cursor.timestamp},and(recorded_at.eq.${cursor.timestamp},ledger_id.gt.${cursor.id})`);
        const result = await query.limit(pageSize);
        if (result.error) return { rows, complete: false, errorCode: result.error.code || 'SUPABASE_READ_FAILED' };
        if (!Array.isArray(result.data)) return { rows, complete: false, errorCode: 'SUPABASE_RESPONSE_INVALID' };
        // With a keyset predicate, PostgREST's exact count is the size of the
        // *remaining* set, not the original total. Its sum with previously
        // collected rows must remain equal to the first page's total.
        if (!Number.isInteger(result.count) || result.count < 0) return { rows, complete: false, errorCode: 'SUPABASE_COUNT_UNAVAILABLE' };
        if (expectedCount === null) expectedCount = result.count;
        else if (!Number.isInteger(result.count) || rows.length + result.count !== expectedCount) return { rows, complete: false, errorCode: 'SUPABASE_SNAPSHOT_CHANGED' };
        for (const row of result.data) {
          if (!row?.ledger_id || !row?.recorded_at || seen.has(row.ledger_id)) return { rows, complete: false, errorCode: 'SUPABASE_CURSOR_INTEGRITY_FAILED' };
          const current = { timestamp: row.recorded_at, id: row.ledger_id };
          if (cursor && (current.timestamp < cursor.timestamp || (current.timestamp === cursor.timestamp && current.id <= cursor.id))) return { rows, complete: false, errorCode: 'SUPABASE_CURSOR_ORDER_INVALID' };
          seen.add(row.ledger_id); rows.push(row); cursor = current;
        }
        if (result.data.length < pageSize) return { rows, complete: rows.length === (expectedCount || 0), errorCode: rows.length === (expectedCount || 0) ? null : 'SUPABASE_SNAPSHOT_CHANGED' };
      }
    },
  };
}

module.exports = { READ_COLUMNS, assertReadOnlyMethod, createSupabaseLedgerReader, createTwilioReader, retryGet, sanitizeTwilioResource, twilioCalendarBounds };
