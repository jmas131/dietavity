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
  ...['red_tomato:jitomate', 'tomatillo:tomate verde', 'onion:cebolla', 'garlic:ajo', 'chile:chile', 'fresh_chile:chile fresco', 'serrano_chile:chile serrano', 'jalapeno_chile:chile jalapeño', 'habanero_chile:chile habanero', 'poblano_chile:chile poblano', 'dried_chile:chile seco', 'ancho_chile:chile ancho', 'guajillo_chile:chile guajillo', 'morita_chile:chile morita', 'pickled_chile:chile en vinagre', 'bell_pepper:pimiento morrón', 'zucchini:calabacita', 'nopal:nopal', 'spinach:espinaca', 'chard:acelga', 'quelites:quelites', 'broccoli:brócoli', 'cauliflower:coliflor', 'carrot:zanahoria', 'cucumber:pepino', 'lettuce:lechuga', 'cabbage:col', 'mushrooms:champiñones', 'green_beans:ejotes', 'chayote:chayote', 'celery:apio', 'pumpkin:calabaza'].map(pair => { const [id, name] = pair.split(':'); return food(id, name, ['vegetable'], { aliases: id === 'red_tomato' ? ['jitomate', 'jitomates'] : id === 'tomatillo' ? ['tomate verde', 'tomates verdes', 'tomate', 'tomates', 'tomatillo', 'tomatillos'] : [name], parent: id.endsWith('_chile') || id === 'fresh_chile' ? (id === 'fresh_chile' ? 'chile' : 'fresh_chile') : null, culinary_roles: ['side', 'filling', 'seasoning'], low_appetite_fit: 'high' }); }),
  // fruit/fat
  ...['avocado:aguacate', 'banana:plátano', 'apple:manzana', 'orange:naranja', 'mandarin:mandarina', 'papaya:papaya', 'mango:mango', 'pineapple:piña', 'strawberry:fresa', 'berries:frutos rojos', 'grapes:uvas', 'pear:pera', 'watermelon:sandía', 'melon:melón', 'guava:guayaba', 'peach:durazno', 'lime:limón'].map(pair => { const [id, name] = pair.split(':'); return food(id, name, id === 'avocado' ? ['fruit', 'fat'] : ['fruit'], { culinary_roles: ['topping', 'side', 'filling'], low_appetite_fit: 'high' }); }),
  ...['peanuts:cacahuates', 'almonds:almendras', 'walnuts:nueces', 'pumpkin_seeds:pepitas', 'chia:chía', 'sesame:ajonjolí'].map(pair => { const [id, name] = pair.split(':'); return food(id, name, ['nuts_seeds'], { culinary_roles: ['topping'], low_appetite_fit: 'high' }); }),
  // condiments and beverages
  ...['salsa:salsa', 'green_salsa:salsa verde', 'red_salsa:salsa roja', 'morita_salsa:salsa morita', 'molcajete_salsa:salsa de molcajete', 'pico_de_gallo:pico de gallo', 'guacamole:guacamole', 'cilantro:cilantro', 'soy_sauce:salsa de soya', 'mustard:mostaza', 'mayonnaise:mayonesa', 'vinegar:vinagre', 'ketchup:catsup', 'cooking_oil:aceite para cocinar'].map(pair => { const [id, name] = pair.split(':'); return food(id, name, ['condiment'], { aliases: id === 'ketchup' ? ['catsup', 'ketchup'] : [name], culinary_roles: ['sauce', 'seasoning', 'topping'], prep_effort: 'none' }); }),
  ...['water:agua', 'coffee:café', 'tea:té', 'sparkling_water:agua mineral', 'fruit_juice:jugo de fruta', 'soft_drink:refresco'].map(pair => { const [id, name] = pair.split(':'); return food(id, name, ['beverage'], { culinary_roles: ['beverage'], prep_effort: 'none' }); }),
];

const DISHES = [
  ['picadillo', 'picadillo'], ['chicken_with_mole', 'pollo con mole'], ['vegetable_soup', 'sopa de verduras'], ['chicken_soup', 'caldo de pollo'], ['lentil_soup', 'sopa de lentejas'], ['bean_soup', 'sopa de frijoles'], ['caldo_de_res', 'caldo de res'], ['tinga', 'tinga'], ['chicken_tinga', 'tinga de pollo'], ['rice_with_chicken', 'arroz con pollo'], ['chilaquiles', 'chilaquiles'], ['enchiladas', 'enchiladas'], ['quesadillas', 'quesadillas'], ['tacos', 'tacos'], ['rajas_with_cream', 'rajas con crema'], ['flautas', 'flautas'], ['cochinita_pibil', 'cochinita pibil'], ['pozole', 'pozole'], ['tamales', 'tamales'],
].map(([id, display_name]) => food(id, display_name, [], { type: 'prepared_dish', culinary_roles: ['main'], default_readiness: 'ready_to_eat', prep_effort: 'none', low_appetite_fit: 'medium' }));
const ONTOLOGY = Object.freeze(Object.fromEntries([...FOODS, ...DISHES].map(item => [item.id, item])));

// V1.1 keeps recipes small, but makes each declared archetype executable.
// Archetypes choose only grounded slots; rendering derives solely from those slots.
const ARCHETYPE_SPECS = Object.freeze([
  ['taco', 'construct'], ['quesadilla', 'construct'], ['tostada', 'construct'], ['flauta', 'complement'], ['chilaquiles', 'complement'],
  ['scrambled_eggs', 'construct'], ['huevos_a_la_mexicana', 'construct'], ['omelette', 'construct'], ['egg_plate', 'fallback'], ['sandwich', 'construct'],
  ['toast', 'construct'], ['mollete', 'construct'], ['plato_casero', 'construct'], ['rice_bowl', 'construct'], ['complete_salad', 'construct'],
  ['warm_vegetable_plate', 'construct'], ['beans_with_accompaniment', 'construct'], ['lentil_preparation', 'construct'], ['yogurt_bowl', 'construct'],
  ['oatmeal', 'construct'], ['licuado', 'construct'], ['soup_complement', 'complement'], ['prepared_dish_complement', 'complement'],
].map(([id, mode]) => Object.freeze({ id, mode })));
const ARCHETYPES = ARCHETYPE_SPECS;
const ARCHETYPE_IDS = new Set(ARCHETYPES.map(item => item.id));
const PREPARED_IDS = new Set(DISHES.map(item => item.id));
const QUICK_COOK_IDS = new Set(['egg']);
const SAVORY_FRUIT_IDS = new Set(['avocado', 'lime']);
const SWEET_FRUIT_IDS = new Set(['banana', 'apple', 'orange', 'mandarin', 'papaya', 'mango', 'pineapple', 'strawberry', 'berries', 'grapes', 'pear', 'watermelon', 'melon', 'guava', 'peach']);
const CHEESE_IDS = new Set(['panela_cheese', 'oaxaca_cheese', 'fresh_cheese', 'manchego_cheese']);
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
function candidateName(archetype, ingredients) {
  const main = ingredients.find(id => PRIMARY_IDS.has(id) || recordHas(id, 'legume') || CHEESE_IDS.has(id) || PREPARED_IDS.has(id));
  const veggie = ingredients.find(id => recordHas(id, 'vegetable') && !id.includes('chile'));
  const sweetFruit = ingredients.find(id => SWEET_FRUIT_IDS.has(id));
  const nuts = ingredients.find(id => recordHas(id, 'nuts_seeds'));
  if (archetype === 'huevos_a_la_mexicana') return 'huevos a la mexicana';
  if (archetype === 'omelette') return `omelette de ${foodListName(ingredients.filter(id => id !== 'egg' && CHEESE_IDS.has(id) === false))}${ingredients.some(id => CHEESE_IDS.has(id)) ? ' y queso' : ''}`;
  if (archetype === 'scrambled_eggs') return `huevos revueltos${veggie ? ` con ${display(veggie)}` : ''}`;
  if (archetype === 'taco') return `${ingredients.some(id => PREPARED_IDS.has(id)) ? 'tacos' : 'taco'} de ${display(main)}${ingredients.includes('avocado') ? ' con aguacate' : ''}${ingredients.includes('green_salsa') ? ' con salsa verde' : ''}`;
  if (archetype === 'quesadilla') return `quesadilla de ${veggie ? display(veggie) : display(main)}`;
  if (archetype === 'tostada') return `tostada de ${display(main)}${ingredients.includes('avocado') ? ' con aguacate' : ''}`;
  if (archetype === 'sandwich') return `sándwich de ${display(main)}${ingredients.includes('avocado') ? ' con aguacate' : ''}`;
  if (archetype === 'toast') return `pan tostado con ${display(main)}${ingredients.includes('avocado') ? ' y aguacate' : ''}`;
  if (archetype === 'mollete') return 'mollete de frijoles y queso';
  if (archetype === 'plato_casero') return `${display(main)} con ${foodListName(ingredients.filter(id => id !== main))}`;
  if (archetype === 'rice_bowl') return `tazón de arroz con ${display(main)}`;
  if (archetype === 'beans_with_accompaniment') return 'frijoles con tortilla';
  if (archetype === 'lentil_preparation') return 'lentejas cocidas';
  if (archetype === 'yogurt_bowl') return `tazón de yogurt con ${foodListName([sweetFruit, nuts].filter(Boolean))}`;
  if (archetype === 'oatmeal') return `avena con ${sweetFruit ? display(sweetFruit) : 'fruta'}`;
  if (archetype === 'licuado') return `licuado de ${foodListName(ingredients.filter(id => id !== 'milk'))}`;
  if (archetype === 'soup_complement') return `${display(ingredients[0])} con ${foodListName(ingredients.slice(1))}`;
  if (archetype === 'prepared_dish_complement' || archetype === 'flauta' || archetype === 'chilaquiles') return display(ingredients[0]);
  if (archetype === 'complete_salad') return `ensalada completa de ${display(main)}`;
  if (archetype === 'warm_vegetable_plate') return `verduras calientes con ${display(main)}`;
  return `${display(main)} con ${foodListName(ingredients.filter(id => id !== main))}`;
}
function makeCandidate(archetype, ingredients, transformations, options = {}) {
  const uniqueIngredients = [...new Set(ingredients)];
  return { archetype, name: candidateName(archetype, uniqueIngredients), named_ingredients: uniqueIngredients, ingredients: uniqueIngredients, transformations: [...new Set(transformations)], specificity: options.specificity || 1, prepared: Boolean(options.prepared), mode: ARCHETYPE_SPECS.find(item => item.id === archetype)?.mode || 'construct' };
}
function candidateSignature(candidate) {
  // A protein/legume/cheese anchor with the same grain base is the same
  // practical assembly even when one variant adds a garnish such as avocado.
  const anchor = candidate.ingredients.find(id => PRIMARY_IDS.has(id) || recordHas(id, 'legume') || CHEESE_IDS.has(id) || PREPARED_IDS.has(id));
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

// Each generator is a slot grammar. Shared helpers choose compatible occupants;
// no candidate is generated from an ingredient role alone.
function candidateRecipes(context, available, byId) {
  const ids = [...available]; const candidates = [];
  const present = id => available.has(id);
  const ready = id => byId.has(id) && (isReady(byId.get(id)) || context.decision_horizon !== 'immediate' || QUICK_COOK_IDS.has(id));
  const primary = choose(ids, id => PRIMARY_IDS.has(id) && ready(id));
  const cookedLegume = choose(ids, id => recordHas(id, 'legume') && ready(id));
  const savoryVegetable = choose(ids, id => recordHas(id, 'vegetable') && !id.includes('chile'));
  const sweetFruit = choose(ids, id => SWEET_FRUIT_IDS.has(id));
  const nut = choose(ids, id => recordHas(id, 'nuts_seeds'));
  const cheese = choose(ids, id => CHEESE_IDS.has(id));
  const starch = choose(ids, id => recordHas(id, 'grain_starch') && ready(id));
  const add = (archetype, ingredients, options = {}) => {
    if (!ingredients.every(present)) return;
    const candidate = makeCandidate(archetype, ingredients, candidateTransformations(ingredients, byId), options);
    if (candidateIsReady(candidate, context, byId)) candidates.push(candidate);
  };

  // Opaque prepared dishes each produce their own candidate; no components leak.
  for (const id of ids.filter(id => PREPARED_IDS.has(id) && ready(id))) {
    if ((id === 'cochinita_pibil' || id === 'picadillo' || id === 'rajas_with_cream') && present('corn_tortilla')) add('taco', [id, 'corn_tortilla'].concat(present('avocado') && id === 'picadillo' ? ['avocado'] : []).concat(present('pickled_chile') && id === 'cochinita_pibil' ? ['pickled_chile'] : []), { specificity: 5, prepared: true });
    else if (id === 'chicken_with_mole' && present('rice') && ready('rice')) add('plato_casero', [id, 'rice'], { specificity: 5, prepared: true });
    else if ((id === 'vegetable_soup' || id === 'chicken_soup') && primary && present('corn_tortilla')) add('soup_complement', [id, primary, 'corn_tortilla'], { specificity: 4, prepared: true });
    else add(id === 'flautas' ? 'flauta' : 'prepared_dish_complement', [id], { specificity: 4, prepared: true });
  }
  if (present('egg') && present('red_tomato') && present('onion')) add('huevos_a_la_mexicana', ['egg', 'red_tomato', 'onion'].concat(present('serrano_chile') ? ['serrano_chile'] : present('habanero_chile') ? ['habanero_chile'] : []), { specificity: 5 });
  if (present('egg') && present('mushrooms') && cheese) add('omelette', ['egg', 'mushrooms', cheese], { specificity: 4 });
  if (present('egg') && present('corn_tortilla')) add('taco', ['egg', 'corn_tortilla'].concat(present('avocado') ? ['avocado'] : []), { specificity: 3 });
  if (present('egg') && (present('bread') || present('whole_grain_bread'))) add('toast', ['egg', present('whole_grain_bread') ? 'whole_grain_bread' : 'bread'].concat(present('avocado') ? ['avocado'] : []), { specificity: 3 });
  if (present('egg')) add('scrambled_eggs', ['egg'].concat(savoryVegetable ? [savoryVegetable] : []), { specificity: 2 });
  if (present('oaxaca_cheese') && present('corn_tortilla') && savoryVegetable) add('quesadilla', ['oaxaca_cheese', 'corn_tortilla', savoryVegetable], { specificity: 3 });
  if (present('tostada') && (present('green_salsa') || present('red_salsa')) && cheese) add('chilaquiles', ['tostada', present('green_salsa') ? 'green_salsa' : 'red_salsa', cheese], { specificity: 3 });
  if (present('bolillo') && cookedLegume && cheese) add('mollete', ['bolillo', cookedLegume, cheese].concat(present('pico_de_gallo') ? ['pico_de_gallo'] : []), { specificity: 5 });
  if (present('canned_tuna') && present('tostada')) add('tostada', ['canned_tuna', 'tostada'].concat(present('avocado') ? ['avocado'] : []).concat(present('red_tomato') ? ['red_tomato'] : []).concat(present('pickled_chile') ? ['pickled_chile'] : []), { specificity: 4 });
  if (primary && present('corn_tortilla')) add('taco', [primary, 'corn_tortilla'].concat(present('avocado') ? ['avocado'] : []).concat(present('green_salsa') ? ['green_salsa'] : present('serrano_chile') ? ['serrano_chile'] : []), { specificity: 3 });
  if (present('canned_tuna') && (present('whole_grain_bread') || present('bread')) && present('avocado')) add('sandwich', ['canned_tuna', present('whole_grain_bread') ? 'whole_grain_bread' : 'bread', 'avocado'].concat(present('cucumber') ? ['cucumber'] : []), { specificity: 4 });
  if (present('nopal') && present('panela_cheese') && present('corn_tortilla')) add('taco', ['nopal', 'panela_cheese', 'corn_tortilla'].concat(present('red_tomato') ? ['red_tomato'] : []), { specificity: 4 });
  if (primary && present('rice') && ready('rice') && savoryVegetable) add('plato_casero', [primary, 'rice', savoryVegetable], { specificity: 3 });
  if (primary && present('rice') && ready('rice')) add('rice_bowl', ['rice', primary].concat(savoryVegetable ? [savoryVegetable] : []), { specificity: 2 });
  if (primary && savoryVegetable && present('lettuce')) add('complete_salad', [primary, 'lettuce', savoryVegetable], { specificity: 2 });
  if (cheese && savoryVegetable && !primary) add('warm_vegetable_plate', [cheese, savoryVegetable], { specificity: 2 });
  if (cookedLegume && present('corn_tortilla')) add('beans_with_accompaniment', [cookedLegume, 'corn_tortilla'], { specificity: 2 });
  if (present('lentils') && ready('lentils')) add('lentil_preparation', ['lentils'].concat(savoryVegetable ? [savoryVegetable] : []), { specificity: 2 });
  if ((present('greek_yogurt') || present('plain_yogurt')) && sweetFruit && nut) add('yogurt_bowl', [present('greek_yogurt') ? 'greek_yogurt' : 'plain_yogurt', sweetFruit, nut], { specificity: 3 });
  if (present('oats') && sweetFruit) add('oatmeal', ['oats', sweetFruit].concat(present('milk') ? ['milk'] : []), { specificity: 2 });
  if (present('milk') && sweetFruit) add('licuado', ['milk', sweetFruit].concat(present('oats') ? ['oats'] : []), { specificity: 2 });
  if (primary && present('corn_tortilla')) add('egg_plate', [primary, 'corn_tortilla'], { specificity: 1 });
  return candidates;
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
function hardFailure(candidate, context, available, byId, rejection = normalizeRejections(context)) {
  if (rejection.archetypes.has(candidate.archetype) || rejection.signatures.has(candidateSignature(candidate))) return 'contextual_rejection';
  for (const id of candidate.ingredients) {
    if (!available.has(id) && !PANTRY.has(id)) return 'required_ingredient_unavailable';
    if (hasConstraint({ ingredients: [id] }, rejection.foodIds) || hasConstraint({ ingredients: [id] }, new Set(context.confirmed_constraints || []))) return 'constraint_violated';
    if (!canUse(byId.get(id), context.decision_horizon, candidate.transformations)) return 'readiness_incompatible';
  }
  const records = candidate.ingredients.map(id => ONTOLOGY[id]);
  if (!records.some(record => PRIMARY_IDS.has(record.id) || record.groups.includes('legume') || record.type === 'prepared_dish' || record.id === 'greek_yogurt' || CHEESE_IDS.has(record.id)) && !['oatmeal', 'licuado'].includes(candidate.archetype)) return 'insufficient_meal_substance';
  // Rendering is composition-derived, but this guard protects future renderers.
  if (!candidate.ingredients.every(id => ONTOLOGY[id])) return 'composition_not_grounded';
  return null;
}
function score(candidate, context) {
  const records = candidate.ingredients.map(id => ONTOLOGY[id]);
  const hasProtein = records.some(record => PRIMARY_IDS.has(record.id) || record.groups.includes('legume') || record.id === 'greek_yogurt' || CHEESE_IDS.has(record.id) || record.type === 'prepared_dish');
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
  const seen = new Set();
  return candidateRecipes(context, available, byId).map(candidate => {
    const signature = candidateSignature(candidate); const preliminaryFailure = hardFailure(candidate, context, available, byId, rejection);
    const failure = preliminaryFailure || (seen.has(signature) ? 'equivalent_candidate' : null);
    if (!failure) seen.add(signature);
    const scored = score(candidate, context); return { candidate, signature, failure, ...scored };
  });
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

module.exports = Object.freeze({ GROUPS, PANTRY: [...PANTRY], ONTOLOGY, ARCHETYPES, normalizeFood, ancestors, candidateSignature, inspectCandidates, recommend });
