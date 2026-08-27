import LegalPage, { legalMetadata } from '../_components/LegalPage.js';

/**
 * The Arabic terms of sale, at /terms.
 *
 * The language is a constant rather than something read off the request. It is
 * the one fact this file adds to the shared LegalPage component, and hard-coding
 * it is what lets the page prerender: every channel that could carry a locale in
 * from outside — `searchParams`, `headers()`, a cookie — is a dynamic API, and
 * touching one opts the route out of static generation. English is the same
 * component at app/en/terms/page.js.
 */

/**
 * The legal copy is a constant, so this page has nothing of its own to
 * revalidate for — but it still needs a window, and the reason is the footer.
 * Chrome.js renders `new Date().getFullYear()` on the server. With no
 * revalidate a static page is cached until the next deploy, so this one would
 * be built in one year and keep insisting on it from 1 January until somebody
 * happened to push. A day is short enough that the wrong year is never visible
 * for long, and long enough to cost nothing.
 */
export const revalidate = 86400;

export const metadata = legalMetadata('terms', 'ar');

export default function TermsPage() {
  return <LegalPage doc="terms" lang="ar" />;
}
