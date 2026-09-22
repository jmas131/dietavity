'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const knowledge = require('../lib/dietavity-knowledge');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(
  root,
  'n8n',
  'Dietavity Sales Engine (Ticket 10).json',
);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const nodes = new Map(workflow.nodes.map(node => [node.name, node]));

const executableMealContracts = [
  nodes.get('Build Nutrition Prompt').parameters.jsCode,
  nodes.get('Build Regeneration Prompt').parameters.jsCode,
  nodes.get('Meal Plan Swap Chat Completions').parameters.jsonBody,
  nodes.get('Build Weekly Update Prompt').parameters.jsCode,
  nodes.get('Dietavity Nutrition Model').parameters.responses.values[0].content,
];

test('Ticket 21 defines the required safety-to-longevity selection hierarchy', () => {
  const contract = knowledge.MEAL_PROMPT_KNOWLEDGE;
  const orderedTerms = [
    'restricciones de seguridad',
    'dieta y exclusiones declaradas',
    'familiaridad',
    'disponibilidad de ingredientes en México',
    'practicidad y sencillez',
    'calidad nutricional',
    'opciones cotidianas conscientes del costo',
    'variedad',
    'principios inspirados en longevidad',
  ];

  let previousIndex = -1;
  for (const term of orderedTerms) {
    const index = contract.indexOf(term);
    assert.ok(index > previousIndex, `${term} must appear in hierarchy order`);
    previousIndex = index;
  }
  assert.match(contract, /restricciones explícitas siempre prevalecen/i);
  assert.match(contract, /No infieras un disgusto/i);
});

test('Ticket 21 prioritizes familiar Mexico-available food and practical preparation', () => {
  const contract = knowledge.MEAL_PROMPT_KNOWLEDGE;

  assert.match(contract, /probablemente reconozca y sepa comer o preparar/i);
  assert.match(contract, /huevo, tortilla, frijoles, lentejas, pollo, atún, sardina/i);
  assert.match(contract, /ingredientes comunes que se puedan conseguir razonablemente en México/i);
  assert.match(contract, /pocos pasos, tiempo activo razonable, equipo limitado/i);
  assert.match(contract, /sartén, olla, comal, microondas/i);
  assert.match(contract, /horno puede usarse, pero no debe ser el método predeterminado/i);
  assert.match(contract, /comida normal compuesta inteligentemente/i);
  assert.match(contract, /sin convertir cada comida en tacos/i);
  assert.match(contract, /no uses "batido" por defecto.*"licuado"/i);
});

test('Ticket 21 discourages specialty defaults without banning profile-compatible choices', () => {
  const contract = knowledge.MEAL_PROMPT_KNOWLEDGE;

  assert.match(contract, /Miso, tofu, quinoa, algas especiales/i);
  assert.match(contract, /no están prohibidos/i);
  assert.match(contract, /no deben representar por defecto la alimentación saludable/i);
  assert.match(contract, /No uses salmón como pescado predeterminado/i);
  assert.match(contract, /atún, sardina, tilapia/i);
  assert.match(contract, /preferencia explícita por tofu o salmón/i);
  assert.doesNotMatch(contract, /(?:prohíbe|nunca uses) (?:miso|tofu|quinoa|salmón)/i);
});

test('Ticket 21 requires specific names, practical legumes, and balanced ingredient reuse', () => {
  const contract = knowledge.MEAL_PROMPT_KNOWLEDGE;

  assert.match(contract, /nombres de comidas claros y descriptivos/i);
  assert.match(contract, /Evita nombres vagos o de marketing/i);
  assert.match(contract, /tilapia a la plancha con calabacitas y arroz/i);
  assert.match(contract, /frijoles o lentejas cocidos previamente/i);
  assert.match(contract, /preparación por tandas/i);
  assert.match(contract, /opciones enlatadas o empacadas/i);
  assert.match(contract, /Reutiliza razonablemente ingredientes entre comidas cercanas/i);
  assert.match(contract, /sin volver monótono el programa ni sacrificar variedad/i);
});

test('Ticket 21 synchronizes the contract into every executable meal prompt', () => {
  for (const [index, source] of executableMealContracts.entries()) {
    assert.match(source, /# Jerarquía obligatoria para elegir comidas/, `prompt ${index}`);
    assert.match(source, /No uses salmón como pescado predeterminado/, `prompt ${index}`);
    assert.match(source, /Reutiliza razonablemente ingredientes/, `prompt ${index}`);
    assert.doesNotMatch(
      source,
      /Mantén variedad entre cocina mexicana\/latinoamericana e inspiración mediterránea, japonesa, nórdica/,
      `prompt ${index}`,
    );
  }

  const weekly = nodes.get('Build Weekly Update Prompt').parameters.jsCode;
  assert.doesNotMatch(weekly, /Diseñas planes de alimentación saludables inspirados[\s\S]*- Japón[\s\S]*- Italia[\s\S]*- España[\s\S]*- Noruega/);
  assert.match(weekly, /no organizan el plan por países ni exigen cocinas extranjeras/i);
  assert.match(weekly, /Reutilizar razonablemente ingredientes entre comidas cercanas sin sacrificar variedad/i);
  assert.equal(workflow.active, false);
});

test('Ticket 21 preserves the existing weekly and regenerated meal JSON schemas', () => {
  const weekly = nodes.get('Build Weekly Update Prompt').parameters.jsCode;
  const regeneration = nodes.get('Build Regeneration Prompt').parameters.jsCode;

  for (const fragment of [
    '"duration_days": 7',
    '"breakfast": {}',
    '"lunch": {}',
    '"dinner": {}',
    '"snacks": []',
    'ingredients[]',
    'steps[]',
  ]) {
    assert.ok(weekly.includes(fragment), fragment);
  }

  for (const fragment of [
    '"title": ""',
    '"description": ""',
    '"calories": 0',
    '"protein": 0',
    '"carbs": 0',
    '"fat": 0',
    '"ingredients": []',
    '"steps": []',
  ]) {
    assert.ok(regeneration.includes(fragment), fragment);
  }
});

test('Ticket 21 leaves Ticket 12 canonical server-side regeneration restrictions intact', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const route = server.slice(
    server.indexOf("app.post('/api/regenerate-meal'"),
    server.indexOf("app.post('/api/regenerate-meal'") + 9000,
  );

  assert.match(route, /LOAD CANONICAL REGENERATION RESTRICTIONS/);
  assert.match(route, /\.from\('profiles'\)/);
  assert.match(route, /\.select\('eating_style, allergies, foods_to_avoid, medical_conditions'\)/);
  assert.match(route, /profile: regenerationProfile/);
  assert.doesNotMatch(route.match(/const \{[\s\S]*?\} = req\.body;/)[0], /profile|allerg|foods_to_avoid|medical_conditions/);
});
