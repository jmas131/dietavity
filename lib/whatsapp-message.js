'use strict';

// Twilio rejects Message bodies above 1,600 characters. Keep room for the
// deterministic multipart label and count UTF-16 code units conservatively:
// astral characters (including most emoji) count as two.
const SAFE_CHARACTER_LIMIT = 1500;

function countCharacters(value) {
  return String(value ?? '').length;
}

function compactWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function boundaryBefore(value, maximum) {
  const window = value.slice(0, maximum + 1);
  const minimumUsefulBoundary = Math.floor(maximum * 0.45);
  const candidates = [
    { expression: /\n\n/g, width: 2 },
    { expression: /\n/g, width: 1 },
    { expression: /[.!?](?:["')\]]*)\s+/g, width: 0 },
    { expression: /[;:]\s+/g, width: 0 },
    { expression: /,\s+/g, width: 0 },
    { expression: /\s+/g, width: 0 },
  ];

  for (const candidate of candidates) {
    let match;
    let last = -1;
    while ((match = candidate.expression.exec(window)) !== null) {
      const end = match.index + match[0].length - candidate.width;
      if (end <= maximum) last = end;
    }
    if (last >= minimumUsefulBoundary) return last;
  }
  return maximum;
}

function splitContent(value, maximum) {
  const chunks = [];
  let remaining = value;
  while (countCharacters(remaining) > maximum) {
    const boundary = boundaryBefore(remaining, maximum);
    const chunk = remaining.slice(0, boundary).trim();
    if (!chunk) throw new Error('Could not produce a non-empty WhatsApp message part');
    chunks.push(chunk);
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function formatWhatsAppMessage(value, limit = SAFE_CHARACTER_LIMIT) {
  if (!Number.isInteger(limit) || limit < 100) {
    throw new TypeError('WhatsApp safe character limit must be an integer of at least 100');
  }
  const original = String(value ?? '');
  const originalCharacterCount = countCharacters(original);
  if (!original.trim()) throw new Error('WhatsApp message body must not be empty');

  if (originalCharacterCount <= limit) {
    return {
      original_character_count: originalCharacterCount,
      final_character_count: originalCharacterCount,
      was_compacted: false,
      was_split: false,
      part_count: 1,
      parts: [original],
    };
  }

  const compacted = compactWhitespace(original);
  const wasCompacted = compacted !== original;
  if (countCharacters(compacted) <= limit) {
    return {
      original_character_count: originalCharacterCount,
      final_character_count: countCharacters(compacted),
      was_compacted: wasCompacted,
      was_split: false,
      part_count: 1,
      parts: [compacted],
    };
  }

  // Reserve enough room even for unusually large part counts. The actual
  // "Parte i/n" label is checked again below before any result is returned.
  const contentLimit = limit - 24;
  let rawParts = splitContent(compacted, contentLimit);
  let parts = rawParts.map((part, index) => `Parte ${index + 1}/${rawParts.length}\n${part}`);
  if (parts.some((part) => countCharacters(part) > limit)) {
    rawParts = splitContent(compacted, contentLimit - 8);
    parts = rawParts.map((part, index) => `Parte ${index + 1}/${rawParts.length}\n${part}`);
  }
  if (parts.some((part) => countCharacters(part) > limit)) {
    throw new Error('WhatsApp multipart formatter exceeded its safe limit');
  }

  return {
    original_character_count: originalCharacterCount,
    final_character_count: parts.reduce((total, part) => total + countCharacters(part), 0),
    was_compacted: wasCompacted,
    was_split: true,
    part_count: parts.length,
    parts,
  };
}

function n8nPrepareMessageCode() {
  return [
    `const SAFE_CHARACTER_LIMIT = ${SAFE_CHARACTER_LIMIT};`,
    countCharacters.toString(),
    compactWhitespace.toString(),
    boundaryBefore.toString(),
    splitContent.toString(),
    formatWhatsAppMessage.toString(),
    `const input = $input.first().json;
const formatted = formatWhatsAppMessage(input.assistant_response, SAFE_CHARACTER_LIMIT);
if (formatted.part_count > 999) throw new Error('WhatsApp part count exceeds the supported integrity bound');
return [{ json: {
  ...input,
  logical_assistant_response: String(input.assistant_response),
  whatsapp_parts: formatted.parts,
  whatsapp_length_metadata: {
    original_character_count: formatted.original_character_count,
    final_character_count: formatted.final_character_count,
    was_compacted: formatted.was_compacted,
    was_split: formatted.was_split,
    part_count: formatted.part_count
  }
} }];`,
  ].join('\n\n');
}

module.exports = {
  SAFE_CHARACTER_LIMIT,
  compactWhitespace,
  countCharacters,
  formatWhatsAppMessage,
  n8nPrepareMessageCode,
};
