import { sql, hasDb } from '../../lib/db.js';
import { alternatesForLang } from '../../lib/urls.js';
import { site } from '../../lib/config.js';
import { HAIR_TYPES, productPublic } from '../../lib/hairtypes.js';
import { Dir, Nav, Footer } from '../_components/Chrome.js';
import Landing from '../_components/Landing.js';
import '../landing.css';

/**
 * The home page, rendered once and mounted at both addresses.
 *
 * This body used to sit in app/page.js and take its language from
 * `searchParams`, because middleware rewrote /en onto /?lang=en and that query
 * string was the only channel carrying the locale into the page. Reading it
 * cost the page its prerender: `searchParams` is a dynamic API, so awaiting it
 * opted the route out of static generation and zeroed the `revalidate` window
 * on the way out. Now that /en is a real path segment there are two route
 * files, each handing this view its own language as a constant, and nothing
 * here learns anything about the request.
 *
 * landing.css is imported here rather than in either route file so both
 * addresses pull it from one place and neither can be left without it.
 */

/**
 * Title, description and hreflang alternates for one language of the home page.
 *
 * The title is `absolute` because the two home pages no longer sit at the same
 * depth. app/layout.js sets a '%s — New Star Seven' template, and Next applies
 * it to child segments but not to the segment that declares it — app/page.js
 * IS the root segment, so the Arabic home has never been suffixed, while
 * app/en/page.js is a child and would be. Both titles already say the brand
 * name, so the English home would have read 'New Star Seven — Hold your style —
 * New Star Seven'. Opting out keeps the two languages saying the same thing and
 * keeps /en's title exactly what it was while middleware was rewriting it onto
 * the root segment.
 */
export function homeMeta(lang) {
  const ar = lang !== 'en';
  return {
    title: {
      absolute: ar ? 'نيو ستار سفن — امسك ستايلك' : 'New Star Seven — Hold your style',
    },
    // Without its own description this page inherited the Arabic default in
    // app/layout.js, so the English home served an Arabic snippet.
    description: ar
      ? 'واكس وجل شعر بريميوم للرجالة، مصنوع في مصر. تثبيت ميجا من الصبح لآخر اليوم، من غير قشرة ومن غير دهون. اطلب أونلاين والدفع عند الاستلام.'
      : 'Premium men’s hair wax and gel, made in Egypt. Mega hold from morning to night, no flakes and no grease. Order online, cash on delivery.',
    alternates: alternatesForLang('/', ar ? 'ar' : 'en'),
  };
}

export default async function HomeView({ lang }) {
  // No DATABASE_URL means someone is working on layout without a database, so
  // render an empty grid rather than crash. A query that genuinely fails is a
  // different matter and is left to throw: the page is revalidated on a timer,
  // so Next serves the last good copy instead of an empty catalogue.
  let products = [];
  if (hasDb()) {
    const rows = await sql`SELECT * FROM products WHERE active = true ORDER BY sort, id`;
    products = rows.map(productPublic);
  }

  const organisation = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.name,
    url: site.url,
    logo: `${site.url}/assets/logo-s7.png`,
  };

  return (
    <Dir lang={lang}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organisation).replace(/</g, '\\u003c') }}
      />
      <Nav lang={lang} path="" />
      <main id="content">
      <Landing
        lang={lang}
        products={products}
        hairTypes={HAIR_TYPES}
        shipping={site.shipping}
        freeOver={site.freeOver}
      />
      </main>
      <Footer lang={lang} />
    </Dir>
  );
}
