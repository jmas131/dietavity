'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateDictionary } = require('../lib/sales-engine-v2/fact-validator');

const dictionaryPath = path.join(__dirname, '..', 'config', 'sales-engine-v2', 'product-facts.json');
function loadDictionary() {
  return validateDictionary(JSON.parse(fs.readFileSync(dictionaryPath, 'utf8')));
}
function seedJson(dictionary = loadDictionary()) {
  return JSON.stringify(dictionary.facts);
}
if (require.main === module) process.stdout.write(seedJson() + '\n');
module.exports = { loadDictionary, seedJson };
