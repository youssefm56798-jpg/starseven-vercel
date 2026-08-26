import { Suspense } from 'react';
import { headers } from 'next/headers';
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

export default async function RootLayout({ children }) {
  // middleware.js resolves the locale from the path and passes it here. The
  // root layout renders <html> and can read neither params nor search params,
  // so a request header is the only channel that reaches it — and without it
  // every English page shipped <html lang="ar">, which also put <title> and
  // <meta description> in the wrong language for a crawler.
  const lang = (await headers()).get('x-s7-lang') === 'en' ? 'en' : 'ar';
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <html lang={lang} dir={dir}>
      <body>
        {/* The wipe reads the current route, and useSearchParams needs a
            Suspense boundary when it is used this high in the tree. */}
        <Suspense fallback={null}><PageWipe /></Suspense>
        {children}
      </body>
    </html>
  );
}
