/**
 * The two language trees, and the sitemap that promises both of them exist.
 *
 * Today there is only one tree. Arabic lives at the bare path and English is a
 * fiction maintained by middleware.js, which rewrites /en/shop onto
 * /shop?lang=en so a single route file can render either language. That is why
 * app/en/ is empty: nothing has ever needed to be there.
 *
 * After the cutover /en is a real path segment and app/en/** holds real route
 * files. The URLs do not change, so nothing about this is visible from outside
 * — which is precisely the danger. Deleting the rewrite turns every English
 * page whose file was not created into a 404, and it does so silently, on URLs
 * that worked in every preview taken before the last commit.
 *
 * Two things are asserted here.
 *
 * PARITY. Every storefront route exists in both trees. Note that this list is
 * deliberately NOT the same as the dynamic allow-list in render-mode.test.mjs:
 * /en/checkout and /en/order/[ref] are live URLs today and have to keep
 * working, so they need English route files exactly like every other page. What
 * they are exempt from is the no-searchParams rule, not from having a twin. The
 * only routes with no twin are app/admin/** — a single-language back office
 * that was never bilingual and is not becoming so — and app/api/**, which
 * holds no pages at all.
 *
 * THE SITEMAP MUST NOT LIE. app/sitemap.js emits an /en/... URL for every path
 * unconditionally, and annotates the Arabic entry with an hreflang alternate
 * pointing at it. Today the rewrite makes all of them resolve. After the
 * cutover they resolve only if the file exists, so one missed English page
 * means the sitemap submits a URL that 404s to Search Console, with the Arabic
 * page vouching for it in a second, independent signal. That is a worse failure
 * than the one the migration is fixing, and this is the test that catches it
 * before a deploy does.
 *
 * The route files are found by walking app/ rather than by asking git, because
 * the migration creates them as new files and an enumeration from the index
 * would not see them until someone remembered to `git add`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The Windows-safe repo root the rest of tests/ uses: URL pathnames arrive as
// /C:/... on win32, and the leading slash has to come off before fs sees it.
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.name === 'page.js') out.push(rel);
  }
  return out.sort();
}

/** Trees that exist in one language only, as path segments. */
const SINGLE_LANGUAGE = [
  ['app', 'admin'],
  ['app', 'api'],
];

const isSingleLanguage = rel => {
  const segments = rel.split('/');
  return SINGLE_LANGUAGE.some(prefix => prefix.every((seg, i) => segments[i] === seg));
};

// Segment-wise, so a future app/energy/ is not mistaken for the English tree.
const isEnglish = rel => rel.split('/')[1] === 'en';

const PAGES = walk('app');
const ARABIC = PAGES.filter(rel => !isEnglish(rel) && !isSingleLanguage(rel));
const ENGLISH = PAGES.filter(isEnglish);

test('the walk of app/ found the Arabic storefront', () => {
  assert.ok(ARABIC.length > 0, 'no bilingual route files found under app/');
});

test('the single-language exemption matches path segments, not substrings', () => {
  assert.ok(isSingleLanguage('app/admin/(panel)/orders/page.js'));
  assert.ok(isSingleLanguage('app/api/order/route.js'));
  assert.ok(!isSingleLanguage('app/administration/page.js'));
  assert.ok(!isSingleLanguage('app/apiary/page.js'));
  // The routes that are exempt from the render-mode rules are NOT exempt here.
  assert.ok(!isSingleLanguage('app/checkout/page.js'));
  assert.ok(!isSingleLanguage('app/order/[ref]/page.js'));
});

/* ------------------------------------------------------------------ parity */

for (const rel of ARABIC) {
  const twin = `app/en/${rel.slice('app/'.length)}`;
  test(`${rel} has its English twin at ${twin}`, () => {
    assert.ok(existsSync(join(ROOT, twin)),
      `${twin} does not exist. Once middleware stops rewriting /en, this page ` +
      'has no file to serve it and the URL 404s.');
  });
}

for (const rel of ENGLISH) {
  const original = `app/${rel.slice('app/en/'.length)}`;
  test(`${rel} has the Arabic original it mirrors at ${original}`, () => {
    assert.ok(existsSync(join(ROOT, original)),
      `${original} does not exist. An English page with no Arabic counterpart is ` +
      'either a route the sitemap and the hreflang alternates cannot describe, or ' +
      'a leftover from a rename that only got applied to one tree.');
  });
}

/* ----------------------------------------------------------------- sitemap */

/**
 * A route pattern per page file: 'app/hair-types/[slug]/page.js' becomes
 * ['hair-types', '[slug]']. Route groups are dropped because '(panel)' is a
 * folder for the developer and never appears in a URL.
 */
const PATTERNS = PAGES.map(rel => rel
  .replace(/^app\//, '')
  .replace(/\/?page\.js$/, '')
  .split('/')
  .filter(seg => seg && !/^\(.*\)$/.test(seg)));

/** True when a route pattern can serve a concrete URL path. */
function serves(pattern, segments) {
  let i = 0;
  for (const seg of pattern) {
    if (/^\[\[\.\.\..+\]\]$/.test(seg)) return true;             // [[...all]]
    if (/^\[\.\.\..+\]$/.test(seg)) return i < segments.length;  // [...all]
    if (i >= segments.length) return false;
    if (!/^\[.+\]$/.test(seg) && seg !== segments[i]) return false;
    i++;
  }
  return i === segments.length;
}

/** The route file that would answer a URL path, or null. */
function routeFor(path) {
  const segments = path.split('/').filter(Boolean);
  const hit = PATTERNS.findIndex(pattern => serves(pattern, segments));
  return hit === -1 ? null : PAGES[hit];
}

test('the route matcher understands dynamic segments and route groups', () => {
  // Proves the matcher below is doing real work rather than passing everything.
  assert.ok(serves(['shop'], ['shop']));
  assert.ok(serves(['shop', '[kind]'], ['shop', 'wax']));
  assert.ok(serves([], []));
  assert.ok(!serves(['shop'], ['en', 'shop']));
  assert.ok(!serves(['shop', '[kind]'], ['shop']));
  assert.ok(!serves(['shop'], ['shop', 'wax']));
  assert.ok(serves(['blog', '[...rest]'], ['blog', 'a', 'b']));
  assert.ok(!serves(['blog', '[...rest]'], ['blog']));
  assert.ok(serves(['blog', '[[...rest]]'], ['blog']));
});

/**
 * The sitemap, generated with no database.
 *
 * app/sitemap.js queries the catalogue and the article table and falls back to
 * the static paths when there is none, which is the local condition and also
 * the condition on any build that has not been given DATABASE_URL. The variable
 * is removed rather than merely assumed absent, so this test asserts the same
 * set of URLs on a developer machine with a .env as it does in CI.
 *
 * That keeps product and article URLs out of scope here. They are dynamic
 * routes and the parity block above already requires
 * app/en/product/[slug]/page.js and app/en/article/[slug]/page.js to exist.
 */
delete process.env.DATABASE_URL;
const sitemap = (await import('../app/sitemap.js')).default;
const entries = await sitemap();

test('the sitemap emits both languages of every static path', () => {
  const paths = entries.map(e => new URL(e.url).pathname);
  assert.ok(paths.includes('/shop'), 'the Arabic shop is not in the sitemap');
  assert.ok(paths.includes('/en/shop'), 'the English shop is not in the sitemap');
  const english = p => p === '/en' || p.startsWith('/en/');
  assert.equal(
    paths.filter(english).length,
    paths.filter(p => !english(p)).length,
    'the two languages are not emitted in equal numbers, so one of them is short a page'
  );
});

for (const entry of entries) {
  const path = new URL(entry.url).pathname;
  test(`the sitemap URL ${path} has a route file that can serve it`, () => {
    const route = routeFor(path);
    assert.ok(route,
      `${path} is submitted to Search Console and annotated as an hreflang ` +
      'alternate of its twin, and after the cutover no route file answers it. ' +
      'The sitemap would be pointing a crawler at a 404.');
  });
}
