import { Suspense } from 'react';
import './globals.css';
import { site } from '../lib/config.js';
import PageWipe from './_components/PageWipe.js';

/**
 * Root layout for the storefront.
 *
 * The admin has its own layout under app/admin, so nothing here (nav, footer,
 * storefront chrome) leaks into it.
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

export default function RootLayout({ children }) {
  // No `dir` here, deliberately. A layout cannot read `?lang=`, so each
  // storefront page states its own direction on the <Dir> wrapper it renders.
  // Asserting dir="rtl" on <html> as well looked harmless but was not: <html>
  // is an ancestor of everything, so every `[dir="rtl"] ...` rule in the
  // stylesheets kept matching on English pages — which is how the English hero
  // lost Anton and fell back to Cairo Black. The wrapper is the only place the
  // direction is declared.
  return (
    <html lang="ar">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Anton&family=Cairo:wght@400;600;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* The wipe reads the current route, and useSearchParams needs a
            Suspense boundary when it is used this high in the tree. */}
        <Suspense fallback={null}><PageWipe /></Suspense>
        {children}
      </body>
    </html>
  );
}
