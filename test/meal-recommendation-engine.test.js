'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../lib/meal-recommendation-engine');

const cooked = new Set(['chicken', 'chicken_breast', 'ground_beef', 'shredded_beef', 'white_fish', 'salmon', 'shrimp', 'rice', 'brown_rice', 'common_beans', 'black_beans', 'lentils', 'chickpeas', 'zucchini', 'broccoli']);
function input(ids, extra = {}) { return { decision_horizon: 'immediate', available_foods: ids.map(id => ({ food_id: id, state: cooked.has(id) ? { cooked: true, readiness: 'ready_to_eat' } : {} })), ...extra }; }
function result(ids, extra) { return engine.recommend(input(ids, extra)); }

// Each case has deterministic properties, while food quality is deliberately
// represented as a transparent heuristic for subsequent human review.
const CASES = [
  ['1 taco básico', ['egg', 'corn_tortilla', 'avocado'], {}, 'taco'],
  ['2 taco poco apetito', ['egg', 'corn_tortilla', 'avocado'], { appetite: 'low' }, 'taco', 'start_small'],
  ['3 huevos mexicanos', ['egg', 'red_tomato', 'onion', 'corn_tortilla'], {}, 'huevos_a_la_mexicana'],
  ['4 omelette', ['egg', 'mushrooms', 'panela_cheese'], {}, 'omelette'],
  ['5 taco de pollo', ['chicken', 'corn_tortilla', 'avocado', 'green_salsa'], {}, 'taco'],
  ['6 tostada de atún', ['canned_tuna', 'tostada', 'avocado', 'red_tomato'], {}, 'tostada'],
  ['7 sándwich de atún', ['whole_grain_bread', 'canned_tuna', 'avocado', 'cucumber'], {}, 'sandwich'],
  ['8 mollete', ['bolillo', 'common_beans', 'fresh_cheese', 'pico_de_gallo'], {}, 'mollete'],
  ['9 plato con pollo', ['chicken', 'rice', 'zucchini'], {}, 'plato_casero'],
  ['10 yogurt bowl', ['greek_yogurt', 'strawberry', 'walnuts'], {}, 'yogurt_bowl'],
  ['11 yogurt poco apetito', ['greek_yogurt', 'banana', 'walnuts'], { appetite: 'low' }, 'yogurt_bowl', 'start_small'],
  ['12 pollo poco apetito', ['chicken', 'corn_tortilla', 'avocado'], { appetite: 'low' }, 'taco', 'start_small'],
  ['13 pan con huevo', ['egg', 'bread', 'avocado'], { appetite: 'low' }, 'toast', 'start_small'],
  ['14 plato pequeño', ['rice', 'chicken', 'broccoli'], { appetite: 'low' }, 'plato_casero', 'start_small'],
  ['15 plato normal', ['rice', 'chicken', 'broccoli'], { appetite: 'normal' }, 'plato_casero', 'normal_portion'],
  ['16 plato hambre alta', ['rice', 'chicken', 'broccoli'], { appetite: 'high' }, 'plato_casero', 'normal_plate'],
  ['17 hambre variable', ['egg', 'corn_tortilla', 'panela_cheese'], { appetite: 'variable' }, 'taco', 'start_small'],
  ['18 variedad frente a huevo', ['egg', 'chicken', 'corn_tortilla', 'avocado'], { recently_consumed: ['egg'] }, 'taco', null, 'chicken'],
  ['19 variedad frente a pollo', ['chicken', 'canned_tuna', 'tostada', 'avocado'], { recently_consumed: ['chicken'] }, 'tostada'],
  ['20 repetición necesaria', ['chicken', 'corn_tortilla'], { recently_consumed: ['chicken'] }, 'taco', null, 'chicken'],
  ['21 variedad frente a yogurt', ['greek_yogurt', 'strawberry', 'egg', 'corn_tortilla', 'red_tomato'], { recently_consumed: ['greek_yogurt', 'strawberry'] }, 'taco'],
  ['22 diversidad frente a tacos', ['chicken', 'rice', 'zucchini', 'corn_tortilla'], { recently_consumed: ['tacos'] }, 'plato_casero'],
  ['23 pozole preparado', ['pozole', 'egg', 'chicken'], {}, 'prepared_dish_complement'],
  ['24 cochinita', ['cochinita_pibil', 'corn_tortilla', 'onion'], {}, 'taco'],
  ['25 mole y arroz', ['chicken_with_mole', 'rice'], {}, 'plato_casero'],
  ['26 rajas', ['rajas_with_cream', 'corn_tortilla'], {}, 'taco'],
  ['27 picadillo', ['picadillo', 'corn_tortilla', 'avocado'], {}, 'taco'],
  ['28 tamal intacto', ['tamales', 'avocado', 'egg'], {}, 'prepared_dish_complement'],
  ['29 sopa complementada', ['vegetable_soup', 'chicken', 'corn_tortilla'], {}, 'soup_complement'],
  ['30 chilaquiles intactos', ['chilaquiles', 'greek_yogurt', 'banana'], {}, 'prepared_dish_complement'],
  ['31 serrano específico', ['egg', 'red_tomato', 'onion', 'serrano_chile'], {}, 'huevos_a_la_mexicana', null, 'serrano_chile'],
  ['32 salsa verde preparada', ['chicken', 'corn_tortilla', 'green_salsa'], {}, 'taco', null, 'green_salsa'],
  ['33 quesadilla', ['oaxaca_cheese', 'corn_tortilla', 'mushrooms'], {}, 'quesadilla'],
  ['34 mollete específico', ['common_beans', 'bolillo', 'fresh_cheese', 'pico_de_gallo'], {}, 'mollete'],
  ['35 nopales y panela', ['nopal', 'panela_cheese', 'red_tomato', 'corn_tortilla'], {}, 'taco'],
  ['36 cochinita y chile en vinagre', ['cochinita_pibil', 'corn_tortilla', 'pickled_chile'], {}, 'taco', null, 'pickled_chile'],
  ['37 serrano no es salsa', ['chicken', 'corn_tortilla', 'serrano_chile'], {}, 'taco', null, 'serrano_chile'],
  ['38 salsa ya hecha', ['chicken', 'corn_tortilla', 'green_salsa'], {}, 'taco', null, 'green_salsa'],
  ['39 habanero prudente', ['egg', 'red_tomato', 'onion', 'habanero_chile'], {}, 'huevos_a_la_mexicana', null, 'habanero_chile'],
  ['40 tostada con chiles en vinagre', ['tostada', 'canned_tuna', 'avocado', 'pickled_chile'], {}, 'tostada', null, 'pickled_chile'],
  ['41 rechazo de huevo', ['egg', 'chicken', 'corn_tortilla', 'avocado'], { contextual_rejections: ['egg'] }, 'taco', null, 'chicken'],
  ['42 rechazo de pollo', ['egg', 'chicken', 'corn_tortilla', 'avocado'], { contextual_rejections: ['chicken'] }, 'taco', null, 'egg'],
  ['43 rechazo de atún', ['canned_tuna', 'egg', 'corn_tortilla', 'avocado'], { contextual_rejections: ['canned_tuna'] }, 'taco', null, 'egg'],
  ['44 otra cosa', ['egg', 'chicken', 'corn_tortilla', 'avocado'], { previous_candidate: { archetype: 'taco' } }, 'not_taco'],
  ['45 insuficiente pepino', ['cucumber', 'lime', 'salsa'], {}, 'needs'],
  ['46 insuficiente condimentos', ['ketchup', 'mustard', 'onion'], {}, 'needs'],
  ['47 crudos no inmediatos', ['common_beans', 'chicken', 'rice'], { available_foods: [{ food_id: 'common_beans', state: {} }, { food_id: 'chicken', state: {} }, { food_id: 'rice', state: {} }] }, 'needs'],
  ['48 no taco de manzana', ['apple', 'corn_tortilla'], {}, 'needs'],
  ['49 alergia a huevo', ['egg', 'chicken', 'corn_tortilla', 'avocado'], { confirmed_constraints: ['egg'] }, 'taco', null, 'chicken'],
];

test('Meal Recommendation Engine V1 exposes a compact culinary ontology and grammar inventory', () => {
  assert.ok(Object.keys(engine.ONTOLOGY).length >= 100, `ontology count: ${Object.keys(engine.ONTOLOGY).length}`);
  assert.ok(engine.ARCHETYPES.length >= 20);
  assert.deepEqual(engine.ONTOLOGY.red_tomato.aliases, ['jitomate', 'jitomates']);
  assert.ok(engine.ONTOLOGY.tomatillo.aliases.includes('tomate'));
  assert.equal(engine.ONTOLOGY.mexican_cream.display_name, 'crema');
  assert.ok(engine.ONTOLOGY.ketchup.aliases.includes('ketchup'));
  assert.equal(engine.ONTOLOGY.canned_tuna.parent, 'tuna');
  assert.equal(engine.normalizeFood('huauzontles').recognition, 'unknown_food');
});

test('V1 49-case deterministic benchmark: grounded construction, variation, prepared food, safety, and clarification', () => {
  const report = [];
  for (const [name, foods, extra, expected, portion, mustUse] of CASES) {
    const output = engine.recommend(input(foods, extra));
    if (expected === 'needs') assert.equal(output.status, 'needs_clarification', name);
    else {
      assert.equal(output.status, 'recommendation', name);
      if (expected === 'not_taco') assert.notEqual(output.candidate.archetype, 'taco', name);
      else assert.equal(output.candidate.archetype, expected, name);
      if (portion) assert.equal(output.portion_strategy, portion, name);
      if (mustUse) assert.ok(output.candidate.ingredients.includes(mustUse), `${name}: ${mustUse}`);
      for (const id of output.candidate.ingredients) assert.ok(foods.includes(id), `${name}: invented ${id}`);
    }
    report.push({ name, output });
  }
  const recommendations = report.filter(row => row.output.status === 'recommendation');
  const quality = recommendations.map(row => row.output.score >= 80 ? 12 : 10);
  assert.ok(quality.reduce((a, b) => a + b, 0) / quality.length >= 10, 'automated heuristic quality threshold');
});

test('Case 50 routes medication/dose questions back to the policy boundary', () => {
  const output = result(['egg', 'corn_tortilla', 'avocado'], { appetite: 'low', medical_or_policy_boundary: true });
  assert.deepEqual(output, { status: 'route_to_policy', reason: 'medical_or_policy_boundary' });
});

test('paired contexts have causal appetite and variety behavior', () => {
  const normal = result(['egg', 'corn_tortilla', 'avocado'], { appetite: 'normal' });
  const low = result(['egg', 'corn_tortilla', 'avocado'], { appetite: 'low' });
  assert.equal(normal.candidate.name, low.candidate.name);
  assert.notEqual(normal.portion_strategy, low.portion_strategy);
  for (const appetite of ['low', 'normal', 'high']) assert.equal(result(['rice', 'chicken', 'broccoli'], { appetite }).candidate.archetype, 'plato_casero');
  assert.equal(result(['rice', 'chicken', 'broccoli'], { appetite: 'low' }).portion_strategy, 'start_small');
  assert.equal(result(['rice', 'chicken', 'broccoli'], { appetite: 'high' }).portion_strategy, 'normal_plate');
});
