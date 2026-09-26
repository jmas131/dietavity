'use strict';

const { CanonicalInputError } = require('./canonical-input-adapters');

const HISTORY_QUERY_LIMIT = 100;
const CLAIM_COLUMNS = 'id,direction,session_id,processing_owner,processing_lease_until,processing_completed_at,processing_order';
const REPLY_COLUMNS = 'id,in_reply_to_id,direction,metadata,idempotency_key';
const CURRENT_COLUMNS = 'id,provider_message_sid,body,timestamp,direction,session_id';
const CANONICAL_HISTORY_COLUMNS = 'id,direction,body,timestamp,in_reply_to_id,metadata,idempotency_key,delivery_status,provider_message_sid';
const LEGACY_HISTORY_COLUMNS = 'id,session_id,created_at,updated_at,message';
const SESSION_COLUMNS = 'session_id,offer_version';
const FACT_SET_COLUMNS = 'authority_set_id,authority_version,status,scope';
const FACT_RECORD_COLUMNS = 'fact_id,authority_set_id,fact_key,state,value_type,value';
const KNOWLEDGE_SET_COLUMNS = 'knowledge_set_id,knowledge_version,locale,status,created_at';
const KNOWLEDGE_RECORD_COLUMNS = 'knowledge_id,knowledge_set_id,knowledge_domain,topic,task_kinds,applicable_input_types,content,provenance';
const FINAL_OUTBOUND_STATUSES = new Set(['accepted', 'scheduled', 'sent', 'delivered']);

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new CanonicalInputError('deadline_exceeded');
}

function unavailable(cause) {
  if (cause instanceof CanonicalInputError) throw cause;
  throw new CanonicalInputError('authority_unavailable');
}

function sortByTimestamp(rows, field) {
  return [...rows].sort((left, right) => Date.parse(left[field]) - Date.parse(right[field]));
}

function createSupabaseCanonicalReader({ supabase, historyQueryLimit = HISTORY_QUERY_LIMIT } = {}) {
  if (!supabase || typeof supabase.from !== 'function' || !Number.isInteger(historyQueryLimit) || historyQueryLimit < 1) {
    throw new CanonicalInputError('authority_unavailable');
  }

  async function read(build, signal) {
    abortIfNeeded(signal);
    try {
      let query = build();
      // PostgREST builders in the installed Supabase client support this method.
      // The guard preserves compatibility with deterministic test doubles.
      if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal);
      const result = await query;
      abortIfNeeded(signal);
      if (!result || result.error) unavailable(result?.error);
      return result.data;
    } catch (error) {
      unavailable(error);
    }
  }

  return Object.freeze({
    async readClaim({ canonicalInboundMessageId, signal } = {}) {
      const inbound = await read(() => supabase.from('messages').select(CLAIM_COLUMNS).eq('id', canonicalInboundMessageId).maybeSingle(), signal);
      if (!inbound) return null;
      const siblings = await read(() => supabase.from('messages').select(REPLY_COLUMNS).eq('in_reply_to_id', canonicalInboundMessageId).eq('direction', 'outbound').limit(1), signal);
      return { ...inbound, has_outbound_reply: Array.isArray(siblings) && siblings.length > 0 };
    },

    async readContext({ canonicalInboundMessageId, sessionId, signal } = {}) {
      const current = await read(() => supabase.from('messages').select(CURRENT_COLUMNS).eq('id', canonicalInboundMessageId).maybeSingle(), signal);
      const [canonicalHistory, legacyHistory, session] = await Promise.all([
        read(() => supabase.from('messages').select(CANONICAL_HISTORY_COLUMNS).eq('session_id', sessionId).eq('direction', 'outbound').order('timestamp', { ascending: false }).limit(historyQueryLimit), signal),
        read(() => supabase.from('onboarding_chat_memory').select(LEGACY_HISTORY_COLUMNS).eq('session_id', sessionId).order('created_at', { ascending: false }).limit(historyQueryLimit), signal),
        read(() => supabase.from('onboarding_sessions').select(SESSION_COLUMNS).eq('session_id', sessionId).maybeSingle(), signal),
      ]);
      if (!current) return null;
      const canonicalMemory = sortByTimestamp(canonicalHistory || [], 'timestamp')
        .filter(row => FINAL_OUTBOUND_STATUSES.has(row.delivery_status))
        .map(row => ({ source_id: row.provider_message_sid || row.id, role: 'assistant', text: row.body, occurred_at: row.timestamp, final_visible: true }));
      return {
        currentTurn: { id: current.provider_message_sid, canonical_message_id: current.id, text: current.body, received_at: current.timestamp },
        memory: [...canonicalMemory, ...sortByTimestamp(legacyHistory || [], 'created_at')],
        // TODO(T75B.1b): project Ticket17A artifact metadata, lineage, and multipart messages.
        conversationArtifacts: [],
        runtimeMetadata: { conversation_id: sessionId, session_id: sessionId, channel: 'whatsapp', offer_version: session?.offer_version ?? null },
      };
    },

    async readFactAuthority({ signal } = {}) {
      const sets = await read(() => supabase.from('product_fact_authority_sets').select(FACT_SET_COLUMNS), signal) || [];
      if (!sets.length) return [];
      const records = await read(() => supabase.from('product_fact_authority_records').select(FACT_RECORD_COLUMNS).in('authority_set_id', sets.map(set => set.authority_set_id)), signal) || [];
      const recordsBySet = new Map();
      for (const record of records) {
        if (!recordsBySet.has(record.authority_set_id)) recordsBySet.set(record.authority_set_id, []);
        recordsBySet.get(record.authority_set_id).push(record);
      }
      return sets.flatMap(set => (recordsBySet.get(set.authority_set_id) || [null]).map(record => ({ ...set, ...(record || { fact_id: null }) })));
    },

    async readKnowledgeAuthority({ locale, signal } = {}) {
      const sets = await read(() => supabase.from('reviewed_nutrition_knowledge_sets').select(KNOWLEDGE_SET_COLUMNS).eq('locale', locale), signal) || [];
      if (!sets.length) return [];
      const records = await read(() => supabase.from('reviewed_nutrition_knowledge_records').select(KNOWLEDGE_RECORD_COLUMNS).in('knowledge_set_id', sets.map(set => set.knowledge_set_id)), signal) || [];
      const recordsBySet = new Map();
      for (const record of records) {
        if (!recordsBySet.has(record.knowledge_set_id)) recordsBySet.set(record.knowledge_set_id, []);
        recordsBySet.get(record.knowledge_set_id).push(record);
      }
      return sets.map(set => ({ ...set, records: recordsBySet.get(set.knowledge_set_id) || [] }));
    },
  });
}

module.exports = {
  HISTORY_QUERY_LIMIT,
  CLAIM_COLUMNS,
  REPLY_COLUMNS,
  CURRENT_COLUMNS,
  CANONICAL_HISTORY_COLUMNS,
  LEGACY_HISTORY_COLUMNS,
  SESSION_COLUMNS,
  FACT_SET_COLUMNS,
  FACT_RECORD_COLUMNS,
  KNOWLEDGE_SET_COLUMNS,
  KNOWLEDGE_RECORD_COLUMNS,
  createSupabaseCanonicalReader,
};
