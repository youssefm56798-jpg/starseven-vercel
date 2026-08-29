/**
 * GET /api/products — the catalogue the storefront boots from.
 *
 * Read-only and unauthenticated, so the interesting questions are not about
 * validation. They are: what does it disclose, is it ordered the way the two
 * routes that read the same tables expect, and what does it do when the
 * database is not there — because it is the one route whose comment promises
 * the front end may be optimistic about it.
 */

export default async function products({ db, api, ip, check, checkThat, section, sub, canary, SKU, CODE }) {
  section('GET /api/products');

  const res = await api('/api/products', { ip: ip('products') });
  const body = res.json;

  check('200', res.status, 200);
  check('ok', body?.ok, true);

  const bySku = Object.fromEntries((body?.products || []).map(p => [p.sku, p]));

  /* --------------------------------------------------------- what is in it */

  sub('the catalogue');
  check('the live products are all there',
    [SKU.wax, SKU.gel, SKU.outOfStock, SKU.unpriced, SKU.scarce, SKU.stocky, SKU.bulk]
      .filter(s => s in bySku).length, 7);
  check('an inactive product is not', SKU.inactive in bySku, false);
  check('and it is not merely hidden — the row is absent from the payload',
    res.text.includes(SKU.inactive), false);

  // sort ASC, id ASC. The shop orders the grid by this and so does the quiz;
  // if they ever disagreed the "recommended" product would move between pages.
  const order = (body?.products || []).map(p => p.sku);
  check('ordered by sort, then id',
    order.slice(0, 8),
    [canary, SKU.wax, SKU.gel, SKU.outOfStock, SKU.unpriced, SKU.scarce, SKU.stocky, SKU.bulk]);

  /* ------------------------------------------------------ what is not in it */

  sub('disclosure');

  // productPublic exists to decide this, and the decision only holds if the
  // route actually goes through it.
  check('a product is exactly the public shape',
    Object.keys(bySku[SKU.gel] || {}).sort(),
    ['ar', 'color', 'compare_at', 'en', 'featured', 'hair', 'hold', 'img',
      'kind', 'price', 'size_ml', 'sku', 'slug', 'stock'].sort());

  for (const leaked of ['id', 'created_at', 'active', 'sort', 'name_ar', 'stock_count', 'ingredients']) {
    check(`no ${leaked} on a product`, leaked in (bySku[SKU.gel] || {}), false);
  }

  // The one that is a stated security property rather than tidiness: the
  // fixture carries 137 units and the response may only say "in stock".
  const stocky = bySku[SKU.stocky];
  check('stock is a flag, never a count', stocky?.stock, 1);
  check('out of stock reads as 0, and is still listed', bySku[SKU.outOfStock]?.stock, 0);
  checkThat('the exact stock level appears nowhere in the response',
    !/\b137\b/.test(res.text),
    'the response contains the literal inventory level 137');

  /* ---------------------------------------------------------------- types */

  sub('shapes the browser depends on');
  const gel = bySku[SKU.gel] || {};
  check('price is a number, not the string NUMERIC returns', typeof gel.price, 'number');
  check('price keeps its decimals', gel.price, 55.5);
  check('compare_at is a number when set', gel.compare_at, 70);
  check('compare_at is null when unset', bySku[SKU.wax]?.compare_at, null);
  check('hair types arrive split', gel.hair, ['wavy', 'curly']);
  // The split has to drop empties, or a single-value column would arrive as a
  // one-element array in one place and a two-element array with a blank in it
  // in another, and the tile filter on the shop reads the length.
  check('a single hair type is a one-element array', bySku[canary]?.hair, ['straight']);

  check('six hair-type tiles', (body?.hair_types || []).length, 6);
  check('in the documented order',
    (body?.hair_types || []).map(t => t.slug),
    ['straight', 'wavy', 'curly', 'coily', 'fine', 'thick']);
  checkThat('each tile carries both languages',
    (body?.hair_types || []).every(t => t.ar?.name && t.en?.name),
    'a tile is missing ar.name or en.name');

  check('shipping rules come from the environment',
    body?.shipping, { fee: 30, free_over: 300, currency: 'EGP' });

  /* ---------------------------------------------------------------- offer */

  sub('which offer is advertised');

  // Newest live offer, by id descending — the banner should show whatever was
  // created last, not the oldest surviving promotion.
  check('the newest live offer', body?.offer?.code, CODE.newest);
  check('its numbers are numbers', [typeof body?.offer?.discount_value, typeof body?.offer?.min_total],
    ['number', 'number']);
  check('its values', [body?.offer?.discount_value, body?.offer?.min_total], [5, 250]);

  // Retire the banner and the next one down must be the next LIVE one. This is
  // the only way to prove all three exclusions at once, because inactive,
  // not-yet-started and already-ended offers sit between them by id.
  await db`UPDATE offers SET active = false WHERE code IN (${CODE.newest}, ${CODE.fraction}, ${CODE.noDiscount})`;
  try {
    const next = await api('/api/products', { ip: ip('products') });
    check('skips inactive, future and expired offers alike',
      next.json?.offer?.code, CODE.capOne);
  } finally {
    await db`UPDATE offers SET active = true WHERE code IN (${CODE.newest}, ${CODE.fraction}, ${CODE.noDiscount})`;
  }

  await db`UPDATE offers SET active = false`;
  try {
    const none = await api('/api/products', { ip: ip('products') });
    check('no live offer is null rather than an error', [none.status, none.json?.offer], [200, null]);
  } finally {
    await db`UPDATE offers SET active = true WHERE code <> ${CODE.disabled}`;
  }

  /* -------------------------------------------------------- no database */

  sub('when the catalogue is unreachable');

  // The route promises a clean 503 rather than a stack trace, and the front end
  // falls back to built-in copy on it. Renaming the table is the least
  // destructive way to make the query fail for real — it is the same failure
  // shape as a dropped connection, from the route's point of view.
  await db`ALTER TABLE products RENAME TO products_hidden`;
  try {
    const down = await api('/api/products', { ip: ip('products') });
    check('503, not 500', down.status, 503);
    check('and a plain message', down.json, { ok: false, error: 'Catalogue unavailable.' });

    // The success response asks to be cached for a minute. If the failure
    // inherited that, one bad minute would be served to every visitor for the
    // following minute — so the two must differ, and they do because the error
    // goes through fail() instead of the hand-built response.
    check('a broken catalogue is never cached', down.header('cache-control'), 'no-store');
  } finally {
    await db`ALTER TABLE products_hidden RENAME TO products`;
  }

  const recovered = await api('/api/products', { ip: ip('products') });
  check('and it recovers on the next request', recovered.status, 200);
}
