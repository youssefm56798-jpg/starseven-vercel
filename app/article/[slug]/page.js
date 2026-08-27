import ArticleView, { articleMetadata, articleParams } from '../../_views/article.js';

/**
 * The Arabic article page. Its English twin is app/en/article/[slug]/page.js
 * and the two share app/_views/article.js.
 *
 * The language is a compile-time constant rather than something read off the
 * request. It used to arrive as a `?lang=` query parameter that middleware
 * rewrote /en/article/... onto, which meant awaiting a dynamic API here —
 * enough on its own to opt the route out of static generation and to quietly
 * rewrite the revalidate window below to zero. Now that /en is a real path
 * segment, the address already says which language it is.
 *
 * What the constant means is "the language this URL asked for", and that is
 * not always the language that comes back: an article with no translation is
 * served in whichever language it does exist in, so /en/article/x can render an
 * Arabic piece. The view decides that and sets the page chrome from the row it
 * found — see app/_views/article.js.
 */

export const revalidate = 300;

export async function generateStaticParams() {
  return articleParams();
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  return articleMetadata(slug, 'ar');
}

export default async function ArticlePage({ params }) {
  const { slug } = await params;
  return <ArticleView slug={slug} lang="ar" />;
}
