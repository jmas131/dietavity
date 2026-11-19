'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'database/migrations/20261118_ticket_96b_media_enrichment.sql'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');

test('media enrichment persistence is owner/lease bound and safely reusable', () => {
  for (const artifact of [migration, schema]) {
    assert.match(artifact, /persist_media_enrichment/);
    assert.match(artifact, /processing_owner = p->>'processing_owner'/);
    assert.match(artifact, /processing_lease_until > now\(\)/);
    assert.match(artifact, /jsonb_array_length\(COALESCE\(m\.metadata->'attachments'/);
    assert.match(artifact, /TICKET_96B_ENRICHMENT_CONFLICT/);
    assert.match(artifact, /\['url','base64','bytes'\]/);
  }
});
