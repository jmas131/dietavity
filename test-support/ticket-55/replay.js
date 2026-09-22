'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {replay} = require('../ticket-54/replay');
const fixture = require('./three-scenario-incidents.json');
function baselineRuntime(options = {}) {
  return vm.runInNewContext(fs.readFileSync(path.join(__dirname,'baseline-runtime.js.txt'),'utf8'),
    {Date:options.Date || Date},{timeout:5000});
}
function acceptanceBaselineRuntime(options = {}) {
  return vm.runInNewContext(fs.readFileSync(path.join(__dirname,'acceptance-baseline-runtime.js.txt'),'utf8'),
    {Date:options.Date || Date},{timeout:5000});
}
// A NEW semantic field did not exist at the recorded model boundary. Explicitly
// label its local annotation; do not present this as fresh model classification.
function annotateTask(turn, operation = 'draft', request = turn.customer_message) {
  const copy = structuredClone(turn);
  copy.diagnostics.interpretation.current_task = {operation, request};
  return copy;
}
module.exports = {fixture, replay, baselineRuntime, acceptanceBaselineRuntime, annotateTask};
