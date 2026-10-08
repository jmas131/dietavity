'use strict';

// Standalone deterministic prototype.  It deliberately has no dependency on
// Direct RAG: callers must first decide that a food recommendation is allowed.

const GROUPS = Object.freeze(['protein', 'legume', 'vegetable', 'fruit', 'grain_starch', 'dairy', 'fat', 'nuts_seeds', 'condiment', 'beverage']);
const PANTRY = new Set(['water', 'salt', 'cooking_oil']);

function food(id, display_name, groups, extra = {}) {
  return Object.freeze({ id, display_name, aliases: [display_name], type: 'atomic_food', parent: null,
    groups, culinary_roles: [], protein_role: 'none', default_readiness: 'ready_to_eat', prep_effort: 'low',
    low_appetite_fit: 'medium', locale: ['es-MX'], ...extra });
}

const FOODS = [
  // proteins
  food('egg', 'huevo', ['protein'], { aliases: ['huevo', 'huevos'], culinary_roles: ['main', 'filling', 'binder'], protein_role: 'primary', default_readiness: 'requires_cooking' }),
  food('fish', 'pescado', ['protein'], { aliases: ['pescado'], culinary_roles: ['main'], protein_role: 'primary', default_readiness: 'requires_cooking', prep_effort: 'medium' }),
  food('chicken', 'pollo', ['protein'], { aliases: ['pollo'], culinary_roles: ['main', 'filling'], protein_role: 'primary', default_readiness: 'requires_cooking', prep_effort: 'medium' }),
  food('chicken_breast', 'pechuga de pollo', ['protein'], { aliases: ['pechuga', 'pechugas', 'pechuga de pollo'], parent: 'chicken', culinary_roles: ['main', 'filling'], protein_role: 'primary', default_readiness: 'requires_cooking', prep_effort: 'medium' }),
  ...['ground_beef:carne molida', 'beef_steak:bistec', 'shredded_beef:carne deshebrada', 'pork:cerdo', 'pork_loin:lomo de cerdo', 'tuna:atún', 'canned_tuna:atún en lata', 'white_fish:pescado blanco', 'salmon:salmón', 'shrimp:camarón', 'turkey:pavo', 'turkey_ham:jamón de pavo', 'ham:jamón', 'sardines:sardinas'].map(pair => {
    const [id, name] = pair.split(':'); const parent = id === 'canned_tuna' ? 'tuna' : ['white_fish', 'salmon'].includes(id) ? 'fish' : null;
    return food(id, name, ['protein'], { parent, culinary_roles: ['main', 'filling'], protein_role: 'primary', default_readiness: id === 'canned_tuna' || id === 'turkey_ham' || id === 'ham' || id === 'sardines' ? 'ready_to_eat' : 'requires_cooking', prep_effort: id === 'canned_tuna' ? 'none' : 'medium' });
  }),
  // legumes
  ...['black_beans:frijoles negros', 'common_beans:frijoles', 'lentils:lentejas', 'chickpeas:garbanzos', 'peas:chícharos'].map(pair => { const [id, name] = pair.split(':'); return food(id, name, ['legume'], { culinary_roles: ['main', 'side', 'filling'], protein_role: 'supporting', default_readiness: 'requires_long_prep', prep_effort: 'medium' }); }),
  // dairy
  ...['panela_cheese:queso panela', 'oaxaca_cheese:queso Oaxaca', 'fresh_cheese:queso fresco', 'manchego_cheese:queso manchego', 'cottage_cheese:requesón', 'plain_yogurt:yogurt natural', 'greek_yogurt:yogurt griego', 'milk:leche', 'mexican_cream:crema'].map(pair => { const [id, name] = pair.split(':'); return food(id, name, ['dairy'].concat(id === 'milk' ? ['beverage'] : []), { culinary_roles: id.includes('cheese') ? ['filling', 'topping'] : ['main', 'liquid'], protein_role: id.includes('yogurt') || id === 'cottage_cheese' ? 'supporting' : 'none' }); }),
  // starches
  ...['corn_tortilla:tortilla de maíz', 'flour_tortilla:tortilla de harina', 'tostada:tostada', 'bread:pan', 'bolillo:bolillo', 'whole_grain_bread:pan integral', 'rice:arroz', 'brown_rice:arroz integral', 'oats:avena', 'pasta:pasta', 'potato:papa', 'sweet_potato:camote', 'corn:elote'].map(pair => { const [id, name] = pair.split(':'); return food(id, name, ['grain_starch'], { culinary_roles: ['base', 'side'], default_readiness: ['corn_tortilla', 'flour_tortilla', 'tostada', 'bread', 'bolillo', 'whole_grain_bread'].includes(id) ? 'ready_to_eat' : 'requires_cooking', prep_effort: 'low' }); }),
  // vegetables
  ...['red_tomato:jitomate', 'tomatillo:tomate verde', 'onion:cebolla', 'garlic:ajo', 'chile:chile', 'fresh_chile:chile fresco', 'serrano_chile:chile serrano', 'jalapeno_chile:chile jalapeño', 'habanero_chile:chile habanero', 'poblano_chile:chile poblano', 'dried_chile:chile seco', 'ancho_chile:chile ancho', 'guajillo_chile:chile guajillo', 'morita_chile:chile morita', 'pickled_chile:chile en vinagre', 'bell_pepper:pimiento morrón', 'zucchini:calabacita', 'nopal:nopal', 'spinach:espinaca', 'chard:acelga', 'quelites:quelites', 'broccoli:brócoli', 'cauliflower:coliflor', 'carrot:zanahoria', 'cucumber:pepino', 'lettuce:lechuga', 'cabbage:col', 'mushrooms:champiñones', 'green_beans:ejotes', 'chayote:chayote', 'celery:apio', 'pumpkin:calabaza'].map(pair => { const [id, name] = pair.split(':'); const chileParents = { fresh_chile: 'chile', serrano_chile: 'fresh_chile', jalapeno_chile: 'fresh_chile', habanero_chile: 'fresh_chile', poblano_chile: 'fresh_chile', dried_chile: 'chile', ancho_chile: 'dried_chile', guajillo_chile: 'dried_chile', morita_chile: 'dried_chile', pickled_chile: 'chile' }; return food(id, name, ['vegetable'], { aliases: id === 'red_tomato' ? ['jitomate', 'jitomates'] : id === 'tomatillo' ? ['tomate verde', 'tomates verdes', 'tomate', 'tomates', 'tomatillo', 'tomatillos'] : [name], parent: chileParents[id] || null, culinary_roles: ['side', 'filling', 'seasoning'], low_appetite_fit: 'high' }); }),
  // fruit/fat
  ...['avocado:aguacate', 'banana:plátano', 'apple:manzana', 'orange:naranja', 'mandarin:mandarina', 'papaya:papaya', 'mango:mango', 'pineapple:piña', 'strawberry:fresa', 'berries:frutos rojos', 'grapes:uvas', 'pear:pera', 'watermelon:sandía', 'melon:melón', 'guava:guayaba', 'peach:durazno', 'lime:limón'].map(pair => { const [id, name] = pair.split(':'); return food(id, name, id === 'avocado' ? ['fruit', 'fat'] : ['fruit'], { culinary_roles: ['topping', 'side', 'filling'], low_appetite_fit: 'high' }); }),
  ...['peanuts:cacahuates', 'almonds:almendras', 'walnuts:nueces', 'pumpkin_seeds:pepitas', 'chia:chía', 'sesame:ajonjolí'].map(pair => { const [id, name] = pair.split(':'); return food(id, name, ['nuts_seeds'], { culinary_roles: ['topping'], low_appetite_fit: 'high' }); }),
  // condiments and beverages
  ...['salsa:salsa', 'green_salsa:salsa verde', 'red_salsa:salsa roja', 'morita_salsa:salsa morita', 'molcajete_salsa:salsa de molcajete', 'pico_de_gallo:pico de gallo', 'guacamole:guacamole', 'cilantro:cilantro', 'soy_sauce:salsa de soya', 'mustard:mostaza', 'mayonnaise:mayonesa', 'vinegar:vinagre', 'ketchup:catsup', 'cooking_oil:aceite para cocinar'].map(pair => { const [id, name] = pair.split(':'); return food(id, name, ['condiment'], { aliases: id === 'ketchup' ? ['catsup', 'ketchup'] : [name], parent: ['green_salsa', 'red_salsa', 'morita_salsa', 'molcajete_salsa'].includes(id) ? 'salsa' : null, culinary_roles: ['sauce', 'seasoning', 'topping'], prep_effort: 'none' }); }),
  ...['water:agua', 'coffee:café', 'tea:té', 'sparkling_water:agua mineral', 'fruit_juice:jugo de fruta', 'soft_drink:refresco'].map(pair => { const [id, name] = pair.split(':'); return food(id, name, ['beverage'], { culinary_roles: ['beverage'], prep_effort: 'none' }); }),
];

const DISHES = [
  ['picadillo', 'picadillo'], ['chicken_with_mole', 'pollo con mole'], ['vegetable_soup', 'sopa de verduras'], ['chicken_soup', 'caldo de pollo'], ['lentil_soup', 'sopa de lentejas'], ['bean_soup', 'sopa de frijoles'], ['caldo_de_res', 'caldo de res'], ['tinga', 'tinga'], ['chicken_tinga', 'tinga de pollo'], ['rice_with_chicken', 'arroz con pollo'], ['chilaquiles', 'chilaquiles'], ['enchiladas', 'enchiladas'], ['quesadillas', 'quesadillas'], ['tacos', 'tacos'], ['rajas_with_cream', 'rajas con crema'], ['flautas', 'flautas'], ['cochinita_pibil', 'cochinita pibil'], ['pozole', 'pozole'], ['tamales', 'tamales'],
].map(([id, display_name]) => food(id, display_name, [], { type: 'prepared_dish', culinary_roles: ['main'], default_readiness: 'ready_to_eat', prep_effort: 'none', low_appetite_fit: 'medium' }));
const ONTOLOGY = Object.freeze(Object.fromEntries([...FOODS, ...DISHES].map(item => [item.id, item])));

// V1.1 keeps recipes small, but makes each declared archetype executable.
// Archetypes choose only grounded slots; rendering derives solely from those slots.
const ARCHETYPE_SPECS = Object.freeze([
  { id: 'taco', mode: 'construct', profile: 'savory_handheld', specificity: 3, slots: [{ name: 'base', required: true, foods: ['corn_tortilla', 'flour_tortilla'] }, { name: 'filling', required: true, profile: 'savory_filling' }, { name: 'topping', max: 1, priority_foods: ['green_salsa', 'red_salsa', 'pickled_chile', 'avocado'], profile: 'taco_topping' }] },
  { id: 'quesadilla', mode: 'construct', profile: 'savory_handheld', specificity: 2, required_transformations: ['heat'], slots: [{ name: 'base', required: true, foods: ['corn_tortilla', 'flour_tortilla'] }, { name: 'cheese', required: true, profile: 'cheese' }, { name: 'filling', max: 1, profile: 'savory_vegetable' }] },
  { id: 'tostada', mode: 'construct', profile: 'savory_handheld', specificity: 4, slots: [{ name: 'base', required: true, foods: ['tostada'] }, { name: 'filling', required: true, profile: 'savory_tostada_filling' }, { name: 'topping', max: 1, priority_foods: ['pickled_chile', 'avocado', 'red_tomato'], profile: 'savory_topping' }] },
  { id: 'flauta', mode: 'complement', profile: 'prepared_only', specificity: 4, slots: [{ name: 'prepared', required: true, foods: ['flautas'] }] },
  { id: 'chilaquiles', mode: 'construct', profile: 'savory_handheld', specificity: 3, slots: [{ name: 'base', required: true, foods: ['tostada'] }, { name: 'sauce', required: true, foods: ['green_salsa', 'red_salsa'] }, { name: 'cheese', required: true, profile: 'cheese' }] },
  { id: 'scrambled_eggs', mode: 'construct', profile: 'egg_dish', specificity: 2, slots: [{ name: 'egg', required: true, foods: ['egg'] }, { name: 'vegetable', max: 1, profile: 'savory_vegetable' }] },
  { id: 'huevos_a_la_mexicana', mode: 'construct', profile: 'egg_dish', specificity: 5, required_foods: ['egg', 'red_tomato', 'onion'], slots: [{ name: 'egg', required: true, foods: ['egg'] }, { name: 'tomato', required: true, foods: ['red_tomato'] }, { name: 'onion', required: true, foods: ['onion'] }, { name: 'chile', max: 1, prefer_present: true, foods: ['serrano_chile', 'jalapeno_chile', 'habanero_chile'] }] },
  { id: 'omelette', mode: 'construct', profile: 'egg_dish', specificity: 4, slots: [{ name: 'egg', required: true, foods: ['egg'] }, { name: 'vegetable', required: true, profile: 'savory_vegetable' }, { name: 'cheese', required: true, profile: 'cheese' }] },
  { id: 'egg_plate', mode: 'fallback', profile: 'savory_plate', specificity: 1, slots: [{ name: 'main', required: true, profile: 'primary' }, { name: 'base', required: true, foods: ['corn_tortilla', 'flour_tortilla'] }] },
  { id: 'sandwich', mode: 'construct', profile: 'savory_handheld', specificity: 4, slots: [{ name: 'base', required: true, foods: ['bread', 'whole_grain_bread', 'bolillo'] }, { name: 'filling', required: true, profile: 'sandwich_primary' }, { name: 'topping', max: 2, profile: 'savory_topping' }] },
  { id: 'toast', mode: 'construct', profile: 'savory_handheld', specificity: 3, slots: [{ name: 'base', required: true, foods: ['bread', 'whole_grain_bread'] }, { name: 'filling', required: true, foods: ['egg'] }, { name: 'topping', max: 1, foods: ['avocado'] }] },
  { id: 'mollete', mode: 'construct', profile: 'savory_handheld', specificity: 5, slots: [{ name: 'base', required: true, foods: ['bolillo'] }, { name: 'beans', required: true, profile: 'legume' }, { name: 'cheese', required: true, profile: 'cheese' }, { name: 'topping', max: 1, foods: ['pico_de_gallo', 'green_salsa', 'red_salsa'] }] },
  { id: 'plato_casero', mode: 'fallback', profile: 'savory_plate', specificity: 3, slots: [{ name: 'main', required: true, profile: 'primary_or_prepared' }, { name: 'starch', required: true, foods: ['rice', 'brown_rice', 'potato', 'sweet_potato', 'pasta'] }, { name: 'vegetable', max: 1, profile: 'savory_vegetable' }] },
  { id: 'rice_bowl', mode: 'construct', profile: 'savory_plate', specificity: 2, slots: [{ name: 'base', required: true, foods: ['rice', 'brown_rice'] }, { name: 'main', required: true, profile: 'primary' }, { name: 'vegetable', max: 1, profile: 'savory_vegetable' }] },
  { id: 'complete_salad', mode: 'construct', profile: 'savory_plate', specificity: 2, slots: [{ name: 'base', required: true, foods: ['lettuce', 'cabbage'] }, { name: 'main', required: true, profile: 'primary' }, { name: 'vegetable', required: true, profile: 'savory_vegetable' }] },
  { id: 'warm_vegetable_plate', mode: 'fallback', profile: 'savory_plate', specificity: 2, slots: [{ name: 'main', required: true, profile: 'cheese' }, { name: 'vegetable', required: true, profile: 'savory_vegetable' }] },
  { id: 'beans_with_accompaniment', mode: 'fallback', profile: 'savory_plate', specificity: 2, slots: [{ name: 'beans', required: true, profile: 'legume' }, { name: 'base', required: true, foods: ['corn_tortilla', 'flour_tortilla'] }] },
  { id: 'lentil_preparation', mode: 'fallback', profile: 'savory_plate', specificity: 2, slots: [{ name: 'lentils', required: true, foods: ['lentils'] }, { name: 'vegetable', max: 1, profile: 'savory_vegetable' }] },
  { id: 'yogurt_bowl', mode: 'construct', profile: 'sweet_bowl', specificity: 3, slots: [{ name: 'yogurt', required: true, foods: ['greek_yogurt', 'plain_yogurt'] }, { name: 'fruit', required: true, profile: 'sweet_fruit' }, { name: 'nuts', max: 1, profile: 'nuts' }, { name: 'energy', max: 1, foods: ['bread', 'whole_grain_bread'] }] },
  { id: 'oatmeal', mode: 'construct', profile: 'sweet_bowl', specificity: 2, slots: [{ name: 'oats', required: true, foods: ['oats'] }, { name: 'fruit', required: true, profile: 'sweet_fruit' }, { name: 'liquid', max: 1, foods: ['milk'] }] },
  { id: 'licuado', mode: 'construct', profile: 'sweet_bowl', specificity: 2, slots: [{ name: 'liquid', required: true, foods: ['milk'] }, { name: 'fruit', required: true, profile: 'sweet_fruit' }, { name: 'oats', max: 1, foods: ['oats'] }] },
  { id: 'soup_complement', mode: 'complement', profile: 'soup_complement', specificity: 4, slots: [{ name: 'soup', required: true, foods: ['vegetable_soup', 'chicken_soup', 'lentil_soup', 'bean_soup', 'caldo_de_res'] }, { name: 'main', required: true, profile: 'primary' }, { name: 'base', required: true, foods: ['corn_tortilla', 'flour_tortilla'] }] },
  { id: 'prepared_dish_complement', mode: 'complement', profile: 'prepared_only', specificity: 4, slots: [{ name: 'prepared', required: true, profile: 'prepared' }] },
].map(item => Object.freeze({ ...item, slots: Object.freeze(item.slots.map(slot => Object.freeze({ ...slot }))) })));
const ARCHETYPES = ARCHETYPE_SPECS;
const ARCHETYPE_IDS = new Set(ARCHETYPES.map(item => item.id));
const PREPARED_IDS = new Set(DISHES.map(item => item.id));
const HANDHELD_PREPARED_IDS = new Set(['picadillo', 'cochinita_pibil', 'rajas_with_cream', 'tinga', 'chicken_tinga']);
const QUICK_COOK_IDS = new Set(['egg']);
const SAVORY_FRUIT_IDS = new Set(['avocado', 'lime']);
const SWEET_FRUIT_IDS = new Set(['banana', 'apple', 'orange', 'mandarin', 'papaya', 'mango', 'pineapple', 'strawberry', 'berries', 'grapes', 'pear', 'watermelon', 'melon', 'guava', 'peach']);
const CHEESE_IDS = new Set(['panela_cheese', 'oaxaca_cheese', 'fresh_cheese', 'manchego_cheese']);
const SAVORY_DAIRY_IDS = new Set([...CHEESE_IDS, 'cottage_cheese']);
const YOGURT_IDS = new Set(['greek_yogurt', 'plain_yogurt']);
const PRIMARY_IDS = new Set(Object.values(ONTOLOGY).filter(record => record.protein_role === 'primary').map(record => record.id));

function normalizeFood(input) {
  if (typeof input === 'string') return ONTOLOGY[input] ? { food_id: input, surface_form: ONTOLOGY[input].display_name, state: {}, source: 'available_foods' } : { food_id: null, surface_form: input, recognition: 'unknown_food', source: 'available_foods', state: {} };
  if (!input || typeof input !== 'object') return { food_id: null, surface_form: String(input), recognition: 'unknown_food', source: 'available_foods', state: {} };
  return { ...input, food_id: ONTOLOGY[input.food_id] ? input.food_id : null, recognition: ONTOLOGY[input.food_id] ? 'known_food' : 'unknown_food', state: input.state || {} };
}
function ancestors(id) {
  const result = new Set(); let current = id;
  while (current && ONTOLOGY[current] && !result.has(current)) { result.add(current); current = ONTOLOGY[current].parent; }
  return result;
}
function isDescendantOf(id, target) { return ancestors(id).has(target); }
function isReady(item) {
  const record = ONTOLOGY[item.food_id];
  return Boolean(item?.state?.cooked || item?.state?.canned || item?.state?.readiness === 'ready_to_eat' || record.default_readiness === 'ready_to_eat');
}
function requiredCookTransformation(id) {
  if (id === 'egg') return 'cook_egg';
  if (ONTOLOGY[id]?.groups.includes('legume')) return 'cook_legume';
  if (ONTOLOGY[id]?.groups.includes('grain_starch')) return 'cook_grain';
  return 'cook_main';
}
function canUse(item, horizon, transformations) {
  if (isReady(item)) return true;
  const record = ONTOLOGY[item.food_id];
  if (record.default_readiness === 'requires_long_prep') return horizon !== 'immediate' && transformations.includes(requiredCookTransformation(item.food_id));
  if (record.default_readiness !== 'requires_cooking') return true;
  if (horizon === 'immediate') return QUICK_COOK_IDS.has(item.food_id) && transformations.includes('cook_egg');
  return transformations.includes(requiredCookTransformation(item.food_id));
}
function recordHas(id, group) { return Boolean(ONTOLOGY[id]?.groups.includes(group)); }
function display(id) { return ONTOLOGY[id].display_name; }
function foodListName(ids) { return ids.map(display).join(' y '); }
// Rendering is a structured projection of a grounded candidate. Food-bearing
// parts are the authority; text is a cache reconstructed from those parts.
// This deliberately avoids trying to recover food identities by substring
// scanning natural language (for example, `col` in `brócoli`). Prepared dishes
// are atomic food parts and are never expanded into presumed components.
function renderCandidate(archetype, ingredients) {
  const parts = [];
  const literal = text => parts.push({ type: 'literal', text });
  const ref = (id, text = display(id), atomic = PREPARED_IDS.has(id)) => {
    parts.push({ type: 'food', food_id: id, text, atomic });
  };
  const foodList = ids => ids.forEach((id, index) => { if (index) literal(' y '); ref(id); });
  const main = ingredients.find(id => PRIMARY_IDS.has(id) || recordHas(id, 'legume') || SAVORY_DAIRY_IDS.has(id) || PREPARED_IDS.has(id));
  const veggie = ingredients.find(id => recordHas(id, 'vegetable') && !id.includes('chile'));
  const sweetFruit = ingredients.find(id => SWEET_FRUIT_IDS.has(id));
  const nuts = ingredients.find(id => recordHas(id, 'nuts_seeds'));
  if (archetype === 'huevos_a_la_mexicana') {
    const chile = ingredients.find(id => isDescendantOf(id, 'fresh_chile'));
    literal(''); ref('egg', 'huevos'); literal(' a la mexicana con '); ref('red_tomato'); literal(' y '); ref('onion'); if (chile) { literal(' y '); ref(chile); }
  } else if (archetype === 'omelette') {
    const cheese = ingredients.find(id => CHEESE_IDS.has(id));
    literal('omelette de '); ref('egg', 'huevo'); literal(' con '); ref(veggie); literal(' y '); ref(cheese);
  } else if (archetype === 'scrambled_eggs') {
    ref('egg', 'huevos'); literal(' revueltos'); if (veggie) { literal(' con '); ref(veggie); }
  } else if (archetype === 'taco') {
    literal(ingredients.some(id => PREPARED_IDS.has(id)) ? 'tacos de ' : 'taco de '); ref(main); if (ingredients.includes('avocado')) { literal(' con '); ref('avocado'); } if (ingredients.includes('green_salsa')) { literal(' con '); ref('green_salsa'); }
  } else if (archetype === 'quesadilla') {
    literal('quesadilla de '); ref(veggie || main);
  } else if (archetype === 'tostada') {
    literal('tostada de '); ref(main); if (ingredients.includes('avocado')) { literal(' con '); ref('avocado'); }
  } else if (archetype === 'sandwich') {
    literal('sándwich de '); ref(main); if (ingredients.includes('avocado')) { literal(' con '); ref('avocado'); }
  } else if (archetype === 'toast') {
    ref(ingredients.find(id => id === 'bread' || id === 'whole_grain_bread')); literal(' tostado con '); ref(main); if (ingredients.includes('avocado')) { literal(' y '); ref('avocado'); }
  } else if (archetype === 'mollete') {
    const beans = ingredients.find(id => recordHas(id, 'legume')); const cheese = ingredients.find(id => CHEESE_IDS.has(id));
    literal('mollete de '); ref('bolillo'); literal(' con '); ref(beans); literal(' y '); ref(cheese);
  } else if (archetype === 'chilaquiles') {
    const base = ingredients.find(id => id === 'tostada'); const sauce = ingredients.find(id => isDescendantOf(id, 'salsa')); const cheese = ingredients.find(id => CHEESE_IDS.has(id));
    literal('chilaquiles de '); ref(base); literal(' con '); ref(sauce); literal(' y '); ref(cheese);
  } else if (archetype === 'plato_casero') {
    ref(main); literal(' con '); foodList(ingredients.filter(id => id !== main));
  } else if (archetype === 'rice_bowl') {
    literal('tazón de '); ref(ingredients.find(id => id === 'rice' || id === 'brown_rice')); literal(' con '); ref(main);
  } else if (archetype === 'beans_with_accompaniment') {
    ref(ingredients.find(id => recordHas(id, 'legume'))); literal(' con '); ref(ingredients.find(id => id === 'corn_tortilla' || id === 'flour_tortilla'));
  } else if (archetype === 'lentil_preparation') {
    ref('lentils'); literal(' cocidas'); if (veggie) { literal(' con '); ref(veggie); }
  } else if (archetype === 'yogurt_bowl') {
    const energy = ingredients.find(id => id === 'bread' || id === 'whole_grain_bread');
    literal('tazón de '); ref(ingredients.find(id => id === 'greek_yogurt' || id === 'plain_yogurt')); literal(' con '); foodList([sweetFruit, nuts].filter(Boolean));
    if (energy) { literal(', acompañado de '); ref(energy); }
  } else if (archetype === 'oatmeal') {
    ref('oats'); literal(' con '); ref(sweetFruit); if (ingredients.includes('milk')) { literal(' y '); ref('milk'); }
  } else if (archetype === 'licuado') {
    literal('licuado de '); foodList(ingredients.filter(id => id !== 'milk')); literal(' con '); ref('milk');
  } else if (archetype === 'soup_complement') {
    ref(ingredients[0]); literal(' con '); foodList(ingredients.slice(1));
  } else if (archetype === 'prepared_dish_complement' || archetype === 'flauta') {
    ref(ingredients[0], display(ingredients[0]), true);
  } else if (archetype === 'complete_salad') {
    literal('ensalada completa de '); ref(main); literal(' con '); foodList(ingredients.filter(id => id !== main));
  } else if (archetype === 'warm_vegetable_plate') {
    ref(veggie); literal(' caliente con '); ref(main);
  } else {
    ref(main); literal(' con '); foodList(ingredients.filter(id => id !== main));
  }
  return { template: archetype, parts, text: renderParts(parts) };
}
function renderedFoodIds(candidate) {
  return [...new Set(candidate?.rendering?.parts?.filter(part => part.type === 'food').map(part => part.food_id) || [])];
}
function renderParts(parts) { return parts.map(part => part.text).join(''); }
function authorizedFoodText(id, text) {
  const representations = new Set();
  for (const ancestor of ancestors(id)) {
    const record = ONTOLOGY[ancestor];
    representations.add(record.display_name);
    for (const alias of record.aliases || []) representations.add(alias);
  }
  return representations.has(text);
}
function sameRenderingParts(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((part, index) => {
      const other = right[index];
      return part?.type === other?.type
        && part?.text === other?.text
        && part?.food_id === other?.food_id
        && Boolean(part?.atomic) === Boolean(other?.atomic);
    });
}
function validateRenderedCandidate(candidate) {
  const rendering = candidate?.rendering;
  const named = renderedFoodIds(candidate);
  const parts = rendering?.parts;
  if (!Array.isArray(candidate?.ingredients) || !candidate.ingredients.every(id => ONTOLOGY[id])) return { valid: false, named_food_ids: named };
  let canonical;
  try {
    // The archetype renderer is the closed grammar registry. Reconstructing
    // from it rejects arbitrary literals, foreign templates, altered order,
    // omitted slots, extra bindings, and caller-controlled atomicity.
    canonical = renderCandidate(candidate.archetype, candidate.ingredients);
  } catch (_) {
    return { valid: false, named_food_ids: named };
  }
  const reconstructed = canonical.text;
  const valid = Boolean(rendering && rendering.template === candidate.archetype && candidate?.name === reconstructed && rendering.text === reconstructed && sameRenderingParts(parts, canonical.parts))
    && canonical.parts.every(part => {
      if (!part || (part.type !== 'literal' && part.type !== 'food') || typeof part.text !== 'string') return false;
      if (part.type === 'literal') return true;
      if (!ONTOLOGY[part.food_id] || !part.text || !authorizedFoodText(part.food_id, part.text)) return false;
      if (part.atomic && ONTOLOGY[part.food_id].type !== 'prepared_dish') return false;
      return PANTRY.has(part.food_id) || (candidate.ingredients || []).some(candidateId => isDescendantOf(candidateId, part.food_id));
    });
  return { valid, named_food_ids: named };
}
function makeCandidate(archetype, ingredients, transformations, options = {}) {
  const uniqueIngredients = [...new Set(ingredients)];
  const rendering = renderCandidate(archetype, uniqueIngredients);
  // named_ingredients remains the historical full-composition field for
  // harness compatibility. `rendering.parts` is the independent,
  // reconstructible customer-visible contract.
  return { archetype, name: rendering.text, rendering, named_ingredients: uniqueIngredients, ingredients: uniqueIngredients, transformations: [...new Set(transformations)], specificity: options.specificity || 1, prepared: Boolean(options.prepared), mode: ARCHETYPE_SPECS.find(item => item.id === archetype)?.mode || 'construct' };
}
function candidateSignature(candidate) {
  // A protein/legume/cheese anchor with the same grain base is the same
  // practical assembly even when one variant adds a garnish such as avocado.
  const anchor = candidate.ingredients.find(id => PRIMARY_IDS.has(id) || recordHas(id, 'legume') || SAVORY_DAIRY_IDS.has(id) || PREPARED_IDS.has(id));
  const base = candidate.ingredients.find(id => recordHas(id, 'grain_starch'));
  return anchor && base ? `assembly:${anchor}|${base}` : candidate.ingredients.slice().sort().join('|');
}
function candidateTransformations(ingredients, byId) {
  const transformations = ['assemble'];
  for (const id of ingredients) if (!isReady(byId.get(id))) transformations.push(requiredCookTransformation(id));
  return transformations;
}
function candidateIsReady(candidate, context, byId) { return candidate.ingredients.every(id => canUse(byId.get(id), context.decision_horizon, candidate.transformations)); }
function availableBy(ids, predicate) { return ids.filter(predicate); }
function choose(ids, predicate) { return ids.filter(predicate).sort((a, b) => a.localeCompare(b, 'es-MX'))[0] || null; }

function matchesSlot(id, slot) {
  const record = ONTOLOGY[id];
  if (!record || (slot.foods && !slot.foods.includes(id) && !slot.profile)) return false;
  switch (slot.profile) {
    case 'primary': return PRIMARY_IDS.has(id);
    case 'sandwich_primary': return (PRIMARY_IDS.has(id) && id !== 'egg') || SAVORY_DAIRY_IDS.has(id);
    case 'primary_or_prepared': return PRIMARY_IDS.has(id) || record.type === 'prepared_dish';
    case 'prepared': return record.type === 'prepared_dish';
    case 'legume': return record.groups.includes('legume');
    case 'cheese': return CHEESE_IDS.has(id);
    case 'sweet_fruit': return SWEET_FRUIT_IDS.has(id);
    case 'nuts': return record.groups.includes('nuts_seeds');
    case 'savory_vegetable': return record.groups.includes('vegetable') && !id.includes('chile') && !['red_tomato', 'onion'].includes(id);
    case 'savory_filling': return PRIMARY_IDS.has(id) || record.groups.includes('legume') || SAVORY_DAIRY_IDS.has(id) || HANDHELD_PREPARED_IDS.has(id);
    case 'savory_tostada_filling': return PRIMARY_IDS.has(id) || record.groups.includes('legume') || HANDHELD_PREPARED_IDS.has(id);
    case 'savory_topping': return SAVORY_FRUIT_IDS.has(id) || record.groups.includes('vegetable') || record.groups.includes('condiment');
    case 'taco_topping': return SAVORY_FRUIT_IDS.has(id) || record.groups.includes('condiment') || id === 'pickled_chile' || isDescendantOf(id, 'fresh_chile') || ['cucumber', 'cabbage', 'nopal'].includes(id);
    default: return slot.foods ? slot.foods.includes(id) : false;
  }
}
function compatibilityValid(profile, assignments) {
  const ids = Object.values(assignments).flat();
  const records = ids.map(id => ONTOLOGY[id]);
  if (!records.length) return false;
  if (profile === 'sweet_bowl') return !ids.some(id => recordHas(id, 'condiment') || recordHas(id, 'vegetable') || PRIMARY_IDS.has(id));
  if (profile === 'savory_handheld' || profile === 'savory_plate' || profile === 'egg_dish' || profile === 'soup_complement') return !ids.some(id => SWEET_FRUIT_IDS.has(id));
  if (profile === 'prepared_only') return records.every(record => record.type === 'prepared_dish');
  return true;
}
function slotChoices(spec, slot, ids, context, byId) {
  const choices = ids.filter(id => matchesSlot(id, slot)).filter(id => {
    const transforms = candidateTransformations([id], byId);
    return canUse(byId.get(id), context.decision_horizon, transforms);
  }).sort((a, b) => {
    const order = slot.priority_foods || []; const left = order.indexOf(a); const right = order.indexOf(b);
    if (left >= 0 || right >= 0) return (left < 0 ? Number.MAX_SAFE_INTEGER : left) - (right < 0 ? Number.MAX_SAFE_INTEGER : right);
    return a.localeCompare(b, 'es-MX');
  });
  if (slot.required) return choices.slice(0, 2).map(id => [id]);
  if (!slot.max) return [[]];
  // Bound optional resolution: leave it empty, then consider only the two
  // strongest deterministic slot fits. This avoids Cartesian-product growth.
  const populated = choices.slice(0, Math.min(slot.max, 2)).map(id => [id]);
  return slot.prefer_present && populated.length ? populated.concat([[]]) : [[]].concat(populated);
}
function resolveArchetype(spec, context, available, byId) {
  const ids = [...available];
  if (spec.required_foods && !spec.required_foods.every(id => available.has(id))) return [];
  let partials = [{}];
  for (const slot of spec.slots) {
    const choices = slotChoices(spec, slot, ids, context, byId);
    if (slot.required && !choices.length) return [];
    partials = partials.flatMap(partial => choices.map(choice => ({ ...partial, [slot.name]: choice }))).slice(0, 12);
  }
  return partials.filter(assignments => compatibilityValid(spec.profile, assignments)).map(assignments => {
    const ingredients = Object.values(assignments).flat();
    const optionalFit = spec.slots.filter(slot => !slot.required && assignments[slot.name]?.length).length;
    const transformations = candidateTransformations(ingredients, byId).concat(spec.required_transformations || []);
    const candidate = makeCandidate(spec.id, ingredients, transformations, { specificity: spec.specificity + optionalFit, prepared: ingredients.some(id => PREPARED_IDS.has(id)) });
    return candidateIsReady(candidate, context, byId) ? candidate : null;
  }).filter(Boolean);
}
// Enumerate declarative archetypes; no food-combination-specific generation
// lives here. Per-archetype slots and compatibility profiles carry that knowledge.
function candidateRecipes(context, available, byId) {
  return ARCHETYPE_SPECS.flatMap(spec => resolveArchetype(spec, context, available, byId));
}

function normalizeRejections(context) {
  const foodIds = new Set(); const archetypes = new Set(context.suppressed_archetypes || []); const signatures = new Set();
  for (const value of context.contextual_rejections || []) {
    const item = typeof value === 'string' ? { value } : value || {};
    const scope = item.scope || null; const raw = item.value || item.id || item.food_id;
    if (!raw) continue;
    if (scope === 'archetype' || ARCHETYPE_IDS.has(raw) || raw === 'tacos') archetypes.add(raw === 'tacos' ? 'taco' : raw);
    else if (scope === 'candidate_signature') signatures.add(raw);
    else if (ONTOLOGY[raw]) foodIds.add(raw);
  }
  if (context.previous_candidate) {
    if (Array.isArray(context.previous_candidate.ingredients) && context.previous_candidate.ingredients.length) signatures.add(candidateSignature(context.previous_candidate));
    else if (context.previous_candidate.archetype) archetypes.add(context.previous_candidate.archetype);
  }
  return { foodIds, archetypes, signatures };
}
function hasConstraint(candidate, ids) { return candidate.ingredients.some(id => [...ids].some(blocked => isDescendantOf(id, blocked))); }
function hasSubstantiveMealAnchor(record) {
  return PRIMARY_IDS.has(record.id) || record.groups.includes('legume') || record.type === 'prepared_dish'
    || SAVORY_DAIRY_IDS.has(record.id) || record.id === 'greek_yogurt';
}
function hasProteinOpportunity(record) {
  return hasSubstantiveMealAnchor(record) || record.id === 'plain_yogurt';
}
function isContextuallyViableLightMeal(candidate, records, context) {
  // A yogurt-and-fruit bowl is a coherent, grounded light eating occasion.
  // It is not promoted to a high-hunger meal, and it never relaxes viability
  // for condiment-only or arbitrary small assemblies.
  if (context.appetite === 'high' || candidate.archetype !== 'yogurt_bowl'
    || !records.some(record => YOGURT_IDS.has(record.id))
    || !records.some(record => record.groups.includes('fruit'))) return false;
  if (context.appetite === 'low' || context.appetite === 'variable') return true;
  return records.some(record => record.groups.includes('grain_starch'));
}
function isSubstantialHighHungerYogurtBowl(candidate, records) {
  // High hunger cannot be satisfied by yogurt's generic anchor status alone.
  // A bowl is only viable when its existing grammar supplies the qualitative
  // protein, fruit, energy, and nuts/seeds contributions of a substantial
  // eating occasion.
  return candidate.archetype === 'yogurt_bowl'
    && records.some(record => YOGURT_IDS.has(record.id))
    && records.some(record => record.groups.includes('fruit'))
    && records.some(record => record.groups.includes('grain_starch'))
    && records.some(record => record.groups.includes('nuts_seeds'));
}
function hardFailure(candidate, context, available, byId, rejection = normalizeRejections(context)) {
  if (rejection.archetypes.has(candidate.archetype) || rejection.signatures.has(candidateSignature(candidate))) return 'contextual_rejection';
  for (const id of candidate.ingredients) {
    if (!available.has(id) && !PANTRY.has(id)) return 'required_ingredient_unavailable';
    if (hasConstraint({ ingredients: [id] }, rejection.foodIds) || hasConstraint({ ingredients: [id] }, new Set(context.confirmed_constraints || []))) return 'constraint_violated';
    if (!canUse(byId.get(id), context.decision_horizon, candidate.transformations)) return 'readiness_incompatible';
  }
  const records = candidate.ingredients.map(id => ONTOLOGY[id]);
  // A yogurt bowl remains an intentionally light eating occasion. Even Greek
  // yogurt must not bypass high-hunger context through the generic anchor;
  // the existing bowl grammar must itself provide substantial components.
  const substantialHighHungerYogurtBowl = isSubstantialHighHungerYogurtBowl(candidate, records);
  if (candidate.archetype === 'yogurt_bowl' && context.appetite === 'high' && !substantialHighHungerYogurtBowl) return 'insufficient_meal_substance';
  if (!records.some(hasSubstantiveMealAnchor) && !isContextuallyViableLightMeal(candidate, records, context) && !substantialHighHungerYogurtBowl && !['oatmeal', 'licuado'].includes(candidate.archetype)) return 'insufficient_meal_substance';
  if (!candidate.ingredients.every(id => ONTOLOGY[id])) return 'composition_not_grounded';
  // Customer-visible composition is a hard grounding invariant, not a
  // test-only assertion. Future renderers must pass this same contract.
  if (!validateRenderedCandidate(candidate).valid) return 'rendered_output_not_grounded';
  return null;
}
function score(candidate, context) {
  const records = candidate.ingredients.map(id => ONTOLOGY[id]);
  const hasProtein = records.some(hasProteinOpportunity);
  const hasPlant = records.some(record => record.groups.includes('vegetable') || record.groups.includes('fruit'));
  const hasEnergy = records.some(record => record.groups.includes('grain_starch'));
  const components = candidate.ingredients.length;
  const low = context.appetite === 'low' || context.appetite === 'variable';
  const recent = new Set(context.recently_consumed || []);
  const repeated = candidate.ingredients.some(id => [...recent].some(value => ONTOLOGY[value] && isDescendantOf(id, value))) || (candidate.archetype === 'taco' && recent.has('tacos'));
  const dimensions = {
    ingredient_grounding: 20,
    culinary_coherence: Math.min(20, 10 + candidate.specificity * 2 + (candidate.prepared ? 2 : 0)),
    nutritional_usefulness: Math.min(20, (hasProtein ? 10 : 0) + (hasPlant ? 5 : 0) + (hasEnergy ? 5 : 0)),
    appetite_context_fit: low ? (components <= 3 ? 15 : 9) : context.appetite === 'high' ? (hasProtein && hasEnergy ? 15 : 9) : 12,
    cultural_familiarity: ['taco', 'quesadilla', 'mollete', 'huevos_a_la_mexicana', 'tostada', 'plato_casero', 'beans_with_accompaniment'].includes(candidate.archetype) ? 10 : 7,
    practicality: candidate.transformations.some(step => step.startsWith('cook_')) ? 6 : candidate.prepared ? 10 : 9,
    variety: repeated ? 0 : 5,
  };
  const value = Object.values(dimensions).reduce((sum, amount) => sum + amount, 0);
  const reason_codes = ['grounded_inventory', `coherent_${candidate.archetype}`];
  if (hasProtein) reason_codes.push('protein_anchor');
  if (hasPlant) reason_codes.push('plant_food');
  if (low && components <= 3) reason_codes.push('low_appetite_fit');
  if (context.appetite === 'high' && hasEnergy) reason_codes.push('substantial_meal');
  if (candidate.prepared) reason_codes.push('prepared_dish_ready');
  if (repeated) reason_codes.push('recent_repetition_penalty');
  return { score: Math.min(100, value), dimensions, reason_codes };
}
function inspectCandidates(rawContext = {}) {
  const context = { appetite: 'unknown', decision_horizon: 'immediate', locale: 'es-MX', recently_consumed: [], confirmed_constraints: [], contextual_rejections: [], ...rawContext };
  const items = (context.available_foods || []).map(normalizeFood); const available = new Set(items.filter(item => item.food_id).map(item => item.food_id));
  const byId = new Map(items.filter(item => item.food_id).map(item => [item.food_id, item])); const rejection = normalizeRejections(context);
  const rows = candidateRecipes(context, available, byId).map(candidate => {
    const signature = candidateSignature(candidate); const preliminaryFailure = hardFailure(candidate, context, available, byId, rejection);
    const scored = score(candidate, context); return { candidate, signature, failure: preliminaryFailure || null, ...scored };
  });
  const winners = new Map();
  for (const row of rows.filter(row => !row.failure)) {
    const existing = winners.get(row.signature);
    if (!existing || row.score > existing.score || (row.score === existing.score && row.candidate.specificity > existing.candidate.specificity) || (row.score === existing.score && row.candidate.specificity === existing.candidate.specificity && row.candidate.name.localeCompare(existing.candidate.name, 'es-MX') < 0)) winners.set(row.signature, row);
  }
  for (const row of rows) if (!row.failure && winners.get(row.signature) !== row) row.failure = 'equivalent_candidate';
  return rows;
}
function validateCandidate(candidate, rawContext = {}) {
  const context = { appetite: 'unknown', decision_horizon: 'immediate', locale: 'es-MX', recently_consumed: [], confirmed_constraints: [], contextual_rejections: [], ...rawContext };
  const items = (context.available_foods || []).map(normalizeFood);
  const available = new Set(items.filter(item => item.food_id).map(item => item.food_id));
  const byId = new Map(items.filter(item => item.food_id).map(item => [item.food_id, item]));
  const failure = hardFailure(candidate, context, available, byId);
  return { valid: !failure, failure: failure || null };
}
function recommend(rawContext = {}) {
  if (rawContext.medical_or_policy_boundary) return { status: 'route_to_policy', reason: 'medical_or_policy_boundary' };
  const context = { appetite: 'unknown', decision_horizon: 'immediate', locale: 'es-MX', recently_consumed: [], confirmed_constraints: [], contextual_rejections: [], ...rawContext };
  const items = (context.available_foods || []).map(normalizeFood);
  const diagnostics = inspectCandidates(context); const candidates = diagnostics.filter(item => !item.failure);
  if (!candidates.length) return { status: 'needs_clarification', reason: items.some(item => item.food_id && !isReady(item) && context.decision_horizon === 'immediate') ? 'preparation_not_immediate' : 'insufficient_meal_substance', unknown_foods: items.filter(item => !item.food_id).map(item => item.surface_form) };
  candidates.sort((a, b) => b.score - a.score || b.candidate.specificity - a.candidate.specificity || a.candidate.name.localeCompare(b.candidate.name, 'es-MX'));
  const winner = candidates[0]; const low = context.appetite === 'low' || context.appetite === 'variable';
  return { status: 'recommendation', candidate: winner.candidate, portion_strategy: low ? 'start_small' : context.appetite === 'high' ? 'normal_plate' : 'normal_portion', score: winner.score, confidence: winner.score >= 75 ? 'high' : 'medium', reason_codes: winner.reason_codes, score_dimensions: winner.dimensions, unknown_foods: items.filter(item => !item.food_id).map(item => item.surface_form) };
}

module.exports = Object.freeze({ GROUPS, PANTRY: [...PANTRY], ONTOLOGY, ARCHETYPES, normalizeFood, ancestors, candidateSignature, inspectCandidates, renderedFoodIds, validateRenderedCandidate, validateCandidate, recommend });
