const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildShoppingList,
  resolveIngredient
} = require('../lib/shopping-list');

const liveOutputFixtures = [
  ['Tomates cherry, partidos a la mitad', 'Tomates cherry', 'Frutas y verduras'],
  ['Tomate pequeño en rodajas finas', 'Tomate', 'Frutas y verduras'],
  ['Pepino en rodajas finas', 'Pepino', 'Frutas y verduras'],
  ['Cebolla morada en tiras finas', 'Cebolla morada', 'Frutas y verduras'],
  ['Atún en agua, escurrido', 'Atún', 'Proteínas'],
  ['Yogur de soya natural sin azúcar', 'Yogur de soya', 'Lácteos y alternativas'],
  ['Frutos rojos frescos o congelados', 'Frutos rojos', 'Frutas y verduras'],
  ['Eneldo fresco o 1/2 cucharadita seco', 'Eneldo', 'Frutas y verduras'],
  ['Hoja de alga nori troceada o en tiras', 'Alga nori', 'Despensa'],
  ['Semillas de chía (opcional)', 'Semillas de chía', 'Despensa']
];

const catalogGapFixtures = [
  ['Hummus natural', 'Hummus', 'Proteínas'],
  ['Hummus natural (aprox. 30g)', 'Hummus', 'Proteínas'],
  ['Tomillo seco', 'Tomillo', 'Frutas y verduras'],
  ['Tomillo seco', 'Tomillo', 'Frutas y verduras'],
  ['Aceitunas negras o verdes en rodajas', 'Aceitunas', 'Frutas y verduras'],
  ['Alcaparras enjuagadas', 'Alcaparras', 'Despensa'],
  ['Alubias blancas cocidas', 'Alubias blancas', 'Proteínas'],
  ['Azúcar o endulzante', 'Azúcar', 'Despensa'],
  ['Calabaza en cubos', 'Calabaza', 'Frutas y verduras'],
  ['Cebada perlada cocida', 'Cebada perlada', 'Cereales y panes'],
  ['Coco rallado sin azúcar', 'Coco rallado', 'Despensa'],
  ['Cúrcuma en polvo', 'Cúrcuma', 'Despensa'],
  ['Curry en polvo suave', 'Curry', 'Despensa'],
  ['Hoja de laurel', 'Laurel', 'Frutas y verduras'],
  ['Jengibre rallado', 'Jengibre', 'Frutas y verduras'],
  ['Semillas de calabaza', 'Semillas de calabaza', 'Despensa'],
  ['Vainilla', 'Vainilla', 'Despensa']
];

const finalCatalogFixtures = [
  ['Cebollín picado', 'Cebollín', 'Frutas y verduras'],
  ['Cebollín picado para decorar', 'Cebollín', 'Frutas y verduras'],
  ['Hojas verdes mixtas', 'Hojas verdes', 'Frutas y verduras'],
  ['Arvejas (guisantes) congeladas', 'Arvejas', 'Proteínas'],
  ['Arvejas (guisantes) congelados', 'Arvejas', 'Proteínas'],
  ['Carne de ternera magra en cubos', 'Ternera', 'Proteínas'],
  ['Fideos de trigo sarraceno (soba) secos', 'Fideos soba', 'Cereales y panes'],
  ['Mezcla de mariscos (camarón, calamar, mejillón) frescos o congelados', 'Mariscos', 'Proteínas'],
  ['Pimentón o paprika', 'Pimentón', 'Despensa']
];

const excludedFixtures = [
  'Hielo al gusto',
  'Hielo al gusto'
];

test('canonicalizes live shopping-list output with catalog categories', () => {
  liveOutputFixtures.forEach(([raw, displayName, category]) => {
    assert.deepEqual(resolveIngredient(raw), [{
      key: resolveIngredient(raw)[0].key,
      displayName,
      category
    }]);
  });
});

test('canonicalizes the remaining live endpoint catalog gaps', () => {
  catalogGapFixtures.forEach(([raw, displayName, category]) => {
    const groups = buildShoppingList({
      days: [{ meals: { comida: { recipe: { ingredients: [raw] } } } }]
    });
    const ingredients = groups.flatMap(group =>
      group.ingredients.map(name => ({ name, category: group.name }))
    );
    assert.deepEqual(ingredients, [{ name: displayName, category }], raw);
  });
});

test('deduplicates repeated hummus and tomillo variants by canonical key', () => {
  const groups = buildShoppingList({
    days: [{ meals: { comida: { recipe: { ingredients: [
      'Hummus natural',
      'Hummus natural (aprox. 30g)',
      'Tomillo seco',
      'Tomillo seco',
      'Dried thyme'
    ] } } } }]
  });

  const proteins = groups.find(group => group.name === 'Proteínas');
  const produce = groups.find(group => group.name === 'Frutas y verduras');
  assert.equal(proteins.ingredients.filter(name => name === 'Hummus').length, 1);
  assert.equal(produce.ingredients.filter(name => name === 'Tomillo').length, 1);
});

test('canonicalizes the final live endpoint catalog fixtures', () => {
  finalCatalogFixtures.forEach(([raw, displayName, category]) => {
    const groups = buildShoppingList({
      days: [{ meals: { comida: { recipe: { ingredients: [raw] } } } }]
    });
    const ingredients = groups.flatMap(group =>
      group.ingredients.map(name => ({ name, category: group.name }))
    );
    assert.deepEqual(ingredients, [{ name: displayName, category }], raw);
  });
});

test('deduplicates cebollin and arveja variants by canonical key', () => {
  const groups = buildShoppingList({
    days: [{ meals: { comida: { recipe: { ingredients: [
      'Cebollín picado',
      'Cebollín picado para decorar',
      'Arvejas (guisantes) congeladas',
      'Arvejas (guisantes) congelados'
    ] } } } }]
  });
  const produce = groups.find(group => group.name === 'Frutas y verduras');
  const proteins = groups.find(group => group.name === 'Proteínas');
  assert.equal(produce.ingredients.filter(name => name === 'Cebollín').length, 1);
  assert.equal(proteins.ingredients.filter(name => name === 'Arvejas').length, 1);
});

test('excludes every live hielo fixture from all shopping-list categories', () => {
  excludedFixtures.forEach(raw => assert.deepEqual(resolveIngredient(raw), []));

  const groups = buildShoppingList({
    days: [{ meals: { comida: { recipe: { ingredients: excludedFixtures } } } }]
  });
  assert.deepEqual(groups.flatMap(group => group.ingredients), []);
});

test('uses longest-match precedence and preserves product distinctions', () => {
  const fixtures = [
    ['tomates cherry', 'Tomates cherry'],
    ['yogur de soya', 'Yogur de soya'],
    ['crema de cacahuate', 'Crema de cacahuate'],
    ['salsa de soya', 'Salsa de soya'],
    ['bebida vegetal', 'Bebida vegetal'],
    ['arroz integral', 'Arroz integral'],
    ['arroz blanco', 'Arroz blanco'],
    ['queso fresco', 'Queso fresco'],
    ['salmón ahumado', 'Salmón ahumado'],
    ['aceite de oliva', 'Aceite de oliva']
  ];
  fixtures.forEach(([raw, expected]) => {
    assert.equal(resolveIngredient(raw)[0].displayName, expected);
  });
});

test('splits alternatives only when every alternative is a catalog ingredient', () => {
  assert.deepEqual(
    resolveIngredient('pollo o tofu').map(item => item.displayName),
    ['Pollo', 'Tofu']
  );
  assert.equal(
    resolveIngredient('frutos rojos frescos o congelados')[0].displayName,
    'Frutos rojos'
  );
});

test('deduplicates by canonical catalog key', () => {
  const groups = buildShoppingList({
    days: [{ meals: { desayuno: { recipe: { ingredients: [
      'jitomate en cubos',
      'tomates, picados',
      'tomates cherry'
    ] } } } }]
  });
  const produce = groups.find(group => group.name === 'Frutas y verduras');
  assert.deepEqual(produce.ingredients, ['Tomate', 'Tomates cherry']);
});

test('keeps unmatched ingredients readable in Otros', () => {
  const [ingredient] = resolveIngredient('2 cucharadas de levadura nutricional (opcional)');
  assert.equal(ingredient.displayName, 'Levadura nutricional');
  assert.equal(ingredient.category, 'Otros');
});