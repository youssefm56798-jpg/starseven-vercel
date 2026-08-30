import { NextResponse } from 'next/server';

/**
 * The legacy-URL redirect table.
 *
 * Arabic is the primary market and keeps the bare paths (/shop). English lives
 * under /en (/en/shop), and as of the cutover that is a real route tree: app/en
 * holds an English twin of every storefront page, each pinning lang="en" as a
 * compile-time constant. Next routes /en/* to those files by itself, so this
 * file no longer rewrites anything. It redirects the addresses that predate the
 * tree and then gets out of the way.
 *
 * Why not /ar + /en symmetrically: the Arabic URLs are already correct and
 * already the ones that go on packaging and into WhatsApp. Making them longer
 * would mean redirecting 24 healthy URLs to gain nothing. English was the half
 * that was unindexable, so it was the half that could be moved for free.
 *
 * What remains here is the whole defence against the crawl traps this site used
 * to have. Before it, ?lang=fr, ?lang=EN, ?kind=bogus and ?utm_source=x all
 * returned 200 with the full Arabic catalogue at a second, third and fourth
 * address, and the only thing containing that duplication was a wrong canonical.
 * Self-referencing canonicals without this whitelist would have turned a
 * contained problem into an unbounded one, so the whitelist has to land first or
 * with them — never after. Each of the three redirects below closes one of those
 * traps, and deleting any of them re-opens it.
 *
 * Why the ?kind= rule lives here and not in next.config.mjs `redirects`: Next
 * forwards the original query string onto a redirect destination unless that
 * destination declares its own, so ?kind=wax would survive onto /shop/wax and
 * recreate the exact duplicate the rule exists to kill.
 *
 * Why nothing here decides <html lang> any more: this file used to hand the
 * resolved locale to the root layout in an x-s7-lang request header, which meant
 * the layout called headers(). headers() is a dynamic API, and a single call in
 * the root layout opts every route on the site out of static generation. That
 * header was the reason nothing here was ever prerendered. app/layout.js and
 * app/not-found.js were its only two readers and both now hardcode the language
 * of the tree they sit in, so the header — and the rewrite that carried it — are
 * gone.
 */

/** Paths that are not localised storefront pages. */
const PASS_THROUGH = /^\/(?:api|admin|_next|assets|js|favicon|robots\.txt|sitemap\.xml)(?:\/|$)/;

/** Matches the English tree as a path segment, so /energy is not mistaken for it. */
const IS_ENGLISH = /^\/en(?:\/|$)/i;

/**
 * The cookie name is repeated from lib/auth.js rather than imported. This file
 * runs on the edge runtime, and importing lib/auth.js would drag jose and the
 * database client in with it. tests/csrf-cookie.test.mjs asserts the two
 * spellings still agree, so the duplication cannot drift unnoticed.
 */
const CSRF_COOKIE = 's7_csrf';

/**
 * Give an anonymous visitor to /admin a CSRF seed of their own.
 *
 * Without this the token on /admin/login, /admin/forgot and /admin/reset is
 * derived from a constant, which makes it the same value for everyone and so
 * no protection at all. A page render cannot set a cookie in the App Router -
 * only a Server Action or a route handler can - so the middleware is the one
 * place that can mint it before the form is drawn.
 *
 * The value is written onto the REQUEST headers as well as the response, so
 * this very render sees it. Setting it only on the response would leave the
 * first page load still deriving its token from 'anon'.
 */
function withCsrfSeed(request) {
  if (request.cookies.get(CSRF_COOKIE)) return NextResponse.next();

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const headers = new Headers(request.headers);
  const had = headers.get('cookie');
  headers.set('cookie', had ? `${had}; ${CSRF_COOKIE}=${value}` : `${CSRF_COOKIE}=${value}`);

  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(CSRF_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/admin',
    maxAge: 60 * 60 * 8,
  });
  return res;
}

export function middleware(request) {
  const { pathname, searchParams } = request.nextUrl;

  if (PASS_THROUGH.test(pathname)) {
    return pathname === '/admin' || pathname.startsWith('/admin/')
      ? withCsrfSeed(request)
      : NextResponse.next();
  }

  /* ------------------------------------------------- legacy ?kind= filter */
  // Wax and gel are paths now, not a filter. This handles both /shop?kind=wax
  // and /en/shop?kind=wax, and it strips an unrecognised value rather than
  // serving the whole catalogue at a second address — the shape of every crawl
  // trap this site has had.
  if (/^\/(?:en\/)?shop$/i.test(pathname) && searchParams.has('kind')) {
    const kind = searchParams.get('kind').toLowerCase();
    const url = request.nextUrl.clone();
    url.searchParams.delete('kind');
    if (kind === 'wax' || kind === 'gel') url.pathname = `${pathname.replace(/\/$/, '')}/${kind}`;
    return NextResponse.redirect(url, 301);
  }

  /* ------------------------------------- legacy '-ar' article slugs ---- */
  // Arabic articles used to live on a '-ar' slug because the table had one
  // unique index across all languages. Twins share a slug now, so the old
  // addresses redirect to the shared one rather than 404.
  if (/^\/article\/.+-ar$/.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/-ar$/, '');
    return NextResponse.redirect(url, 301);
  }

  /* --------------------------------------------- legacy ?lang= handling */
  if (searchParams.has('lang')) {
    const value = searchParams.get('lang').toLowerCase();
    const url = request.nextUrl.clone();
    url.searchParams.delete('lang');

    if (value === 'en') {
      // 301 the old query form to its permanent home so any link already in
      // the wild, and anything Google learned, lands on the canonical URL.
      // A path that is already under /en only needs the parameter taken off:
      // prefixing it again would send /en/shop?lang=en to /en/en/shop, which is
      // a redirect into a 404. That case used to be unreachable because the /en
      // rewrite ran before this block and returned first.
      if (!IS_ENGLISH.test(pathname)) {
        url.pathname = pathname === '/' ? '/en' : `/en${pathname}`;
      }
      return NextResponse.redirect(url, 301);
    }
    // 'ar' is the default and needs no marker; anything else is not a language
    // we serve, and must not mint another crawlable URL.
    return NextResponse.redirect(url, 301);
  }

  /* ------------------------------------ a current address in either tree */
  // Nothing above matched, so this is a live URL: /shop is Arabic and /en/shop
  // is English, and both are ordinary route files that Next can resolve without
  // help. Pass it straight through. Not even a rewrite onto the same URL — that
  // would stamp x-middleware-rewrite on every storefront request for no gain,
  // and the rewrite is the thing this migration exists to remove.
  return NextResponse.next();
}

export const config = {
  // Everything except static assets and the files Next serves itself.
  //
  // This is knowingly over-broad now: with the rewrite gone, middleware runs on
  // every storefront path only to fall through to NextResponse.next(). It is
  // left alone in this commit on purpose. Narrowing it and deleting the rewrite
  // in the same change would make any English 404 afterwards ambiguous between
  // the two, and the narrowing buys very little — NextResponse.next() does not
  // stop Vercel serving prerendered HTML from the edge, so the saving is a
  // little edge compute and nothing more.
  //
  // When it is narrowed, the matcher only needs the paths the three redirects
  // can actually fire on: '/', '/shop', '/en/shop', '/article/:slug*', and
  // whatever can still arrive carrying ?lang= — the storefront pages. /api,
  // /admin and the asset routes are already skipped by PASS_THROUGH above and
  // would simply stop entering the function at all.
  matcher: ['/((?!_next/static|_next/image|assets|js|favicon.ico).*)'],
};
