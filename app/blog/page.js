import BlogView, { blogMeta } from '../_views/blog.js';

/**
 * The Arabic article index, at /blog.
 *
 * The language is a constant rather than something read off the request. Here
 * it does more than pick copy — the articles table stores one row per language,
 * so this constant is the WHERE clause that decides which posts the page lists.
 * Hard-coding it is also what lets the page prerender: every channel that could
 * carry a locale in from outside — `searchParams`, `headers()`, a cookie — is a
 * dynamic API, and touching one opts the route out of static generation and
 * zeroes the `revalidate` window below. English is the same view at
 * app/en/blog/page.js.
 */

// Articles are edited in the admin and published from there, so a new post
// should appear without waiting for a deploy.
export const revalidate = 300;

export const metadata = blogMeta('ar');

export default function BlogPage() {
  return <BlogView lang="ar" />;
}
