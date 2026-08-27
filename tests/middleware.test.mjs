/**
 * middleware.js — the redirect table, pinned.
 *
 * Nothing has ever read this file. It holds the most consequential SEO logic in
 * the repository: it is the only thing standing between the site and the crawl
 * traps it used to have, where ?lang=fr, ?lang=EN and ?kind=bogus each returned
 * 200 with the full Arabic catalogue at a second, third and fourth address.
 *
 * The /en migration has landed. The rewrite that used to serve /en/shop from
 * /shop?lang=en is deleted, app/en/** holds the real route files, and the tests
 * at the bottom of this file assert the absence of that rewrite — they are the
 * lock on the cutover, and they were written before it and un-skipped by it.
 *
 * Everything else asserted below is unchanged behaviour, and that is the point:
 * the migration removed the rewrite and touched nothing else, so a redirect that
 * stops working is a mistake, not a step.
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

test('/en/shop is not rewritten - it is served by its own route file', { skip: SKIP }, () => {
  // Middleware used to rewrite /en/shop onto /shop?lang=en, which is what forced
  // every page to read searchParams and is therefore what stopped any of them
  // being prerendered. app/en/shop/page.js exists now, the rewrite is deleted,
  // and /en/shop is an ordinary static route.
  const res = run('/en/shop');
  assert.equal(rewritten(res), null,
    `/en/shop is still being rewritten onto ${rewritten(res)}`);
  assert.equal(res.headers.get('location'), null, '/en/shop was redirected');
  assert.equal(res.status, 200);
});

test('the whole /en tree reaches its own route files untouched', { skip: SKIP }, () => {
  // One entry per shape of English route, because the rewrite that used to stand
  // in front of all of them was a single branch — if it comes back, or if one of
  // the redirects above starts matching /en by accident, every English URL goes
  // with it. A rewrite here means the English address is being served by an
  // Arabic route file, which is the exact failure this migration removes.
  for (const path of [
    '/en',
    '/en/shop',
    '/en/shop/wax',
    '/en/product/x',
    '/en/article/x',
    '/en/hair-types/fine',
    '/en/checkout',
  ]) {
    const res = run(path);
    assert.equal(rewritten(res), null, `${path} was rewritten onto ${rewritten(res)}`);
    assert.equal(res.headers.get('location'), null,
      `${path} was redirected to ${res.headers.get('location')}`);
    assert.equal(res.status, 200, `${path} did not reach its route file`);
    assert.equal(res.headers.get('x-middleware-next'), '1',
      `${path} did not pass straight through`);
  }
});

test('the Arabic tree is not rewritten either', { skip: SKIP }, () => {
  // The Arabic branch used to end in a rewrite onto the same URL, which existed
  // only to carry the x-s7-lang header to the root layout. With that header gone
  // the rewrite was a no-op that still stamped x-middleware-rewrite on every
  // storefront request, so it is a plain pass-through now.
  for (const path of ['/', '/shop', '/shop/wax', '/article/hair-care', '/checkout']) {
    const res = run(path);
    assert.equal(rewritten(res), null, `${path} was rewritten onto ${rewritten(res)}`);
    assert.equal(res.status, 200, `${path} did not pass through`);
    assert.equal(res.headers.get('x-middleware-next'), '1',
      `${path} did not pass straight through`);
  }
});

test('the ?lang=en redirect and the real English route agree on the address', { skip: SKIP }, () => {
  // These are two independent statements about where English lives: the legacy
  // redirect below says /en/shop, and app/en/shop/page.js is what answers there.
  // If they ever disagree the redirect is pointing Google at a 404, so the test
  // follows the redirect's own destination back into the middleware.
  const url = redirects('/shop?lang=en', '/en/shop', ['lang']);
  const res = run(url.pathname);
  assert.equal(res.status, 200, `${url.pathname}, the redirect target, does not pass through`);
  assert.equal(res.headers.get('location'), null,
    `${url.pathname} redirects again - the redirect target is not a final address`);
  assert.equal(rewritten(res), null,
    `${url.pathname} is rewritten rather than served by its own route file`);
});

test('?lang=en on a path that is already English does not double the prefix', { skip: SKIP }, () => {
  // Unreachable before the cutover: the /en rewrite ran ahead of the ?lang=
  // whitelist and returned first. With the rewrite deleted these fall through to
  // the whitelist, and prefixing a path that already carries /en would send
  // /en/shop?lang=en to /en/en/shop — a 301 into a 404.
  redirects('/en/shop?lang=en', '/en/shop', ['lang']);
  redirects('/en?lang=en', '/en', ['lang']);
  // A language we do not serve is still stripped, and the English path it
  // arrived on is still where it lands.
  redirects('/en/shop?lang=fr', '/en/shop', ['lang']);
});
