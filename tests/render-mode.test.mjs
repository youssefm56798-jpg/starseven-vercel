/**
 * Render mode: what a storefront page is allowed to read at request time.
 *
 * Not one page on this site is prerendered, and the cause is a single line
 * repeated in every route file: `const sp = await searchParams`. Arabic lives
 * at the bare path and English is served by middleware.js rewriting /en/shop
 * onto /shop?lang=en, so `searchParams` is the only channel carrying the
 * language down into the page. It is also a dynamic API. Awaiting it in a
 * legacy (non-PPR) prerender opts the route out of static generation and zeroes
 * the revalidate window on the way out, which is how `export const revalidate =
 * 60` came to be written on pages that cache nothing at all. `headers()` in
 * app/layout.js does the same thing to every page underneath it in one line.
 *
 * These tests encode the state after /en becomes a real path segment: each
 * route file pins its language as a compile-time constant, and no page that is
 * supposed to be static reads a request-scoped API. They are expected to fail
 * until that migration lands. That is what they are for, and a failure here
 * should be read as "this route has not been migrated yet", not as a bug.
 *
 * The files are read as text rather than imported. They are server components
 * that import next/navigation and the database, so importing them under
 * node:test would fail for reasons that have nothing to do with render mode.
 *
 * One test per file, so a failure names the route rather than handing back a
 * list of eleven and making someone bisect it.
 *
 * The allow-list is matched on whole path segments, never as a substring. The
 * checkout, the order lookup and the admin genuinely have to read the request
 * and are exempt; a future app/reorder/ would not become exempt just because
 * the letters "order" appear inside its name. There is a test below that pins
 * exactly that, because it is the kind of thing a regex gets wrong silently.
 *
 * app/layout.js is held to the same rule, because it is the one file that can
 * make every page in the tree dynamic on its own — no route file can be static
 * underneath a layout that awaits `headers()`.
 *
 * app/not-found.js is deliberately NOT asserted here. Next renders the root
 * not-found.js for URLs that match no route at all, so it is handed no params
 * and no path of its own, and a header set by middleware may remain the only
 * way it can answer /en/... in English. The cost of that is the prerender of
 * /_not-found and nothing else, so it is not worth breaking the 404 over.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Windows-safe repo root the rest of tests/ uses: URL pathnames arrive as
// /C:/... on win32, and the leading slash has to come off before fs sees it.
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * Every route file under app/, found by walking the directory rather than by
 * asking git.
 *
 * A directory walk is the right source here even though tests/line-endings
 * uses `git ls-files`: the migration creates app/en/** as new files, and an
 * enumeration from the index would not see them until someone remembered to
 * `git add`. A test that passes or fails on staging state is a trap.
 */
function walk(dir, name) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel, name));
    else if (entry.name === name) out.push(rel);
  }
  return out.sort();
}

/**
 * Routes that must stay dynamic, as path segments.
 *
 * The checkout reads the cart and the coupon out of the request, the order
 * lookup is a live status page that must never be served from a cache, and the
 * admin is behind a session cookie. Their English twins are the same routes at
 * a different address and get the same exemption.
 */
const DYNAMIC = [
  ['app', 'checkout'],
  ['app', 'order'],
  ['app', 'en', 'checkout'],
  ['app', 'en', 'order'],
  ['app', 'admin'],
  ['app', 'api'],
];

/** True when `rel` sits under one of the dynamic prefixes, segment for segment. */
function isExempt(rel) {
  const segments = rel.split('/');
  return DYNAMIC.some(prefix => prefix.every((seg, i) => segments[i] === seg));
}

/**
 * Source with its comments removed.
 *
 * A page that no longer reads `searchParams` will very likely still mention it
 * in the comment explaining why it does not, and that must not fail the test.
 * Block comments go first, then `//` to end of line — except where the two
 * slashes are preceded by a colon, which is what keeps 'https://schema.org'
 * and every other URL literal in these files intact.
 */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const PAGES = walk('app', 'page.js');
const LAYOUTS = walk('app', 'layout.js');

test('there are route files under app/ to check', () => {
  assert.ok(PAGES.length > 0, 'the walk of app/ found no page.js at all');
  assert.ok(LAYOUTS.length > 0, 'the walk of app/ found no layout.js at all');
});

test('the dynamic allow-list matches path segments, not substrings', () => {
  // The exemptions themselves.
  assert.ok(isExempt('app/checkout/page.js'));
  assert.ok(isExempt('app/order/[ref]/page.js'));
  assert.ok(isExempt('app/en/checkout/page.js'));
  assert.ok(isExempt('app/en/order/[ref]/page.js'));
  assert.ok(isExempt('app/admin/(panel)/orders/page.js'));
  assert.ok(isExempt('app/api/order/route.js'));

  // The near misses. Each of these shares a substring with an exempt prefix and
  // must still be held to the static rules.
  assert.ok(!isExempt('app/reorder/page.js'), 'reorder is not order');
  assert.ok(!isExempt('app/orders/page.js'), 'orders is not order');
  assert.ok(!isExempt('app/checkout-guide/page.js'), 'checkout-guide is not checkout');
  assert.ok(!isExempt('app/en/reorder/page.js'), 'en/reorder is not en/order');
  assert.ok(!isExempt('app/administration/page.js'), 'administration is not admin');
  assert.ok(!isExempt('app/shop/page.js'));
  assert.ok(!isExempt('app/en/shop/page.js'));
});

/**
 * The four routes that must never be cached, asserted rather than merely
 * exempted.
 *
 * Everything above this point is one rule - a page that is supposed to be
 * static must not read the request - and the allow-list is how the four routes
 * that genuinely do read it are let through. That is a hole: being on the
 * allow-list only means these tests stop checking, so deleting the
 * `force-dynamic` from app/order/[ref]/page.js passes every test in this file
 * while turning the order page into a prerender.
 *
 * On /checkout that would be a cache-freshness bug. On /order/[ref] it is a
 * data breach: the page is opened with a token in the query string and shows
 * one customer name, address and phone number, so a cached copy is that
 * customer served to whoever asks next. The comment at the top of both route
 * files says so at length. This is the test that makes the comment binding.
 *
 * `revalidate` is checked too, and not out of tidiness. `force-dynamic` and a
 * revalidate window in the same file contradict each other, and the resolution
 * is a Next implementation detail rather than something anyone should have to
 * know - so the pair is refused outright.
 */
const NEVER_CACHED = [
  'app/checkout/page.js',
  'app/en/checkout/page.js',
  'app/order/[ref]/page.js',
  'app/en/order/[ref]/page.js',
];

for (const rel of NEVER_CACHED) {
  test(`${rel} is force-dynamic and stays that way`, () => {
    assert.ok(PAGES.includes(rel), `${rel} is not where this test expects it - was it moved?`);
    const src = code(readFileSync(join(ROOT, rel), 'utf8'));

    assert.match(src, /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/,
      'does not export dynamic = "force-dynamic". This route is keyed by something ' +
      'in the request - a cart, or a token that opens exactly one order - so a ' +
      'prerendered copy is one visitor served to the next.');

    assert.doesNotMatch(src, /export\s+const\s+revalidate\s*=/,
      'exports a revalidate window as well as force-dynamic. The two contradict ' +
      'each other; which wins is an implementation detail nobody should have to know.');
  });
}

/**
 * The catalogue endpoint, which is the opposite case: it reads nothing from the
 * request and every visitor gets the same answer, so it should be prerendered
 * and revalidated rather than run per request. It has no `dynamic` export and
 * must not grow one - `force-dynamic` here would silently put a function and
 * two Neon queries back in front of every uncached hit.
 */
test('app/api/products/route.js is cached, not forced dynamic', () => {
  const src = code(readFileSync(join(ROOT, 'app/api/products/route.js'), 'utf8'));

  const declared = /export\s+const\s+revalidate\s*=\s*([^;\n]+)/.exec(src);
  assert.ok(declared, 'does not export a revalidate, so it runs on every request');
  assert.notEqual(declared[1].trim(), '0', 'revalidate = 0 is the same as not caching at all');

  assert.doesNotMatch(src, /export\s+const\s+dynamic\s*=/,
    'exports a dynamic mode. The catalogue reads nothing from the request; forcing ' +
    'it dynamic puts a function and two database queries back on every hit.');
});

for (const rel of PAGES) {
  test(`${rel} is a static page: no request-scoped reads, and a revalidate window`, {
    skip: isExempt(rel) ? 'on the dynamic allow-list - this route must read the request' : false,
  }, () => {
    const src = code(readFileSync(join(ROOT, rel), 'utf8'));

    assert.doesNotMatch(src, /\bsearchParams\b/,
      'still reads searchParams. It is a dynamic API: awaiting it opts this route ' +
      'out of static generation and zeroes its revalidate window. The language ' +
      'belongs in the route file as a constant now that /en is a real segment.');

    assert.doesNotMatch(src, /\bheaders\s*\(/,
      'still calls headers(). Same problem as searchParams - the page cannot be ' +
      'prerendered while it reads the request.');

    assert.doesNotMatch(src, /\bcookies\s*\(/,
      'still calls cookies(). Same problem as searchParams.');

    const declared = /export\s+const\s+revalidate\s*=\s*([^;\n]+)/.exec(src);
    assert.ok(declared,
      'does not export a revalidate. A static page with no window is cached ' +
      'until the next deploy, so a price or an article edit never appears.');
    assert.notEqual(declared[1].trim(), '0',
      'exports revalidate = 0, which is the value Next writes when a dynamic API ' +
      'has already opted the route out. Setting it by hand only hides that.');
  });
}

for (const rel of LAYOUTS) {
  test(`${rel} does not make its whole subtree dynamic`, {
    skip: isExempt(rel) ? 'on the dynamic allow-list - this subtree must read the request' : false,
  }, () => {
    // A layout is not a page and needs no revalidate of its own, but it decides
    // the render mode of everything below it. app/layout.js reads the locale
    // from the x-s7-lang header middleware sets, and that one call is enough to
    // make /shop, /blog and every other page dynamic no matter what they export.
    // After the cutover the Arabic tree's layout pins lang="ar" and app/en's
    // pins lang="en", both as constants.
    const src = code(readFileSync(join(ROOT, rel), 'utf8'));

    assert.doesNotMatch(src, /\bheaders\s*\(/,
      'still calls headers(). Every page under this layout is dynamic while it does.');
    assert.doesNotMatch(src, /\bcookies\s*\(/,
      'still calls cookies(). Every page under this layout is dynamic while it does.');
    assert.doesNotMatch(src, /\bsearchParams\b/,
      'still reads searchParams.');
  });
}
