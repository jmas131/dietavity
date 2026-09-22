const SHOPPING_LIST_CATEGORIES = [
  'Frutas y verduras',
  'Proteínas',
  'Lácteos y alternativas',
  'Cereales y panes',
  'Despensa',
  'Otros'
];

// This is deliberately data, rather than a set of phrase-wide heuristics. Each
// alias identifies exactly one product and therefore one shopping-list group.
const CANONICAL_INGREDIENT_CATALOG = [
  entry('tomates-cherry', 'Tomates cherry', 'Frutas y verduras', ['tomate cherry', 'tomates cherry', 'jitomate cherry', 'jitomates cherry']),
  entry('cebolla-morada', 'Cebolla morada', 'Frutas y verduras', ['cebolla morada', 'cebollas moradas']),
  entry('frutos-rojos', 'Frutos rojos', 'Frutas y verduras', ['frutos rojos', 'frutas rojas', 'berries']),
  entry('alga-nori', 'Alga nori', 'Despensa', ['alga nori', 'algas nori', 'hoja de alga nori', 'hojas de alga nori', 'nori']),
  entry('tomate', 'Tomate', 'Frutas y verduras', ['tomate', 'tomates', 'jitomate', 'jitomates']),
  entry('cebollin', 'Cebollín', 'Frutas y verduras', ['cebollin', 'cebollines', 'cebolla de verdeo', 'cebollas de verdeo', 'scallion', 'scallions', 'spring onion', 'spring onions']),
  entry('hojas-verdes', 'Hojas verdes', 'Frutas y verduras', ['hojas verdes', 'hojas verdes mixtas', 'mezcla de hojas verdes', 'mix de hojas verdes', 'mixed greens']),
  entry('pepino', 'Pepino', 'Frutas y verduras', ['pepino', 'pepinos']),
  entry('eneldo', 'Eneldo', 'Frutas y verduras', ['eneldo']),
  entry('tomillo', 'Tomillo', 'Frutas y verduras', ['tomillo', 'tomillos', 'thyme']),
  entry('aceitunas', 'Aceitunas', 'Frutas y verduras', ['aceituna', 'aceitunas', 'oliva', 'olivas']),
  entry('calabaza', 'Calabaza', 'Frutas y verduras', ['calabaza', 'calabazas']),
  entry('laurel', 'Laurel', 'Frutas y verduras', ['laurel', 'hoja de laurel', 'hojas de laurel']),
  entry('jengibre', 'Jengibre', 'Frutas y verduras', ['jengibre']),
  entry('aguacate', 'Aguacate', 'Frutas y verduras', ['aguacate', 'aguacates', 'palta', 'paltas']),
  entry('limon', 'Limón', 'Frutas y verduras', ['limon', 'limones', 'jugo de limon', 'zumo de limon']),
  entry('ajo', 'Ajo', 'Frutas y verduras', ['ajo', 'ajos', 'diente de ajo', 'dientes de ajo']),
  entry('cebolla', 'Cebolla', 'Frutas y verduras', ['cebolla', 'cebollas']),
  entry('zanahoria', 'Zanahoria', 'Frutas y verduras', ['zanahoria', 'zanahorias']),
  entry('pimiento', 'Pimiento', 'Frutas y verduras', ['pimiento', 'pimientos']),
  entry('espinaca', 'Espinaca', 'Frutas y verduras', ['espinaca', 'espinacas']),
  entry('lechuga', 'Lechuga', 'Frutas y verduras', ['lechuga', 'lechugas']),
  entry('brocoli', 'Brócoli', 'Frutas y verduras', ['brocoli', 'brocolis']),
  entry('calabacin', 'Calabacín', 'Frutas y verduras', ['calabacin', 'calabacines', 'zucchini', 'zucchinis']),
  entry('champiñon', 'Champiñones', 'Frutas y verduras', ['champiñon', 'champiñones', 'hongo', 'hongos']),
  entry('papa', 'Papa', 'Frutas y verduras', ['papa', 'papas', 'patata', 'patatas']),
  entry('camote', 'Camote', 'Frutas y verduras', ['camote', 'camotes', 'batata', 'batatas']),
  entry('apio', 'Apio', 'Frutas y verduras', ['apio']),
  entry('coliflor', 'Coliflor', 'Frutas y verduras', ['coliflor', 'coliflores']),
  entry('berenjena', 'Berenjena', 'Frutas y verduras', ['berenjena', 'berenjenas']),
  entry('betabel', 'Betabel', 'Frutas y verduras', ['betabel', 'betabeles', 'remolacha', 'remolachas']),
  entry('col', 'Col', 'Frutas y verduras', ['col', 'coles', 'repollo', 'repollos']),
  entry('acelga', 'Acelga', 'Frutas y verduras', ['acelga', 'acelgas']),
  entry('rucula', 'Rúcula', 'Frutas y verduras', ['rucula']),
  entry('cilantro', 'Cilantro', 'Frutas y verduras', ['cilantro']),
  entry('perejil', 'Perejil', 'Frutas y verduras', ['perejil']),
  entry('albahaca', 'Albahaca', 'Frutas y verduras', ['albahaca']),
  entry('menta', 'Menta', 'Frutas y verduras', ['menta', 'hierbabuena']),
  entry('manzana', 'Manzana', 'Frutas y verduras', ['manzana', 'manzanas']),
  entry('platano', 'Plátano', 'Frutas y verduras', ['platano', 'platanos', 'banana', 'bananas']),
  entry('naranja', 'Naranja', 'Frutas y verduras', ['naranja', 'naranjas']),
  entry('fresa', 'Fresas', 'Frutas y verduras', ['fresa', 'fresas', 'frutilla', 'frutillas']),
  entry('arandano', 'Arándanos', 'Frutas y verduras', ['arandano', 'arandanos']),
  entry('mango', 'Mango', 'Frutas y verduras', ['mango', 'mangos']),
  entry('piña', 'Piña', 'Frutas y verduras', ['piña', 'piñas', 'anana', 'ananas']),
  entry('pera', 'Pera', 'Frutas y verduras', ['pera', 'peras']),
  entry('uva', 'Uvas', 'Frutas y verduras', ['uva', 'uvas']),

  entry('salmon-ahumado', 'Salmón ahumado', 'Proteínas', ['salmon ahumado']),
  entry('mariscos', 'Mariscos', 'Proteínas', ['mezcla de mariscos', 'mariscos mixtos', 'marisco', 'mariscos', 'mixed seafood', 'seafood mix']),
  entry('ternera', 'Ternera', 'Proteínas', ['carne de ternera', 'ternera', 'beef', 'veal']),
  entry('arvejas', 'Arvejas', 'Proteínas', ['arveja', 'arvejas', 'guisante', 'guisantes', 'green peas', 'peas']),
  entry('atun', 'Atún', 'Proteínas', ['atun', 'atunes']),
  entry('salmon', 'Salmón', 'Proteínas', ['salmon', 'salmones']),
  entry('pollo', 'Pollo', 'Proteínas', ['pollo', 'pechuga de pollo', 'muslo de pollo']),
  entry('pavo', 'Pavo', 'Proteínas', ['pavo', 'pechuga de pavo']),
  entry('res', 'Carne de res', 'Proteínas', ['carne de res', 'res']),
  entry('cerdo', 'Cerdo', 'Proteínas', ['cerdo', 'carne de cerdo']),
  entry('huevo', 'Huevos', 'Proteínas', ['huevo', 'huevos']),
  entry('tofu', 'Tofu', 'Proteínas', ['tofu']),
  entry('tempeh', 'Tempeh', 'Proteínas', ['tempeh']),
  entry('lenteja', 'Lentejas', 'Proteínas', ['lenteja', 'lentejas']),
  entry('garbanzo', 'Garbanzos', 'Proteínas', ['garbanzo', 'garbanzos']),
  entry('hummus', 'Hummus', 'Proteínas', ['hummus', 'humus']),
  entry('alubias-blancas', 'Alubias blancas', 'Proteínas', ['alubia blanca', 'alubias blancas', 'judia blanca', 'judias blancas']),
  entry('frijol', 'Frijoles', 'Proteínas', ['frijol', 'frijoles', 'poroto', 'porotos', 'judia', 'judias']),
  entry('edamame', 'Edamame', 'Proteínas', ['edamame', 'edamames']),
  entry('sardina', 'Sardinas', 'Proteínas', ['sardina', 'sardinas']),
  entry('pescado', 'Pescado', 'Proteínas', ['pescado', 'pescados']),

  entry('yogur-soya', 'Yogur de soya', 'Lácteos y alternativas', ['yogur de soya', 'yogurt de soya', 'yogur de soja', 'yogurt de soja']),
  entry('yogur', 'Yogur', 'Lácteos y alternativas', ['yogur', 'yogures', 'yogurt', 'yogurts']),
  entry('queso-fresco', 'Queso fresco', 'Lácteos y alternativas', ['queso fresco', 'quesos frescos']),
  entry('bebida-vegetal', 'Bebida vegetal', 'Lácteos y alternativas', ['bebida vegetal', 'bebidas vegetales', 'leche vegetal', 'leches vegetales']),
  entry('leche-almendra', 'Leche de almendra', 'Lácteos y alternativas', ['leche de almendra', 'bebida de almendra']),
  entry('leche-avena', 'Leche de avena', 'Lácteos y alternativas', ['leche de avena', 'bebida de avena']),
  entry('leche-soya', 'Leche de soya', 'Lácteos y alternativas', ['leche de soya', 'leche de soja', 'bebida de soya', 'bebida de soja']),
  entry('leche', 'Leche', 'Lácteos y alternativas', ['leche', 'leches']),
  entry('queso', 'Queso', 'Lácteos y alternativas', ['queso', 'quesos']),
  entry('requeson', 'Requesón', 'Lácteos y alternativas', ['requeson', 'ricotta']),

  entry('arroz-integral', 'Arroz integral', 'Cereales y panes', ['arroz integral']),
  entry('arroz-blanco', 'Arroz blanco', 'Cereales y panes', ['arroz blanco']),
  entry('arroz', 'Arroz', 'Cereales y panes', ['arroz', 'arroces']),
  entry('pan-integral', 'Pan integral', 'Cereales y panes', ['pan integral', 'panes integrales']),
  entry('pan', 'Pan', 'Cereales y panes', ['pan', 'panes']),
  entry('tortilla-maiz', 'Tortillas de maíz', 'Cereales y panes', ['tortilla de maiz', 'tortillas de maiz']),
  entry('tortilla', 'Tortillas', 'Cereales y panes', ['tortilla', 'tortillas']),
  entry('avena', 'Avena', 'Cereales y panes', ['avena', 'avena en hojuelas', 'hojuelas de avena']),
  entry('quinoa', 'Quinoa', 'Cereales y panes', ['quinoa', 'quinua']),
  entry('pasta', 'Pasta', 'Cereales y panes', ['pasta', 'pastas']),
  entry('cuscus', 'Cuscús', 'Cereales y panes', ['cuscus', 'couscous']),
  entry('amaranto', 'Amaranto', 'Cereales y panes', ['amaranto']),
  entry('cebada-perlada', 'Cebada perlada', 'Cereales y panes', ['cebada perlada']),
  entry('fideos-soba', 'Fideos soba', 'Cereales y panes', ['fideos de trigo sarraceno', 'fideos soba', 'fideo soba', 'soba noodles', 'noodles soba', 'buckwheat noodles', 'buckwheat noodle', 'soba']),

  entry('crema-cacahuate', 'Crema de cacahuate', 'Despensa', ['crema de cacahuate', 'mantequilla de cacahuate', 'crema de mani', 'mantequilla de mani']),
  entry('salsa-soya', 'Salsa de soya', 'Despensa', ['salsa de soya', 'salsa de soja', 'soya sauce', 'tamari']),
  entry('aceite-oliva', 'Aceite de oliva', 'Despensa', ['aceite de oliva', 'aceite oliva']),
  entry('semillas-chia', 'Semillas de chía', 'Despensa', ['semilla de chia', 'semillas de chia', 'chia']),
  entry('semillas-calabaza', 'Semillas de calabaza', 'Despensa', ['semilla de calabaza', 'semillas de calabaza', 'pepita de calabaza', 'pepitas de calabaza', 'pepita', 'pepitas']),
  entry('alcaparras', 'Alcaparras', 'Despensa', ['alcaparra', 'alcaparras']),
  entry('azucar', 'Azúcar', 'Despensa', ['azucar', 'azucares', 'endulzante', 'endulzantes']),
  entry('coco-rallado', 'Coco rallado', 'Despensa', ['coco rallado']),
  entry('curcuma', 'Cúrcuma', 'Despensa', ['curcuma']),
  entry('curry', 'Curry', 'Despensa', ['curry']),
  entry('pimenton', 'Pimentón', 'Despensa', ['pimenton', 'paprika']),
  entry('vainilla', 'Vainilla', 'Despensa', ['vainilla', 'extracto de vainilla', 'esencia de vainilla']),
  entry('cacahuate', 'Cacahuates', 'Despensa', ['cacahuate', 'cacahuates', 'mani', 'manies']),
  entry('soya', 'Soya', 'Despensa', ['soya', 'soja']),
  entry('almendra', 'Almendras', 'Despensa', ['almendra', 'almendras']),
  entry('nuez', 'Nueces', 'Despensa', ['nuez', 'nueces']),
  entry('linaza', 'Linaza', 'Despensa', ['linaza', 'semilla de lino', 'semillas de lino']),
  entry('sesamo', 'Ajonjolí', 'Despensa', ['sesamo', 'ajonjoli', 'semillas de sesamo', 'semillas de ajonjoli']),
  entry('aceite', 'Aceite', 'Despensa', ['aceite', 'aceites']),
  entry('vinagre', 'Vinagre', 'Despensa', ['vinagre', 'vinagres']),
  entry('miel', 'Miel', 'Despensa', ['miel']),
  entry('mostaza', 'Mostaza', 'Despensa', ['mostaza']),
  entry('sal', 'Sal', 'Despensa', ['sal']),
  entry('pimienta', 'Pimienta', 'Despensa', ['pimienta']),
  entry('canela', 'Canela', 'Despensa', ['canela']),
  entry('comino', 'Comino', 'Despensa', ['comino']),
  entry('oregano', 'Orégano', 'Despensa', ['oregano']),
  entry('caldo-verduras', 'Caldo de verduras', 'Despensa', ['caldo de verduras', 'caldo vegetal']),
  entry('agua', 'Agua', 'Despensa', ['agua']),

  // Preparation-only items are identified deterministically but intentionally
  // omitted from the purchase list.
  entry('hielo', null, null, ['hielo', 'cubito de hielo', 'cubitos de hielo'], { exclude: true })
];

function entry(key, displayName, category, aliases, options = {}) {
  return { key, displayName, category, aliases, ...options };
}

function foldIngredient(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALIAS_INDEX = CANONICAL_INGREDIENT_CATALOG
  .flatMap(catalogEntry => catalogEntry.aliases.map(alias => ({
    alias: foldIngredient(alias),
    catalogEntry
  })))
  .sort((left, right) =>
    right.alias.split(' ').length - left.alias.split(' ').length ||
    right.alias.length - left.alias.length
  );

function findCatalogEntry(value) {
  const folded = ` ${foldIngredient(value)} `;
  return ALIAS_INDEX.find(({ alias }) => folded.includes(` ${alias} `))
    ?.catalogEntry || null;
}

function rawIngredientText(ingredient) {
  return typeof ingredient === 'string'
    ? ingredient
    : ingredient?.name || ingredient?.ingredient || ingredient?.title || '';
}

function readableFallback(value) {
  const cleaned = value
    .trim()
    .replace(/^[-•]\s*/, '')
    .replace(/^(?:(?:\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])\s*)+/, '')
    .replace(/^(?:g|gr|gramos?|kg|kilogramos?|ml|mililitros?|l|litros?|tazas?|cucharaditas?|cucharadas?|piezas?|rebanadas?|dientes?|puñados?)\b\.?\s*(?:de\s+)?/i, '')
    .replace(/\s*\((?:opcional|al gusto)\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,;:\s]+|[,;:\s]+$/g, '')
    .trim();

  return cleaned
    ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
    : null;
}

function resolveIngredient(ingredient) {
  const raw = rawIngredientText(ingredient).trim();
  if (!raw) return [];

  // Alternatives become separate products only when every side is itself a
  // known ingredient. Descriptors such as "fresco o congelado" stay attached
  // while the normal longest-match lookup identifies the food phrase.
  const alternatives = raw.split(/\s+(?:o|u)\s+/i);
  if (alternatives.length > 1) {
    const alternativeEntries = alternatives.map(findCatalogEntry);
    if (alternativeEntries.every(Boolean)) {
      return alternativeEntries
        .filter(catalogEntry => !catalogEntry.exclude)
        .map(catalogEntry => ({
          key: catalogEntry.key,
          displayName: catalogEntry.displayName,
          category: catalogEntry.category
        }));
    }
  }

  const catalogEntry = findCatalogEntry(raw);
  if (catalogEntry) {
    if (catalogEntry.exclude) return [];
    return [{
      key: catalogEntry.key,
      displayName: catalogEntry.displayName,
      category: catalogEntry.category
    }];
  }

  const displayName = readableFallback(raw);
  return displayName
    ? [{ key: null, displayName, category: 'Otros' }]
    : [];
}

function buildShoppingList(mealPlan) {
  const groups = Object.fromEntries(
    SHOPPING_LIST_CATEGORIES.map(category => [category, []])
  );
  const seenCatalogKeys = new Set();

  (mealPlan?.days || []).forEach(day => {
    Object.values(day.meals || {}).forEach(mealValue => {
      const meals = Array.isArray(mealValue) ? mealValue : [mealValue];
      meals.forEach(meal => {
        (meal?.recipe?.ingredients || []).forEach(ingredient => {
          resolveIngredient(ingredient).forEach(resolved => {
            if (resolved.key && seenCatalogKeys.has(resolved.key)) return;
            if (resolved.key) seenCatalogKeys.add(resolved.key);
            groups[resolved.category].push(resolved.displayName);
          });
        });
      });
    });
  });

  return SHOPPING_LIST_CATEGORIES.map(name => ({
    name,
    ingredients: groups[name].sort((a, b) => a.localeCompare(b, 'es'))
  }));
}

module.exports = {
  CANONICAL_INGREDIENT_CATALOG,
  SHOPPING_LIST_CATEGORIES,
  buildShoppingList,
  findCatalogEntry,
  foldIngredient,
  resolveIngredient
};