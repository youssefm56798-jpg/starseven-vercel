import test from 'node:test';
import assert from 'node:assert/strict';
import { currencyLabel, whole, discountPercent } from '../lib/money.js';

/**
 * Prices are the one thing on the page a customer will argue about, so the
 * helpers that format them get the same treatment as the checkout maths.
 */

test('currency label follows the reading language', () => {
  assert.equal(currencyLabel('ar'), 'جنيه');
  assert.equal(currencyLabel('en'), 'EGP');
  // Arabic is the default; anything unrecognised must not fall back to Latin.
  assert.equal(currencyLabel(undefined), 'جنيه');
  assert.equal(currencyLabel(''), 'جنيه');
  assert.equal(currencyLabel('fr'), 'جنيه');
});

test('whole() rounds to the nearest pound and never returns NaN', () => {
  assert.equal(whole('45.00'), 45);
  assert.equal(whole(44.6), 45);
  assert.equal(whole(44.4), 44);
  assert.equal(whole(null), 0);
  assert.equal(whole(undefined), 0);
  assert.equal(whole('not a price'), 0);
});

test('discountPercent computes the saving off the compare-at price', () => {
  assert.equal(discountPercent(45, 55), 18);
  assert.equal(discountPercent(50, 100), 50);
  assert.equal(discountPercent('45.00', '55.00'), 18);
});

test('discountPercent returns null when there is nothing to advertise', () => {
  assert.equal(discountPercent(45, null), null, 'no compare-at price');
  assert.equal(discountPercent(45, undefined), null);
  assert.equal(discountPercent(45, 0), null, 'a zero compare-at is not a discount');
  assert.equal(discountPercent(45, 45), null, 'same price is not a discount');
  // A compare-at below the price would render a negative "saving" — refuse it
  // rather than print "−-22%" on the card.
  assert.equal(discountPercent(55, 45), null, 'compare-at below price');
});

test('the seeded Pro X discount is the 18% shown on the cards', async () => {
  const { readFile } = await import('node:fs/promises');
  const seed = await readFile(new URL('../db/seed.sql', import.meta.url), 'utf8');

  // The one row in the catalogue carrying a compare-at price.
  const row = seed.match(/([\d.]+), ([\d.]+), '#D7291D'/);
  assert.ok(row, 'Pro X row with a compare-at price not found in the seed');

  const [, price, compareAt] = row;
  assert.equal(discountPercent(price, compareAt), 18);
});
