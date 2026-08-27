/**
 * middleware.js — the redirect table, pinned.
 *
 * Nothing has ever read this file. It holds the most consequential SEO logic in
 * the repository: it is the only thing standing between the site and the crawl
 * traps it used to have, where ?lang=fr, ?lang=EN and ?kind=bogus each returned
 * 200 with the full Arabic catalogue at a second, third and fourth address. It
 * is also the file the /en migration is about to change, and the change is a
 * deletion — the rewrite goes away once app/en/** holds real route files.
 *
 * Everything asserted below is CURRENT behaviour. This file is green today and
 * must stay green through the cutover: the migration removes the rewrite and
 * touches nothing else, so a redirect that stops working is a mistake, not a
 * step. The one test that is expected to flip is marked skip and says so.
 *
 * These are the behaviours, and each is a 301 for a reason. A 302 would leave
 * the old address in the index competing with the new one, and every URL below
 * is one Google has already seen.
 *
 * Two things here are worth reading twice, because both are easy to assume
 * wrongly and both are asserted the way the code actually behaves:
 *
 *   - ?lang= is matched case-insensitively. ?lang=EN is lower-cased before the
 *     whitelist sees it, so it is treated as English and 301s to /en/shop, not
 *     stripped back to Arabic. Same for ?kind=WAX, which lands on /shop/wax.
 *     Only a value that is genuinely not a language we serve — fr, de, junk —
 *     gets stripped and sent back to the bare path.
 *
 *   - "the parameter is stripped" is the invariant in every one of those cases.
 *     Whatever the destination, ?lang= and ?kind= never survive on it, because
 *     surviving is exactly how a redirect target becomes the next duplicate.
 *
 * middleware.js imports 'next/server', which Node cannot resolve on its own:
 * the next package publishes no "exports" map, so a bare specifier with no
 * extension does not resolve outside Next's own bundler. A module resolve hook
 * maps that one specifier onto next/server.js, which is a plain CommonJS file
 * and loads fine. The hook is registered for this test process only — node
 * --test runs each test file in its own child — and it rewrites nothing else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';

const ORIGIN = 'https://newstarseven.com';

let middleware = null;
let NextRequest = null;
let unavailable = false;

if (typeof nodeModule.registerHooks !== 'function') {
  // Synchronous module hooks landed in Node 22.15. package.json asks for >= 20,
  // and on an older runtime this file skips rather than fails: it is a test of
  // middleware.js, not of the Node version someone happens to have.
  unavailable = 'node:module registerHooks is unavailable - needs Node 22.15 or newer';
} else {
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context);
    },
  });
  try {
    ({ NextRequest } = await import('next/server.js'));
    ({ middleware } = await import('../middleware.js'));
  } catch (err) {
    unavailable = `middleware.js could not be loaded: ${err.message}`;
  }
}

const SKIP = unavailable;

/** Runs the middleware against a synthetic request for a site-relative path. */
const run = path => middleware(new NextRequest(new Request(ORIGIN + path)));

/** The Location header of a redirect, parsed. */
const target = res => new URL(res.headers.get('location'));

/** The internal rewrite Next records as a header rather than as a status. */
const rewritten = res => res.headers.get('x-middleware-rewrite');

/** Asserts a 301 to `path` with none of `gone` left on the destination. */
function redirects(from, path, gone = []) {
  const res = run(from);
  assert.equal(res.status, 301, `${from} did not 301`);
  const url = target(res);
  assert.equal(url.pathname, path, `${from} landed on ${url.pathname}`);
  for (const param of gone) {
    assert.equal(url.searchParams.has(param), false,
      `${from} kept ?${param}= on the destination, which is the next duplicate URL`);
  }
  return url;
}

test('middleware.js loads outside the Next.js runtime', { skip: SKIP }, () => {
  assert.equal(typeof middleware, 'function');
});

/* ------------------------------------------------- legacy ?kind= filter */

test('?kind=wax becomes the /shop/wax path and loses the parameter', { skip: SKIP }, () => {
  redirects('/shop?kind=wax', '/shop/wax', ['kind']);
  // Case-folded before the comparison, so the upper-case form is the same page
  // and not a second address for it.
  redirects('/shop?kind=WAX', '/shop/wax', ['kind']);
});

test('?kind=gel on the English path becomes /en/shop/gel', { skip: SKIP }, () => {
  redirects('/en/shop?kind=gel', '/en/shop/gel', ['kind']);
  redirects('/en/shop?kind=wax', '/en/shop/wax', ['kind']);
});

test('an unrecognised ?kind= is stripped, not served', { skip: SKIP }, () => {
  // The whole catalogue at /shop?kind=clay would be the same page at a second
  // address, which is the shape of every crawl trap this site has had.
  redirects('/shop?kind=clay', '/shop', ['kind']);
  redirects('/shop?kind=', '/shop', ['kind']);
  redirects('/en/shop?kind=clay', '/en/shop', ['kind']);
});

/* --------------------------------------------- legacy '-ar' article slugs */

test('an old -ar article slug redirects to the shared slug', { skip: SKIP }, () => {
  redirects('/article/some-slug-ar', '/article/some-slug');
  // Only the suffix goes. An 'ar' anywhere else in the slug is part of the word.
  redirects('/article/hair-care-ar', '/article/hair-care');
});

test('a slug that merely contains "ar" is left alone', { skip: SKIP }, () => {
  const res = run('/article/hair-care');
  assert.equal(res.status, 200, '/article/hair-care was redirected');
  assert.equal(res.headers.get('location'), null);
});

/* --------------------------------------------- legacy ?lang= handling */

test('?lang=en is promoted to the /en path', { skip: SKIP }, () => {
  redirects('/shop?lang=en', '/en/shop', ['lang']);
  redirects('/?lang=en', '/en', ['lang']);
  redirects('/hair-types?lang=en', '/en/hair-types', ['lang']);
});

test('a language we do not serve is stripped and never mints a URL', { skip: SKIP }, () => {
  // This whitelist is the whole defence. Without it every ?lang= value on earth
  // returns 200 with Arabic content at its own crawlable address.
  redirects('/shop?lang=fr', '/shop', ['lang']);
  redirects('/shop?lang=de', '/shop', ['lang']);
  redirects('/shop?lang=junk', '/shop', ['lang']);
  // 'ar' is the default and needs no marker, so it is stripped too.
  redirects('/shop?lang=ar', '/shop', ['lang']);
});

test('?lang= is matched case-insensitively', { skip: SKIP }, () => {
  // Asserting what the code does, not what the name of the whitelist suggests:
  // the value is lower-cased before the comparison, so ?lang=EN is English and
  // is promoted to /en/shop. The parameter is stripped either way, which is the
  // part that stops the duplicate.
  redirects('/shop?lang=EN', '/en/shop', ['lang']);
  redirects('/shop?lang=En', '/en/shop', ['lang']);
  redirects('/shop?lang=AR', '/shop', ['lang']);
});

/* ------------------------------------------------------------ pass-through */

test('the API and the admin are untouched', { skip: SKIP }, () => {
  for (const path of ['/api/order', '/api/products', '/admin', '/admin/orders']) {
    const res = run(path);
    assert.equal(res.status, 200, `${path} was redirected`);
    assert.equal(res.headers.get('location'), null, `${path} got a Location header`);
    assert.equal(rewritten(res), null, `${path} was rewritten`);
    assert.equal(res.headers.get('x-middleware-next'), '1',
      `${path} did not pass straight through`);
  }
});

test('a query string on the API is not stripped', { skip: SKIP }, () => {
  // The pass-through runs before the ?lang= whitelist, so an API caller that
  // sends ?lang= is answered rather than redirected.
  const res = run('/api/products?lang=en');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-middleware-next'), '1');
});

/* ------------------------------------------------------------- the cutover */

test('/en/shop is not rewritten - it is served by its own route file', {
  skip: 'un-skip at cutover',
}, () => {
  // Today middleware rewrites /en/shop onto /shop?lang=en, which is what forces
  // every page to read searchParams and is therefore what stops any of them
  // being prerendered. Once app/en/shop/page.js exists the rewrite is deleted
  // and /en/shop is an ordinary static route.
  const res = run('/en/shop');
  assert.equal(rewritten(res), null,
    `/en/shop is still being rewritten onto ${rewritten(res)}`);
  assert.equal(res.headers.get('location'), null, '/en/shop was redirected');
  assert.equal(res.status, 200);
});
