import HomeView, { homeMeta } from './_views/home.js';

/**
 * The Arabic home page, at the bare path.
 *
 * The language is a constant rather than something read off the request. It is
 * the one fact this file adds to the shared view, and hard-coding it is what
 * lets the page prerender: every channel that could carry a locale in from
 * outside — `searchParams`, `headers()`, a cookie — is a dynamic API, and
 * touching one opts the route out of static generation and zeroes the
 * `revalidate` window below. English is the same view at app/en/page.js.
 */

// The catalogue is queried on every render, so a price or a sold-out flag
// should not be more than a minute stale.
export const revalidate = 60;

export const metadata = homeMeta('ar');

export default function HomePage() {
  return <HomeView lang="ar" />;
}
