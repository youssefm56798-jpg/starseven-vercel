import LegalPage, { legalMetadata } from '../../_components/LegalPage.js';

/**
 * The English privacy policy, at /en/privacy.
 *
 * /en is a real path segment, so this file exists purely to name the language
 * of the shared LegalPage component. Pinning it as a constant is what lets the
 * page prerender: every channel that could carry a locale in from outside —
 * `searchParams`, `headers()`, a cookie — is a dynamic API, and touching one
 * opts the route out of static generation.
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

export const metadata = legalMetadata('privacy', 'en');

export default function PrivacyPageEn() {
  return <LegalPage doc="privacy" lang="en" />;
}
