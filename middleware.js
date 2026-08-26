import { NextResponse } from 'next/server';

/**
 * Language routing.
 *
 * Arabic is the primary market and keeps the bare paths (/shop). English lives
 * under /en (/en/shop). Both are rewritten internally onto the same routes, so
 * no page file moved and every page keeps reading `lang` exactly as it did.
 *
 * Why not /ar + /en symmetrically: the Arabic URLs are already correct and
 * already the ones that go on packaging and into WhatsApp. Making them longer
 * would mean redirecting 24 healthy URLs to gain nothing. English is the half
 * that is currently unindexable, so it is the half that can be moved for free.
 *
 * This also closes an open crawl trap. Before, ?lang=fr, ?lang=EN, ?kind=bogus
 * and ?utm_source=x all returned 200 with Arabic content, and the only thing
 * containing that duplication was a wrong canonical. Self-referencing canonicals
 * without this whitelist would have turned a contained problem into an unbounded
 * one, so the whitelist has to land first or with them — never after.
 */

const LOCALES = new Set(['ar', 'en']);

/** Paths that are not localised storefront pages. */
const PASS_THROUGH = /^\/(?:api|admin|_next|assets|js|favicon|robots\.txt|sitemap\.xml)(?:\/|$)/;

export function middleware(request) {
  const { pathname, searchParams } = request.nextUrl;

  if (PASS_THROUGH.test(pathname)) return NextResponse.next();

  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0]?.toLowerCase();

  /* ---------------------------------------------------------- /en/... */
  if (first === 'en') {
    const rest = '/' + segments.slice(1).join('/');
    const url = request.nextUrl.clone();
    url.pathname = rest === '/' ? '/' : rest;
    url.searchParams.set('lang', 'en');
    return rewrite(url, request, 'en');
  }

  /* --------------------------------------------- legacy ?lang= handling */
  if (searchParams.has('lang')) {
    const value = searchParams.get('lang').toLowerCase();
    const url = request.nextUrl.clone();
    url.searchParams.delete('lang');

    if (value === 'en') {
      // 301 the old query form to its permanent home so any link already in
      // the wild, and anything Google learned, lands on the canonical URL.
      url.pathname = pathname === '/' ? '/en' : `/en${pathname}`;
      return NextResponse.redirect(url, 301);
    }
    // 'ar' is the default and needs no marker; anything else is not a language
    // we serve, and must not mint another crawlable URL.
    return NextResponse.redirect(url, 301);
  }

  /* ------------------------------------------------------------ Arabic */
  return rewrite(request.nextUrl.clone(), request, 'ar');
}

/** Rewrites, passing the resolved locale to the layout via a request header. */
function rewrite(url, request, lang) {
  const headers = new Headers(request.headers);
  // The root layout renders <html> and cannot read params or search params.
  // A request header is the one channel that reaches it.
  headers.set('x-s7-lang', lang);
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  // Everything except static assets and the files Next serves itself.
  matcher: ['/((?!_next/static|_next/image|assets|js|favicon.ico).*)'],
};
