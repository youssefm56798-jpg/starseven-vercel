import { Suspense } from 'react';
import { anton, cairo, tajawal } from '../lib/fonts.js';
import './globals.css';
import { site } from '../lib/config.js';
import PageWipe from './_components/PageWipe.js';
import CardSpotlight from './_components/CardSpotlight.js';

/**
 * Root layout for the storefront.
 *
 * The admin has its own layout under app/admin, so nothing here (nav, footer,
 * storefront chrome) leaks into it — but it does share this <html>, so the
 * fonts applied below cover it too.
 */

export const metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: 'نيو ستار سفن — امسك ستايلك | New Star Seven',
    template: '%s — New Star Seven',
  },
  description:
    'نيو ستار سفن: واكس وجل شعر بريميوم للرجالة. تثبيت ميجا، ريحة نضيفة، سعر مظبوط. اطلب أونلاين والدفع عند الاستلام.',
  icons: { icon: '/assets/favicon.png' },
  openGraph: {
    type: 'website',
    siteName: site.name,
    images: ['/assets/wax-red.png'],
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#12100B',
};

/**
 * Why <html lang> is a constant, and why <html> carries no dir at all.
 *
 * This looks wrong and it is deliberate. Please read this before "fixing" it.
 *
 * It used to read the locale from the x-s7-lang header middleware sets, which
 * meant `await headers()`. headers() is a dynamic API, and one call to one
 * anywhere in the root layout opts every route on the site out of static
 * generation and forces `revalidate` to zero — for the whole tree, not just
 * this file. That is the single reason nothing on this site is prerendered, so
 * this read had to go before any of the rest of the render-mode work could
 * matter. Arabic is the default language and the unprefixed tree, so Arabic is
 * what the constant says.
 *
 * The cascade does not depend on this element. The Dir component in
 * app/_components/Chrome.js sets lang and dir on the .s7page wrapper that
 * contains every visible element on the page, and the stylesheets' direction
 * rules are descendant selectors that find that wrapper, so both languages
 * still lay out exactly as they did.
 *
 * The dir attribute is omitted rather than pinned to "rtl", and that part is
 * not a style preference — pinning it breaks the English pages. Those
 * descendant selectors are unanchored: `[dir="rtl"] .en` in globals.css and
 * `[dir="rtl"] .s7home .hero-title` in landing.css match through ANY rtl
 * ancestor, and <html> is one. With dir="rtl" up here, an English page matches
 * every RTL rule in the site despite its own wrapper being ltr — measured, the
 * English hero flips from Anton to Tajawal and .en from weight 400 to 900,
 * which is precisely the "the English font changed again" report the font
 * commentary in lib/fonts.js is about. Leaving dir off keeps <html> at the
 * default ltr, so nothing matches through it and both languages render as
 * before. Only globals.css's letter-spacing rule was ever anchored (it was
 * rewritten to `body [dir="rtl"]` for this exact reason); once the rest are
 * anchored the same way, or once the root layout is split per language tree,
 * dir="rtl" can and should come back here.
 *
 * What is left genuinely wrong is small and accepted for now: <title> and the
 * meta description sit outside the wrapper, so a screen reader on an English
 * page announces them with Arabic pronunciation rules, and the document
 * scrollbar renders on the right in both languages instead of on the left for
 * Arabic. Correcting either means splitting this file into one root layout per
 * language, which is a separate phase with a much larger blast radius.
 *
 * Worth knowing before treating this as a regression: <html lang> was already
 * stale after any client-side language switch, because the root layout is not
 * re-rendered on navigation. Pinning it turns an intermittent wrongness that
 * depended on how the visitor happened to arrive into a uniform, predictable
 * one.
 */
export default function RootLayout({ children }) {
  return (
    <html lang="ar" className={`${anton.variable} ${cairo.variable} ${tajawal.variable}`}>
      <body>
        {/* The wipe reads the current route, and a client component that calls
            useSearchParams this high in the tree needs a Suspense boundary
            around it. That boundary is load-bearing rather than decorative:
            without one, Next bails the entire tree out of prerendering, which
            would silently undo the static-generation work in commit 7df5b6b
            that this file's own comment below is about. */}
        <Suspense fallback={null}><PageWipe /></Suspense>
        {/* One delegated pointer listener for every product card on the site —
            the home grid and the shop grid are both server-rendered, so this
            cannot live in either of them. */}
        <CardSpotlight />
        {children}
      </body>
    </html>
  );
}
