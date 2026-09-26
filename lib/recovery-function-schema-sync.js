'use strict';

const FUNCTION_NAMES = Object.freeze(['prepare_whatsapp_reply_recovery', 'claim_whatsapp_reply_recovery_part']);

function escape(name) { return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function extractFunction(sql, name) {
  if (typeof sql !== 'string' || !FUNCTION_NAMES.includes(name)) throw new TypeError('RECOVERY_FUNCTION_SOURCE_INVALID');
  const expression = new RegExp(`CREATE(?:\\s+OR\\s+REPLACE)?\\s+FUNCTION\\s+public\\.${escape(name)}\\s*\\(\\s*p\\s+jsonb\\s*\\)\\s+RETURNS\\s+SETOF\\s+public\\.messages([\\s\\S]*?)AS\\s+(\\$[A-Za-z_]*\\$)([\\s\\S]*?)\\2\\s*;`, 'i');
  const match = expression.exec(sql);
  if (!match) throw new Error(`RECOVERY_FUNCTION_NOT_FOUND:${name}`);
  return { attributes: match[1], body: match[3] };
}
function normalize(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\s*([(),;])\s*/g, '$1').replace(/\s*=\s*/g, '=');
}
function fingerprint(sql, name) {
  const source = extractFunction(sql, name);
  const attributes = normalize(source.attributes).replace(/SET search_path TO 'pg_catalog','public'/i, 'SET search_path=pg_catalog,public');
  if (!/LANGUAGE plpgsql SECURITY DEFINER/i.test(attributes) || !/SET search_path(?: TO)?=?pg_catalog,public/i.test(attributes)) throw new Error(`RECOVERY_FUNCTION_ATTRIBUTES_INVALID:${name}`);
  return Object.freeze({ name, attributes: attributes.toLowerCase(), body: normalize(source.body) });
}
function recoveryFunctionsSynchronized({ canonicalSql, schemaSql }) {
  try { return FUNCTION_NAMES.every(name => JSON.stringify(fingerprint(canonicalSql, name)) === JSON.stringify(fingerprint(schemaSql, name))); } catch { return false; }
}
function assertRecoveryFunctionsSynchronized(input) {
  if (!recoveryFunctionsSynchronized(input)) throw new Error('RECOVERY_FUNCTION_SCHEMA_DRIFT');
  return true;
}

module.exports = { FUNCTION_NAMES, assertRecoveryFunctionsSynchronized, extractFunction, fingerprint, recoveryFunctionsSynchronized };
