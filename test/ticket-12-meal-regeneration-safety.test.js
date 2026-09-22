'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(
  root,
  'n8n',
  'Dietavity Sales Engine (Ticket 10).json'
);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const nodes = new Map(workflow.nodes.map(node => [node.name, node]));

function buildPrompt(body) {
  const source = nodes.get('Build Regeneration Prompt').parameters.jsCode;
  return vm.runInNewContext(
    `(function () { ${source} })()`,
    { $json: { body } }
  )[0].json.prompt;
}

test('Ticket 12 executable regeneration prompt consumes every structured canonical restriction', () => {
  const prompt = buildPrompt({
    currentMeal: {
      title: 'Cena anterior',
      description: 'Descripción anterior',
      calories: 450
    },
    mealType: 'dinner',
    profile: {
      eating_style: 'vegetarian',
      allergies: ['nuez'],
      foods_to_avoid: ['hongos'],
      medical_conditions: ['hypertension']
    }
  });

  assert.match(prompt, /"eating_style": "vegetarian"/);
  assert.match(prompt, /"allergies": \[\s*"nuez"/);
  assert.match(prompt, /"foods_to_avoid": \[\s*"hongos"/);
  assert.match(prompt, /"medical_conditions": \[\s*"hypertension"/);
  assert.match(prompt, /todas las alergias declaradas son exclusiones estrictas/i);
  assert.match(prompt, /ingrediente, topping, guarnición, salsa, aderezo, ingrediente opcional, alternativa ni sustitución/i);
  assert.match(prompt, /alimentos a evitar.*todos son exclusiones estrictas/is);
  assert.match(prompt, /respeta el valor canónico cuando esté presente/i);
  assert.match(prompt, /perfil vegetariano no puede recibir carne ni pescado/i);
  assert.match(prompt, /no inventes una interpretación dietética/i);
  assert.match(prompt, /condiciones médicas.*únicamente como contexto de seguridad/is);
  assert.match(prompt, /no diagnostiques, no prescribas, no afirmes tratar condiciones/i);
  assert.match(prompt, /no modifiques medicamentos/i);
  assert.match(prompt, /no afirmes idoneidad médica ni prometas beneficios terapéuticos/i);
  assert.match(prompt, /no autoriza terapia de nutrición médica/i);
});

test('Ticket 12 keeps Dietavity philosophy and the existing regenerated-meal JSON contract', () => {
  const prompt = buildPrompt({
    currentMeal: {},
    mealType: 'snack'
  });

  assert.match(prompt, /contexto cotidiano de México/);
  assert.match(prompt, /alimentos mínimamente procesados/i);
  assert.match(prompt, /preparaciones realistas/i);
  assert.match(prompt, /variedad/i);
  assert.match(prompt, /"title": ""/);
  assert.match(prompt, /"description": ""/);
  assert.match(prompt, /"calories": 0/);
  assert.match(prompt, /"macros"/);
  assert.match(prompt, /"protein": 0/);
  assert.match(prompt, /"carbs": 0/);
  assert.match(prompt, /"fat": 0/);
  assert.match(prompt, /"recipe"/);
  assert.match(prompt, /"ingredients": \[\]/);
  assert.match(prompt, /"steps": \[\]/);
  assert.match(prompt, /"eating_style": null/);
  assert.match(prompt, /"allergies": \[\]/);
  assert.match(prompt, /"foods_to_avoid": \[\]/);
  assert.match(prompt, /"medical_conditions": \[\]/);
});

test('Ticket 12 workflow remains import-ready and inactive', () => {
  assert.equal(workflow.active, false);
  for (const name of [
    'Meal Regeneration Webhook',
    'Build Regeneration Prompt',
    'Meal Plan Swap Chat Completions',
    'Parse Regenerated Meal JSON',
    'Respond to Meal Regeneration Webhook'
  ]) {
    assert.ok(nodes.has(name), name);
  }
});
