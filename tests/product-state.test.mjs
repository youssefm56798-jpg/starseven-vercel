/**
 * Which call to action a product gets.
 *
 * Two columns, three outcomes, and three screens that have to agree about them.
 * They did not: the product page answered "is it priced" first, and the shop
 * card and the quick view looked at the price ALONE — so an out-of-stock
 * product could show an Add button on the grid that the checkout then refused,
 * and an unpriced out-of-stock one invited a WhatsApp about something the shop
 * could not supply either way.
 *
 * lib/product-state.js is now the only place that decides. These tests pin the
 * rule, and the last one pins that all three screens still ask it rather than
 * quietly growing their own copy again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buyState, BUY, ASK, OUT } from '../lib/product-state.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

test('priced and in stock can be bought', () => {
  assert.equal(buyState({ price: 80, stock: 200 }), BUY);
  // productPublic() flattens stock to 1 or 0 for the public API, and the rule
  // has to read both shapes the same way.
  assert.equal(buyState({ price: 80, stock: 1 }), BUY);
});

test('in stock but unpriced sends them to WhatsApp', () => {
  // A price of zero is a product the client has not costed yet, not a free
  // one. It is listed so the range looks complete.
  assert.equal(buyState({ price: 0, stock: 200 }), ASK);
});

test('out of stock beats unpriced', () => {
  /*
   * The case this module was written for, and the one the old order got wrong.
   *
   * A product that is BOTH unpriced and unavailable used to offer "اسأل عن
   * السعر" with a WhatsApp button — a message the shop has to answer, about a
   * product it cannot sell, from which the customer learns nothing. "خلص من
   * المخزن" is the fact that actually decides it, and it implies the product
   * is coming back.
   *
   * This is exactly the state the hair spray and the hair-removal range are in.
   */
  assert.equal(buyState({ price: 0, stock: 0 }), OUT);
  assert.equal(buyState({ price: 80, stock: 0 }), OUT);
});

test('a missing or nonsense value is never a buy button', () => {
  // Fails towards "cannot be sold". A caller that forgot to select the column
  // must not accidentally get an Add button for something the checkout will
  // refuse — which is the shape the shop card had before this existed.
  for (const p of [
    {}, null, undefined,
    { price: 80 },                       // no stock selected
    { stock: 5 },                        // no price selected
    { price: 80, stock: 'lots' },
    { price: 80, stock: null },
    { price: 80, stock: -3 },
    { price: 'free', stock: 5 },
  ]) {
    assert.notEqual(buyState(p), BUY, `${JSON.stringify(p)} was offered as buyable`);
  }
});

test('every screen asks this module rather than the columns', () => {
  /*
   * The regression that matters. Each of these three used to decide for itself
   * from `price > 0`, and they drifted. Asserting the import is what stops the
   * fourth screen inventing its own version — a unit test of the helper cannot
   * catch a caller that never calls it.
   */
  const screens = {
    'app/_views/product.js': 'the product page',
    'app/shop/view.js': 'the shop grid card',
    'app/_components/QuickView.js': 'the quick view',
  };

  for (const [file, what] of Object.entries(screens)) {
    const src = readFileSync(`${ROOT}${file}`, 'utf8');
    assert.match(src, /from '.*lib\/product-state\.js'/,
      `${what} does not use the shared availability rule`);
    assert.match(src, /buyState\(/, `${what} imports the rule but never calls it`);
  }
});

test('all three screens can say "out of stock" in both languages', () => {
  // A screen that imports the rule but has no branch for OUT would silently
  // fall through to whichever wording came before it.
  for (const file of ['app/_views/product.js', 'app/shop/view.js', 'app/_components/QuickView.js']) {
    const src = readFileSync(`${ROOT}${file}`, 'utf8');
    assert.ok(src.includes('خلص من المخزن'), `${file} has no Arabic out-of-stock wording`);
    assert.ok(src.includes('Out of stock'), `${file} has no English out-of-stock wording`);
  }
});

/* ------------------------------------------ getting the change onto the site */

test('every product write invalidates the storefront cache', () => {
  /*
   * The complaint this fixes: "my admin changes do not show up on the site".
   *
   * Every storefront route carries `revalidate = 60` and /api/products adds a
   * CDN header on top, which is right for a catalogue that changes twice a week
   * and wrong for the minute after somebody presses Save. An owner reloaded the
   * shop, saw the old price, and could not tell whether the save had failed or
   * the page was stale — and the usual next move is to save it again.
   *
   * Worse than the confusion: a product taken off sale stayed buyable at its
   * old address for up to a minute, and a corrected price stayed collectable at
   * the door for the same window.
   *
   * This cannot be proven on a dev server — `next dev` re-renders every request
   * regardless — so the property is asserted against the source instead: every
   * function in the single writer module ends by invalidating, and none of them
   * can be added without doing so.
   */
  const src = readFileSync(`${ROOT}lib/product-admin.js`, 'utf8');

  assert.match(src, /revalidatePath/, 'lib/product-admin.js no longer invalidates anything');

  // Both trees. Arabic is the unprefixed one and English lives under /en, so
  // invalidating only the root leaves every English page stale.
  assert.match(src, /revalidatePath\('\/', 'layout'\)/, 'the Arabic tree is not invalidated');
  assert.match(src, /revalidatePath\('\/en', 'layout'\)/, 'the English tree is not invalidated');

  /*
   * The import has to stay dynamic. lib/product-admin.js is exercised against a
   * real Postgres with no server around it by scripts/verify-product-admin.mjs,
   * and a top-level `next/cache` import does not resolve there.
   */
  assert.doesNotMatch(src, /^import .*next\/cache/m,
    'next/cache is imported at the top level, which breaks scripts/verify-product-admin.mjs');
  assert.match(src, /await import\('next\/cache'\)/);

  /*
   * And every writer has to call it. Counted rather than eyeballed: the failure
   * mode is the EIGHTH function, added later, that quietly does not.
   */
  const writers = [...src.matchAll(/export async function (\w+)/g)].map(m => m[1]);
  assert.ok(writers.length >= 7, `only found ${writers.length} writers - has the module moved?`);

  const missing = [];
  for (let i = 0; i < writers.length; i++) {
    const from = src.indexOf(`export async function ${writers[i]}`);
    const to = i + 1 < writers.length
      ? src.indexOf(`export async function ${writers[i + 1]}`)
      : src.length;
    if (!/await published\(\)/.test(src.slice(from, to))) missing.push(writers[i]);
  }
  assert.deepEqual(missing, [],
    `these write products without invalidating the storefront, so the change sits stale for a minute: ${missing.join(', ')}`);
});
