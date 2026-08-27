import { Suspense } from 'react';
import { headers } from 'next/headers';
import { Anton, Cairo, Tajawal } from 'next/font/google';
import './globals.css';
import { site } from '../lib/config.js';
import PageWipe from './_components/PageWipe.js';
import CardSpotlight from './_components/CardSpotlight.js';

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

/**
 * The Arabic display face.
 *
 * Two faces have been rejected here, and both rejections were about drawing
 * rather than loading — the Cairo above is genuine, and has been since the
 * fonts were wired up.
 *
 * Cairo went first. It is a text face, drawn to stay even and quiet at
 * paragraph sizes, which is exactly what makes it fall apart on the hero: at
 * 148px its Black weight has no stroke contrast to hold the eye, the counters
 * open up, and the whole line reads as a UI font that someone dragged bigger.
 *
 * Changa replaced it and was rejected in turn, with the note that modern and
 * bold was what was wanted. Changa is a modern kufi: squared terminals, angular
 * joins, an architectural silhouette rather than a typographic one. That kufi
 * flavour is the thing being objected to, not the weight, so the answer is not
 * a heavier kufi but a different construction altogether.
 *
 * Tajawal is that construction. It is a geometric Arabic sans — even stroke,
 * round unmodulated bowls, clean joins, no calligraphic contrast — which is the
 * neo-grotesque register contemporary Gulf and Egyptian brands are set in. Its
 * Black is the heaviest thing in the comparison: set on the hero's own three
 * lines it is visibly denser in colour than Cairo 900 or Changa 800, which is
 * what bold was asking for. It also partners the Latin hero properly. That is
 * set in Anton — tall, condensed, flat-terminalled, near-uniform stroke — and
 * Tajawal Black is the Arabic face that matches its density and its flatness,
 * so the two halves of a bilingual site read as one design.
 *
 * The rest of the shortlist was set on the same three lines and put aside.
 * Alexandria 900 is wider than the hero column and wraps outright. Zain 900 and
 * Noto Sans Arabic 900 carry real stroke modulation and read editorial next to
 * Anton's blunt grotesque. Almarai stops at 800 and is lighter in colour there.
 * Mada 900, Vazirmatn 900, Readex Pro 700 and IBM Plex Sans Arabic 700 all top
 * out at a strong UI bold rather than a poster black.
 *
 * Cairo stays. Everything below the display tier — body copy, buttons, nav,
 * product cards, the whole Arabic UI — is still set in it, because that is the
 * work it is good at. This is a second face for the headlines, not a swap.
 */
const tajawal = Tajawal({
  subsets: ['arabic', 'latin'],
  // 900 only. It is the single weight the stylesheet asks Tajawal for, and the
  // top of the family's range — anything heavier would have to be synthesised.
  weight: ['900'],
  display: 'swap',
  variable: '--font-tajawal',
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
    <html lang={lang} dir={dir} className={`${anton.variable} ${cairo.variable} ${tajawal.variable}`}>
      <body>
        {/* The wipe reads the current route, and useSearchParams needs a
            Suspense boundary when it is used this high in the tree. */}
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
