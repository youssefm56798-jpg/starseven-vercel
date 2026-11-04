import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productIngredients } from '../lib/product-ingredients.js';

test('all five pack transcriptions retain their colourant IDs and ingredient order', () => {
  const seed = readFileSync(new URL('../db/seed.sql', import.meta.url), 'utf8');
  const lists = [...seed.matchAll(/SET ingredients = '([^']+)' WHERE sku = '(S7-WAX-[A-Z]+)'/g)];
  assert.equal(lists.length, 5);
  for (const [, text, sku] of lists) {
    const { ingredients, optionalColourants } = productIngredients(text);
    assert.deepEqual(optionalColourants, [...text.matchAll(/CI (\d{5})/g)].map(m => `CI ${m[1]}`), sku);
    assert.deepEqual(ingredients.slice(0, 8), [
      'Microcrystalline Wax', 'Beeswax', 'Petrolatum', 'Paraffinum Liquidum',
      'Propylparaben', 'BHT', 'Tocopheryl Acetate', 'Lanolin',
    ], sku);
    assert.equal(ingredients[8], 'Parfum', sku);
    assert.ok(!ingredients.some(item => /\+\/|±|Parfume|Bees wax/.test(item)), sku);
    assert.deepEqual(productIngredients(ingredients.join(' – ') + ' – ' + optionalColourants.map(c => `+/– ${c}`).join(' – ')),
      { ingredients, optionalColourants }, sku);
    if (sku === 'S7-WAX-PUR') assert.equal(ingredients[9], 'Butyrospermum Parkii Butter');
    if (sku === 'S7-WAX-BLK') assert.equal(ingredients.at(-1), 'Nigella Sativa Seed Oil');
    if (sku === 'S7-WAX-BLU') assert.equal(ingredients[9], 'Argania Spinosa Kernel Oil');
  }
});

test('missing or whitespace-only lists stay empty', () => {
  for (const text of [null, undefined, '', ' \n ']) {
    assert.deepEqual(productIngredients(text), { ingredients: [], optionalColourants: [] });
  }
});

test('optional colourants accept pack minus variants without changing the numeric ID', () => {
  for (const marker of ['+/-', '+/–', '+/−', '+ / –', '±']) {
    assert.deepEqual(productIngredients(`Aqua – ${marker} CI 01234`), {
      ingredients: ['Aqua'], optionalColourants: ['CI 01234'],
    });
  }
});

test('unmarked colourants, unknown ingredients, hyphens and malformed codes stay visible', () => {
  const text = 'PEG-40 Hydrogenated Castor Oil – CI 77266 – Unknown Ingredient – +/- CI 123456 – +/- other';
  assert.deepEqual(productIngredients(text), {
    ingredients: ['PEG-40 Hydrogenated Castor Oil', 'CI 77266', 'Unknown Ingredient', '± CI 123456', '± other'],
    optionalColourants: [],
  });
});
