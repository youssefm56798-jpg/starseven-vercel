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

export default async function sitemap() {
  const now = new Date();

  const staticPaths = [
    ['/', { lastModified: now, changeFrequency: 'daily', priority: 1.0 }],
    ['/shop', { lastModified: now, changeFrequency: 'daily', priority: 0.9 }],
    ['/hair-types', { lastModified: now, changeFrequency: 'monthly', priority: 0.8 }],
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
      // Articles are the one content type that exists in one language per row,
      // so each is listed at its own language's URL only. Pairing an AR article
      // with its EN twin needs the twin's slug, which the schema tracks in
      // group_key but nothing reads yet.
      ...articles.map(a => ({
        url: localeUrl(`/article/${a.slug}`, a.lang === 'en' ? 'en' : 'ar'),
        lastModified: new Date(a.m),
        changeFrequency: 'monthly',
        priority: 0.7,
      })),
    ];
  } catch {
    return base;
  }
}
