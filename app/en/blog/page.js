import BlogView, { blogMeta } from '../../_views/blog.js';

/**
 * The English article index, at /en/blog.
 *
 * /en is a real path segment, so this file exists purely to name the language
 * of the shared view — which here also selects the rows, since articles are
 * stored one per language. Pinning it as a constant is what lets the page
 * prerender: every channel that could carry a locale in from outside —
 * `searchParams`, `headers()`, a cookie — is a dynamic API, and touching one
 * opts the route out of static generation and zeroes the `revalidate` window
 * below.
 */

// Matches the Arabic twin at app/blog/page.js: both list articles published
// from the admin and must not disagree about how soon a new one shows up.
export const revalidate = 300;

export const metadata = blogMeta('en');

export default function BlogPageEn() {
  return <BlogView lang="en" />;
}
