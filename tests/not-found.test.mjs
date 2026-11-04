/**
 * Source contracts for the shared 404 design and real middleware behavior.
 * These tests do not claim browser hydration, no-JS matched-route rendering,
 * HTTP404 document status or static build output; those need build/browser QA.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { localePath } from '../lib/urls.js';
import nextConfig from '../next.config.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const code = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const view = code(read('app/_views/not-found.js'));
const css = code(read('app/_views/not-found.css'));
const globalBoundary = code(read('app/global-not-found.js'));
const englishBoundary = code(read('app/en/not-found.js'));
const rootBoundary = code(read('app/not-found.js'));
const middlewareSource = code(read('middleware.js'));

// Match the repository's middleware test conventions. An actual import failure
// on a supported Node version must fail, not quietly skip the behavior tests.
let NextRequest;
let middleware;
const unsupported = typeof nodeModule.registerHooks !== 'function'
  ? 'node:module registerHooks needs Node 22.15 or newer' : false;
if (!unsupported) {
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context);
    },
  });
  ({ NextRequest } = await import('next/server.js'));
  ({ middleware } = await import('../middleware.js'));
}
const ORIGIN = 'https://newstarseven.com';
function run(path, headers = {}) {
  return middleware(new NextRequest(new Request(ORIGIN + path, { headers })));
}
function withPassword(value, fn) {
  const prior = process.env.SITE_PASSWORD;
  const had = Object.hasOwn(process.env, 'SITE_PASSWORD');
  if (value === undefined) delete process.env.SITE_PASSWORD;
  else process.env.SITE_PASSWORD = value;
  try { return fn(); } finally {
    if (had) process.env.SITE_PASSWORD = prior;
    else delete process.env.SITE_PASSWORD;
  }
}

// All entrypoints use one artwork implementation rather than divergent pages.
test('all 404 boundaries reuse the same shared light view', () => {
  for (const source of [globalBoundary, englishBoundary, rootBoundary]) {
    assert.match(source, /import NotFoundView from ['"]\.{1,2}\/_views\/not-found\.js['"]/);
    assert.match(source, /<NotFoundView\b/);
  }
  assert.match(view, /import ['"]\.\/not-found\.css['"]/);
  assert.match(view, /className="nf-art"/);
  assert.match(view, /Wrong page\. Still your style\./);
  assert.match(view, /الصفحة مش هنا\. ستايلك لسه هنا\./);
  for (const color of ['#fffdf8', '#12100b', '#e8362a', '#d7291d', '#6e6a60']) {
    assert.ok(css.includes(color), `missing brand color ${color}`);
  }
});

test('the view is presentational and has no database, authentication or data fetching', () => {
  const imports = [...view.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.deepEqual(imports.sort(), ['../../lib/urls.js', 'next/link']);
  assert.doesNotMatch(view, /\b(fetch|headers|cookies|useEffect|useState)\s*\(|['"]use server['"]|dangerouslySetInnerHTML/);
  assert.doesNotMatch(globalBoundary + englishBoundary + rootBoundary, /from\s+['"][^'"]*(?:db|auth|neon|resend|actions)/);
});

test('English and Arabic wrapper direction and recovery destinations stay paired', () => {
  assert.match(view, /const ar = lang !== 'en'/);
  assert.match(view, /lang=\{ar \? 'ar' : 'en'\}/);
  assert.match(view, /dir=\{ar \? 'rtl' : 'ltr'\}/);
  assert.match(view, /localePath\(path, ar \? 'ar' : 'en'\)/);
  assert.match(view, /href=\{L\('\/shop'\)\}/);
  assert.match(view, /href=\{L\('\/'\)\}/);
  assert.equal(localePath('/shop', 'en'), '/en/shop');
  assert.equal(localePath('/', 'en'), '/en');
  assert.equal(localePath('/shop', 'ar'), '/shop');
  assert.equal(localePath('/', 'ar'), '/');
  assert.match(view, /href=\{ar \? '\/en\/404' : '\/404'\}/);
});

test('artwork and controls retain accessible semantics and existing assets', () => {
  assert.equal((view.match(/<h1\b/g) || []).length, 1);
  assert.match(view, /<main\b/);
  assert.match(view, /<nav[^>]+aria-label=/);
  assert.match(view, /className="nf-art"[^>]*aria-hidden="true"[^>]*focusable="false"/);
  assert.match(view, /src="\/assets\/logo-s7\.png"[^>]*alt="New Star Seven"/);
  assert.match(view, /className="nf-sr"/);
  assert.match(css, /:focus-visible/);
  for (const variable of ['--font-anton', '--font-cairo', '--font-tajawal']) {
    assert.ok(css.includes(`var(${variable})`));
  }
});

test('404 CSS is scoped, responsive and honors reduced motion', () => {
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map(m => m[1].trim());
  assert.ok(selectors.length > 20);
  for (const selector of selectors) {
    if (selector.startsWith('@') || /^(from|to|\d+%)$/.test(selector)) continue;
    for (const part of selector.split(',')) {
      assert.ok(part.trim().startsWith('.s7-notfound'), `unscoped selector: ${part}`);
    }
  }
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /@media\(max-width:350px\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /animation:none!important/);
  assert.match(css, /transition:none!important/);
  assert.doesNotMatch(css, /animation[^;}]*\binfinite\b/);
});

test('English matched-resource boundary is explicit and static', () => {
  assert.match(englishBoundary, /<NotFoundView lang="en"\s*\/>/);
  const enLayout = code(read('app/en/layout.js'));
  assert.match(enLayout, /return children/);
  for (const source of [englishBoundary, enLayout, rootBoundary, code(read('app/layout.js'))]) {
    assert.doesNotMatch(source, /from\s+['"]next\/headers['"]|\bheaders\s*\(|\bcookies\s*\(/);
  }
  assert.match(rootBoundary, /usePathname\(\)/);
});

test('only isolated global boundary reads locale header and supplies its own document', () => {
  assert.match(globalBoundary, /from ['"]next\/headers['"]/);
  assert.match(globalBoundary, /\(await headers\(\)\)\.get\('x-s7-lang'\) === 'en' \? 'en' : 'ar'/);
  assert.match(globalBoundary, /<html lang=\{lang\}/);
  assert.match(globalBoundary, /<body><NotFoundView lang=\{lang\}/);
  assert.match(globalBoundary, /<meta name="robots" content="noindex"/);
  assert.match(globalBoundary, /from ['"]\.\.\/lib\/fonts\.js['"]/);
  assert.match(globalBoundary, /import ['"]\.\/globals\.css['"]/);
  assert.equal(nextConfig.experimental?.globalNotFound, true);
});

test('locale is a request-header override, never a rewrite or response locale header', () => {
  assert.match(middlewareSource, /const headers = new Headers\(request\.headers\)/);
  assert.match(middlewareSource, /headers\.set\('x-s7-lang', IS_ENGLISH\.test\(pathname\) \? 'en' : 'ar'\)/);
  assert.doesNotMatch(middlewareSource, /NextResponse\.rewrite\s*\(/);
});

test('runtime middleware overrides forged locale using exact English path segments', { skip: unsupported }, () => {
  withPassword(undefined, () => {
    for (const [path, lang] of [['/en', 'en'], ['/en/404', 'en'], ['/en/deep/missing', 'en'], ['/404', 'ar'], ['/deep/missing', 'ar'], ['/energy', 'ar']]) {
      const res = run(path, { 'x-s7-lang': lang === 'en' ? 'ar' : 'en', 'x-test-retained': 'yes' });
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get('x-middleware-request-x-s7-lang'), lang, path);
      assert.equal(res.headers.get('x-middleware-request-x-test-retained'), 'yes', path);
      assert.equal(res.headers.get('x-s7-lang'), null, path);
      assert.equal(res.headers.get('x-middleware-rewrite'), null, path);
      assert.equal(res.headers.get('location'), null, path);
    }
  });
});

test('API/assets bypass the locale branch and admin CSRF behavior is preserved', { skip: unsupported }, () => {
  withPassword(undefined, () => {
    for (const path of ['/api/no-such-endpoint', '/assets/logo-s7.png', '/_next/static/test.js']) {
      const res = run(path);
      assert.equal(res.headers.get('x-middleware-next'), '1');
      assert.equal(res.headers.get('x-middleware-request-x-s7-lang'), null);
      assert.equal(res.headers.get('x-middleware-rewrite'), null);
    }
    const fresh = run('/admin/forgot');
    assert.ok(fresh.cookies.get('s7_csrf')?.value);
    assert.equal(fresh.headers.get('x-middleware-request-x-s7-lang'), null);
    const existing = run('/admin/forgot', { cookie: 's7_csrf=existing-test-seed' });
    assert.equal(existing.cookies.get('s7_csrf'), undefined);
    assert.equal(existing.headers.get('x-middleware-next'), '1');
  });
});

test('holding gate still runs before locale and retains cron exemption', { skip: unsupported }, () => {
  withPassword('not-a-real-secret-test-fixture', () => {
    for (const path of ['/en/missing', '/admin/forgot', '/api/no-such-endpoint']) {
      const res = run(path);
      assert.equal(res.status, 401, path);
      assert.match(res.headers.get('www-authenticate') || '', /^Basic/);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('x-middleware-request-x-s7-lang'), null);
    }
    assert.equal(run('/api/cron/test').headers.get('x-middleware-next'), '1');
  });
});

test('legacy redirects still run before locale fallthrough', { skip: unsupported }, () => {
  withPassword(undefined, () => {
    for (const [from, to] of [['/shop?lang=en', '/en/shop'], ['/en/shop?kind=wax', '/en/shop/wax'], ['/article/test-ar', '/article/test']]) {
      const res = run(from);
      assert.equal(res.status, 301, from);
      assert.equal(new URL(res.headers.get('location')).pathname, to);
      assert.equal(res.headers.get('x-middleware-request-x-s7-lang'), null);
      assert.equal(res.headers.get('x-middleware-rewrite'), null);
    }
  });
});
