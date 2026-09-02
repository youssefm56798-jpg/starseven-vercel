/**
 * The order page draws the jar next to each line, the way the confirmation
 * email does. order_items stores no picture, so it has to come from the
 * catalogue by SKU - and if either half of that is dropped the page quietly
 * goes back to names only, which nobody would notice until a customer asked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => readFileSync(`${ROOT}/${p}`, 'utf8');

test('the lines are joined to the catalogue for their photograph', () => {
  const src = read('lib/order-access.js');
  assert.match(src, /LEFT JOIN products p ON p\.sku = i\.sku/, 'itemsFor no longer joins products');
  assert.match(src, /COALESCE\(p\.image, ''\) AS image/, 'itemsFor no longer selects the image');
});

test('the page renders the photograph through the shared image helpers', () => {
  const view = read('app/_views/order.js');
  assert.match(view, /src=\{imageUrl\(i\.image\)\}/, 'the line has no <img>');
  assert.match(view, /srcSet=\{imageSrcSet\(i\.image\)\}/, 'the <img> has no srcset, so a phone fetches the 900px file');
  assert.match(view, /width="44" height="44"/, 'no intrinsic size, so the list jumps as pictures load');
});
