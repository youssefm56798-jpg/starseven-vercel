import HomeView, { homeMeta } from '../_views/home.js';

/**
 * The English home page, at /en.
 *
 * /en is a real path segment, so this file exists purely to name the language
 * of the shared view. Pinning it as a constant is what lets the page prerender:
 * every channel that could carry a locale in from outside — `searchParams`,
 * `headers()`, a cookie — is a dynamic API, and touching one opts the route out
 * of static generation and zeroes the `revalidate` window below.
 */

// Matches the Arabic twin at app/page.js: both render the same catalogue and
// must not disagree about how stale it is allowed to get.
export const revalidate = 60;

export const metadata = homeMeta('en');

export default function HomePageEn() {
  return <HomeView lang="en" />;
}
