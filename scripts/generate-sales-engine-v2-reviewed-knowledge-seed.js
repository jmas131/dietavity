'use strict';
const fs = require('node:fs'); const path = require('node:path');
const { validateAuthority } = require('../lib/sales-engine-v2/reviewed-knowledge-authority');
const authorityPath = path.join(__dirname, '..', 'config', 'sales-engine-v2', 'reviewed-nutrition-knowledge.json');
function loadAuthority() { return validateAuthority(JSON.parse(fs.readFileSync(authorityPath, 'utf8'))); }
function seedJson(authority = loadAuthority()) { return JSON.stringify(authority.knowledge_sets); }
if (require.main === module) process.stdout.write(seedJson() + '\n');
module.exports = { loadAuthority, seedJson };
