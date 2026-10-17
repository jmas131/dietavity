'use strict';

// Deliberately small, grounded presentation policy for the market-validation
// food vocabulary. This is not a recipe database or pantry model.
function has(values, value) { return values.some(item => item.concept === value); }
function named(values, value) { return values.find(item => item.concept === value); }
function lowAppetiteSuffix(appetite) { return appetite === 'low' ? ' Empieza con una porción pequeña y come despacio.' : ''; }

function recommendationV2({ availability, appetite = null, recentlyConsumed = [] }) {
  if (!availability || availability.scope === 'none' || availability.scope === 'unknown') return null;
  if (availability.scope === 'broad') {
    const repeatedChicken = recentlyConsumed.includes('pollo');
    const claim = repeatedChicken
      ? 'Prepara tacos de frijoles con aguacate. Calienta los frijoles, sírvelos en tortillas y agrega aguacate al final.'
      : 'Prepara tacos de pollo con aguacate. Cocina el pollo, sírvelo en tortillas y agrega aguacate al final.';
    return { claim: `${claim}${lowAppetiteSuffix(appetite)}`, archetype: repeatedChicken ? 'broad_bean_tacos' : 'broad_chicken_tacos' };
  }

  const foods = availability.confirmed_foods || [];
  const groups = availability.underspecified_groups || [];
  const vegetables = has(groups, 'vegetables');
  let claim = null; let archetype = null;

  if (has(foods, 'ground_meat') && vegetables) {
    claim = 'Haz un salteado de carne molida con las verduras que tengas. Cocina primero la carne y luego agrega las verduras hasta que queden suaves.';
    archetype = 'ground_meat_vegetable_saute';
  } else if (has(foods, 'egg') && has(foods, 'nopal')) {
    claim = 'Prepara huevos revueltos con nopales. Cocina los nopales y agrega los huevos al final para que queden suaves.';
    archetype = 'eggs_with_nopales';
  } else if (has(foods, 'tuna') && has(foods, 'corn_tortilla')) {
    claim = `Haz tacos de atún${has(foods, 'red_tomato') ? ' con jitomate' : ''}. Calienta las tortillas y sirve el atún encima.`;
    archetype = 'tuna_tacos';
  } else if (has(foods, 'chicken') && has(foods, 'corn_tortilla')) {
    if (has(foods, 'common_beans') && recentlyConsumed.includes('pollo')) {
      claim = 'Haz tacos de frijoles. Calienta los frijoles y sírvelos en las tortillas.';
      archetype = 'bean_tacos_for_variety';
    } else {
      claim = `Haz tacos de pollo${has(foods, 'avocado') ? ' con aguacate' : ''}${has(foods, 'red_tomato') ? ' y jitomate' : ''}. Cocina el pollo, sírvelo en las tortillas y agrega lo fresco al final.`;
      archetype = 'chicken_tacos';
    }
  } else if (has(foods, 'egg')) {
    claim = 'Prepara huevos revueltos. Si tienes una verdura o tortillas, agrégalas al servir.';
    archetype = 'eggs_limited_inventory';
  } else if (has(foods, 'rice') && vegetables) {
    claim = 'Haz arroz salteado con las verduras que tengas. Cocina el arroz y mézclalo con las verduras; si tienes una proteína, puedes agregarla.';
    archetype = 'rice_with_generic_vegetables';
  } else if (has(foods, 'broccoli') || has(foods, 'zucchini') || has(foods, 'carrot')) {
    const listed = ['broccoli', 'zucchini', 'carrot'].filter(value => has(foods, value)).map(value => named(foods, value).surface).join(', ').replace(/, ([^,]+)$/u, ' y $1');
    claim = `Saltea ${listed} con un poco de agua o aceite. Si tienes huevo, pollo o frijoles, puedes agregarlos para hacerlo más completo.`;
    archetype = 'specific_vegetable_saute';
  } else if (vegetables) {
    claim = 'Prepara las verduras que tienes salteadas. Si tienes huevo, pollo o frijoles, puedes agregarlos para hacerlo más completo.';
    archetype = 'generic_vegetable_saute';
  }
  if (!claim) return null;
  return { claim: `${claim}${lowAppetiteSuffix(appetite)}`, archetype };
}

module.exports = Object.freeze({ recommendationV2 });
