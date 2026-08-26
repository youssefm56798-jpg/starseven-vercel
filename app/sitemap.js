import { sql, hasDb } from '../lib/db.js';
import { HAIR_TYPES } from '../lib/hairtypes.js';
import { localeUrl } from '../lib/urls.js';

/**
 * sitemap.xml, generated from the live catalogue and published articles so it
 * can never drift from what is actually on the site.
 *
 * Every page is listed once per language, and each entry carries the full
 * alternates set. Next renders those as the xhtml:link annotations Search
 * Console validates hreflang against — a second, independent signal to the one
 * in the page head. The previous version listed 24 Arabic URLs, no English
 * ones, and no annotations at all, which left the English half of the site
 * undiscoverable even after the canonicals were fixed.
 */

/** One entry per language for a path, each annotated with the other. */
function bilingual(path, { lastModified, changeFrequency, priority }) {
  const languages = {
    'ar-EG': localeUrl(path, 'ar'),
    ar: localeUrl(path, 'ar'),
    'en-EG': localeUrl(path, 'en'),
    en: localeUrl(path, 'en'),
    'x-default': localeUrl(path, 'ar'),
  };
  return ['ar', 'en'].map(lang => ({
    url: localeUrl(path, lang),
    lastModified,
    changeFrequency,
    priority: lang === 'ar' ? priority : Math.max(0.1, Math.round((priority - 0.1) * 10) / 10),
    alternates: { languages },
  }));
}

/**
 * Article rows grouped by slug, so a twinned pair is emitted as two annotated
 * URLs and a lone article as one unannotated URL.
 */
function articleEntries(rows) {
  const bySlugMap = new Map();
  for (const r of rows) {
    const lang = r.lang === 'en' ? 'en' : 'ar';
    const bucket = bySlugMap.get(r.slug) || new Map();
    bucket.set(lang, r);
    bySlugMap.set(r.slug, bucket);
  }

  const out = [];
  for (const [slug, bucket] of bySlugMap) {
    const path = `/article/${slug}`;
    const langs = [...bucket.keys()];

    const languages = {};
    if (bucket.has('ar')) { languages['ar-EG'] = localeUrl(path, 'ar'); languages.ar = localeUrl(path, 'ar'); }
    if (bucket.has('en')) { languages['en-EG'] = localeUrl(path, 'en'); languages.en = localeUrl(path, 'en'); }
    languages['x-default'] = localeUrl(path, bucket.has('ar') ? 'ar' : 'en');

    for (const lang of langs) {
      out.push({
        url: localeUrl(path, lang),
        lastModified: new Date(bucket.get(lang).m),
        changeFrequency: 'monthly',
        priority: lang === 'ar' ? 0.7 : 0.6,
        ...(langs.length > 1 ? { alternates: { languages } } : {}),
      });
    }
  }
  return out;
}

export default async function sitemap() {
  const now = new Date();

  const staticPaths = [
    ['/', { lastModified: now, changeFrequency: 'daily', priority: 1.0 }],
    ['/shop', { lastModified: now, changeFrequency: 'daily', priority: 0.9 }],
    // The two category pages carry the head terms — "hair wax", "hair gel" —
    // that /shop cannot rank for while it is titled after the whole line.
    ['/shop/wax', { lastModified: now, changeFrequency: 'daily', priority: 0.9 }],
    ['/shop/gel', { lastModified: now, changeFrequency: 'daily', priority: 0.9 }],
    ['/hair-types', { lastModified: now, changeFrequency: 'monthly', priority: 0.8 }],
    ['/brand', { lastModified: now, changeFrequency: 'monthly', priority: 0.6 }],
    // Built from lib/hairtypes.js rather than the database, so they are listed
    // even on a build with no database, and a seventh tile lists itself.
    ...HAIR_TYPES.map(t => [`/hair-types/${t.slug}`,
      { lastModified: now, changeFrequency: 'monthly', priority: 0.7 }]),
    ['/blog', { lastModified: now, changeFrequency: 'daily', priority: 0.7 }],
    ['/privacy', { lastModified: now, changeFrequency: 'yearly', priority: 0.3 }],
    ['/terms', { lastModified: now, changeFrequency: 'yearly', priority: 0.3 }],
  ];

  const base = staticPaths.flatMap(([p, meta]) => bilingual(p, meta));

  if (!hasDb()) return base;   // let a build without a database still succeed

  try {
    const products = await sql`SELECT slug, created_at FROM products WHERE active = true`;
    const articles = await sql`
      SELECT slug, lang, COALESCE(published_at, updated_at) AS m
        FROM articles WHERE status = 'published'`;

    return [
      ...base,
      ...products.flatMap(p => bilingual(`/product/${p.slug}`, {
        lastModified: new Date(p.created_at),
        changeFrequency: 'weekly',
        priority: 0.8,
      })),
      // An article and its translation share a slug now, so a twinned pair
      // gets both URLs and each is annotated with the other. An article that
      // exists in one language only is listed once and claims no alternate it
      // cannot serve — pointing hreflang at a missing translation is worse
      // than declaring none, because the URL resolves and serves the wrong
      // language.
      ...articleEntries(articles),
    ];
  } catch {
    return base;
  }
}
