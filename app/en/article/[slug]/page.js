import ArticleView, { articleMetadata, articleParams } from '../../../_views/article.js';

/**
 * The English article page, mirroring app/article/[slug]/page.js. Both render
 * app/_views/article.js and differ only in the language they pass it.
 *
 * The language is a compile-time constant rather than something read off the
 * request. English used to be a fiction maintained by middleware, which
 * rewrote /en/article/... onto the Arabic route with `?lang=en` attached — so
 * the page had to await a dynamic API to find out what language it was, which
 * opted it out of static generation and zeroed the revalidate window below.
 * /en is a real path segment now, so this file simply is the English one.
 *
 * The constant means "the language this URL asked for", and English is the
 * language more likely to be missing: an article published only in Arabic is
 * still served here, in Arabic, rather than 404-ing at an address a reader
 * followed a link to. The view makes that call and sets the page chrome from
 * the row it found — see app/_views/article.js.
 */

export const revalidate = 300;

/**
 * The English tree needs its own copy of this export — Next reads
 * generateStaticParams per route file, and the Arabic page's does nothing for
 * /en/article/... The slug set is the same in both trees, because a slug is
 * shared by an article and its translation, so both call the one query in the
 * view.
 */
export async function generateStaticParams() {
  return articleParams();
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  return articleMetadata(slug, 'en');
}

export default async function ArticlePage({ params }) {
  const { slug } = await params;
  return <ArticleView slug={slug} lang="en" />;
}
