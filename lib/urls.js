import { site } from './config.js';

/**
 * One place that knows what a URL looks like in each language.
 *
 * Arabic sits at the bare path, English under /en. Every link, canonical,
 * hreflang alternate and sitemap entry goes through here, so the shape can
 * never drift between them — which is exactly how the site ended up with
 * correct hreflang pointing at pages that canonicalled themselves away.
 */

export const LOCALES = ['ar', 'en'];

/** Normalises whatever a page was handed into a locale we actually serve. */
export const toLocale = v => (v === 'en' ? 'en' : 'ar');

/**
 * A site-root-relative path for a page in a given language.
 *   localePath('/shop', 'ar') -> '/shop'
 *   localePath('/shop', 'en') -> '/en/shop'
 *   localePath('/', 'en')     -> '/en'
 */
export function localePath(path, lang) {
  const clean = '/' + String(path || '').replace(/^\/+/, '');
  if (toLocale(lang) !== 'en') return clean;
  return clean === '/' ? '/en' : `/en${clean}`;
}

/** The absolute URL, for canonicals, hreflang and the sitemap. */
export function localeUrl(path, lang) {
  const base = site.url.replace(/\/$/, '');
  return base + localePath(path, lang);
}

/**
 * The `alternates` block for a page's metadata.
 *
 * Five tags, and each one is earned:
 *   ar-EG / en-EG  the business can only fulfil in Egypt — cash on delivery,
 *                  EGP pricing, an Egyptian courier. A Gulf impression is an
 *                  order that cannot be taken.
 *   ar / en        kept as well. hreflang is a selection hint among results a
 *                  page already qualifies for, not a geo filter, so dropping
 *                  the bare tags would not keep anyone out — it would only stop
 *                  Google picking the right variant for an Arabic speaker whose
 *                  location signal is ambiguous.
 *   x-default      points at Arabic. Sending the fallback to English would aim
 *                  it at the minority language of the only market that can buy.
 */
export function alternatesFor(path) {
  const ar = localeUrl(path, 'ar');
  const en = localeUrl(path, 'en');
  return {
    canonical: ar,
    languages: {
      'ar-EG': ar,
      ar,
      'en-EG': en,
      en,
      'x-default': ar,
    },
  };
}

/** The same, but for the English rendering of a page — canonical flips. */
export function alternatesForLang(path, lang) {
  const alts = alternatesFor(path);
  return { ...alts, canonical: localeUrl(path, lang) };
}
