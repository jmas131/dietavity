'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {run, fixtureModel, library} = require('../test-support/ticket-48/runner');
async function main() {
  const all = process.argv.includes('--all');
  const scenarioIndex = process.argv.indexOf('--scenario');
  const scenario = scenarioIndex >= 0 ? process.argv[scenarioIndex + 1] : library[0].scenario_id;
  if (scenarioIndex >= 0 && (!scenario || all)) throw new Error('Use one --scenario ID or --all');
  const outIndex = process.argv.indexOf('--output');
  const result = await run({target: 'sales', scenario_ids: all ? library.map(s => s.scenario_id) : [scenario]}, fixtureModel());
  result.validation_mode = 'MODEL_BOUNDARY_FIXTURES_NOT_LIVE_AI';
  for (const report of result.reports) {
    report.validation_mode = result.validation_mode;
    report.reproducibility.actual_model_provider = 'deterministic model-boundary fixture';
    report.reproducibility.models_describe = 'configured n8n models; not called during this fixture run';
  }
  if (outIndex >= 0) {
    if (!process.argv[outIndex + 1]) throw new Error('Missing --output path');
    const dest = path.resolve(process.argv[outIndex + 1]);
    fs.writeFileSync(dest, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
  }
  console.log(JSON.stringify({validation_mode: result.validation_mode, ...result.summary}, null, 2));
  if (result.summary.passes !== result.summary.scenarios_run) process.exitCode = 1;
}
main().catch(() => {console.error('Ticket 48 fixture execution failed.'); process.exitCode = 1;});
