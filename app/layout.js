import { Suspense } from 'react';
import { headers } from 'next/headers';
import { Anton, Cairo } from 'next/font/google';
import './globals.css';
import { site } from '../lib/config.js';
import PageWipe from './_components/PageWipe.js';

/**
 * Root layout for the storefront.
 *
 * The admin has its own layout under app/admin, so nothing here (nav, footer,
 * storefront chrome) leaks into it — but it does share this <html>, so the
 * fonts below cover it too.
 */

/**
 * The two faces the design is drawn in.
 *
 * The PHP site pulled these from a Google Fonts <link>. The port dropped it and
 * nothing replaced it, so every 'Anton' and 'Cairo' in the stylesheets — around
 * thirty declarations — has been silently falling back to a system sans this
 * whole time. Arabic degraded to something passable, which is why it went
 * unnoticed; the English display type did not.
 *
 * next/font rather than the original <link>: it downloads the files at build
 * time and serves them from this origin, so there is no third-party request on
 * the critical path, no round trip to two extra hosts, and a size-adjusted
 * fallback that keeps the swap from shifting the layout.
 *
 * Cairo needs the arabic subset spelled out. Left implicit it ships Latin only,
 * and the entire Arabic storefront — the default language — renders in the
 * fallback again, which is the bug this is fixing.
 */
const anton = Anton({
  subsets: ['latin'],
  weight: '400',            // Anton ships one weight
  display: 'swap',
  variable: '--font-anton',
});

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  // 400/600/700/800/900 are the weights the stylesheets actually ask for.
  // The original <link> requested 400;600;700;900, so the thirty rules set
  // in 800 were being synthesised by the browser — a faux-bold smear of the
  // 700. Cairo is a variable font, so the extra weight costs nothing.
  weight: ['400', '600', '700', '800', '900'],
  display: 'swap',
  variable: '--font-cairo',
});
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
    <html lang={lang} dir={dir} className={`${anton.variable} ${cairo.variable}`}>
      <body>
        {/* The wipe reads the current route, and useSearchParams needs a
            Suspense boundary when it is used this high in the tree. */}
        <Suspense fallback={null}><PageWipe /></Suspense>
        {children}
      </body>
    </html>
  );
}
