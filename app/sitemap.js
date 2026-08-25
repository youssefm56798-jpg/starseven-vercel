import { sql, hasDb } from '../lib/db.js';
import { site } from '../lib/config.js';
import { HAIR_TYPES } from '../lib/hairtypes.js';

/**
 * sitemap.xml, generated from the live catalogue and published articles so it
 * can never drift from what is actually on the site.
 */
export default async function sitemap() {
  const base = site.url.replace(/\/$/, '');
  const now = new Date();

  // The hair-type pages are built from lib/hairtypes.js rather than the
  // database, so they belong with the static entries: they are listed even on
  // a build with no database, and adding a seventh tile lists itself.
  const hairTypes = [
    { url: `${base}/hair-types`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    ...HAIR_TYPES.map(t => ({
      url: `${base}/hair-types/${t.slug}`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    })),
  ];

  const staticPages = [
    { url: `${base}/`,        lastModified: now, changeFrequency: 'daily',   priority: 1.0 },
    { url: `${base}/shop`,    lastModified: now, changeFrequency: 'daily',   priority: 0.9 },
    ...hairTypes,
    { url: `${base}/blog`,    lastModified: now, changeFrequency: 'daily',   priority: 0.7 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${base}/terms`,   lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
  ];

  if (!hasDb()) return staticPages;   // let a build without a database still succeed

  try {
    const products = await sql`SELECT slug, created_at FROM products WHERE active = true`;
    const articles = await sql`
      SELECT slug, COALESCE(published_at, updated_at) AS m
        FROM articles WHERE status = 'published'`;

    return [
      ...staticPages,
      ...products.map(p => ({
        url: `${base}/product/${p.slug}`,
        lastModified: new Date(p.created_at),
        changeFrequency: 'weekly',
        priority: 0.8,
      })),
      ...articles.map(a => ({
        url: `${base}/article/${a.slug}`,
        lastModified: new Date(a.m),
        changeFrequency: 'monthly',
        priority: 0.7,
      })),
    ];
  } catch {
    return staticPages;
  }
}
